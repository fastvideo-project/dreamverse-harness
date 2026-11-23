---
description: "DreamVerse 的 MCP 预设：在 MCP 插件开启时提供配置好的 MCP 服务器（Blender、ComfyUI），供一步添加。"
kind: "package-reference"
---

# @dv/mcp-presets

[English](README.md) | 中文

## 摘要

使用本包选择 DreamVerse 推荐哪些 MCP 服务器。MCP 插件开启时，它通过 `ctx.mcpServers.offerPresets()` 把配置好的预设提供给 [MCP 服务器列表](../../mcp/mcp-servers/README.zh.md)，[`@dv/ui-mcp-presets`](../ui-mcp-presets/README.zh.md) 在 MCP 页面把每个预设显示成一张卡片，一步添加对应的服务器。MCP 插件关闭时，这一行仍然处于激活状态，但不提供任何预设。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

[`@dv/bundle`](../../bundle/dv/README.zh.md) 的 `dv-mcp-presets` 行配置这些预设：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `presets` | `{}` | 按添加的服务器名称索引的预设；每个预设有 `title`、`description` 和 `spec`（stdio 或 `streamable-http` 服务器配置，与服务器列表相同） |

DreamVerse 提供 `blender`（`uvx mcp-for-blender@2.1.9`，需要一个开着 MCP for Blender 插件、监听 9876 端口的 Blender）和 `comfyui`（`uvx comfy-mcp@0.10.0`，驱动 127.0.0.1:8188 上的 ComfyUI）。两者都通过 `uvx` 启动，harness 的 PATH 里必须有 `uvx`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`apply` 用 `ctx.inject` 等待可选的 `mcpServers` 服务，并在该作用域的 effect 中提供预设，因此关闭 MCP 插件会撤回预设，重新开启会再次提供。这一行不声明必需的服务，所以无论 MCP 插件是否开启，它都会激活。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [MCP 服务器列表](../../mcp/mcp-servers/README.zh.md)——预设如何列出和添加。

-----

<a id="model-experience"></a>
## 模型体验

无，因为提供预设并不会添加服务器；由用户添加，面向模型的工具都由列表中的服务器提供。

#### KV Cache 影响

无直接影响。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 预设的标题和描述是英文；MCP 页面卡片（[`@dv/ui-mcp-presets`](../ui-mcp-presets/README.zh.md)）为 `blender` 和 `comfyui` 显示自己的中英文文案。
