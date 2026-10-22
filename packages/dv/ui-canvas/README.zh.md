---
description: "DreamVerse 画布：把项目的记录画成素材和版本节点以及已注册节点类型的节点，按素材流向连线；浮动编辑器把新渲染的版本写成用户记录，并把画布的写入、素材选择窗口和素材预览借给插件的编辑器条目。"
kind: "package-reference"
---

# @dv/ui-canvas

[English](README.md) | 中文

## 概述

使用本包让 web 应用在对话旁边多一个 DreamVerse 项目的画布。`CanvasView` 在可平移、可缩放的画布上把项目当前状态的记录画成节点，节点之间按流过的素材连线，过期记录有标记。点一个节点打开浮动编辑器，可以渲染新版本、从素材库添加参考，或预填对话输入框。画布是 shell 中间区域的 画布 视图（`dv.center.view`）；右侧栏的 `dv-canvas` 标签类型在项目栏下显示同一个画布。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app`（提供右侧栏、locale 服务和客户端模块加载器）和 `@dv/api`（提供画布调用的路由）的 profile 里挂载插件。先构建浏览器 bundle：`pnpm run build` 会写出 `lib/client.js`。

画布只显示项目的当前状态，不显示历史：位于画布上的导入图片和视频画成 `asset` 节点，在 `dvCanvas` 中注册的节点类型的条目画成节点（`@dv/ui-shot-plan` 把每个分镜计划以最新版本画成 `plan` 节点），生成记录画成 `take` 节点：生成记录指其操作被 `GET /api/dv/operations` 列为非确定性、使用 GPU、有图片、视频或音频输出的记录，所以仍在渲染的版本也会画出；操作不在该列表中的记录，在非确定性并有图片、视频或音频输出时画成版本（`@dv/ui-kit` 的 `isGenerationRecord`）。记录的链是它的 `started_by`，没有时是它 `based_on` 根记录的 `started_by`（`@dv/ui-kit` 的 `chainOf`），所以画布上的重拍沿用原版本的链。链的发起记录已加载，并且 `dvCanvas` 中注册了发起记录所属操作的 `ChainAnchor` 时，这条链是锚定链；锚点给出链所挂的节点，例如 `plan:p1`。锚定链上的版本卡片以链中的位置为标题，链有分支（lane）时后接 ` · <lane>`（镜头 1 · 9:16），并有一条边从锚点节点连到它；其他版本即自由版本，以界面语言的操作标签为标题（未声明标签或操作不在该列表中时用操作名）。版本卡片显示第一个图片输出；它的编辑器播放第一个视频输出，或在有声音的音频播放器中播放第一个音频输出。由 `based_on` 相连的版本，否则是锚点、位置和分支都相同的版本，按记录顺序编号。画出的版本是：每个锚点节点上每种发起操作最新一次发起的链上的版本（所以两个工作流在同一个分镜计划上的链都会显示）；每个自由版本；输出仍在使用中的版本（被已注册的 `TakesInUse` 报告，例如 `@dv/ui-timeline` 报告的时间线片段的记录，或当前角色、场景、风格或分镜计划版本的参考图的产出记录）；以及每个已画出版本读取输入所来自的版本和它的 `based_on` 家族（原版本和它的重拍）。较早发起的链上无人使用的版本不显示，所以撤销或回到之前某一步会改变画布显示的内容。已注册的 `TakesInUse` 为某个素材报告的标记，例如时间线裁剪的片段的 已裁剪 / Trimmed，按原文显示在该素材的节点上。带 `slots` 的条目（例如分镜计划）的帧网格为每个位置显示该条目节点上锚定链中该位置最新完成的版本。图片或视频只在其素材 ID 位于画布上（`asset` 切片的 `placed`）时才有一个 `asset` 节点；已由条目节点（例如角色、场景或风格的参考图）或 `take` 节点（版本的产出）显示的除外。读取画布外素材的版本没有来自该素材的边，它的编辑器仍列出该参考图。用户把文件或素材库缩略图拖到画布上，或在对话消息里以附加图片或 `dv:asset/<id>` 标签发出某个素材（由 `@dv/chat-references` 放置）时，该素材放到画布上；`asset` 节点编辑器里的"从画布移除"把它移出画布，素材仍留在素材库里。这些都是历史中的步骤，所以历史会列出它们，撤销能退回它们。当前状态改变时画布跟着改变，画布的修改立即成为历史中的步骤。

```yaml
- id: dv-ui-canvas
  name: '@dv/ui-canvas'
