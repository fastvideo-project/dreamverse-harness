---
description: "在 Plugins 页面开启 MCP，并在它的页面上管理 MCP 服务器。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-mcp-bundle

[English](README.md) | 中文

## 摘要

这个可选 bundle 组合了 [MCP 服务器列表](../mcp-servers/README.zh.md) 和它的 [管理页](../../client/ui-mcp-servers/README.zh.md)。安装包会在 Plugins 页面的 **Official** 分组里提供它，默认关闭。

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

在 Web 侧边栏打开 Plugins，开启带插头图标的 **MCP**。侧边栏随后会出现 **MCP** 入口，在它的页面上可以添加、删除和重新连接 MCP 服务器；每个已连接服务器的工具都会加入所有 agent 的工具列表。关闭 bundle 会断开所有服务器，已保存的列表会保留，下次开启时继续使用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

静态的 `cordis.patch.yml` 插入 `mcp-servers` 和 `ui-mcp-servers` 两行。服务器列表保存在 profile patch 的 `mcp-servers` 条目里，这个条目不受 bundle 自身开关的影响。本包不发布运行时不变量配套模块，因为这个纯配置包没有运行时状态。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [MCP 客户端](../mcp-client/README.zh.md)——服务器列表为每个服务器挂载一次的插件。

-----

<a id="model-experience"></a>
## 模型体验

无，因为已连接的服务器通过 MCP 客户端添加它们的工具和提示词段。

#### KV Cache 影响

无直接影响；参见 [服务器列表](../mcp-servers/README.zh.md#model-experience)。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 本 bundle 不预置任何服务器；每个服务器都在 bundle 页面或 profile patch 中添加。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

无。

</details>
