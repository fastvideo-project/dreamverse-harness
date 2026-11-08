---
description: "DreamVerse 画布：项目节点列表中的节点，由插件通过 `@dv/ui-canvas/contract` 注册的节点类型用同一套外框绘制并按素材流向连线；工作区中间区域和右侧栏标签渲染的 `dv.canvas` 组件工厂；以及浮动编辑器外壳，它把画布的写入、版本条、素材选择窗口和素材预览借给每种类型的编辑器主体。"
kind: "package-reference"
---

# @dv/ui-canvas

[English](README.md) | 中文

## 概述

使用本包让 web 应用在对话旁边多一个 DreamVerse 项目的画布。`CanvasView` 在可平移、可缩放的画布上画出项目节点列表中的每个节点，节点之间按流过的素材连线，过期记录有标记。一个节点保留一个镜头、图片、文本或参考的每个版本，并显示最新版本。双击一个节点打开浮动编辑器，可以查看它的版本、重跑某个版本、添加参考，或预填对话输入框。画布是 画布 / Canvas 中间区域视图；右侧栏的 `dv-canvas` 标签显示同一个画布。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app`（提供右侧栏、locale 服务和客户端模块加载器）和 `@dv/api`（提供画布调用的项目路由和 [`@dv/canvas`](../canvas/README.zh.md) 的 `canvas` 切片）的 profile 里挂载插件。先构建浏览器 bundle：`pnpm run build` 会写出 `lib/client.js`。

画布只显示项目的当前状态，不显示历史。`@dv/canvas` 从记录重建 `canvas` 切片，画布为切片中的每个节点画一个节点，按创建顺序，位于切片中的位置：一个节点把同一个条目的记录作为它的版本，从旧到新，卡片显示最新版本。`type` 等于节点 `kind` 的已注册 `NodeType` 绘制该节点：画布把节点和它的一个版本交给类型，类型提供标题、`meta`、素材、预览和尺寸。`kind` 没有已注册类型的节点画成一张 16:9 的普通卡片，标题为其最新版本的操作标签。节点 ID 是节点列表给它的 ID，即创建该节点的记录的 ID。节点拥有其类型指名的素材（默认：最新版本的产出），然后是它较早版本的产出。已注册的 `RecordsInUse` 为某个素材报告的标记，例如时间线裁剪的片段的 已裁剪 / Trimmed，按原文显示在该素材的节点上。用户把文件或素材库缩略图拖到画布上，或在对话消息里以附加图片或 `dv:asset/<id>` 标签发出某个素材（由 `@dv/chat-references` 放置）时，该素材作为 `kind` 为 `asset` 的节点放到画布上，由 `@dv/ui-asset-pool` 绘制。这些都是历史中的步骤，所以历史会列出它们，撤销能撤回它们。当前状态改变时画布跟着改变，画布的修改立即成为历史中的步骤。

```yaml
- id: dv-ui-canvas
  name: '@dv/ui-canvas'
