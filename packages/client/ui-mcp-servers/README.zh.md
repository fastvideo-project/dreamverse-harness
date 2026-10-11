---
description: "在侧边栏添加 MCP 入口和它打开的页面，用于列出 MCP 服务器，并添加、删除或重新连接服务器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp-servers

[English](README.md) | 中文

## 摘要

这个 Client 插件在侧边栏 **插件** 下方添加 **MCP** 入口，点击后打开带服务器管理区的 MCP 页面。同一个管理区也显示在插件页中 [MCP bundle](../../mcp/mcp-bundle/README.zh.md) 的页面上。它挂载 [`dsh-mcp-servers`](../../mcp/mcp-servers/README.zh.md) 生成的 `mcpServers` Remote，跟随服务器列表的变化，并提供 **添加服务器**、**重新连接** 和 **删除**。列表行沿用插件页面自己的行尺寸，所以看起来是该页面的一部分。

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

在插件页开启 **MCP** 后，侧边栏会立即出现 **MCP** 入口；关闭 MCP 后入口消失。点击入口打开 MCP 页面。每个服务器行显示名称、启动命令或地址、连接状态，以及一个 **工具** 开关，展开后列出该服务器面向模型的工具名称和描述。**添加服务器** 会打开一个对话框，用于添加 stdio 服务器（命令、参数、环境变量）或 HTTP 服务器（地址、请求头）。连接失败的服务器会显示启动错误和 **重新连接**。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

插件以面板 id `mcp` 注册一个 `sidebar.panellist` 入口和一个 `main` 页面（顺序 1，排在插件之后），并以 `@deepseek-ai/dsh-mcp-bundle` 为键注册 `plugins.bundle.config` 条目；三者渲染同一个管理区。每个 Client 插件只开一条 `follow()` 流，写入一个快照存储，所有渲染出来的管理页都从这里读取；传输失败时保留最后一份列表并显示错误。Remote 挂载和 UI 注册共用一个释放函数，做法与语音输入插件相同。Host 端只是一个空标记。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [插件管理页](../ui-plugin-manager/README.zh.md)——本管理页渲染到的页面和插槽。

-----

<a id="model-experience"></a>
## 模型体验

无，因为管理页只编辑服务器列表，面向模型的工具都由列表中的服务器提供。

#### KV Cache 影响

无直接影响；参见 [服务器列表](../../mcp/mcp-servers/README.zh.md#model-experience)。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 对话框没有编辑模式；要修改服务器，需要先删除再重新添加。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节——点击展开</summary>

无。

</details>
