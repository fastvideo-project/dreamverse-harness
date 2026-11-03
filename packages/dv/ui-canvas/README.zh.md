---
description: "DreamVerse 画布：插件通过 `@dv/ui-canvas/contract` 注册的节点类型的节点，用同一套外框绘制并按素材流向连线；工作区中间区域和右侧栏标签渲染的 `dv.canvas` 组件工厂；以及浮动编辑器外壳，它把画布的写入、素材选择窗口和素材预览借给每种类型的编辑器主体。"
kind: "package-reference"
---

# @dv/ui-canvas

[English](README.md) | 中文

## 概述

使用本包让 web 应用在对话旁边多一个 DreamVerse 项目的画布。`CanvasView` 在可平移、可缩放的画布上把项目的当前状态画成插件节点类型（`@dv/ui-canvas/contract`）的节点，节点之间按流过的素材连线，过期记录有标记。点一个节点打开浮动编辑器，可以重跑版本、从素材库添加参考，或预填对话输入框。画布是 shell 中间区域的 画布 视图（`dv.center.view`）；右侧栏的 `dv-canvas` 标签类型在项目栏下显示同一个画布。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app`（提供右侧栏、locale 服务和客户端模块加载器）和 `@dv/api`（提供画布调用的项目路由）的 profile 里挂载插件。先构建浏览器 bundle：`pnpm run build` 会写出 `lib/client.js`。

画布只显示项目的当前状态，不显示历史，每个节点都来自一个已注册的 `NodeType`。一种类型有切片条目、认领节点，或两者都有。切片条目（`entries`）是类型从状态中自己的切片读出的 `NodeEntry`，例如 `@dv/ui-character` 的角色。认领节点（`claimed`）代表该类型认领的操作的当前记录，例如 `@dv/ui-shot-render` 的版本认领 `shot.render`。画布从记录构建每个认领节点：节点 ID 是记录 ID，节点的素材是记录的产出，它的边是记录的输入和 `based_on`；类型只提供标题、`meta`、预览和主体高度。没有类型认领其操作的记录不画节点。节点 ID 唯一：两个绘出的节点 ID 相同时，构建画布图会抛错，错误信息给出两个节点类型。由 `based_on` 相连的记录组成一组；多于一个记录的组里，每个记录按记录顺序得到从 1 开始的 `version` 编号。已注册的 `RecordsInUse` 为某个素材报告的标记，例如时间线裁剪的片段的 已裁剪 / Trimmed，按原文显示在该素材的节点上。切片条目的素材归这些条目所有，然后是已注册的 `VersionKind` 画成切片条目的条目的每个更早版本的素材，再然后是认领节点的产出。带 `standIn` 的条目，例如 `@dv/ui-asset-pool` 为画布列表（`asset` 切片的 `placed`）上每个素材画的素材节点，只在没有其他节点拥有它的任何素材时才画出。用户把文件或素材库缩略图拖到画布上，或在对话消息里以附加图片或 `dv:asset/<id>` 标签发出某个素材（由 `@dv/chat-references` 放置）时，该素材放到画布上。这些都是历史中的步骤，所以历史会列出它们，撤销能退回它们。当前状态改变时画布跟着改变，画布的修改立即成为历史中的步骤。

```yaml
- id: dv-ui-canvas
  name: '@dv/ui-canvas'