```

Host 半边注入 DSH Workspace 注册表，并在 Connection 服务挂载期间注册经认证的 Fetch 路由 `/api/dv/canvas/layout`。该路由把每个项目的视口存放在 `<项目文件夹>/.dreamverse/canvas-layout.json`，项目文件夹是 ID 等于项目 ID 的 Workspace 的路径。`GET ?project=<id>` 返回 `{viewport}`，第一次平移或缩放之前、文件缺失或无法读取时为 `viewport: null`；`POST {project, viewport}` 替换视口，原子地写入文件，并返回存储后的布局。只有 `x` 和 `y` 为有限数且 `zoom` 为正数的视口会被保留。错误使用每个 `/api/dv` 路由的响应体 `{error, code}`：项目格式错误时为 400 `invalid_params`；ID 不对应任何 Workspace，或写入没有 `.dreamverse/` 的文件夹时为 404 `unknown_project`，此时不创建任何东西。视口是视图状态：它不写记录，所以撤销不会平移或缩放，移除项目时文件留在文件夹里。节点的位置和尺寸是 `canvas` 切片中的项目内容。

Host 半边还注册 agent 的工具 `dv_canvas_read`，它拒绝由另一个 agent 启动的 agent，并为它另注册两条 Fetch 路由。每个已挂载画布保持 `GET /api/dv/canvas/agent?project=<id>&session=<id>` 打开，一个页面中每个项目和对话会话一条流，流发送 `text/event-stream` 帧：`ready` 和带 `{id, stream}` 的 `read`。每次调用找到该 agent 对话会话的项目，即文件夹为该会话工作目录的 Workspace，并在该项目位于该会话旁的每条已打开流上写一个 `read` 帧；第一个用 `POST /api/dv/canvas/agent/answer` 和 `{id, stream, project, cards}` 作答的画布了结这次读取，指向未知读取或未收到该读取的流的回答得到 404，作答时不绘制也不保存任何东西。没有这样的流打开时，调用立即失败；Config `answerTimeoutMs`（默认 10000）限制等待回答的时间。读取发给打开的画布，因为只有浏览器知道每种节点类型的默认尺寸。

浏览器半边提供客户端服务 `dvCanvas`（`@dv/ui-canvas/contract` 的 `DvCanvas`），它的四个注册表在插件的 UI 半边向其中注册之前是空的：`nodeTypes`（`NodeType`，以 `type` 为键，即宿主生产者注册该 `kind` 时用的节点类型键）、`recordsInUse`（`RecordsInUse`，以 `id` 为键）、`versionKinds`（`@dv/ui-kit/registries.ts` 的 `VersionKind`，以 `kind` 为键）和 `actions`（`NodeAction`，以 `id` 为键）。插件的 UI 半边在 `ctx.inject(['dvCanvas'], …)` 里注册它的描述符，并保留返回的注销函数；键已被占用的第二个描述符会抛出指名占用者的错误。浏览器半边注册 `dv.canvas` 组件工厂，它接收属性 `projectId`、`session` 和 `focus`，通过注入的 `hooks` 读取注册表，并声明三个键控子插槽，节点类型以其 `NodeType.type` 为键填充：`dv.canvas.card`（卡片主体，所有者属性为 `CardOwner`：节点、它每个素材的 wire 素材、文字缩放倍数和一个 `CardHost`；没有条目时卡片显示类型标签）、`dv.canvas.editor`（编辑器主体，所有者属性为 `EditorOwner`，其中的 `EditorHost` 另有编辑器的素材选择窗口）和 `dv.canvas.picker`（素材选择窗口里的素材库，键为 `assets`，所有者属性为 `PickerOwner`）。没有条目的编辑器只显示标题栏。它还注册 `dv-canvas` 标签类型（侧栏指南页以"视频画布"提供的页面）、中英文的 `dvCanvas` locale 命名空间、以自身 id `@dv/ui-canvas` 为键的标签主体，并把 `CanvasCenter` 注册为 `dv.center.view` 条目 `canvas`（顺序 0，标签为标签类型的 画布 / Canvas）。中间区域视图和标签主体各自为自己的项目和对话会话渲染一个 `dv.canvas` 实例，所以两者画出相同的卡片、编辑器和选择窗口。卡片主体和编辑器主体通过 `@dv/ui-media` 的 `dv.media` 组件工厂绘制媒体。`NodeAction` 显示在其 `shows` 返回 true 的每个节点上，按 `order` 排列：显示在编辑器标题栏里，以及最新版本失败的节点的画框里；它的 `run` 接收节点和一个没有素材选择窗口的 `NodeHost`。

填充画布的 UI 插件有：`@dv/ui-asset-pool`（`asset` 节点类型、它的卡片和编辑器主体，以及选择窗口里的素材库）、`@dv/ui-text-node`（`text` 节点类型）、`@dv/ui-timeline`（时间线片段使用的记录及其裁剪标记）和 `@dv/ui-composer`（"问 agent"动作，通过 `dv:compose` 窗口事件预填对话输入框）。由 [`@dv/ui-generation`](../ui-generation/README.zh.md) 的 `defineGenerationUi` 定义的每个生成 UI 插件（例如 `shot` 节点的 `@dv/ui-shot-render`）注册一个节点类型、它的卡片和编辑器主体，以及最新版本失败的节点的"重试"动作。参考名词 `@dv/ui-character`、`@dv/ui-location` 和 `@dv/ui-style` 来自 [`@dv/ui-reference-kit`](../ui-reference-kit/README.zh.md) 的 `defineReferenceUi`：每个注册一个节点类型、它的卡片和编辑器主体、一个版本种类，以及它的参考使用的记录。`@dv/ui-history` 的 `dvHistory` 加载期间，浏览器半边还注册 `canvas.node_position` 的历史行：移动时为 移动节点 / Moved “{title}”，调整大小时为 调整大小 / Resized “{title}”，标题为该节点卡片显示的标题；以及 `canvas.node_remove` 的历史行：从画布移除「{title}」 / Removed “{title}”，标题为移除前该节点卡片显示的标题，取自记录的 `report.removed` 保留的节点；以及 `canvas.node_rename` 的历史行：重命名为「{name}」 / Renamed to “{name}”，清除的名称显示为节点类型计算出的标题；选中一行会打开该节点。

| 手势 | 请求 |
| --- | --- |
| 卡片主体、编辑器主体或动作的 `host.run`，例如参考名词的编辑器添加或移除一个参考 | `POST /api/dv/operation`，带主体给出的操作、参数、输入和意图，并补上画布的项目、对话会话和 `surface: 'canvas'`；失败显示在画布上方 |
| `host.rerun`，例如镜头编辑器中输入框的发送或失败版本的"重试" | `POST /api/dv/operation`，带该请求和它的 `based_on` 记录，以同样方式补全；新记录成为同一个节点的最新版本，画布等待它出现 |
| 把文件拖到画布上 | 对每个文件（任何媒体类型）调用带 `surface=canvas` 的 `POST /api/dv/assets/import`，其 `asset.import` 同时把素材放到画布上；它的节点出现后，一条 `canvas.node_position` 记录把它放在指针下，之后每个都在前一个的右下方 32 个单位处 |
| 把素材库缩略图拖到画布上 | 素材已有节点时，用一条 `canvas.node_position` 记录把该节点移到指针下；素材库面板中的其他素材则由 `POST /api/dv/operation` 执行 `asset.place`，该素材作为输入角色 `asset`，新节点以同样方式放在指针下 |
| 节点右键菜单里的 从画布移除 / Remove from canvas、编辑器标题栏的垃圾桶按钮，或对选中节点按 Delete 或 Backspace | 先由 `window.confirm` 询问；确定发送 `POST /api/dv/operation`，执行 `canvas.node_remove`，`nodes: [<节点>]`，取消则不发送。状态显示该记录后，节点、它的连线、选中、菜单和编辑器一起消失；被拒绝时错误显示在画布上方。只有在没有打开编辑器、素材选择窗口和媒体预览都已关闭、按键也不在输入框、多行文本框或 contenteditable 元素里时，按键才起作用 |
| 在过期节点的编辑器里点"仍然保留" | 对节点的记录调用 `POST /api/dv/stale/accept`（作为历史中的一步运行 `proj.stale_accept`） |
| 拖动节点 | 拖动结束时 `POST /api/dv/operation` 执行 `canvas.node_position`，带节点新的 `x` 和 `y`，每次拖动一条记录；画布立即画出新位置，请求被拒绝时把节点放回原处 |
| 平移或缩放 | `POST /api/dv/canvas/layout`，带视口 |
| 在选中的节点上按 F2，或点击其编辑器的标题 | 回车或离开输入框保存改过的名称时，`POST /api/dv/operation` 执行 `canvas.node_rename`，带该节点和新的 `name`；清空的输入框发送 `name: null`，即清除名称。F2 把标题行变成名称输入框，它随缩放变化，按下它不会开始拖动；缩放低于 50% 时以及编辑器打开时，F2 改为打开编辑器的标题输入框。有文本框获得焦点或编辑器的素材选择窗口打开时，F2 不起作用。超过 80 个字符的名称让输入框保持打开，并显示 名称最多 80 个字符。 / The name can have at most 80 characters. Escape 取消重命名并保持编辑器打开。画布立即画出新名称，请求被拒绝时恢复旧名称 |
| 拖动选中节点的一个角把手 | 拖动结束时 `POST /api/dv/operation` 执行 `canvas.node_position`，带节点新的 `x`、`y`、`width` 和 `height`，尺寸均不小于节点的 `minSize`。窗口节点取指针要求的宽度和高度，主体显示更多或更少的内容；媒体节点的画框高度保持为 宽度 / `ratio` + `fixedHeight`，跟随指针移动更多的那个方向，图片随画框缩放。拖西边或北边的角时节点同时移动，使对角保持原位。按住把手不动则什么都不改，也不打开编辑器 |
| `@dv/canvas` 中 agent 的 `dv_canvas_node_position` 或 `dv_canvas_node_rename` | 页面不发请求：该记录改变 `canvas` 切片，该项目的每个已挂载画布在下一帧 `/dv/events` 到来、重新拉取状态时，把节点画在新位置或带上新名称 |
| `@dv/canvas` 中 agent 的 `dv_canvas_node_remove` | 页面不发请求：该项目的每个已挂载画布在下一帧 `/dv/events` 到来时去掉该节点、它的连线以及它的选中、菜单和编辑器，不显示提示；历史显示这一步 |

除布局请求外，每个请求都带 `surface: 'canvas'` 和画布旁边的对话，记录把该对话存为它的 `session`。工作区中间区域把请求 `{ record: <id> }` 交给中间区域视图时，视图打开一个节点；这个请求由 `@dv/ui-shell/contract` 的 `dvCenter.show({ view: 'canvas', target: { record } })` 给出，历史在选中记录时就这样做。画布把 ID 等于该 ID 的节点移到中央、选中并打开；没有时是把该记录作为版本的节点，否则是包含该记录第一个产出的节点。没有节点匹配时请求会等待，所以后注册的节点类型仍能打开它的节点；画布打开节点时取走该请求，所以重新挂载的画布不会再次打开该节点。标签主体不传焦点。

浮动编辑器打开时位于变暗画布的中央，宽度最多 720 px，高度约为画布的 80%。拖动标题行可移动编辑器；拖动右边缘、下边缘或右下角可调整大小，也可以聚焦右下角的调整手柄后按方向键（每次 16 px）；双击标题行恢复到居中的默认位置和大小。浏览器在 `localStorage` 中为所有节点保存同一个最近的位置和大小，下次打开编辑器时把它放进画布范围内。点击变暗的画布或按 Escape 关闭编辑器；上面叠着第二个编辑器时，同样的操作只关闭上面那个。编辑器打开时从它的节点放大出来，关闭时缩回该节点，变暗的画布同时淡入淡出（`@dv/ui-kit/zoom.ts`）。它的标题栏在标题上方显示类型圆点、类型标签和最新版本（例如 镜头 · v3），然后是显示在该节点上的动作和关闭按钮。标题在节点有名称时显示名称，否则显示节点类型计算出的标题；悬停时它带 surface-3 填充和铅笔图标，点击它会变成名称输入框；过期节点在主体上方显示 已过期 / Stale 和"仍然保留"。有多个版本的节点在标题栏下方显示版本条：版本 / Versions、每个版本一张按时间排列的缩略图（显示中的那张有轮廓），以及 第 {i} / {n} 版 / Version {i} of {n}。选中一张缩略图会在编辑器里显示该版本，卡片保持不变，因为卡片总是显示最新版本；每个版本挂载自己的主体，所以一个版本的草稿不会带到另一个版本。

单击节点会选中它（显示强调色描边和四角把手）；双击打开它的编辑器。关闭编辑器后描边保留，方便找回该节点；没有打开编辑器时点击空白画布会清除描边。右键单击节点会选中它，并在指针处打开它的菜单，样式与时间线标签菜单一致：先是该节点上显示的节点动作，然后是危险色、带 ⌫ 提示的 从画布移除 / Remove from canvas。画布右侧或下方放不下时，菜单移到指针左侧或上方；在菜单外按下、按 Escape、平移或缩放画布都会关闭它。主体或动作调用 `host.rerun` 后，该节点的动作被禁用（`NodeView.rerunning`），失败画框里发起重跑的那个动作的按钮显示类型的运行文字，直到该节点有了一个之前没有的版本；然后编辑器关闭，画布把该节点移到中央并选中它。如果请求先返回，编辑器在那时关闭。新版本出现之前请求失败时，编辑器主体的 `host.rerun`（`EditorHost`）以该请求的错误拒绝。画布一次只等一个重跑，所以后来的重跑替换它时，它会完成，不显示失败。错误由主体显示，动作或卡片主体的重跑（`NodeHost`）把该错误显示在画布的提示里，盖在打开的编辑器上方，编辑器标题栏和失败画框都一样。最新版本已完成并有产出、而用户在本浏览器中还没打开过的节点，标题旁显示一个强调色圆点，打开它的编辑器后消失。浏览器在 `localStorage` 中按项目保存已打开的版本；某个项目在一个浏览器中第一次打开时，所有已完成的版本都算作已打开。

画布用同一套外框绘制每个节点：画框上方的标题行。标题行是一行小字，有标题、未查看圆点、已过期 / Stale 标签和等宽字体的 meta：节点有 n 个版本且 n 大于 1 时为 v{n}，然后是类型的 `meta`。有多个版本的节点在画框后面画两个错开的画框。画框是圆角轮廓，没有底色和阴影；选中描边和键盘焦点轮廓只围绕画框。画框里，类型的 `dv.canvas.card` 主体填满画框，自己画底色（卡片式主体画 `@dv/ui-kit/frame.ts` 的 `CARD_SURFACE`，图片主体只画图片），最新版本在等待或运行中时，主体上覆盖类型的状态文字（`NodeType.status`，没有时为 运行中… / Running… 和 失败 / Failed），标记显示在主体左下角。最新版本失败的节点保持画框高度，不显示主体：在画框里的卡片表面色上显示类型的失败文字和显示在该节点上的动作，悬停时显示该版本的错误信息。最新版本被取代的节点变暗，过期节点的画框有危险色轮廓。每条边连在节点画框的中间，使用其起点节点类型的颜色（`NodeType.color`，它不给其他任何东西上色）；边来自最新版本的输入，选中节点的边以强调色画在最上层。编辑器主体和动作收到的 `NodeHost` 在 `run` 和 `rerun` 之外增加：`pickAssets` 打开素材选择窗口；`preview` 打开 `@dv/ui-media` 的 `dvMedia.preview` 素材预览，从触发元素放大出来（没有加载媒体插件时不打开任何东西）；`importFiles`（只在编辑器主体的 `EditorHost` 上）把本地文件逐个作为画布导入导入项目，每个素材也放到画布上，并按文件顺序给出它们的素材 ID（某次导入被拒绝时停止导入，并显示画布的错误提示）；`openNode` 在当前编辑器上方打开另一个节点的编辑器，当前编辑器里未保存的修改保留；`setPlaced` 把素材放到画布上或移除它的素材节点；`close` 关闭编辑器。传入 `versions: true` 时，素材选择窗口为每个已注册版本种类显示一个分区，标题为该种类的 `label()`，列出编辑器没有持有的每个条目的最新版本，通过 `dv.media` 绘制；其下显示键为 `assets` 的 `dv.canvas.picker` 条目。点击选中或取消选中，"确认"按选中顺序交出选中的引用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`CanvasView` 用 `@dv/ui-kit/useProject.ts` 的 `useProjectState` 和 `useOperations` 读取项目的当前状态和操作；`graph.ts` 的 `buildCanvasGraph` 把它们和已注册的描述符变成节点和边。它遍历 `canvas.order`，在记录中找到每个节点的最新版本，并向节点的类型要该版本的条目；`atVersion` 要较早版本的条目，供编辑器的版本条显示。节点为其最新版本的每个输入画一条边：输入为 `<id>@<version>` 且版本种类找到所指条目的节点（`VersionKind.node(state, id)`）时，从该节点连过来，否则从输入素材的节点连过来（拥有该素材的节点，没有时是沿产出链向上最近的、被某个节点持有的记录）。尺寸是以画布单位计的画框范围，画框上方的标题行不在其中。条目的 `sizing` 声明节点的 `defaultSize`、`minSize` 和种类：`window` 节点的画框变化时显示更多或更少的主体，`media` 节点的图片随画框缩放，它还声明 `aspectRatio`：`ratio` 是图片的宽 ÷ 高，`fixedHeight` 是图片之外固定栏的高度，所以它的画框高度为 宽度 / `ratio` + `fixedHeight`。已存 `width` 或 `height` 为 null 的节点在已存的角上取其类型的 `defaultSize`。画布按这个范围绘制、适应、居中、连接边，并报告给 `dv_canvas_read`。拖动或调整大小期间，以及从手势结束到状态显示写入的位置之前，画布画出手势的范围；写入被拒绝时丢弃该范围，并在画布提示中显示错误。每收到一帧 `/dv/events`，状态就重新拉取，所以对话消息放上的素材不用刷新就会出现。视口读写失败时忽略。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Host 半边：视口存储、其路由的注册，以及 `dv_canvas_read` |
| [`src/layout.ts`](src/layout.ts) | 保存视口的 `CanvasLayoutStore` 和布局路由 |
| [`src/canvas-layout.ts`](src/canvas-layout.ts) | 两个半边共用的范围和视口类型以及路由路径 |
| [`src/client/layout-client.ts`](src/client/layout-client.ts) | 布局路由的浏览器客户端 |
| [`src/client/contract/index.ts`](src/client/contract/index.ts) | `@dv/ui-canvas/contract`：节点契约、`DvCanvas` 和 `dv.canvas.*` 插槽（只有类型） |
| [`src/types.ts`](src/types.ts)、[`src/canvas.ts`](src/canvas.ts)、[`src/client/agent-canvas.ts`](src/client/agent-canvas.ts) | `dv_canvas_read` 与画布交换的值、它们的解析器，以及回答读取的 `CanvasViews` |
| [`src/client/index.ts`](src/client/index.ts)、[`src/client/history-row.ts`](src/client/history-row.ts) | `dvCanvas` 服务和注册，以及 `canvas.node_position`、`canvas.node_remove` 和 `canvas.node_rename` 的历史行 |
| [`src/client/dv-canvas.ts`](src/client/dv-canvas.ts) | 四个 `dvCanvas` 注册表 |
| [`src/client/definition.ts`](src/client/definition.ts) | 标签类型 |
| [`src/client/CanvasFactory.tsx`](src/client/CanvasFactory.tsx) | `dv.canvas` 组件工厂：通过注入的 hooks 读取注册表并交给 `CanvasView` |
| [`src/client/CanvasBody.tsx`](src/client/CanvasBody.tsx) | 标签主体：项目栏下的 `dv.canvas` 实例 |
| [`src/client/CanvasCenter.tsx`](src/client/CanvasCenter.tsx) | 中间区域视图：打开请求记录节点的 `dv.canvas` 实例 |
| [`src/client/CanvasView.tsx`](src/client/CanvasView.tsx) | 画布：平移、缩放、拖动、拖放、`canvas.node_position`、`canvas.node_remove` 和 `canvas.node_rename` 写入、节点菜单的条目、F2、焦点、重跑、节点宿主 |
| [`src/client/graph.ts`](src/client/graph.ts) | 来自节点列表的节点、边，以及每个版本的条目 |
| [`src/client/resize.ts`](src/client/resize.ts) | `resizedBox`：角拖动后节点的范围，不超出其类型的尺寸声明 |
| [`src/client/NodeCard.tsx`](src/client/NodeCard.tsx)、[`src/client/NodeEditor.tsx`](src/client/NodeEditor.tsx) | 带版本画框和标题行名称输入框的节点外框和节点菜单，以及带标题名称输入框、版本条和垃圾桶按钮的浮动编辑器外壳 |
| [`src/client/AssetPicker.tsx`](src/client/AssetPicker.tsx) | 素材选择窗口，渲染版本种类的条目和 `dv.canvas.picker` 条目 |
| [`src/client/locales.ts`](src/client/locales.ts) | `dvCanvas` 词典 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/canvas`](../canvas/README.zh.md) — 画布绘制的节点列表、`canvas.node_position` 和 `canvas.node_remove`，以及 agent 的 `dv_canvas_node_position` 和 `dv_canvas_node_remove`。
- [`@dv/api`](../api/README.zh.md) — 除布局请求外每个手势背后的路由。
- [`@dv/ui-kit`](../ui-kit/README.zh.md) — API 客户端、wire 类型、注册表和 hook。
- [`@dv/ui-shell`](../ui-shell/README.zh.md) — 工作区中间区域和把它移到画布的 `dvCenter`；[`@dv/ui-media`](../ui-media/README.zh.md) — 绘制画布素材的 `dv.media` 组件工厂，以及素材预览。
- [DreamVerse 各包](../../../docs/subsystems/video-harness.zh.md) — 画布所显示的过期、版本和历史规则。

