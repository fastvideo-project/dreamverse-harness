# 界面

[English](ui.md) | 中文

DreamVerse 的浏览器端代码分为 UI 核心和 UI 插件。UI 核心是五个包：`@dv/ui-kit`、`@dv/ui-canvas`、`@dv/ui-history`、`@dv/ui-shell` 和 `@dv/ui-composer`。三个 UI 核心包各提供一个客户端服务：`@dv/ui-canvas` 提供 `dvCanvas`，`@dv/ui-history` 提供 `dvHistory`，`@dv/ui-composer` 提供 `dvMentions`。十个 UI 插件向这些服务注册描述符，并向 UI 核心的 slot 注册条目。`@dv/ui-shell` 声明工作区中央的 slot，`@dv/ui-canvas` 声明画布编辑器的 slot。每个 UI 包都通过 `@dv/api` 的路由读取项目（[Agent 和 API](agent-and-api.zh.md)），并且只通过运行操作来修改项目。[UI 注册表 Agent Note](../../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-ui-registries.zh.md) 和 [客户端状态类型 Agent Note](../../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-client-state-types.zh.md) 给出这一设计的理由。

<a id="ui-core-and-ui-plugins"></a>
## UI 核心和 UI 插件

UI 核心只通过插件注册的描述符和 slot 条目来绘制插件的数据。UI 插件是带 `./client` 入口的包 `packages/dv/ui-<name>`。宿主包 `@dv/<name>` 存在时，UI 插件是该包的浏览器半部。[架构页](../architecture.zh.md) 给出每一层允许的导入。

每个 UI 核心包拥有以下部分：