```

Host 半边注入 DSH Workspace 注册表，并在 Connection 服务挂载期间注册经认证的 Fetch 路由 `/api/dv/canvas/layout`。该路由把每个项目以画布节点 ID 为键的节点位置和视口存放在 `<项目文件夹>/.dreamverse/canvas-layout.json`，项目文件夹是 ID 等于项目 ID 的 Workspace 的路径。`GET ?project=<id>` 返回 `{positions, viewport}`，文件缺失或无法读取时返回空布局；`POST {project, positions?, viewport?}` 把位置合并进已存的位置，给出视口时替换视口，原子地写入文件，并返回存储后的布局。一个布局最多保留 5000 个位置。错误使用每个 `/api/dv` 路由的响应体 `{error, code}`：项目格式错误或位置过多时为 400 `invalid_params`；ID 不对应任何 Workspace，或写入没有 `.dreamverse/` 的文件夹时为 404 `unknown_project`，此时不创建任何东西。布局是视图状态：它不写记录，所以撤销不会移动节点，移除项目时文件留在文件夹里。

Host 半边还注册 agent 的工具 `dv_canvas_read` 和 `dv_canvas_move`，它们拒绝由另一个 agent 启动的 agent，并为它们另注册两条 Fetch 路由。每个已挂载画布保持 `GET /api/dv/canvas/agent?project=<id>&session=<id>` 打开，一个页面中每个项目和对话会话一条流，流发送 `text/event-stream` 帧：`ready`、带 `{id, stream}` 的 `read` 和带 `{project, positions}` 的 `moved`。每次调用找到该 agent 对话会话的项目，即文件夹为该会话工作目录的 Workspace，并在该项目位于该会话旁的每条已打开流上写一个 `read` 帧；第一个用 `POST /api/dv/canvas/agent/answer` 和 `{id, stream, project, cards}` 作答的画布了结这次读取，指向未知读取或未收到该读取的流的回答得到 404，作答时不绘制也不保存任何东西。没有这样的流打开时，调用立即失败且不移动任何节点；Config `answerTimeoutMs`（默认 10000）限制等待回答的时间。Host 半边按保存的布局规划移动，只向布局存储写入一次，然后在该项目的每条已打开流上写一个 `moved` 帧，不论它位于哪个会话旁。

浏览器半边提供客户端服务 `dvCanvas`（`@dv/ui-canvas/contract` 的 `DvCanvas`），它的四个注册表在插件的 UI 半边向其中注册之前是空的：`nodeTypes`（`NodeType`，以 `type` 以及每个认领操作的 `op:<operation>` 为键，所以两种类型不会认领同一个操作）、`recordsInUse`（`RecordsInUse`，以 `id` 为键）、`versionKinds`（`@dv/ui-kit/registries.ts` 的 `VersionKind`，以 `kind` 为键）和 `actions`（`NodeAction`，以 `id` 为键）。插件的 UI 半边在 `ctx.inject(['dvCanvas'], …)` 里注册它的描述符，并保留返回的注销函数；键已被占用的第二个描述符会抛出指名占用者的错误。浏览器半边注册 `dv.canvas` 组件工厂，它接收属性 `projectId`、`session` 和 `focus`，通过注入的 `hooks` 读取注册表，并声明四个键控子插槽，节点类型以其 `NodeType.type` 为键填充：`dv.canvas.card`（卡片主体，所有者属性为 `CardOwner`：节点、它每个素材的 wire 素材、文字缩放倍数和一个 `CardHost`；没有条目时卡片显示类型标签）、`dv.canvas.editor`（切片节点的编辑器主体，所有者属性为 `EditorOwner`，其中的 `EditorHost` 另有编辑器的素材选择窗口）、`dv.canvas.editor.claimed`（认领节点的编辑器主体，所有者属性为 `EditorOwner<ClaimedNodeView>`）和 `dv.canvas.picker`（素材选择窗口里的素材库，键为 `assets`，所有者属性为 `PickerOwner`）。没有条目的编辑器只显示标题栏。它还注册 `dv-canvas` 标签类型（侧栏指南页以"视频画布"提供的页面）、中英文的 `dvCanvas` locale 命名空间、以自身 id `@dv/ui-canvas` 为键的标签主体，并把 `CanvasCenter` 注册为 `dv.center.view` 条目 `canvas`（顺序 0，标签为标签类型的 画布 / Canvas）。中间区域视图和标签主体各自为自己的项目和对话会话渲染一个 `dv.canvas` 实例，所以两者画出相同的卡片、编辑器和选择窗口。卡片主体和编辑器主体通过 `@dv/ui-media` 的 `dv.media` 组件工厂绘制媒体。`NodeAction` 显示在其 `shows` 返回 true 的每个节点上，按 `order` 排列：显示在编辑器标题栏里，以及失败的认领节点的画框里；它的 `run` 接收节点和一个没有素材选择窗口的 `NodeHost`。

填充画布的 UI 插件有：`@dv/ui-asset-pool`（素材节点类型、它的卡片和编辑器主体、"从画布移除"动作，以及选择窗口里的素材库）、`@dv/ui-timeline`（时间线片段使用的记录及其裁剪标记）和 `@dv/ui-composer`（"问 agent"动作，通过 `dv:compose` 窗口事件预填对话输入框）。由 [`@dv/ui-generation`](../ui-generation/README.zh.md) 的 `defineGenerationUi` 定义的每个生成 UI 插件（例如镜头渲染版本的 `@dv/ui-shot-render`）注册一个认领节点类型、它的卡片和认领编辑器主体，以及失败版本的"重试"动作。参考名词 `@dv/ui-character`、`@dv/ui-location` 和 `@dv/ui-style` 来自 [`@dv/ui-reference-kit`](../ui-reference-kit/README.zh.md) 的 `defineReferenceUi`：每个注册一个带切片条目的节点类型、它的卡片和编辑器主体、一个版本种类，以及它的参考使用的记录。

| 手势 | 请求 |
| --- | --- |
| 卡片主体、编辑器主体或动作的 `host.run`，例如参考名词的编辑器添加或移除一个参考 | `POST /api/dv/operation`，带主体给出的操作、参数、输入和意图，并补上画布的项目、对话会话和 `surface: 'canvas'`；失败显示在画布上方 |
| `host.rerun`，例如版本编辑器中输入框的发送或失败版本的"重试" | `POST /api/dv/operation`，带该请求和它的 `based_on` 记录，以同样方式补全；画布等待新节点出现 |
| 把文件拖到画布上 | 对每个文件（任何媒体类型）调用带 `surface=canvas` 的 `POST /api/dv/assets/import`，其 `asset.import` 同时把素材放到画布上；第一个新节点放在指针下，之后每个都在前一个的右下方 32 个单位处 |
| 把素材库缩略图拖到画布上 | 素材已有节点时，把该节点移到指针下；素材库面板中的其他素材则由 `POST /api/dv/operation` 执行 `asset.place`，该素材作为输入角色 `asset`，新节点放在指针下 |
| `host.setPlaced`，例如素材节点编辑器里的"从画布移除" | `POST /api/dv/operation` 执行 `asset.place` 或 `asset.unplace`，该素材作为输入角色 `asset`；本视图立即显示改变，请求被拒绝时恢复原样 |
| 在过期节点的编辑器里点"仍然保留" | 对节点的记录调用 `POST /api/dv/stale/accept`（作为历史中的一步运行 `proj.stale_accept`） |
| 拖动节点、平移或缩放 | `POST /api/dv/canvas/layout`，带以节点 ID 为键的移动位置和视口 |
| agent 的 `dv_canvas_move` | 页面不发请求：Host 半边保存这次移动，该项目在每个标签页中的每个已挂载画布在收到其流的 `moved` 帧时立即画出被移动的节点；等待保存的拖动不再携带这些节点 |
| 出现一个没有存储位置的节点，或它的记录结束渲染 | `POST /api/dv/canvas/layout`，带它的位置：默认布局位置，每次下移一行，直到不压住其他节点。节点的记录在等待或运行中时，这个位置会画出来，其他节点也会避开它，但不存储；记录结束渲染时，画布按节点的最终高度重新放置它，再存储该位置。拖动会立即存储拖到的位置 |

除布局请求外，每个请求都带 `surface: 'canvas'` 和画布旁边的对话，记录把该对话存为它的 `session`。工作区中间区域把请求 `{ record: <id> }` 交给中间区域视图时，视图打开该记录的节点；这个请求由 `@dv/ui-shell/contract` 的 `dvCenter.show({ view: 'canvas', target: { record } })` 给出，历史在选中记录时就这样做。画布把记录自己的节点移到中央、选中并打开；没有时是 `record` 为该记录的节点，再没有时是 `records` 列出该记录的条目节点（例如较早版本的记录对应角色），否则是包含该记录第一个产出的节点。没有节点匹配时请求会等待，所以后注册的节点类型仍能打开它的节点；画布打开节点时取走该请求，所以重新挂载的画布不会再次打开该节点。标签主体不传焦点。

浮动编辑器打开时位于变暗画布的中央，宽度最多 720 px，高度约为画布的 80%。拖动标题行可移动编辑器；拖动右边缘、下边缘或右下角可调整大小，也可以聚焦右下角的调整手柄后按方向键（每次 16 px）；双击标题行恢复到居中的默认位置和大小。浏览器在 `localStorage` 中为所有节点保存同一个最近的位置和大小，下次打开编辑器时把它放进画布范围内。点击变暗的画布或按 Escape 关闭编辑器；上面叠着第二个编辑器时，同样的操作只关闭上面那个。编辑器打开时从它的节点放大出来，关闭时缩回该节点，变暗的画布同时淡入淡出（`@dv/ui-kit/zoom.ts`）。它的标题栏显示类型圆点和类型标签（与标题相同时省略）、标题、显示在该节点上的动作和关闭按钮；过期节点在主体上方显示 已过期 / Stale 和"仍然保留"。

点击节点会选中它（显示强调色描边）并打开它的编辑器。关闭编辑器后描边保留，方便找回该节点；没有打开编辑器时点击空白画布会清除描边。主体或动作调用 `host.rerun` 后，该节点的动作被禁用（`NodeView.rerunning`），失败画框里发起重跑的那个动作的按钮显示类型的运行文字，直到出现一个记录 `based_on` 被重跑记录的新节点；然后编辑器关闭，画布把新节点移到中央并选中它。如果请求先返回，例如没有类型绘制的记录，编辑器在那时关闭。新节点出现之前请求失败时，编辑器主体的 `host.rerun`（`EditorHost`）以该请求的错误拒绝。画布一次只等一个重跑，所以后来的重跑替换它时，它会完成，不显示失败。错误由主体显示，动作或卡片主体的重跑（`NodeHost`）把该错误显示在画布的提示里，盖在打开的编辑器上方，编辑器标题栏和失败画框都一样。用户在本浏览器中还没打开过的已完成认领节点，标题旁显示一个强调色圆点，打开它的编辑器后消失。浏览器在 `localStorage` 中按项目保存已打开的节点；某个项目在一个浏览器中第一次打开时，所有已完成的节点都算作已打开。

画布用同一套外框绘制每个节点：画框上方的标题行。标题行是一行小字，有标题、未查看圆点、已过期 / Stale 标签和等宽字体的 `meta`。画框是圆角轮廓，没有底色和阴影；选中描边和键盘焦点轮廓只围绕画框。画框里，类型的 `dv.canvas.card` 主体填满画框，自己画底色（卡片式主体画 `@dv/ui-kit/frame.ts` 的 `CARD_SURFACE`，图片主体只画图片），记录在等待或运行中，或切片节点的记录失败后，主体上覆盖类型的状态文字（`claimed.status`，没有时为 运行中… / Running… 和 失败 / Failed），标记显示在主体左下角。失败的认领节点保持画框高度，不显示主体：在画框里的卡片表面色上显示类型的失败文字和显示在该节点上的动作，悬停时显示记录的错误信息。被取代的记录的节点变暗，过期节点的画框有危险色轮廓。每条边连在节点画框的中间，使用其起点节点类型的颜色（`NodeType.color`，它不给其他任何东西上色）；`based_on` 边是虚线，选中节点的边以强调色画在最上层。编辑器主体和动作收到的 `NodeHost` 在 `run` 和 `rerun` 之外增加：`pickAssets` 打开素材选择窗口；`preview` 打开 `@dv/ui-media` 的 `dvMedia.preview` 素材预览，从触发元素放大出来（没有加载媒体插件时不打开任何东西）；`importFiles`（只在编辑器主体的 `EditorHost` 上）把本地文件逐个作为画布导入导入项目，每个素材也放到画布上，并按文件顺序给出它们的素材 ID（某次导入被拒绝时停止导入，并显示画布的错误提示）；`openNode` 在当前编辑器上方打开另一个节点的编辑器，当前编辑器里未保存的修改保留；`setPlaced` 把素材放到画布列表上或移出；`close` 关闭编辑器。传入 `versions: true` 时，素材选择窗口为每个已注册版本种类显示一个分区，标题为该种类的 `label()`，列出编辑器没有持有的每个条目的最新版本，通过 `dv.media` 绘制；其下显示键为 `assets` 的 `dv.canvas.picker` 条目。点击选中或取消选中，"确认"按选中顺序交出选中的引用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`CanvasView` 用 `@dv/ui-kit/useProject.ts` 的 `useProjectState` 和 `useOperations` 读取项目的当前状态和操作；`graph.ts` 的 `buildCanvasGraph` 把它们和已注册的描述符变成节点、边和默认布局：每个节点位于其类型的 `column` 列；从某个节点读取 `deepenOn` 输入角色（例如接续上一个镜头的视频版本的 `first_frame`）的节点位于该节点右边一列；重跑紧跟在源节点之后，位于源节点的列。同一列中，认领节点按记录顺序排列；节点数超过共用行数的列会分成几个子列。切片节点的 ID 是其条目自己的 ID，例如 `character:<id>`；认领节点的 ID 是它的记录 ID。认领节点为每个输入画一条边：输入为 `<id>@<version>` 且版本种类画出了所指条目的节点时，从该节点连过来，否则从输入素材的节点连过来（拥有该素材的节点，没有时是沿产出链向上最近的已画出认领记录）；另有一条从 `based_on` 记录来的谱系边；切片节点不画边。`NodeEntry.bodyHeight` 在挂载前给出节点高度（标题行和主体），空闲位置、边的端点和焦点都用它。`/api/dv/canvas/layout` 中存下的位置覆盖默认布局；布局读写失败时忽略。每收到一帧 `/dv/events`，状态就重新拉取，所以对话消息放上的素材不用刷新就会出现；本视图发出的摆放立即显示，直到状态显示它为止，被拒绝的摆放会恢复原样。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Host 半边：布局存储、其路由的注册，以及 agent 的工具 |
| [`src/layout.ts`](src/layout.ts) | `CanvasLayoutStore` 和布局路由 |
| [`src/canvas-layout.ts`](src/canvas-layout.ts) | 两个半边共用的布局类型和路由路径 |
| [`src/client/layout-client.ts`](src/client/layout-client.ts) | 布局路由的浏览器客户端 |
| [`src/client/contract/index.ts`](src/client/contract/index.ts) | `@dv/ui-canvas/contract`：节点契约、`DvCanvas` 和 `dv.canvas.*` 插槽（只有类型） |
| [`src/types.ts`](src/types.ts)、[`src/canvas.ts`](src/canvas.ts)、[`src/client/agent-canvas.ts`](src/client/agent-canvas.ts) | agent 的工具与画布交换的值、`dv_canvas_move` 的规则，以及回答读取并画出已保存移动的 `CanvasViews` |
| [`src/client/index.ts`](src/client/index.ts) | `dvCanvas` 服务和注册 |
| [`src/client/dv-canvas.ts`](src/client/dv-canvas.ts) | 四个 `dvCanvas` 注册表 |
| [`src/client/definition.ts`](src/client/definition.ts) | 标签类型 |
| [`src/client/CanvasFactory.tsx`](src/client/CanvasFactory.tsx) | `dv.canvas` 组件工厂：通过注入的 hooks 读取注册表并交给 `CanvasView` |
| [`src/client/CanvasBody.tsx`](src/client/CanvasBody.tsx) | 标签主体：项目栏下的 `dv.canvas` 实例 |
| [`src/client/CanvasCenter.tsx`](src/client/CanvasCenter.tsx) | 中间区域视图：打开请求记录节点的 `dv.canvas` 实例 |
| [`src/client/CanvasView.tsx`](src/client/CanvasView.tsx) | 画布：平移、缩放、拖动、拖放、布局存储、焦点、重跑、节点宿主 |
| [`src/client/graph.ts`](src/client/graph.ts) | 节点、边、版本编号和默认布局 |
| [`src/client/NodeCard.tsx`](src/client/NodeCard.tsx)、[`src/client/NodeEditor.tsx`](src/client/NodeEditor.tsx) | 节点外框和浮动编辑器外壳 |
| [`src/client/AssetPicker.tsx`](src/client/AssetPicker.tsx) | 素材选择窗口，渲染版本种类的条目和 `dv.canvas.picker` 条目 |
| [`src/client/locales.ts`](src/client/locales.ts) | `dvCanvas` 词典 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/api`](../api/README.zh.md) — 除布局请求外每个手势背后的路由。
- [`@dv/ui-kit`](../ui-kit/README.zh.md) — API 客户端、wire 类型、注册表和 hook。
- [`@dv/ui-shell`](../ui-shell/README.zh.md) — 工作区中间区域和把它移到画布的 `dvCenter`。
- [`@dv/ui-media`](../ui-media/README.zh.md) — 绘制画布素材的 `dv.media` 组件工厂，以及素材预览。
- [DreamVerse 各包](../../../docs/subsystems/video-harness.zh.md) — 画布所显示的过期、版本和历史规则。