-----

<a id="model-experience"></a>
## 模型体验

### `dv_canvas_read` 工具定义与结果

#### 模型看到什么

DSH 工具注册表挂载期间，agent 看到没有参数的工具 `dv_canvas_read`，带下面的描述。一次调用返回一个文本块，内容是 JSON：`project` 和 `cards`，每个已画节点一项，包含 `id`（节点 ID）、`type`（节点的 `kind`）、`title`（节点有名称时为名称，否则为其类型计算出的标题）、`versions`（节点持有的版本数）、`shown`（卡片显示的最新版本的记录）、`x`、`y`、`width`、`height`（节点的位置和其画框的尺寸，画框在标题行下方；节点列表中没有尺寸时为类型的默认尺寸）和 `rendering`。本对话旁没有打开该项目的画布时，调用以 `No open canvas shows project <id>. Ask the user to open the canvas of this project, then call dv_canvas_read again; dv_proj_state lists the canvas nodes with their positions.` 失败。来自子 agent 的调用以 `dv_canvas_read serves only the agent of the user's conversation, and another agent started this one. dv_proj_state lists the canvas nodes with their positions.` 失败。画布手势写下的记录（包括移动、调整大小和重命名）经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息和工具到达模型；[`@dv/canvas`](../canvas/README.zh.md) 负责 `dv_canvas_node_position`、`dv_canvas_node_rename` 和项目摘要中的 `canvas` 字段。