| 包                                                                 | 拥有                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@dv/ui-kit`](../../../packages/dv/ui-kit/README.zh.md)           | 一个没有插件入口的库。它不注册任何东西，每个消费方打包自己导入的模块。它持有协议类型（`types.ts`）、描述符类型和 `createRegistry`（`registries.ts`）、`defineReferenceUi`（`reference-kit.tsx`）、`/api/dv` 客户端（`api.ts`），以及所有视图以同一方式使用的辅助函数：`chainOf`、`versionRefOf`、`formatInputRef`、`isGenerationOperation`、`isGenerationRecord`、`operationLabel` 和 `taskLabel`。 |
| [`@dv/ui-canvas`](../../../packages/dv/ui-canvas/README.zh.md)     | `dvCanvas` 服务、右侧栏标签类型 `dv-canvas` 和中央视图 `canvas`。该中央视图声明 slot `dv.canvas.editor`、`dv.canvas.picker` 和 `dv.canvas.preview`，并把一个 `EntryEditorHost` 传给每个编辑器条目。                                                                                                                                                                                                 |
| [`@dv/ui-history`](../../../packages/dv/ui-history/README.zh.md)   | `dvHistory` 服务和标签类型 `dv-history`（历史面板）。`dv:history-focus` 事件会打开该标签。                                                                                                                                                                                                                                                                                                          |
| [`@dv/ui-shell`](../../../packages/dv/ui-shell/README.zh.md)       | 替代 DSH `main.conversation` 条目的工作区中央，带 slot `dv.explore` 和 `dv.center.view`；左侧栏导航；主题；对话 / Chat 和 轨迹 / Trajectory 标签类型；撤销和重做快捷键；以及 `dv:trajectory-focus` 链接。                                                                                                                                                                                           |
| [`@dv/ui-composer`](../../../packages/dv/ui-composer/README.zh.md) | `dvMentions` 服务和对话输入框的附加内容：`@` 来源、＋ 菜单的 引用 / Reference 行、面向创作者的工具名、对话 Markdown 中的媒体卡片、在历史中查看 / Show in history 链接，以及 `dv:compose` 预填。                                                                                                                                                                                                     |

每个 UI 插件注册以下部分：

| 包                                                                             | 宿主包               | 注册                                                                                                                                  |
| ------------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [`@dv/ui-asset-pool`](../../../packages/dv/ui-asset-pool/README.zh.md)         | `@dv/asset-pool`     | 标签类型 `dv-asset-pool`，以及键为 `assets` 的 `dv.canvas.picker` 和 `dv.canvas.preview` 条目                                         |
| [`@dv/ui-character`](../../../packages/dv/ui-character/README.zh.md)           | `@dv/character`      | 一次 `defineReferenceUi` 调用：一个节点类型、一个版本种类、在用的版本（take）、一个提及种类、一个历史行和一个 `dv.canvas.editor` 条目 |
| [`@dv/ui-location`](../../../packages/dv/ui-location/README.zh.md)             | `@dv/location`       | 一次 `defineReferenceUi` 调用：一个节点类型、一个版本种类、在用的版本、一个提及种类、一个历史行和一个 `dv.canvas.editor` 条目         |
| [`@dv/ui-style`](../../../packages/dv/ui-style/README.zh.md)                   | `@dv/style`          | 一次 `defineReferenceUi` 调用：一个节点类型、一个版本种类、在用的版本、一个提及种类、一个历史行和一个 `dv.canvas.editor` 条目         |
| [`@dv/ui-shot-plan`](../../../packages/dv/ui-shot-plan/README.zh.md)           | `@dv/shot-plan`      | 节点类型 `plan`、在用的版本、一个历史行，以及作为 `dv.canvas.editor` 条目的分镜计划编辑器                                             |
| [`@dv/ui-shot-render`](../../../packages/dv/ui-shot-render/README.zh.md)       | `@dv/shot-render`    | DSH `tool.call.toolview` slot 中 `dv_shot_render` 的渲染卡片                                                                          |
| [`@dv/ui-timeline`](../../../packages/dv/ui-timeline/README.zh.md)             | `@dv/timeline`       | 标签类型 `dv-timeline`、中央视图 `timeline`、在用的版本、一个历史行和提及种类 `clip`                                                  |
| [`@dv/ui-workflow-story`](../../../packages/dv/ui-workflow-story/README.zh.md) | `@dv/workflow-story` | `story.approve` 的链锚点及其历史行                                                                                                    |
| [`@dv/ui-mcp-presets`](../../../packages/dv/ui-mcp-presets/README.zh.md)       | `@dv/mcp-presets`    | `dv.explore` 的 `mcp` 条目：探索 / Explore 区的 MCP 标签                                                                              |
| [`@dv/ui-skills`](../../../packages/dv/ui-skills/README.zh.md)                 | 无                   | `dv.explore` 的 `skills` 条目、DSH `sidebar.panellist` slot 的 技能 / Skills 条目，以及 DSH `main` slot 中的技能页面                  |

<a id="views"></a>
## 视图

UI 各包是 web 应用的右侧栏标签类型和中央视图。因此视图和对话页显示在同一个 profile 里。各包绘制以下部分：

- [`@dv/ui-shell`](../../../packages/dv/ui-shell/README.zh.md) 把项目工作区放在中央，把 对话 / Chat 和 轨迹 / Trajectory 标签放在右侧。它把 画布 / Canvas 和 时间线 / Timeline 切换按钮放在顶栏。它绑定[历史规则](project.zh.md#history-rules)中的撤销和重做快捷键。
- [`@dv/ui-canvas`](../../../packages/dv/ui-canvas/README.zh.md) 把当前状态画成按素材流向相连的节点。它标记陈旧记录。它的节点编辑器在渲染新版本或替换参考图时写入一条用户记录。
- [`@dv/ui-timeline`](../../../packages/dv/ui-timeline/README.zh.md) 把每条时间线画成一条轨道。它把插入、移动、移除、拆分和裁剪手势变成按 `ClipId` 指定片段的 `timeline.*` 记录。它把导出变成一条 `timeline.export` 记录。
- `@dv/ui-asset-pool` 列出项目的每个素材并导入文件。
- `@dv/ui-composer` 为对话加上 `@` 和 `+ → 引用` 引用和面向创作者的工具名。
- `@dv/ui-shot-render` 为对话加上 `dv_shot_render` 的渲染卡片。

画布绘制以下节点：

- 导入的素材；
- 版本，每个都带模型和生成任务；
- 处于当前版本的角色、场景和风格，来自 `@dv/ui-character`、`@dv/ui-location` 和 `@dv/ui-style`；
- 处于最新版次的每个分镜计划，来自 `@dv/ui-shot-plan`，写出每个镜头的模型和生成任务。设置了 接上一镜头 / Continues the previous shot 的镜头也显示它。

`@dv/ui-workflow-story` 把一次故事批准的版本连到分镜计划节点（[链与锚点](#canvas-history-mention-rules)）。

<a id="slots"></a>
## shell 和画布的 slot

slot 是 DSH 客户端中的具名位置，插件通过 `ctx.slots` 向它注册条目。每个 DreamVerse slot 恰好由一个条目声明。`@dv/ui-shell` 的中央条目声明 `dv.explore` 和 `dv.center.view`。`dv.center.view` 的 `canvas` 条目声明三个画布 slot。标签 `dv-canvas` 的主体（`CanvasBody.tsx`）不声明 slot，因此画布 slot 只在中央视图中渲染。

```text
DSH slot main.conversation
└─ @dv/ui-shell center entry: declares dv.explore and dv.center.view
   ├─ no project open: the entry page
   │  └─ dv.explore         list slot, entry id   ◀── @dv/ui-mcp-presets (mcp), @dv/ui-skills (skills)
   └─ project open: the top bar toggle above the selected view
      └─ dv.center.view     list slot, entry id   ◀── @dv/ui-canvas (canvas), @dv/ui-timeline (timeline)
         └─ canvas entry: declares the canvas slots, reads the dvCanvas registries
            ├─ dv.canvas.editor   keyed slot, NodeType.id   ◀── @dv/ui-shot-plan, @dv/ui-character,
            │                                                   @dv/ui-location, @dv/ui-style
            ├─ dv.canvas.picker   keyed slot, key assets    ◀── @dv/ui-asset-pool
            └─ dv.canvas.preview  keyed slot, key assets    ◀── @dv/ui-asset-pool

