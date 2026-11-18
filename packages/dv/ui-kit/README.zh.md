---
description: "DreamVerse 各视图共用的浏览器代码：/api/dv 客户端、wire 类型、参数表单模型、轨道几何、窗口事件、视图会话 hook 和项目栏。"
kind: "package-reference"
---

# @dv/ui-kit

[English](README.md) | 中文

## 概述

在 DreamVerse 的浏览器插件里使用本包与 `@dv/api` 通信，并读取它发来的状态。`DvClient` 封装每条 `/api/dv` 路由并跟随 `/dv/events`；`fieldsOf` 和 `paramsOf` 把操作的参数 schema 变成表单字段再变回参数；`useViewSession` 让视图的项目、项目的当前状态和操作与宿主同步；`ProjectBar` 是侧栏视图的项目和撤销栏；事件模块拥有各面板之间交换的 `dv:*` 窗口事件和页面全局变量；`registries.ts` 存放 `createRegistry`、`VersionKind` 和 `@` 菜单的描述符，以及 `UiPlugin`。本包是一个库：它不注册任何东西，会被打进每个消费者的 bundle。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把 `@dv/ui-kit` 加进浏览器插件的 `devDependencies`，按模块逐个导入；包的 `./*` 导出映射到 `src/client/*`，DSH 客户端 bundle 会内联导入的内容。没有 Loader 行。

```ts
import { DvClient } from '@dv/ui-kit/api.ts'
import { useViewSession } from '@dv/ui-kit/useView.ts'
import { DV_HISTORY_FOCUS_EVENT } from '@dv/ui-kit/workspace-events.ts'
```

