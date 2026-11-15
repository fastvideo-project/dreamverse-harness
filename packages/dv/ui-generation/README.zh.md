---
description: "DreamVerse 生成原语（例如镜头渲染）的浏览器工具包：defineGenerationUi 把一个 GenerationUiSpec 变成 UI 插件，注册该原语节点的画布节点类型、节点卡片和节点编辑器、重试动作、每个操作的智能体工具对话卡片，以及带缩略图的历史行。"
kind: "package-reference"
---

# @dv/ui-generation

[English](README.md) | 中文

## 概述

使用本包让一个生成原语（例如镜头渲染）用一份声明获得它在浏览器中的全部呈现。`defineGenerationUi` 返回的插件绘制该原语的画布节点，每个节点持有一次生成的所有版本；打开可以用改过的提示词、参考和参数重跑某个版本的节点编辑器，为最新版本失败的节点添加 重试 / Retry，绘制每个操作的智能体工具调用的对话卡片，并在历史中以缩略图显示每条记录。`@dv/ui-shot-render` 就是这样一份声明。

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

把 `@dv/ui-generation` 加入原语 UI 包的 `devDependencies`，并导入 `@dv/ui-generation/generation-kit.tsx`；`./*` 导出映射到 `src/client/*`，原语包的客户端 bundle 会内联该工具包。工具包没有 Loader 行：它的 Host 半边（`src/index.ts`）不导出任何内容。原语包导出插件，`@dv/ui-shot-render` 就是这样做的（它的 `apply` 还注册它在 `@dv/ui-composer` 中的参数栏）：

```ts ignore-check
export const { inject, apply } = defineGenerationUi({
  id: '@dv/ui-shot-render', type: 'shot', operations: ['shot.render'], label: ['镜头', 'Shot'], color: 'var(--dv-node-3)',
  status: { running: ['渲染中…', 'Rendering…'], failed: ['生成失败', 'Render failed'], done: ['已渲染', 'Rendered'] },
  preview: outputs => outputs.find(output => output.mime.startsWith('image/'))?.id,
  bar: shotRenderBar,
})
```

### 工具包 API

工具包的入口是 [`src/client/generation-kit.tsx`](src/client/generation-kit.tsx)。它的描述符使用画布契约（`@dv/ui-canvas/contract`，即 `@dv/ui-canvas` 的 [`src/client/contract/index.ts`](../ui-canvas/src/client/contract/index.ts)）和历史契约（`@dv/ui-history/contract`）的类型。

| 符号 | 含义 |
| --- | --- |
| `defineGenerationUi(spec)` | 返回一个生成原语的 `UiPlugin`（`{ inject: [], apply }`） |
| `GenerationUiSpec` | 声明。必填：`id`（注册它的包）、`type`（节点类型键，例如 `'audio'`，即宿主原语的 `node` 声明的 kind）、`operations`（该种类的生成操作，用于对话卡片、历史行和参数栏）、`label`（中英文类型标签）、`color`（主题颜色，例如 `var(--dv-node-3)`）和 `status`（`StatusWords`）。可选：`fallbackRatio`（所显示素材宽或高未知的节点（例如音频节点）的画框宽高比，即宽 ÷ 高；默认 16:9）、`subject(record)`（历史主题；默认无）、`bar`（该类型的输入框参数栏：`placeholder` 和 `send` 文字、`chips(…)` 和 `candidates(schema)`；`@dv/ui-composer` 已加载时，套件为每个操作在 `dvComposer.paramBars` 中注册它，所有者为 `id`，发送进行中的文字为 `status.running`，所以没有 `bar` 的类型也显示它的进行中文字）和 `preview(outputs)`（不是第一个输出时，在小视图中代表节点、并由编辑器和对话卡片的播放器在播放前显示的输出；它读取该版本的输出及其 MIME 类型） |
| `StatusWords` | 中英文文本对 `running`、`failed` 和 `done` |

### 插件注册的内容

插件在 `dvCanvas` 和插槽注册表存在时注册它的画布部分（节点类型、重试、卡片和节点编辑器），在插槽注册表存在时注册它的对话卡片，在 `dvHistory` 存在时注册它的历史行，任何加载顺序都有效。节点类型在画布部分中最先注册，所以节点类型被拒绝时，该种类不留下其他画布部分；对话卡片和历史行以工具和操作为键，所以 `@dv/ui-canvas` 未加载时它们也会注册。每个注册随它的服务或插件一起离开：