◀── entry that the package registers with ctx.slots.register
NodeType of dvCanvas.nodeTypes ──▶ the dv.canvas.editor entry at key NodeType.id draws the editor body of its nodes
```

shell 按 `order` 把 `dv.center.view` 的条目显示为顶栏的切换按钮。URL 中的视图没有对应条目时，显示第一个条目。画布节点的编辑器渲染键等于该节点 `NodeType.id` 的 `dv.canvas.editor` 条目。编辑器条目只导入 `@dv/ui-kit`，因此画布把一个带三个回调的 `EntryEditorHost` 传给它：

- `run` 以画布写入的身份，用画布的项目和对话运行一个操作。
- `pickAssets` 打开画布的素材选择器。
- `preview` 打开画布的素材预览。

<a id="registries"></a>
## 注册表

注册表是 UI 插件添加和移除的描述符列表。每个注册表都是一个客户端服务。读取注册表的 UI 核心包在其 `apply` 的顶层通过 `ctx.reflect.provide` 提供它。提供方不在 effect 内提供，因为其他插件从各自的 fiber 向注册表注册。fiber 是 Cordis 中一个已加载插件的生命周期单元。

`@dv/ui-kit/registries.ts` 中的 `createRegistry(keys)` 创建一个空注册表。`keys` 函数给出一个描述符的键，两个描述符绝不持有同一个键。注册表有三个方法：

- 当另一个描述符已持有其中某个键时，`register(descriptor)` 抛出 `registry key "<key>" is already registered`。否则它加入该描述符并返回一个 disposer。
- `list()` 在变化之前返回同一个数组。
- `subscribe(listener)` 在每次变化时调用监听函数，并返回一个停止调用的函数。

UI 插件在 `ctx.inject(['dvCanvas'], …)`、`ctx.inject(['dvHistory'], …)` 或 `ctx.inject(['dvMentions'], …)` 内以 `scope.effect` 注册每个描述符。插件在服务缺席时也能加载。服务或插件离开时，它的描述符随之离开。每个注册的包都测试 dispose 会移除它的描述符，这是 [`packages/AGENTS.md`](../../../packages/AGENTS.md) 的要求。

| 注册表                  | 提供方            | 键        | 一个描述符给出的内容                               | 注册方                                                                                                                |
| ----------------------- | ----------------- | --------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `dvCanvas.nodeTypes`    | `@dv/ui-canvas`   | `id`      | 一种画布节点类型及其条目，从插件自己的切片读取     | `@dv/ui-shot-plan`（`plan`）、`@dv/ui-character`、`@dv/ui-location`、`@dv/ui-style`                                   |
| `dvCanvas.chainAnchors` | `@dv/ui-canvas`   | `starter` | 一个起始操作的记录所连到的节点，以及其已批准的版次 | `@dv/ui-workflow-story`（`story.approve`）                                                                            |
| `dvCanvas.takesInUse`   | `@dv/ui-canvas`   | `id`      | 插件数据使用其产出的记录，以及素材节点上的标记     | `@dv/ui-timeline`、`@dv/ui-shot-plan`、`@dv/ui-character`、`@dv/ui-location`、`@dv/ui-style`                          |
| `dvCanvas.versionKinds` | `@dv/ui-canvas`   | `kind`    | 一种引用种类的版本、名称、参考素材和节点 ID        | `@dv/ui-character`、`@dv/ui-location`、`@dv/ui-style`                                                                 |
| `dvHistory.rows`        | `@dv/ui-history`  | `match`   | 一个操作或组件键的历史行的主语和中心聚焦           | `@dv/ui-workflow-story`、`@dv/ui-timeline`、`@dv/ui-shot-plan`、`@dv/ui-character`、`@dv/ui-location`、`@dv/ui-style` |
| `dvMentions.kinds`      | `@dv/ui-composer` | `id`      | `@` 菜单的一个分区                                 | `@dv/ui-timeline`（`clip`）、`@dv/ui-character`、`@dv/ui-location`、`@dv/ui-style`                                    |

描述符类型位于 `@dv/ui-kit/registries.ts`：

| 类型          | 注册表                  | 字段                                                                                                                                                                                 |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NodeType`    | `dvCanvas.nodeTypes`    | `id`（包名，也是 `dv.canvas.editor` 的键）、`type`（卡片的 `data-node-type` 值，例如 `plan`）、`label()`、`color`、`column`（默认布局列），以及只读取插件自己切片的 `entries(state)` |
| `NodeEntry`   | 由 `entries` 返回       | `id`（画布节点 ID，例如 `plan:p1`）、`record`（写入所显示版本的记录）、`records`（较早版本的记录）、`title`、`subtitle`、`media` 和 `slots`（帧网格的格数）                          |
| `ChainAnchor` | `dvCanvas.chainAnchors` | `starter`（一个操作）、`anchor(starter)`（被开启的记录所连到的节点 ID）和 `approvedVersions(state, anchorId)`                                                                        |
| `TakesInUse`  | `dvCanvas.takesInUse`   | `id`、`uses(state)`（插件数据使用其产出的记录 ID）和 `badges(state)`（素材节点上的标记，例如片段的裁剪）                                                                             |
| `VersionKind` | `dvCanvas.versionKinds` | `kind`（一个引用种类）、`label()`、`node(id)`、`latest(state)`、`name(state, id, version)` 和 `assets(state, id, version)`                                                           |
| `HistoryRow`  | `dvHistory.rows`        | `match`（一个操作名，或表示某组件键全部操作的 `'<key>.'`）、`subject(record)` 和 `focus(record, records)`                                                                            |
| `MentionKind` | `dvMentions.kinds`      | `id`、`kind`（`dv:<kind>/<id>` 中的 `<kind>`）、`order`、`section()` 和 `items(state)`                                                                                               |

