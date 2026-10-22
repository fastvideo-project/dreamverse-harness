---
description: "DreamVerse 生成原语（例如镜头渲染）的浏览器工具包：defineGenerationUi 把一个 GenerationUiSpec 变成 UI 插件，注册该原语版本的认领式画布节点类型、版本卡片和版本编辑器、重试动作、每个操作的智能体工具对话卡片，以及带缩略图的历史行。"
kind: "package-reference"
---

# @dv/ui-generation

[English](README.md) | 中文

## 概述

使用本包让一个生成原语（例如镜头渲染）用一份声明获得它在浏览器中的全部呈现。`defineGenerationUi` 返回的插件把原语各操作的每条记录画成画布上的一个版本，打开可以渲染新版本的版本编辑器，为失败的版本添加 重试 / Retry，绘制每个操作的智能体工具调用的对话卡片，并在历史中以缩略图显示每条记录。`@dv/ui-shot-render` 就是这样一份声明。

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

把 `@dv/ui-generation` 加入原语 UI 包的 `devDependencies`，并导入 `@dv/ui-generation/generation-kit.tsx`；`./*` 导出映射到 `src/client/*`，原语包的客户端 bundle 会内联该工具包。工具包没有 Loader 行：它的 Host 半边（`src/index.ts`）不导出任何内容。原语包导出插件，`@dv/ui-shot-render` 就是这样做的：

```ts ignore-check
export const { inject, apply } = defineGenerationUi({
  id: '@dv/ui-shot-render', type: 'take', operations: ['shot.render'], label: ['版本', 'Take'], color: 'var(--dv-kind-take)',
  deepenOn: ['first_frame'],
  status: { running: ['渲染中…', 'Rendering…'], failed: ['生成失败', 'Render failed'], done: ['已渲染', 'Rendered'] },
  references: record => record.params['task'] !== 't2v',
  preview: (record, state) => record.outputs.find(id => state.assets.find(asset => asset.id === id)?.mime.startsWith('image/') === true),
})
```

### 工具包 API

工具包的入口是 [`src/client/generation-kit.tsx`](src/client/generation-kit.tsx)。它的描述符使用画布契约（`@dv/ui-canvas/contract`，即 `@dv/ui-canvas` 的 [`src/client/contract/index.ts`](../ui-canvas/src/client/contract/index.ts)）和历史契约（`@dv/ui-history/contract`）的类型。

| 符号 | 含义 |
| --- | --- |
| `defineGenerationUi(spec)` | 返回一个生成原语的 `UiPlugin`（`{ inject: [], apply }`） |
| `GenerationUiSpec` | 声明。必填：`id`（注册它的包）、`type`（节点类型键，例如 `'audio'`）、`operations`（其记录即为版本的生成操作）、`label`（中英文类型标签）、`color`（主题颜色，例如 `var(--dv-kind-take)`）和 `status`（`StatusWords`）。可选：`column`（默认 2）、`deepenOn`（把版本推到其读取来源节点右边一列的输入角色）、`bodyHeight`（默认 117，即 208 px 卡片宽度下的 16:9 画面）、`references(record)`（操作声明了 `reference` 输入时，版本编辑器是否为该版本提供参考标签；默认是）、`subject(record)`（历史主题；默认无）和 `preview(record, state)`（不是第一个输出时，在小视图中代表版本的输出） |
| `StatusWords` | 中英文文本对 `running`、`failed` 和 `done` |
| `Text` | 中英文文本对 |

### 插件注册的内容

插件在各描述符的服务存在时注册它们，任何加载顺序都有效，每个注册随它的服务或插件一起离开：

- **认领式节点类型。** `dvCanvas.nodeTypes` 以 `type` 和每个操作的 `op:<operation>` 为键，所以认领了其中某个操作的第二个类型会抛错并给出持有者的名字，例如 `registry key "op:shot.render" is already registered by @dv/ui-shot-render`。画布从记录构建每个认领式节点；工具包提供标题、meta、预览、主体高度和状态文字。锚定链上的版本以它的位置和分支为标题，例如 镜头 1 · 9:16 / Shot 1 · 9:16；其他版本以界面语言的操作标签为标题，没有时用操作名。同组有多个版本时追加编号，例如 ` · 第 2 次` / ` · take 2`。meta 是第一个有时长的输出的时长，例如 `2.5s`。
- **卡片主体**，以 `type` 为键的 `dv.canvas.card` 条目。它在高度为该类型主体高度（默认 117 px）的画面中通过 `dv.media` 以用途 `card` 绘制版本的预览，没有时绘制第一个输出；待处理的版本在画布的运行中文字下显示空画面。
- **版本编辑器**，以 `type` 为键的 `dv.canvas.editor.claimed` 条目。它通过 `dv.media` 以用途 `loop` 播放第一个输出，以版本的预览作为静帧，并显示失败版本的失败原因。它显示模型和生成任务（任务在 `GET /api/dv/tasks` 中的标签，没有时用任务名），并为操作在 `GET /api/dv/operations` 中声明的每个参数显示一个字段：先是提示词，再是其他参数，模型键参数 `modality`、`task`、`provider` 和 `model` 不显示。操作声明了 `reference` 输入且 `spec.references` 允许时显示参考标签；标签打开其带版本条目所在节点的编辑器（`host.openNode`）或其素材的预览（`host.preview`），＋ 添加素材 / + Add asset 打开 `host.pickAssets(…, { versions: true }, …)`。渲染新版本 / Render new take 调用 `host.rerun`，带版本的操作、改过的输入、版本的参数加上改过的字段（清空的字段去掉其参数），`based_on` 设为该版本；等待期间按钮禁用并显示运行中文字，被拒绝的请求在按钮下显示错误。操作不在该列表中的版本不显示参数，也没有按钮。
- **重试 / Retry 动作**，`dvCanvas.actions` 中的 `<id>:retry`，顺序 0。它只在原语操作的失败认领式版本上显示，并用记录自己的操作、输入和参数调用 `host.rerun`，`based_on` 为该记录。
- **对话卡片**，每个操作一个 `tool.call.toolview` 条目，以操作的工具名为键，例如 `shot.render` 的 `dv_shot_render`。它显示操作标签、调用所处阶段的状态文字、模型和任务行、提示词、通过 `dv.media` 以用途 `player` 绘制的第一个输出，以及调用结束后的 在历史中查看 / Show in history。
- **历史行**，每个操作一个 `dvHistory.rows` 条目。每行以 `spec.subject` 为主题，以 `spec.preview`（没有时为第一个输出）为缩略图。