- **节点类型。** `dvCanvas.nodeTypes` 以 `type` 为键，所以键相同的第二个类型会抛错并给出持有者的名字，例如 `registry key "shot" is already registered by @dv/ui-shot-render`。画布从 `@dv/canvas` 的节点列表绘制 kind 为 `type` 的节点；工具包为一个版本提供标题、meta、预览、尺寸和状态文字。节点以其版本的操作在界面语言中的标签为标题，没有时用操作名，所以一个节点的每个版本标题相同；画布在 meta 中加上版本数。meta 是第一个有时长的输出的时长，例如 `2.5s`。
- **卡片主体**，以 `type` 为键的 `dv.canvas.card` 条目。它通过 `dv.media` 以用途 `card` 绘制最新版本所显示的素材，即该版本的预览，没有时为第一个输出；节点被选中时带 `play`，所以视频这时带控件播放。生成节点是媒体节点：它的 `sizing` 是 `@dv/ui-kit/frame.ts` 的 `mediaSizing` 对所显示素材的计算结果，没有固定栏，宽高比为素材宽高比并限制在 3:4 到 16:9 之间；素材宽或高未知或该版本没有输出时，取该类型的 `fallbackRatio`。主体填满画布给定尺寸的画框，所以图片随画框缩放。尺寸已知的素材不加底色地填满它；其他节点（例如音频波形，或在画布的运行中文字下的待处理版本）画出 `CARD_SURFACE`。
- **节点编辑器**，以 `type` 为键的 `dv.canvas.editor` 条目，显示编辑器版本条选中的版本，默认为最新版本。它通过 `dv.media` 以用途 `loop` 播放该版本的第一个输出，以该版本的预览作为静帧，并在失败版本的失败带有消息时显示失败原因。它显示模型和生成任务（任务在 `GET /api/dv/tasks` 中的标签，没有时用任务名）。`GET /api/dv/operations` 声明了该版本的操作时，它接着在该版本的调用上绘制 [`@dv/ui-composer`](../ui-composer/README.zh.md) 的 `dv.prompt` 输入框：其操作和参数，以 `@dv/ui-kit` 的 `requestInputsOf(record)` 为输入。输入框根据操作的输入和套件按声明注册的参数栏决定参考、参数标签和文字。输入框的宿主打开带版本条目的画布素材选择窗口（`host.pickAssets(…, { versions: true }, …)`），把上传的文件作为画布导入导入（`host.importFiles`），并打开素材的预览（`host.preview`）和另一个节点的编辑器（`host.openNode`）。发送调用 `host.rerun`，带改过的调用、设为该版本的 `based_on`，以及意图 在画布上生成 {title} 的新版本 / Generate a new version of {title} from the canvas，所以新记录成为同一个节点的最新版本；重跑等待期间，输入框的发送按钮禁用并显示它的发送中文字，输入框显示被拒绝的请求的错误。操作不在该列表中的版本不显示输入框。
- **重试 / Retry 动作**，`dvCanvas.actions` 中的 `<id>:<type>:retry`，顺序 0，所以同一个包的每个种类各有一个。它只在最新版本失败、且该版本是原语操作记录的节点上显示，并用记录自己的操作和参数、作为输入的 `requestInputsOf(record)`（所以记录按素材各存一次的版本只发送一次）调用 `host.rerun`，`based_on` 为该记录。
- **对话卡片**，每个操作一个 `tool.call.toolview` 条目，以操作的工具名为键，例如 `shot.render` 的 `dv_shot_render`。它显示操作标签、调用所处阶段的状态文字、模型和任务行、提示词、通过 `dv.media` 以用途 `loop` 静音绘制的第一个输出（以 `preview` 选出的输出为封面），以及调用结束后的 在历史中查看 / Show in history。
- **历史行**，每个操作一个 `dvHistory.rows` 条目。每行以 `spec.subject` 为主题，并标为媒体行，以 `spec.preview`（没有时为第一个输出）为缩略图。