```

Host 半边不注册任何东西。浏览器半边提供客户端服务 `dvCanvas`（`@dv/ui-kit/registries.ts` 的 `DvCanvas`：注册表 `nodeTypes`、`chainAnchors`、`takesInUse` 和 `versionKinds`），插件的 UI 半边向其中注册之前它们是空的。它还注册 `dv-canvas` 标签类型（侧栏指南页以"视频画布"提供的页面）、中英文的 `dvCanvas` locale 命名空间，以及以自身 id `@dv/ui-canvas` 为键的标签主体。它把 `CanvasCenter` 注册为 `dv.center.view` 条目 `canvas`（顺序 0，标签为标签类型的 画布 / Canvas），这是按中间区域的所有者属性 `projectId` 和 `session` 绘制项目并记录对话的 `CanvasView`，它打开所有者属性 `target` 指定的记录的节点。插件的 UI 半边在 `ctx.inject(['dvCanvas'], …)` 里注册它的描述符，并保留返回的注销函数；键已被占用的第二个描述符会抛错。标签主体和中间区域视图把这些注册表作为 `canvas` 属性传给 `CanvasView`。已注册 `NodeType` 的每个条目画成一个节点，带有其类型的 `data-node-type`，位于其类型的布局列 `column`，用同一张默认卡片绘制：`NodeType.color` 颜色的类型圆点、`NodeType.label()` 和 ` · <subtitle>`；带 `slots` 的条目随后在有位置已有画面时显示画面网格，再显示标题，其他条目显示 40 × 40 的第一张图片或视频、其余数量"+N"和标题；条目的媒体，以及已注册的 `VersionKind` 画成该节点的条目的每个更早版本的素材，都不单独画成 `asset` 节点。画布只通过已注册的 `VersionKind` 读取带版本的条目：版本的输入 `<id>@<n>` 从该条目的版本种类给出的节点连过来，版本编辑器的参考标签显示并打开该条目，素材选择窗口提供每个条目的最新版本，分镜计划编辑器列出每个条目版本的参考素材（`@dv/ui-kit/references.ts` 的 `referenceAssets`）。角色、场景和风格是 `@dv/ui-character`、`@dv/ui-location` 和 `@dv/ui-style` 的节点条目和版本种类。中间区域视图声明键控插槽 `dv.canvas.editor` 和 `dv.canvas.picker`（它们的 `SlotMap` 条目在 `@dv/ui-kit/registries.ts` 中），并把自己的 `renderSlot` 作为 `renderSlot` 传给 `CanvasView`：节点条目的编辑器显示以其 `NodeType.id` 为键的插槽条目，所有者属性为 `{ node, state, host }`，没有注册条目时只显示标题栏。`host`（`EntryEditorHost`）以画布写入的方式运行一个操作（画布的项目、对话会话和 `surface: 'canvas'`；失败显示在画布上方），打开只含素材的素材选择窗口，并为某个素材打开 `dvMedia`（`@dv/ui-media`）的素材预览。角色、场景或风格的编辑器是其 UI 包的条目。素材选择窗口在带版本的条目下方显示键为 `assets` 的 `dv.canvas.picker` 条目；`@dv/ui-asset-pool` 用它的素材库面板填充该插槽。一个插槽只能由一个条目声明，所以标签主体不声明画布插槽，挂载 `CanvasView` 时不传 `renderSlot`，那里的条目编辑器（包括角色、场景和风格的）只显示标题栏，素材选择窗口只提供带版本的条目。标签主体和中间区域视图都把各自插槽条目的 `renderFactorySlot` 传给 `CanvasView`，由它通过 `@dv/ui-media` 的 `dv.media` 组件工厂绘制画布上的每个素材（条目卡片的媒体及其帧网格用途为 `thumb`，版本卡片或素材卡片的画面为 `card`，编辑器的播放器为 `loop` 并以图片为 poster，参考标签和选择窗口条目为 `thumb`），并传入调用 `dvMedia.preview` 的回调 `preview`；`dvMedia` 不存在时，素材不打开预览。

| 手势 | 请求 |
| --- | --- |
| 改一个版本的参数或参考图并按"渲染新版本" | `POST /api/dv/operation`，操作为该版本的操作，带该版本自己的参数（其中有它的 `modality`、`task`、`provider` 和 `model`）和改过的字段，以及改过的输入，`based_on` 指向所示版本，`surface: 'canvas'` |
| 条目编辑器的 `host.run`，例如角色编辑器添加或移除一个参考 | `POST /api/dv/operation`，带条目给出的操作、参数、输入和意图；在选择窗口里拖入的文件先经 `POST /api/dv/assets/import` 运行 `asset.import` |
| 把图片或视频文件拖到画布上 | 带 `surface=canvas` 的 `POST /api/dv/assets/import`，其 `asset.import` 同时把素材放到画布上；新节点放在指针下 |
| 把素材库缩略图拖到画布上 | 素材已有节点时，把该节点移到指针下；素材库面板中的其他图片或视频则由 `POST /api/dv/operation` 执行 `asset.place`，该素材作为输入角色 `asset`，新节点放在指针下 |
| 在 `asset` 节点编辑器里点"从画布移除" | `POST /api/dv/operation` 执行 `asset.unplace`，该素材作为输入角色 `asset`；素材仍留在素材库里 |
| 让智能体改 | `dv:compose` 窗口事件，用指向该节点的 `@` 引用预填对话输入框 |
| 在过期节点的编辑器里点"仍然保留" | 对节点的记录调用 `POST /api/dv/stale/accept`（作为历史中的一步运行 `proj.stale_accept`） |
| 拖动节点、平移或缩放 | `POST /api/dv/layout`，带以节点 ID 为键的移动位置和视口 |
| 出现一个没有存储位置的节点 | `POST /api/dv/layout`，带它的位置：默认布局位置，每次下移一行，直到不压住其他卡片 |

每个请求都带 `surface: 'canvas'` 和画布旁边的对话，记录把该对话存为它的 `session`。工作区中间区域把请求 `{ record: <id> }` 交给中间区域视图时，视图打开该记录的节点，例如历史为选中的记录传给 `dvCenter.show({ view: 'canvas', target: { record } })` 的目标。画布把该记录的节点移到中央并打开。记录没有自己的节点时，画布打开它写下的版本所属的条目节点（条目的 `NodeEntry.records`，例如较早版本的记录对应分镜计划），否则打开它第一个产出的节点。画布在布局和状态读到之后取走该请求，所以重新挂载的画布不会再次打开该节点；记录没有节点的请求不打开任何节点。标签主体不给 `CanvasView` 传 `focus`。

浮动编辑器打开时位于变暗画布的中央，宽度最多 720 px，高度约为画布的 80%。拖动标题行可移动编辑器；拖动右边缘、下边缘或右下角可调整大小，也可以聚焦右下角的调整手柄后按方向键（每次 16 px）；双击标题行恢复到居中的默认位置和大小。浏览器在 `localStorage` 中为所有节点保存同一个最近的位置和大小，下次打开编辑器时把它放进画布范围内。点击变暗的画布或按 Escape 关闭编辑器；上面叠着第二个编辑器时，同样的操作只关闭上面那个。编辑器打开时从它的节点放大出来，关闭时缩回该节点，变暗的画布同时淡入淡出（`@dv/ui-kit/zoom.ts`）。

点击节点会选中它（显示强调色描边）并打开它的编辑器。关闭编辑器后描边保留，方便找回该节点；没有打开编辑器时点击空白画布会清除描边。按"渲染新版本"或失败版本的"重试"后，按钮显示"渲染中…"并禁用，直到新版本的节点出现；然后编辑器关闭，画布把新节点移到中央并选中它，新节点显示"渲染中…"直到渲染结束。如果请求在此之前被拒绝，错误显示在编辑器按钮旁边；"重试"的错误显示在画布上方。用户在本浏览器中还没打开过的已完成版本，标题旁显示一个强调色圆点，打开它的编辑器后消失。浏览器在 `localStorage` 中按项目保存已打开的版本；某个项目在一个浏览器中第一次打开时，所有已完成的版本都算作已打开。

版本的编辑器按记录的参数显示它的模型和生成任务，生成任务显示它在模型目录 `GET /api/dv/tasks` 中的标签（没有时显示任务名），例如"fasth3 · 参考图生成"（生成任务 `ref2v`）或"fasth3 · 文字生成"（生成任务 `t2v`），并为它的操作在 `GET /api/dv/operations` 中声明的其他每个参数显示一个字段：先是提示词，然后是用本地化标签的时长和种子，其他参数以参数名为标签。操作声明了 `reference` 输入且生成任务不是 `t2v` 的版本有参考标签。操作不在该列表中的版本不显示字段，也没有"渲染新版本"。参考标签以用途 `thumb` 绘制它的素材；点击后，素材打开从该标签放大出来的素材预览，带版本的条目则在版本编辑器上方打开它所在节点的编辑器，版本编辑器里未渲染的修改保留。版本编辑器里的"添加素材"和条目编辑器的 `host.pickAssets` 打开素材选择窗口：先是每个已注册版本种类一个分区，标题为该种类的 `label()`，列出该版本尚未引用的每个条目的最新版本（只在版本编辑器里；没有这样的条目的种类不显示分区），然后是 `@dv/ui-asset-pool` 的素材库面板及其导入拖放区。点击选中或取消选中，"确认"按选中顺序追加。`plan` 条目的编辑器显示 `@dv/ui-shot-plan` 的分镜计划编辑器（版本、批准状态和镜头）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`CanvasView` 用 `@dv/ui-kit/useProject.ts` 的 `useProjectState` 读项目的当前状态；`buildCanvasGraph` 把它变成节点、边和默认的分列布局：先素材，各节点类型的条目位于它的列（分镜计划在第 1 列），版本按首帧链深度排列，重拍挨着它的源版本。同一列中，版本先按链的锚点排列，锚点按各自第一个版本的记录顺序（自由版本留在自己的位置），再按位置（没有位置的版本在最后），再按分支，分支按各自第一个版本的记录顺序，最后按记录顺序。条目节点的 ID 是条目自己的 ID，例如 `character:<id>` 或 `plan:<PlanId>`；`asset` 节点的 ID 是当前状态中产出该素材的 `asset.import` 记录，否则为没有记录的 `asset:<AssetId>`（撤销退过的导入、静帧、导出）；其他节点的 ID 是它的记录 ID。`/api/dv/layout` 中存下的位置覆盖默认布局；布局读写失败时忽略。请求的输入是引用文本（`<asset>`、`<record>#<output>`、`<id>@<version>`），由 `@dv/ui-kit/references.ts` 的 `formatInputRef` 从记录存储的输入引用写出，任何引用类型的版本都适用。每收到一帧 `/dv/events`，状态就重新拉取，所以对话消息放上的素材不用刷新就会出现；本视图发出的摆放立即显示，直到状态显示它为止，被拒绝的摆放会恢复原样。