对话卡片和版本编辑器通过 [`src/client/loaded.ts`](src/client/loaded.ts) 的注入 `hooks` 读取操作标签和任务标签：两个源在第一次订阅时各加载一次 `GET /api/dv/operations` 和 `GET /api/dv/tasks`，加载失败时保持为空，所以每个读取方都退回到名称。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`defineGenerationUi` 从声明一次性构建节点类型、重试 动作和历史行，然后在 `apply` 中按服务（`dvCanvas`、`slots`、`dvHistory`）各开一个 `ctx.inject` 块注册它们。画布计算每个版本的谱系（它的锚定链和在组内的编号）并交给节点类型的 `entry`，所以认领式节点不会与它的记录不一致。版本编辑器从画布传入的 `operations` 所有者属性读取声明的参数，它的表单使用 `@dv/ui-kit/form.ts` 的 `fieldsOf` 和 `paramsOf`。

`tests/` 下的测试在 `@deepseek-ai/dsh-client-test-runtime` 的 `SlotTestRuntime` 下挂载工具包，由真实的 `@dv/ui-media` 和 `@dv/ui-asset-pool` 插件绘制媒体。`tests/take-kind.client.ts` 定义认领 `shot.render` 和 `clip.extend` 的测试种类 `test_take`，以及一个记录调用的画布 host。`generation-kit.client.spec.tsx` 检查标题、meta、预览、状态文字、卡片主体、重试 动作，以及卸载时移除每个注册。`take-editor.client.spec.tsx` 检查播放器、字段、重新渲染请求、参考标签和错误；`generation-card.client.spec.tsx` 在对话会话中检查对话卡片。`plugin-proofs.client.tsx` 存放每个原语自己的测试在其插件上运行的检查：它在 `@dv/ui-canvas` 之前挂载插件并挂载画布，找到某条记录唯一的节点，渲染已结束调用的对话卡片，并列出每个不是 JSON 数据或函数的注入值或所有者值。`plugin-proofs.client.spec.tsx` 在 `@dv/ui-shot-render` 上运行这些检查。

| 文件 | 内容 |
| --- | --- |
| [`src/client/generation-kit.tsx`](src/client/generation-kit.tsx) | 声明、节点类型、卡片主体、重试 动作、历史行和插件 |
| [`src/client/TakeEditor.tsx`](src/client/TakeEditor.tsx) | 版本编辑器 |
| [`src/client/GenerationCard.tsx`](src/client/GenerationCard.tsx) | 对话卡片和 `StatusWords` |
| [`src/client/loaded.ts`](src/client/loaded.ts) | 操作和任务标签源 |
| [`src/client/generation-card.module.css`](src/client/generation-card.module.css) | 对话卡片样式 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/generation`](../generation/README.zh.md) 声明生成原语的 Host 半边。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md) 构建认领式节点并渲染卡片和编辑器条目。
- [`@dv/ui-media`](../ui-media/README.zh.md) 通过 `dv.media` 绘制每个输出。
- [`@dv/ui-history`](../ui-history/README.zh.md) 绘制历史行。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；版本编辑器的 渲染新版本 和 重试 动作写下的记录只经由 [`@dv/project`](../project/README.zh.md) 的 `dv:project` 提示词段落以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；工具包不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **视图通过 `@dv/ui-kit` 的 hook 读取文案。** `TakeEditor` 和 `GenerationCard` 用 `useText` 选择文本，节点类型标签、状态文字和 重试 标签用 `pickText`，它们都跟随 `<html lang>`，而不是使用注入的 `hooks` 源和插槽的 `t`。
- **每个生成插件自己加载标签。** `apply` 为标签源创建自己的 `DvClient`，所以每个插件各请求一次 `GET /api/dv/operations` 和 `GET /api/dv/tasks`，对话卡片从这份副本读取操作标签，而版本编辑器读取画布的 `operations`。
- **版本标题用镜头命名。** 工具包把锚定的版本命名为 镜头 N / Shot N，把带编号的版本命名为 第 N 次 / take N；`GenerationUiSpec` 没有字段可以改变这些文字。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