-----

<a id="model-experience"></a>
## 模型体验

### `dv_canvas_read` 和 `dv_canvas_move` 工具定义与结果

#### 模型看到什么

DSH 工具注册表挂载期间，agent 看到没有参数的工具 `dv_canvas_read` 和工具 `dv_canvas_move`，带下面的描述和参数。一次 `dv_canvas_read` 调用返回一个文本块，内容是 JSON：`project` 和 `cards`，每个已画节点一项，包含 `id`、`type`、`title`、`record`、`x`、`y`、`width`、`height`（渲染中卡片完成后的高度）和 `rendering`。本对话旁没有打开该项目的画布时，两个工具的调用都以 `No open canvas shows project <id>, so no node is known. Ask the user to open the canvas of this project, then call dv_canvas_read again. Nothing was moved.` 失败。一次 `dv_canvas_move` 调用返回 `project`、移动的节点数 `moved`，以及带移动后位置的 `cards`。被拒绝的移动以一句话失败：指出被列出两次的节点、未知节点及已知节点，或每对相距不足 24 单位的卡片及其方框。工具陈述的每种失败，包括没有绑定项目的调用、来自子 agent 的调用和在写入之前取消的调用，都以 `Nothing was moved.` 结尾。画布手势写下的记录经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息和工具到达模型。