##### dv_canvas_read 描述

```markdown
Read the canvas of this project that the user has open: every node with its id, type, title (its name when it has one), versions (how many versions it holds) and shown (the record of the version it shows), its box (x and y of the top-left corner of the node; width and height of its frame, which sits below a 20-unit caption, so the node spans y to y + 20 + height; canvas units, y grows downward), and rendering: true while the shown version is still being generated. To redo or change a node's content, pass based_on with the shown id. To move or resize a node, call dv_canvas_node_position; to rename it, call dv_canvas_node_rename. Fails when no canvas of this project is open.
```

#### Token 影响

工具注册表挂载期间，每次请求中该定义约 160 token。每张卡片的结果约 55 token。

#### KV Cache 影响

该定义是稳定工具段中的固定文本；挂载或移除本包会改变工具列表，使工具段及之后的缓存前缀失效。对话在每次调用之后收到其结果。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **画布上不能新建节点** — 已注册的主体和动作只重跑已有记录、修改角色、场景、风格的参考，以及放置或移除素材；新建角色留给对话。
- **已存尺寸不跟随之后的图片** — 调整过大小的节点保留其 `canvas.node_position` 记录设定的尺寸，所以调整大小之后图片宽高比才变化的媒体节点（例如形状不同的新版本）在用户再次调整大小之前保留之前的画框。
- **`dv_canvas_read` 需要打开的画布** — 读取报告已挂载画布画出的范围，因为只有浏览器知道每种节点类型的默认尺寸；对话旁没有打开的画布时，agent 用 `dv_proj_state` 读取节点列表，但无法把其中为 null 的尺寸换算成范围。
- **整图重建** — 每个项目事件都重新拉取状态并重建图；长项目重画慢。
- **通过 `@dv/ui-kit` hook 读取状态** — `CanvasView` 通过 `@dv/ui-kit` 的 `useProjectState`、`useOperations` 和 `useLanguage` 读取项目状态、操作和界面语言，而不是通过注入的 `hooks` 来源；插件向 `dv.canvas` 组件工厂和标签主体注入一个 `DvClient` 实例，而不是普通回调（[客户端规则](../../client/AGENTS.md)）。没有契约类型指名 `DvClient` 或 React hook。