“type”一词指画布节点类型。“kind”一词指内核的引用种类或提及种类。`NodeEntry` 没有自己的标签，因此它的卡片显示 `NodeType.label()`。在 `@dv/ui-canvas` 内部，绘制出的节点是 `CanvasNodeType = 'asset' | 'take' | 'entry'`，`entry` 节点是已注册的 `NodeType` 绘制的节点。

<a id="canvas-history-mention-rules"></a>
## 画布、历史和提及规则

这些规则说明 UI 核心如何读取描述符。

**版本。** 当 `isGenerationRecord(record, op, mimeOf)` 为真时，一条记录是版本。当 `/api/dv/operations` 列出该记录的操作时，由操作声明决定。此时，操作非确定性、资源为 `gpu`、并且有图像、视频或音频输出时，记录是版本。因此一个待处理的版本在有产出之前就会绘制。当列表中没有该操作时，由记录决定。此时，记录非确定性、并且有图像、视频或音频输出时，记录是版本。

**链与锚点。** `chainOf` 按[审批链](workflows.zh.md#the-approval-chain)的起始记录规则给出记录的链。当链的起始记录已加载、且为起始记录的操作注册了 `ChainAnchor` 时，这条链是锚定链。画布对锚定链的版本执行以下步骤：

- 按 slot 和分支（lane）为每个版本命名。
- 用一条 `chain` 边把每个版本连到锚点节点。
- 为版本分组并编号。
- 填充带 `slots` 的条目的帧网格。

其他版本是自由版本，以操作标签作为标题。一个节点的已批准版次是所有已注册锚点的 `approvedVersions` 的并集；`@dv/ui-shot-plan` 的分镜计划编辑器读取它们。

**条目卡片。** 画布用同一种卡片绘制每个 `NodeEntry`。卡片的标题栏依次是以 `NodeType.color` 着色的类型圆点、`NodeType.label()`、` · <subtitle>`。带 `slots` 的条目显示帧网格。其他条目显示第一项媒体，更多媒体显示为 `+N`。

**历史行。** `started_by.record` 等于某行记录的已加载记录是该行的嵌套行。用户展开该行时，历史面板显示其嵌套行。一行显示 `operationLabel` 和与操作匹配的已注册 `HistoryRow` 的主语。匹配先比较精确的操作名，再比较 `'<key>.'`。只有第一个匹配的 `HistoryRow` 给出主语，即使它的 `subject` 返回 null 也是如此。没有匹配行的记录显示它在链中的 slot 和分支，例如 渲染镜头 1 · 9:16。选中一行时运行其匹配行的 `focus`。没有 `focus` 时，`proj` 记录不聚焦任何内容，其他记录把它的画布节点居中。

**提及。** `@dv/ui-composer` 的 `@` 来源按 `order` 列出每个 `MentionKind` 的条目，每种放在其 `section()` 之下。然后它列出项目最新的 40 个图像和视频。选中一项会插入 `@[<label>](dv:<kind>/<id>)`，`@dv/chat-references` 为 agent（智能体）展开它（[对话引用](agent-and-api.zh.md#chat-references)）。

<a id="wire-types"></a>
## 协议类型

`@dv/ui-kit/types.ts` 手写复制宿主类型的 JSON 字段，因为浏览器打包产物不能导入宿主包。`WireState` 是 `GET /api/dv/state` 应答的类型。[协议状态](project.zh.md#the-project-summary-and-the-wire-state)给出它的字段，以及视图何时重新获取它。

每个 UI 插件把自己切片的类型以必填键的形式合并进 `@dv/ui-kit/types.ts` 的 `ComponentStates` 接口，例如 `@dv/ui-character` 中的 `character: CharacterState`。它的宿主包把同一个必填键合并进 `@dv/project` 的 `ComponentStates`。合并进来的成员表示切片存在时该切片的类型。

`WireState.components` 的类型是 `WireComponents = Pick<ComponentStates, 'proj' | 'asset'> & Partial<ComponentStates>`。`proj` 切片和 `asset` 切片始终存在，因为 `@dv/api` 插件注入了它们的所有者 `dvProject` 和 `dvAssetPool`。其他切片只在服务器加载了拥有它的宿主插件时存在，因此它的类型是 `<K>State | undefined`。

切片的所有者在一个访问函数中写出切片缺失的含义。这个值是所有者在宿主上的初始切片，因此“宿主插件未加载”和“切片为空”画出的视图相同。

| 访问函数               | 包                                     | 切片缺失时的值 | 读取方                                                     |
| ---------------------- | -------------------------------------- | -------------- | ---------------------------------------------------------- |
| `itemsOf(spec, state)` | `@dv/ui-kit`（`reference-kit.tsx`）    | `{}`           | `newestOf`、`versionOf` 和 `ReferenceEditor`，服务每个名词 |
| `timelinesOf(state)`   | `@dv/ui-timeline`（`timelines.ts`）    | `[]`           | 时间线视图、在用的版本和提及种类 `clip`                      |
| `plansOf(state)`       | `@dv/ui-shot-plan`（`PlanEditor.tsx`） | `{}`           | 分镜计划的画布条目和 `PlanEditor` 组件                     |

宿主包可以没有客户端面。这样的宿主包的 UI 插件通过 `ComponentStates` 的 `[key: string]: unknown` 索引签名读取自己的切片，并用类型守卫收窄这个值。`@dv/ui-workflow-story` 用 `isStorySlice` 读取 `story` 切片。`packages/dv/ui-*/src` 中每一处 `state.components.<k>` 读取都位于拥有 `<k>` 的包里。通用代码（例如画布）只读取 `proj` 和 `asset`。编译器拒绝对可选切片的直接读取，例如 `state.components.character.hero`，报错 `'state.components.character' is possibly 'undefined'`。

[`@dv/ui-kit` README](../../../packages/dv/ui-kit/README.zh.md#use-this-package) 给出共享的客户端测试状态，以及测试中切片的类型。

<a id="history-and-the-trajectory"></a>
## 历史和轨迹

历史是项目历史列表中按顺序排列的步骤，来自每个发起者、视图和对话。轨迹是 agent 在一个对话中的步骤。记录通过它的 `session` 和 `tool_call` 字段把两者连起来。

[`@dv/ui-history`](../../../packages/dv/ui-history/README.zh.md) 是历史面板（标签类型 `dv-history`）。[历史规则](project.zh.md#history-rules)给出面板列出的步骤和显示为灰色的步骤。它们还给出撤销和重做按钮，以及 回到这一步 / Go back to this step 菜单项。面板还显示以下部分：

- 每一行显示动作、谁做的（你 / You、智能体 / Agent、自动 / Automatic）和状态。渲染行还显示一张缩略图。
- 当前位置的那一行显示 当前 / Current。
- 一条记录开启的记录是它那一行的嵌套行（[历史行](#canvas-history-mention-rules)）。
- 选中一行会在画布上聚焦该记录的节点（`dv:canvas-focus`）或在时间线上聚焦它的片段（`dv:timeline-focus`）。这只适用于当前位置或之前的步骤。
- 行内的 在轨迹中查看 / Show in trajectory 链接发出 `dv:trajectory-focus`。随后 `@dv/ui-shell` 在那个对话的那次工具调用处打开 轨迹。

在对话中，写入记录的工具的每个已结束行都有 在历史中查看 / Show in history 链接。该链接发出 `dv:history-focus`，历史面板随即选中那次工具调用写入的记录。