| 模块 | 内容 |
| --- | --- |
| `types.ts` | `WireState`（`head` 是当前位置，`tip` 是历史列表的最后一步）、`WireComponents`（`WireState.components` 的类型：`proj` 和 `canvas` 切片始终存在，其他切片只在服务端加载拥有它的插件时存在，所以这种切片的类型包含 `undefined`）、`WireLine`（`{tip, at}`，撤销和重做的回答）、`ProjectRecord`、`WireInputRef`（存储的输入引用：素材、记录产出，或 `WireVersionRef`，即任一引用类型的一个版本）、`Asset`、`ProjectAsset`（带本项目导入名字和时间以及 `made_by` 的素材）、`WireOperation`、`WireProject`、`WireProjectSummary` 和 `WireProjectCover`（项目卡片的封面、镜头数、时长和最后编辑时间）、`SummaryQuery`（收窄单个项目概要的 `timeline`）、`ProjectEvent`、`OperationRequest`、`OperationCheck`（`POST /api/dv/operation/check` 的回答：`problems`，即调用此时运行会得到的拒绝句子，可以运行时为空）、`WireModelEntry`（`GET /api/dv/models` 的一个条目，带模型的 `schema()`）、`HistoryQuery`、`HistoryEntry`（`{record, place}`）、`WireHistory`、`ComponentStates`（`proj` 切片和 `canvas` 切片 `WireCanvas`，其节点是带 `WireNodePosition` 的 `WireCanvasNode`；其他已加载组件的切片是 `unknown`：宿主包有客户端门面的 UI 半边把该门面的切片类型合并进来，其他 UI 半边用自己的类型守卫收窄自己的切片）：`@dv/api` 收发的 JSON 的结构类型 |
| `api.ts` | `DvClient`（`listProjects`、`listProjectSummaries`（`GET /api/dv/projects/summary`）、`getState`（读当前状态）、`listOperations`、`getTaskLabels`（`GET /api/dv/tasks`）、`listModels`（`GET /api/dv/models`）、`checkOperation`（`POST /api/dv/operation/check`，不写任何内容）、`runOperation`、`importAsset`、`undo`（往回移一步）、`moveTo`（移到历史列表中的某一步）、`redo`（往前移一步）、`acceptStale`、`listHistory`、`placeOnCanvas`（在画布来源上执行 `asset.place`），项目、工作区和对话调用，`subscribe`）、`ViewSurface`、`DvApiError`、`errorMessage(error)`（视图为抛出的值显示的文字）、`assetUrl` |
| `form.ts` | `fieldsOf(params, values)`、`paramsOf(fields)`、`valueOf(field)`、`FieldParseError`：每个 schema 属性一个控件，带类型转换；`@dv/ui-composer` 的 `dv.prompt` 输入框的默认参数标签读取 `fieldsOf` 和 `valueOf` |
| `timeline.ts` | `FALLBACK_CLIP_SECONDS`、`timelineName(timeline, numbered)` |
| `references.ts` | `versionRefOf(ref)` 和 `formatInputRef(ref)`：存储的版本引用的类型、ID 和版本，以及任一存储的输入引用的引用文本，不点名任何引用类型，经 `@dv/project/grammar` 的 `formatInputSyntax` 写出；`requestInputsOf(record)`：操作请求所接受形式的记录输入，记录按素材各存一次的版本只出现一次；`referenceAssets(state, references, kinds)`：一个镜头发给视频模型的各种媒体类型的参考素材，经 `@dv/project/grammar` 的 `splitInputRef` 从每个引用文本读出（版本 `<id>@<n>` 经传入的 `VersionKind` 展开）；`referenceItems(state, references, kinds)`：每个引用文本一项，带视图显示的名称，版本显示其版本类型给出的名称和第一个参考素材，其他引用显示其素材名 |
| `state.ts` | `assetIndex(state)`：以素材 ID 为键的状态素材 |
| `media-type.ts` | `mediaTypeOf(mime)`：MIME 类型的媒体类型，即小写、去掉空格和参数的顶层类型，`@dv/ui-media` 以它为视图和媒体类型的键 |
| `player-box.ts` | `playerBox(asset, maxHeight)`：可播放素材在界面上的外框，全宽、比例与素材相同，最高 `maxHeight`（尺寸未知时取完整的 `maxHeight`），例如画布节点编辑器 360 px 的播放器和历史 220 px 的播放器；媒体视图填满它 |
| `registries.ts` | `Registry` 和 `createRegistry(keys, owner)`：每个键只有一个所有者的描述符列表（`register` 遇到已被占用的键时抛错，用 `owner` 指明占用者，并返回注销函数），`getSnapshot()` 在变化之前返回同一个数组，`subscribe(listener)` 报告每次变化，所以插槽注册可以通过 inject 的 `hooks` 来源把注册表交给它的组件；`VersionKind`（`kind` 是内核的一种引用类型；`label()` 是该种类在素材选择窗口中的分区标题；`node(state, id)` 是显示该条目的画布节点，没有节点显示它时为 null；`latest(state)` 是每个条目的最新版本；以及一个版本的 `name` 和 `assets`），由 `@dv/ui-canvas` 保存在它的 `dvCanvas` 注册表 `versionKinds` 中；`DvMentions`（以 `id` 为键的 `kinds`）及其描述符 `MentionKind`（地址 `dv:<kind>/<id>` 的 `kind`、`@` 菜单分组的顺序 `order`、`section()`，以及给出 `uri`、`label`、`description` 和 `thumb` 素材的 `items(state)`，`@` 菜单把 `thumb` 素材的媒体类型的静帧显示为条目图标），由 `@dv/ui-composer` 作为 `ctx.dvMentions` 提供，以及 cordis `Context` 中 `dvMentions` 的声明合并；`UiPlugin`（`inject` 和 `apply`），即 Cordis 从写 `export const { inject, apply } = define…Ui({ … })` 的 UI 插件文件加载的内容。`@dv/ui-canvas/contract` 声明画布的描述符，`@dv/ui-history/contract` 声明历史行的类型 |
| `waveform.ts` | `useAudioEnvelope(assetId)`、`peakEnvelope`、`clipPeaks`：音频解码和峰值包络，时间线的声音块以及 `@dv/ui-asset-pool` 的音频媒体视图把它们画成波形条 |
| `canvas-nodes.ts` | `nodeOfRecord(state, record)`：把某条记录作为版本持有的画布节点的 ID，没有时为 null；`assetLabel(state, asset)`：素材在画布之外显示的名称，它的画布节点有名称时跟随该名称（节点指显示该素材的节点，没有时指把创建该素材的记录作为版本持有的节点），否则为素材自己的名称。节点的主素材显示节点的名称：放置节点的主素材是它放置的素材，其他节点的主素材是它最新的有输出的版本的第一个输出。节点的其他素材显示节点的名称再加它自己的名称，例如 `Opening · shot1.mp4`，所以同一个节点的两个素材不会显示相同的名称 |
| `chain.ts` | `chainOf(record, records)`：记录所在的链（`WireStartedBy`），即它自身的 `started_by`，没有时用它 `based_on` 根记录的 `started_by`，再没有时为 null |
| `useProject.ts` | `useProjects`、`useOperations`、`useTaskLabels`、`useProjectState`：每次项目事件都重新拉取的加载器；`useLoader(load, deps)` 是它们共用的请求流程，会中止过期的请求，并在重新加载时保留上一次的值 |
| `loaded.ts` | `loadedOnce(empty, load)`：一个可观察的来源，起始值为 `empty`，在第一次订阅时加载它的值，供插槽注册的 inject `hooks` 来源使用；加载失败时保持 `empty`，下一次订阅再加载 |
| `useView.ts` | `useViewSession(client, surface, session?)`：项目选择、项目的当前状态、操作、最近一次失败和项目栏回调；视图打开外壳已打开的项目（`useCurrentProject`），否则打开最新的项目 |
| `InlineRename.tsx` | `InlineRename`：重命名时替换标题的文本框，用于 `@dv/ui-shell` 的项目和对话，以及 `@dv/ui-canvas` 的节点名称。它选中标题，按回车或失去焦点时保存改过并去掉首尾空白的标题，按 Esc 取消；`check` 拒绝的改过的标题让文本框保持打开，显示危险色边框，并在下方显示消息。它不把按键和指针事件传给外围元素，所以 Esc 不会关闭对话框，按下也不会开始拖动 |
| `ProjectBar.tsx` | 侧栏的栏（测试 ID `dv-kit-project-bar`）：项目选择器、新建项目按钮和撤销，用 `--dv-*` 主题变量画成 28 px 的次要控件；文案以 `labels` 传入，由所属插件先本地化 |
| `compose.ts`、`workspace-events.ts` | 窗口事件 `dv:compose`、`dv:history-focus`、`dv:trajectory-focus`（`DV_*_EVENT`）和素材拖拽类型 `application/x-dv-asset`（素材 ID）与 `application/x-dv-asset-mime`（其 MIME 类型） |
| `tool-labels.ts` | `DV_TOOL_LABELS`：每个 `dv_proj_*`、`dv_asset_*` 和 `dv_models_*` 工具的中英文标签，这些工具所在的包不声明操作标签；`operationLabel`：操作的中英文名称（它在 `/api/dv/operations` 里的 `label`，没有时用它的工具在 `DV_TOOL_LABELS` 里的条目，再没有时用操作名）；`toolNameOf`：操作的工具名。输入框的工具行和历史面板显示这些名称。`taskLabel`：生成任务的中英文名称（它在 `WireTaskLabels`，即模型目录在 `GET /api/dv/tasks` 提供的标签里的标签，没有时用任务名），`@dv/ui-generation` 的版本编辑器和对话卡片显示它 |
| `tool-rows.tsx` | 工具调用在对话里的行的共用部分：`argsOf(raw)`（解析后的调用参数，流式到达时为 `{}`）、`wroteRecord(block)`（结果元数据是否写明了写出的记录）、`outputsOf(block)`（每个产出素材的角色、素材 ID、URL 和 MIME 类型），以及 `HistoryLink`（在历史中查看 / Show in history，测试 ID `dv-composer-open-history`，派发 `dv:history-focus`；每个调用方传入自己 CSS 模块里的按钮类名） |
| `current-project.ts` | 打开的项目，存在 `window.__dvCurrentProject` 上，用 `dv:current-project` 通知 |
| `zoom.ts` | `useZoomPresence(value, openerOf, onOpened?)`：弹窗（画布节点编辑器和 `@dv/ui-media` 的素材预览）的缩放过渡。弹窗用 300 ms 从打开它的元素放大出来，关闭时用 250 ms 缩回该元素，背景同时淡入淡出；无论用哪种方式关闭，弹窗都等缩回结束才移除。打开它的元素已不存在或在屏幕外时，弹窗改为轻微缩放加淡出；开启 `prefers-reduced-motion` 时只淡入淡出。弹窗还在放大时被关闭，会从屏幕上的当前状态开始缩回。`mediaBox(width, height, maxWidth, maxHeight)` 在已知尺寸的图片或视频加载前就定好它的大小，这样由媒体决定大小的弹窗在过渡测量时已是最终尺寸 |
| `frame.ts` | 画布节点的画框，即标题行下方的圆角轮廓，节点的 `dv.canvas.card` 主体画在其中：`WIDE_RATIO`，16:9 宽高比；`mediaSizing(size, fallbackRatio, fixedHeight)`，`@dv/ui-canvas/contract` 中媒体节点的 `NodeSizing`，类型为 `media`：图片宽高比限制在 3:4 到 16:9 之间，宽或高未知时取 `fallbackRatio`，默认画框宽 208 单位，最窄画框宽 104 单位，高度均为 宽度 / 宽高比 + `fixedHeight`（图片之外固定栏的高度）；`CARD_SURFACE`，卡片式主体自己画的底色（卡片表面色和文字色，占满画框高度），显示已知尺寸图片的主体不画其他内容 |
| `elapsed.ts` | `formatElapsed(seconds)`：`m:ss`，从一小时起为 `h:mm:ss`，负数和非有限值显示为 `0:00`；`useElapsedSeconds(since, active)`：从 ISO 时间 `since` 起的整秒数，`active` 为真时每秒重新渲染，没有 `since` 或未激活时返回 `null`，画布节点和历史行用它显示渲染用时 |
| `locale.ts` | `useText`、`pickText`：按 `<html lang>` 取一对中英文字符串中的一个 |