##### dv_canvas_read 描述

```markdown
Read the canvas of this project that the user has open: every node with its id, type, title and record, its card box (x and y of the top-left corner, width, height; canvas units, y grows downward), and rendering: true while the node's record is still being generated. The height of a rendering card is the height that the finished card takes, so plan with it as given. Fails when no canvas of this project is open.
```

##### dv_canvas_move 描述

```markdown
Move canvas nodes in one call: list each node you place with the new x and y of the top-left corner of its card, planned from the boxes that dv_canvas_read returned. Keep at least 24 units between a moved card and every other card. Nodes you do not list stay where they are. The call moves nothing when a node is unknown or listed twice, or when a moved card would come closer than 24 units to another card. The user sees the move at once. A move is not a step of the project history: dv_proj_undo does not revert it; to restore, move the nodes back. Returns the canvas after the move.
```

##### dv_canvas_move 参数描述

```markdown
- moves: The nodes to move, each with the new top-left corner of its card.
  - node: The node id, as dv_canvas_read lists it.
  - x: The new left edge of the card.
  - y: The new top edge of the card.
```

#### Token 影响

工具注册表挂载期间，每次请求中两个定义约 290 token。每张卡片的结果约 50 token。

#### KV Cache 影响

两个定义是稳定工具段中的固定文本；挂载或移除本包会改变工具列表，使工具段及之后的缓存前缀失效。对话在每次调用之后收到其结果。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **画布上不能新建节点** — 已注册的主体和动作只重跑已有记录、修改角色、场景、风格的参考，以及放置或移除素材；新建角色留给对话。
- **整图重建** — 每个项目事件都重新拉取状态并重建图；长项目重画慢。
- **通过 `@dv/ui-kit` hook 读取状态** — `CanvasView` 通过 `@dv/ui-kit` 的 `useProjectState`、`useOperations` 和 `useLanguage` 读取项目状态、操作和界面语言，而不是通过注入的 `hooks` 来源；插件向 `dv.canvas` 组件工厂和标签主体注入一个 `DvClient` 实例，而不是普通回调（[客户端规则](../../client/AGENTS.md)）。没有契约类型指名 `DvClient` 或 React hook。
