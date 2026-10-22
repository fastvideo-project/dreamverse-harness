---
description: "DreamVerse 各视图共用的浏览器代码：/api/dv 客户端、wire 类型、参数表单模型、轨道几何、窗口事件、视图会话 hook 和项目栏。"
kind: "package-reference"
---

# @dv/ui-kit

[English](README.md) | 中文

## 概述

在 DreamVerse 的浏览器插件里使用本包与 `@dv/api` 通信，并读取它发来的状态。`DvClient` 封装每条 `/api/dv` 路由并跟随 `/dv/events`；`fieldsOf` 和 `paramsOf` 把操作的参数 schema 变成表单字段再变回参数；`useViewSession` 让视图的项目、项目的当前状态和操作与宿主同步；`ProjectBar` 是侧栏视图的项目和撤销栏；事件模块拥有各面板之间交换的 `dv:*` 窗口事件和页面全局变量；`registries.ts` 存放注册表的描述符类型和 `createRegistry`，这些注册表由 UI 核心包提供、由插件的 UI 半边填充。本包是一个库：它不注册任何东西，会被打进每个消费者的 bundle。

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
import { DV_TIMELINE_INSERT_EVENT } from '@dv/ui-kit/workspace-events.ts'
```

| 模块 | 内容 |
| --- | --- |
| `types.ts` | `WireState`（`head` 是当前位置，`tip` 是历史列表的最后一步）、`WireComponents`（`WireState.components` 的类型：`proj` 和 `asset` 切片始终存在，其他切片只在服务端加载拥有它的插件时存在，所以这种切片的类型包含 `undefined`）、`WireLine`（`{tip, at}`，撤销和重做的回答）、`ProjectRecord`、`WireInputRef`（存储的输入引用：素材、记录产出，或 `WireVersionRef`，即任一引用类型的一个版本）、`Asset`、`ProjectAsset`（带本项目导入名字和时间以及 `made_by` 的素材）、`WireOperation`、`WireProject`、`WireProjectSummary` 和 `WireProjectCover`（项目卡片的封面、镜头数、时长和最后编辑时间）、`ProjectEvent`、`OperationRequest`、`HistoryQuery`、`HistoryEntry`（`{record, place}`）、`WireHistory`、`ComponentStates`（`proj` 和 `asset` 切片；其他已加载组件的切片是 `unknown`：宿主包有客户端门面的 UI 半边把该门面的切片类型合并进来，其他 UI 半边用自己的类型守卫收窄自己的切片）：`@dv/api` 收发的 JSON 的结构类型 |
| `api.ts` | `DvClient`（`listProjects`、`listProjectSummaries`（`GET /api/dv/projects/summary`）、`getState`（读当前状态）、`listOperations`、`getTaskLabels`（`GET /api/dv/tasks`）、`runOperation`、`importAsset`、`undo`（往回移一步）、`moveTo`（移到历史列表中的某一步）、`redo`（往前移一步）、`acceptStale`、`listHistory`、`placeOnCanvas`（在画布来源上执行 `asset.place` 或 `asset.unplace`），项目、布局（位置和视口）、工作区和对话调用，`subscribe`）、`ViewSurface`、`DvApiError`、`assetUrl` |
| `form.ts` | `fieldsOf(params, values)`、`paramsOf(fields)`、`FieldParseError`：每个 schema 属性一个控件，带类型转换 |
| `timeline.ts` | `FALLBACK_CLIP_SECONDS`、`timelineName(timeline, numbered)`、`formatSeconds` |
| `references.ts` | `versionRefOf(ref)`、`parseVersionedReference(ref)` 和 `formatInputRef(ref)`：存储的版本引用的类型、ID 和版本，引用文本 `<id>@<n>` 所指的 ID 和版本，以及任一存储的输入引用的引用文本，不点名任何引用类型；`referenceAssets(state, references, kinds)`、`isPicture(asset)`、`pictureParts(prompt)`：一个镜头发给视频模型的各种媒体类型的参考素材（版本 `<id>@<n>` 经传入的 `VersionKind` 展开），其中哪些是图片（按输入顺序编号为 `Picture 1`、`Picture 2`……），以及在这些标记处切开的提示词 |
| `state.ts` | `assetIndex`、`videoAssets`；`isGenerationOperation(op)`（非确定性、资源为 `gpu`、有图片、视频或音频输出）和 `isGenerationRecord(record, op, mimeOf)`（给出 `op` 时由声明决定，否则由记录决定：非确定性，并有图片、视频或音频输出）：各视图区分生成记录所用的唯一规则 |
| `registries.ts` | `Registry` 和 `createRegistry(keys)`：每个键只有一个所有者的描述符列表（`register` 遇到已被占用的键时抛错，并返回注销函数），`list()` 在变化之前返回同一个数组；`DvHistory` 和 `HistoryRow`（`match`：一个操作名或 `'<key>.'`；`subject(record)`：名称之后的文字，自带分隔符，或 null；可选的 `focus(record, records)`：根据当前状态的记录，选中该记录时中间区域移到哪里，或 null；没有时为记录的画布节点）和 `CenterFocus`（`dv:canvas-focus` 或 `dv:timeline-focus` 事件及其 detail），由 `@dv/ui-history` 作为 `ctx.dvHistory` 提供；`DvCanvas`（以 `id` 为键的 `nodeTypes`、以 `starter` 为键的 `chainAnchors`、以 `id` 为键的 `takesInUse`、以 `kind` 为键的 `versionKinds`）及其描述符 `NodeType`、`NodeEntry`、`ChainAnchor`、`TakesInUse` 和 `VersionKind`（其 `label()` 是该种类在素材选择窗口中的分区标题），由 `@dv/ui-canvas` 作为 `ctx.dvCanvas` 提供；`DvMentions`（以 `id` 为键的 `kinds`）及其描述符 `MentionKind`（地址 `dv:<kind>/<id>` 的 `kind`、`@` 菜单分组的顺序 `order`、`section()`，以及给出 `uri`、`label`、`description` 和 `thumb` 素材的 `items(state)`），由 `@dv/ui-composer` 作为 `ctx.dvMentions` 提供；cordis `Context` 中 `dvCanvas`、`dvHistory` 和 `dvMentions` 的声明合并；键控插槽 `dv.canvas.editor` 的 `SlotMap` 声明合并（所有者属性为 `{ node, state, host }`，以 `NodeType.id` 为键，`EntryEditorHost` 把画布的写入、素材选择窗口和素材预览借给条目），由 `@dv/ui-canvas` 在节点条目的编辑器中渲染；键控插槽 `dv.canvas.picker`（所有者属性为 `{ projectId, session, client, onOpen }`）和 `dv.canvas.preview`（所有者属性为 `{ asset, onClose, zoom }`）的 `SlotMap` 声明合并，由 `@dv/ui-canvas` 以键 `assets` 在素材选择窗口和素材预览中渲染；列表插槽 `dv.center.view` 的 `SlotMap` 声明合并（所有者属性为 `{ projectId, session }`），`@dv/ui-shell` 在工作区中间区域显示其中选中的条目 |
| `reference-kit.tsx` | `defineReferenceUi(spec)`：由一个 `ReferenceUiSpec`（`id` 是包名，也是编辑器插槽键；`key` 是组件键、引用种类和节点类型；`slice(state)`，即该名词的切片，宿主半边未加载时为 `undefined`，此时各描述符不列出任何条目；`label`；`mention`；可选的 `editor`）生成一个引用名词的描述符：在第 0 列为每个条目的最新版本画一个节点 `<key>:<id>` 的 `NodeType`、一个 `VersionKind`、列出最新引用的生产记录的 `TakesInUse`、列出 `dv:<key>/<id>` 条目的 `MentionKind`、匹配 `<key>.` 并以记录的 `name`（否则以其 ID 参数）命名的 `HistoryRow`，以及注册它们和 `dv.canvas.editor` 条目的客户端插件主体 `apply(ctx)`；`ReferenceEditor`：默认编辑器主体（参考图、描述、`children` 行和“＋ 添加素材”），每次修改都通过 `host.run` 写入 `<key>.update` |
| `asset-media.tsx` | `AssetMedia({asset, style})`：图片素材画成图片，视频素材画成它的第一帧，与画布和分镜计划编辑器的画法相同 |
| `chain.ts` | `chainOf(record, records)`：记录所在的链（`WireStartedBy`），即它自身的 `started_by`，没有时用它 `based_on` 根记录的 `started_by`，再没有时为 null |
| `useProject.ts` | `useProjects`、`useOperations`、`useTaskLabels`、`useProjectState`：每次项目事件都重新拉取的加载器；`useLoader(load, deps)` 是它们共用的请求流程，会中止过期的请求，并在重新加载时保留上一次的值 |
| `useView.ts` | `useViewSession(client, surface, session?)`：项目选择、项目的当前状态、操作、最近一次失败和项目栏回调；`sessionFromLocation` 从页面地址的 `?session=` 读对话，让视图打开该对话的项目 |
| `ProjectBar.tsx` | 侧栏的栏（测试 ID `dv-kit-project-bar`）：项目选择器、新建项目按钮和撤销，用 `--dv-*` 主题变量画成 28 px 的次要控件；文案以 `labels` 传入，由所属插件先本地化 |
| `compose.ts`、`workspace-events.ts` | 窗口事件 `dv:compose`、`dv:timeline-insert`、`dv:canvas-focus`、`dv:history-focus`、`dv:trajectory-focus`、`dv:timeline-focus`（`DV_*_EVENT`）和素材拖拽类型 `application/x-dv-asset` |
| `tool-labels.ts` | `DV_TOOL_LABELS`：每个 `dv_proj_*`、`dv_asset_*` 和 `dv_models_*` 工具的中英文标签，这些工具所在的包不声明操作标签；`operationLabel`：操作的中英文名称（它在 `/api/dv/operations` 里的 `label`，没有时用它的工具在 `DV_TOOL_LABELS` 里的条目，再没有时用操作名）；`toolNameOf`：操作的工具名。输入框的工具行和历史面板显示这些名称。`taskLabel`：生成任务的中英文名称（它在 `WireTaskLabels`，即模型目录在 `GET /api/dv/tasks` 提供的标签里的标签，没有时用任务名），画布编辑器和 `@dv/ui-shot-render` 的渲染卡片显示它 |
| `tool-rows.tsx` | 工具调用在对话里的行的共用部分：`argsOf(raw)`（解析后的调用参数，流式到达时为 `{}`）、`wroteRecord(block)`（结果元数据是否写明了写出的记录）、`outputsOf(block)`（每个产出素材的角色、URL 和 MIME 类型），以及 `HistoryLink`（在历史中查看 / Show in history，测试 ID `dv-composer-open-history`，派发 `dv:history-focus`；每个调用方传入自己 CSS 模块里的按钮类名） |
| `current-project.ts`、`current-timeline.ts` | 打开的项目和选中的时间线，存在 `window.__dvCurrentProject` 和 `window.__dvCurrentTimeline` 上，用 `dv:current-project` 和 `dv:current-timeline` 通知 |
| `zoom.ts` | `useZoomPresence(value, openerOf, onOpened?)`：弹窗（对话视频播放器、画布节点编辑器、素材库预览）的缩放过渡。弹窗用 300 ms 从打开它的元素放大出来，关闭时用 250 ms 缩回该元素，背景同时淡入淡出；无论用哪种方式关闭，弹窗都等缩回结束才移除。打开它的元素已不存在或在屏幕外时，弹窗改为轻微缩放加淡出；开启 `prefers-reduced-motion` 时只淡入淡出。弹窗还在放大时被关闭，会从屏幕上的当前状态开始缩回。`mediaBox(width, height, maxWidth, maxHeight)` 在已知尺寸的图片或视频加载前就定好它的大小，这样由媒体决定大小的弹窗在过渡测量时已是最终尺寸 |
| `locale.ts` | `useText`、`pickText`：按 `<html lang>` 取一对中英文字符串中的一个 |

`subscribe` 在浏览器有 `EventSource` 时用它，否则每三秒轮询一次。跟随项目的每个 bundle 通过 `window.__dvEventSources` 为每个项目共享一条流；`window.__dvStreams` 记录打开的流数。

DreamVerse UI 包共享的客户端测试状态是 `tests/fixture.client.tsx` 中的 `fixtureState()`。它返回 `FixtureState`，即 `WireState & { components: Pick<ComponentStates, 'plan' | 'timeline'> }`。它不持有任何名词切片。`withTestRef(state)` 加入测试名词 `test_ref`，并保留参数的类型。客户端测试字面量只列出测试读取的切片。`packages/dv/e2e/tests/wire-state.ts` 中的 e2e 类型 `WireState` 把完整 bundle 的切片都定为存在。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`DvClient` 把每个错误响应体解码成 `DvApiError`，保留 HTTP 状态和 `ProjectError` 代码；`listProjectSummaries` 还检查摘要每个字段的类型，响应格式不对时抛出 `Error`。`useLoader` 在重新加载期间保留上一个值，并忽略输入已变化的响应；`useProjectState` 读取项目的当前状态，并把一阵项目事件合成一次重新拉取，所以任何地方的撤销或重做都会刷新每个视图。`types.ts` 里的类型手工照抄 `@dv/project` 的类型，因为宿主包不能被导入进浏览器 bundle；插件的切片类型来自其宿主包的客户端门面 `./types`；记录以 `ProjectRecord` 到达，输入的 `ref` 是存储时的对象。

| 文件 | 内容 |
| --- | --- |
| [`src/client/api.ts`](src/client/api.ts) | 客户端和共享的事件流 |
| [`src/client/form.ts`](src/client/form.ts) | 表单模型 |
| [`src/client/timeline.ts`](src/client/timeline.ts) | 时间线辅助函数 |
| [`src/client/references.ts`](src/client/references.ts) | 存储的输入引用、镜头参考素材和 `Picture N` 标记 |
| [`src/client/zoom.ts`](src/client/zoom.ts) | 弹窗的缩放过渡 |
| [`src/client/useProject.ts`](src/client/useProject.ts)、[`src/client/useView.ts`](src/client/useView.ts) | hook |
| [`src/client/ProjectBar.tsx`](src/client/ProjectBar.tsx) | 共用的栏 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/api`](../api/README.zh.md) — 这个客户端读取的路由和 JSON。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md) 与 [`@dv/ui-timeline`](../ui-timeline/README.zh.md) — 使用这些 hook 和项目栏的两个视图。
- [DreamVerse 项目](../../../docs/dreamverse/subsystems/project.zh.md) — 记录、历史规则和过期标记的含义。

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