| 文件 | 内容 |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | `dvCanvas` 服务和注册 |
| [`src/client/dv-canvas.ts`](src/client/dv-canvas.ts) | `dvCanvas` 注册表 |
| [`src/client/definition.ts`](src/client/definition.ts) | 标签类型 |
| [`src/client/CanvasBody.tsx`](src/client/CanvasBody.tsx) | 标签主体：项目栏下的 `CanvasView` |
| [`src/client/CanvasCenter.tsx`](src/client/CanvasCenter.tsx) | 中间区域视图：渲染条目编辑器插槽并打开请求记录节点的 `CanvasView` |
| [`src/client/CanvasView.tsx`](src/client/CanvasView.tsx) | 画布：平移、缩放、拖动、拖放、布局存储 |
| [`src/client/graph.ts`](src/client/graph.ts) | 节点、边和默认布局 |
| [`src/client/NodeCard.tsx`](src/client/NodeCard.tsx)、[`src/client/NodeEditor.tsx`](src/client/NodeEditor.tsx) | 节点卡片和浮动编辑器 |
| [`src/client/AssetPicker.tsx`](src/client/AssetPicker.tsx) | 素材选择窗口：渲染 `dv.canvas.picker` 条目，并通过 `dv.media` 以每个带版本条目的第一个素材绘制该条目 |
| [`src/client/locales.ts`](src/client/locales.ts) | `dvCanvas` 词典 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/api`](../api/README.zh.md) — 每个手势背后的路由。
- [`@dv/ui-kit`](../ui-kit/README.zh.md) — API 客户端、wire 类型和 hook。
- [`@dv/ui-shell`](../ui-shell/README.zh.md) — 工作区中间区域和把它移到画布的 `dvCenter`。
- [`@dv/ui-media`](../ui-media/README.zh.md) — 绘制画布素材的 `dv.media` 组件工厂，以及素材预览。
- [DreamVerse 各包](../../../docs/subsystems/video-harness.zh.md) — 画布所显示的过期、版本和历史规则。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；其手势写下的记录只经由 [`@dv/project`](../project/README.zh.md) 的 `dv:project` 提示词段落以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；画布不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **画布上不能新建节点** — 编辑器只为已有记录渲染新版本和修改角色、场景、风格的参考；新建分镜计划或角色留给对话。
- **整图重建** — 每个项目事件都重新拉取状态并重建图；长项目重画慢。
