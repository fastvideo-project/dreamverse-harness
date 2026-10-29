---
description: "DreamVerse 浏览器工作区中的图片生成：用 @dv/ui-generation 的一份 defineGenerationUi 声明，把 image.generate 记录认领为图片版本，并给出它们的标签、状态文字和节点调色板槽位。"
kind: "package-reference"
---

# @dv/ui-image-generate

[English](README.md) | 中文

## 概述

使用本包在 DreamVerse 工作区中显示图片生成。它通过 `@dv/ui-generation` 的 `defineGenerationUi`，把 `image.generate` 记录声明为图片版本，并给出它们的标签、状态文字和节点调色板槽位。工具包在画布上、版本编辑器中、对话中和历史中绘制这些版本。只有在 host 插件声明了 `image.generate` 操作的组合中（例如 `@dv/image-generate`），这些版本才会出现。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app`、`@dv/ui-canvas`、`@dv/ui-media` 和 `@dv/ui-history` 的 profile 里挂载插件；`@dv/bundle` 用下面这一行挂载它。浏览器半边注入 `@deepseek-ai/dsh-client-ui-renderer` 和 `@deepseek-ai/dsh-client-ui-tool`（它声明对话卡片所在的 `tool.call.toolview` 插槽）。`bundle` 脚本（`tsdown`）写出浏览器 bundle `lib/client.js`，由 `./client` 导出提供。

```yaml
- id: dv-ui-image-generate
  name: '@dv/ui-image-generate'
```

Host 半边（`src/index.ts`）是一个什么都不做的 `apply`。浏览器半边（[`src/client/index.ts`](src/client/index.ts)）只导出 `inject` 和 `apply`，即 [`@dv/ui-generation`](../ui-generation/README.zh.md) 的一份 `defineGenerationUi` 声明所生成的插件：

| 字段 | 值 |
| --- | --- |
| `id` | `'@dv/ui-image-generate'` |
| `type` | `'image'` |
| `operations` | `['image.generate']` |
| `label` | 图片 / Image |
| `color` | `var(--dv-node-4)`，即 `@dv/ui-shell` 节点调色板的第 4 个槽位 |
| `status` | 运行中 生成中… / Generating…，失败 生成失败 / Generation failed，完成 已生成 / Generated |

该声明不设置 `preview`，也不设置其他字段，所以这些版本使用工具包的默认值。这些版本的画布卡片、版本编辑器、重试 / Retry 动作、对话卡片和历史行都来自工具包；[`@dv/ui-generation`](../ui-generation/README.zh.md) 记载了它们和每个 `GenerationUiSpec` 字段。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本包没有自己的逻辑：每个注册都来自 `defineGenerationUi`，UI 核心包也不写出 `image` 类型。

`tests/image-generate.client.spec.tsx` 只检查插件注册的内容。它检查本包只导出 `inject` 和 `apply`，节点类型 `image` 以声明中的标签、调色板槽位和状态文字认领 `image.generate`，以及以该类型、工具 `dv_image_generate` 和该操作为键的条目会注册，并随插件离开。

| 文件 | 内容 |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | `defineGenerationUi` 声明 |
| [`src/index.ts`](src/index.ts) | 空的 Host 入口 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/ui-generation`](../ui-generation/README.zh.md) 拥有本包所声明的工具包：版本卡片、版本编辑器、重试 / Retry、对话卡片和历史行。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md) 绘制这些版本。
- [`@dv/image-generate`](../image-generate/README.zh.md) 拥有 `image.generate` 操作。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；工具包从画布写下的 `image.generate` 记录只经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；本包不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **工具包的延期工作同样适用。** 本插件的版本卡片、版本编辑器和对话卡片来自 `@dv/ui-generation`；见[它的已知限制](../ui-generation/README.zh.md#known-limitations-and-deferred-work)。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