`subscribe` 在浏览器有 `EventSource` 时用它，否则每三秒轮询一次。跟随项目的每个 bundle 通过 `window.__dvEventSources` 为每个项目共享一条流；`window.__dvStreams` 记录打开的流数。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`DvClient` 把每个错误响应体解码成 `DvApiError`，保留 HTTP 状态和 `ProjectError` 代码；`listProjectSummaries` 还检查摘要每个字段的类型，响应格式不对时抛出 `Error`。`useLoader` 在重新加载期间保留上一个值，并忽略输入已变化的响应；`useProjectState` 读取项目的当前状态，并把一阵项目事件合成一次重新拉取，所以任何地方的撤销或重做都会刷新每个视图。`types.ts` 里的类型手工照抄 `@dv/project` 的类型，因为宿主包的服务端模块不能被导入进浏览器 bundle；插件的切片类型来自其宿主包的客户端门面 `./types`；记录以 `ProjectRecord` 到达，输入的 `ref` 是存储时的对象。

| 文件 | 内容 |
| --- | --- |
| [`src/client/api.ts`](src/client/api.ts) | 客户端和共享的事件流 |
| [`src/client/form.ts`](src/client/form.ts) | 表单模型 |
| [`src/client/timeline.ts`](src/client/timeline.ts) | 时间线辅助函数 |
| [`src/client/references.ts`](src/client/references.ts) | 存储的输入引用、记录的请求输入和镜头参考素材 |
| [`src/client/zoom.ts`](src/client/zoom.ts) | 弹窗的缩放过渡 |
| [`src/client/elapsed.ts`](src/client/elapsed.ts) | 用时文字及其 hook |
| [`src/client/useProject.ts`](src/client/useProject.ts)、[`src/client/useView.ts`](src/client/useView.ts) | hook |
| [`src/client/InlineRename.tsx`](src/client/InlineRename.tsx) | 行内标题输入框 |
| [`src/client/ProjectBar.tsx`](src/client/ProjectBar.tsx) | 共用的栏 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/api`](../api/README.zh.md) — 这个客户端读取的路由和 JSON。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md) 与 [`@dv/ui-timeline`](../ui-timeline/README.zh.md) — 使用这些 hook 和项目栏的两个视图。
- [DreamVerse 各包](../../../docs/subsystems/video-harness.zh.md) — 记录、历史规则和过期标记的含义。

-----

<a id="model-experience"></a>
## 模型体验

无；浏览器侧的客户端、表单和轨道辅助代码，不触碰任何提示词、schema 或工具结果。

#### KV Cache 影响

无；本包不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **手工复制的 wire 类型** — `types.ts` 照抄宿主的类型；宿主侧新增字段要手工加到这里。
- **扁平表单** — 表单模型把嵌套对象和数组渲染成一个 JSON 文本框。
- **轮询回退** — 没有 `EventSource` 时视图每三秒轮询一次，无法知道变了什么。
