---
description: "保存用户在浏览器里添加的 MCP 服务器并逐个连接，让它们的工具进入模型的工具列表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-servers

[English](README.md) | 中文

## 摘要

`dsh-mcp-servers` 管理一份由用户在浏览器里添加和删除的 MCP 服务器列表。它通过 Settings 服务把列表保存在自己的 profile 条目里，并在 Host 上为每个服务器挂载一个 [`@deepseek-ai/dsh-mcp-client`](../mcp-client/README.zh.md) 实例，于是每个服务器的工具都以 `mcp__<server>__<tool>` 的名字注册在原生工具旁边。`mcpServers` Remote 提供这份列表，以及每个服务器的连接阶段和工具清单。[MCP bundle](../mcp-bundle/README.zh.md) 挂载本插件；[管理页](../../client/ui-mcp-servers/README.zh.md) 负责显示。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Plugins 页面打开 **MCP**，进入它的页面，点击 **添加服务器**。stdio 服务器需要填写命令、每行一个的参数，以及 `KEY=VALUE` 格式的环境变量；HTTP 服务器需要填写地址和 `Name: Value` 格式的请求头。保存后，服务器写入 profile 的 `cordis.patch.yml` 中 `mcp-servers` 条目的 `servers` 字段；列表会立即连接它，并显示 **连接中**、**已连接 · N 个工具**，或带启动错误的 **连接失败**。**重新连接** 用于重试失败的服务器，例如在启动它所连接的程序之后；**删除** 会移除服务器并撤回它的工具。

同一份列表也可以手写：

```yaml
- id: mcp-servers
  config:
    servers:
      blender:
        transport: stdio
        command: /usr/local/bin/uvx
        args: [mcp-for-blender@2.1.9]
        env: { BLENDER_HOST: 127.0.0.1, BLENDER_PORT: '9876' }
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `servers` | `{}` | 按名称索引的服务器；每项是 stdio 配置（`command`、`args`、`env`）或 `streamable-http` 配置（`url`、`headers`）。实时字段：保存后无需重新加载插件即可重新连接服务器。 |
| `toolCallTimeoutMs` | `60000` | 每次 MCP 工具调用的超时时间，传给每个服务器的客户端。 |

其他插件可以通过 `ctx.mcpServers.offerPresets({ <name>: { title, description, spec } })` 提供预设，也就是用户一步就能添加的服务器；它返回撤回这些预设的释放函数，名称已被提供时会失败。`mcpServers` Remote 在 `snapshot().presets` 中列出提供的预设并带上 `added` 标记，`addPreset(name)` 会把预设的配置按它的名称保存。服务器列表本身不保存预设，因此部署提供的预设不在 Settings 会改写的 profile 条目里。DreamVerse 通过 [`@dv/mcp-presets`](../../dv/mcp-presets/README.zh.md) 提供它的预设。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

`servers` 是一个 volatile 配置字段。`addServer` 和 `removeServer` 对插件自己的条目调用 `settings.replace()`；随后 Loader 发出 `loader/volatile-update`，一次串行的对账先释放每个被删除或被修改的服务器的客户端，再挂载新的客户端，因此重复使用的名称在下一个客户端占用前已经空出。每个客户端以 `failOnStartupError: true` 挂载；fiber 落定后的状态决定上报的阶段，启动错误信息会保留用于显示。服务器的工具按 `mcp__<server>__` 前缀从全局工具注册表读取，`tools/change` 会唤醒 `follow()` 的观察者。

Remote 方法名避开了浏览器端 Remote 命名空间服务的成员（`remove`、`has` 等）；名称冲突会让浏览器端贡献挂载失败。

本包不发布运行时不变量配套模块，因为列表的唯一状态是 Loader 持有的配置，以及由该配置派生的客户端 fiber。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [MCP 客户端](../mcp-client/README.zh.md)——传输方式、工具命名，以及服务器可用的协议特性。
- [MCP 资源](../mcp-resources/README.zh.md)——所有已连接服务器共用的资源工具。

-----

<a id="model-experience"></a>
## 模型体验

### 服务器的工具和说明

#### 模型看到什么

每个已连接的服务器会贡献它的 [MCP 客户端](../mcp-client/README.zh.md#model-experience) 发布的工具和 `mcp:<server>` 说明段，工具名为 `mcp__<server>__<tool>`。正在连接或连接失败的服务器不贡献任何内容。服务器列表本身不添加工具或提示词文本。

#### Token 影响

工具和说明的 token 随已连接服务器的数量增长，具体见 MCP 客户端的说明；空列表不增加 token。

#### KV Cache 影响

添加、删除或重新连接服务器会改变工具列表和对应的 `mcp:<server>` 段，从第一个变化的工具 schema 或提示词段开始，缓存前缀失效。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 环境变量和请求头以明文保存在 profile 里；需要密钥的服务器会把密钥存在那里，直到列表改用凭据服务。
- 启动失败的服务器会一直保持失败状态，直到点击 **重新连接**；连接中断后的重连遵循 MCP 客户端自己的策略。
- 修改已保存的服务器需要先删除再重新添加。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

无。

</details>