对话卡片和节点编辑器通过 [`src/client/loaded.ts`](src/client/loaded.ts) 的注入 `hooks` 读取操作标签和任务标签：两个源在第一次订阅时各加载 `GET /api/dv/operations` 和 `GET /api/dv/tasks`，加载失败时保持为空，所以每个读取方都退回到名称，直到下一次订阅再加载。节点编辑器只读取任务标签；它从 `operations` 所有者属性读取声明。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`defineGenerationUi` 从声明一次性构建节点类型、重试 动作和历史行，然后在 `apply` 中用一个 `dvCanvas` 和 `slots` 的 `ctx.inject` 块注册它们，历史行在其中嵌套的 `dvHistory` 块里注册。宿主的节点列表持有节点的每个版本，画布把其中一个版本交给节点类型的 `entry`，所以画出的节点不会与它的记录不一致。节点编辑器从画布传入的 `operations` 所有者属性读取该版本的操作是否已声明；`dv.prompt` 输入框自己读取声明的参数，所以工具包不读取 `@dv/ui-kit/form.ts`。

`tests/` 下的测试在 `@deepseek-ai/dsh-client-test-runtime` 的 `SlotTestRuntime` 下挂载工具包，由真实的 `@dv/ui-media` 和 `@dv/ui-asset-pool` 插件绘制媒体。`tests/take-kind.client.ts` 定义用于 `shot.render` 和 `clip.extend` 的测试种类 `test_take`，挂载节点编辑器所绘制的输入框栈（`../ui-composer/tests/composer-stack.client.ts` 的 `composerStack`），并定义一个记录调用的画布 host。`generation-kit.client.spec.tsx` 检查标题、meta、预览、状态文字、卡片主体、重试 动作，以及卸载时移除每个注册。`take-editor.client.spec.tsx` 检查播放器、模式行、版本调用上的输入框、重跑请求（展开的版本只发送一次）、改过的参数标签、发送中文字、输入框打开和选择的参考、操作没有声明 `reference` 输入的版本，以及错误；`generation-card.client.spec.tsx` 在对话会话中检查对话卡片。`plugin-proofs.client.tsx` 存放每个原语自己的测试在其插件上运行的检查：它在 `@dv/ui-canvas` 之前挂载插件并挂载画布，找到某条记录唯一的节点，渲染已结束调用的对话卡片，并列出每个不是 JSON 数据或函数的注入值或所有者值。`plugin-proofs.client.spec.tsx` 在 `@dv/ui-shot-render` 上运行这些检查。

| 文件 | 内容 |
| --- | --- |
| [`src/client/generation-kit.tsx`](src/client/generation-kit.tsx) | 声明、节点类型、卡片主体、重试 动作、历史行和插件 |
| [`src/client/TakeEditor.tsx`](src/client/TakeEditor.tsx) | 节点编辑器 |
| [`src/client/GenerationCard.tsx`](src/client/GenerationCard.tsx) | 对话卡片和 `StatusWords` |
| [`src/client/loaded.ts`](src/client/loaded.ts) | 操作和任务标签源 |
| [`src/client/generation-card.module.css`](src/client/generation-card.module.css) | 对话卡片样式 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/generation`](../generation/README.zh.md) 声明生成原语的 Host 半边。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md) 绘制节点列表中的节点并渲染卡片和编辑器条目；[`@dv/canvas`](../canvas/README.zh.md) 持有节点列表。
- [`@dv/ui-composer`](../ui-composer/README.zh.md) 绘制节点编辑器的 `dv.prompt` 输入框，并持有参数栏。
- [`@dv/ui-media`](../ui-media/README.zh.md) 通过 `dv.media` 绘制每个输出。
- [`@dv/ui-history`](../ui-history/README.zh.md) 绘制历史行。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；节点编辑器的发送和 重试 动作写下的记录只经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；工具包不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **视图通过 `@dv/ui-kit` 的 hook 读取文案。** `TakeEditor` 和 `GenerationCard` 用 `useText` 选择文本，节点类型标签、状态文字和 重试 标签用 `pickText`，它们都跟随 `<html lang>`，而不是使用注入的 `hooks` 源和插槽的 `t`。
- **每个生成插件自己加载标签。** `apply` 为标签源创建自己的 `DvClient`，所以每个插件各请求一次 `GET /api/dv/operations` 和 `GET /api/dv/tasks`，对话卡片从这份副本读取操作标签，而节点编辑器读取画布的 `operations`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
