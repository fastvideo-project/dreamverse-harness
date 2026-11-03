# Agent Note: DreamVerse 数据流——dvProject 内核的记录、reducer 与切片

Status: implemented

[English](2026-10-17-dv-architecture-data-flow.md) | 中文

## 问题

DreamVerse 项目的每次修改都是内核 `@dv/project`（Cordis 服务 `dvProject`）写下的一条记录，视图读取的是 reducer 根据这些记录算出的状态。内核知道写入和读取这些数据的插件，因此改动一个插件就要修改内核和其他共享包：

- `packages/dv/project/src/shared.ts` 中的 `COMPONENT_KEYS` 固定了组件键（`proj`、`asset`、`bible`、`plan`、`shot`、`timeline`、`inspect`）以及项目摘要字段的顺序。带有自己的键的插件要修改内核。
- `packages/dv/project/src/types.ts` 声明了 `CharacterId`、`LocationId` 和 `StyleId`，在 `RecordInputRef` 中为 story bible 的每个种类各设一个分支，并把输入标志命名为 `OperationInput.bible`。`parseInputRef` 按名字逐一尝试这三个种类，agent（智能体）文本写着 "a character, location or style version such as c1@1"，`dv:project` 规则还提到了 clip。加入第四个引用名词就要修改内核的类型、解析器和 agent 文本。
- reducer 注册表只允许一个 reducer 定义 `Reducer.assetsOf` 和 `Reducer.createdBy`，因此只有 story bible 能拥有版本。
- 由计划批准启动的渲染带有 `shot.render` 的参数 `plan`、`plan_version` 和 `shot`，画布按这些参数匹配渲染。任何其他启动渲染的工作流都必须写入计划参数。
- `packages/dv/ui-kit/src/client/tool-labels.ts` 中 `DV_TOOL_LABELS` 的 37 个条目为每个 agent 工具命名，`dv_bible_*` 也在其中，因此每加一个操作都要修改 `@dv/ui-kit` 才能得到显示名称。
- `packages/dv/api/src/wire.ts` 中的 `mentionedAssets` 导入 `@dv/story-bible`，并遍历它的切片（slice）来收集参考图。

## 决策

`@dv/project` 只保留机制和开放的注册表，不提任何插件名词。它负责记录日志、历史列表、操作运行器与调度器、陈旧标记，以及各个操作的 agent 工具。插件在各自的 `ctx.effect` 中向它注册组件键、reducer、引用种类和操作，因此插件被 dispose（资源释放）时会移除自己的注册。数据单向流动：

```
agent tool call   view (POST /api/dv/operation)   plugin service (ctx.dv<Name>.<method>)
        \                    |                              /
         +-------------> dvProject.run <-------------------+
                             |
                             v
          record line and update lines in <project>/records.jsonl
                             |
                             v
          every registered reducer, record by record, in registration order
                             |
                             v
          ProjectState.components: one slice per registered reducer
                 |                                   |
                 v                                   v
   project summary (dv_proj_* tools,      WireState (GET /api/dv/state)
   dv:project prompt section)                        |
                                                     v
                                        canvas, timeline, history, asset pool
```

视图和 agent 从不直接编辑切片。它们只通过运行操作来写入项目数据，并在修改之后重新读取状态。画布节点位置是记录之外的视图状态，由 `@dv/ui-canvas` 的布局存储保存：拖拽经由它的路由保存位置，agent 的 `dv_canvas_move` 由它的宿主一半保存位置（[agent 画布工具](../feature/2026-10-26-dv-agent-canvas-tools.zh.md)）。[适应度测试](../process/2026-10-17-dv-architecture-fitness-test.zh.md) 检查 `packages/dv/project/src` 不提任何插件键或名词，也从不读取 `started_by`。

## 记录、组件与切片

一个项目是存储根目录下的三个文件：`project.json`、`records.jsonl` 和 `line.json`。每条 `ProjectRecord` 是对一个操作的一次调用，带有调用方信息（`actor`、`surface`、`session`、`turn`、`tool_call`、`intent`）、`params`、`inputs`、`outputs`、`based_on`、`supersedes`、可选的 `started_by`，以及只会向前推进的 `status`。更新行设置追加之后才变化的字段。只有记录存储读写这些文件。

历史列表是最后一步（`tip`）沿 `parents[0]` 的祖先链，项目状态是当前位置（`at`）处的状态。`undo`、`redo` 和 `moveTo` 移动位置，不写记录。

插件先调用 `registerComponent(key)`，再注册 reducer 和操作；同一个键的第二次声明抛出 `component_exists`，内核自己注册 `proj`。`registerReducer` 拒绝未注册的键（`invalid_params`）和同一个键的第二个 reducer（`reducer_exists`）。切片类型通过声明合并加入 `ComponentStates`（[客户端状态类型](2026-10-17-dv-architecture-client-state-types.zh.md)）。一个键可以没有 reducer：`shot` 和 `inspect` 只注册键和操作。

`ReducerRegistry.reduceChain` 把链上的每条记录依次传给每个已注册的 reducer，然后才处理下一条记录。reducer 是纯函数，会忽略它不解释的记录。

## 操作

操作名的形式是 `<key>.<verb>`，`registerOperation` 拒绝不在 `OperationSpec.component` 这个键之下的名字。`dvProject.run` 是唯一的修改路径：它校验参数和输入，运行操作的 `precondition`，追加 `pending` 记录，然后立即执行该记录，或在 `after` 中的记录之后执行。`readOnly` 操作不写记录。

每个操作都成为 agent 工具 `dv_<name with _>`。`OperationSpec.label` 保存显示名称 `{ zh, en }`；内核只存储它，`toWireOperation` 在 `GET /api/dv/operations` 中发送它，`@dv/ui-kit` 中的 `operationLabel` 读取它。`DV_TOOL_LABELS` 只保留 `dv_proj_*`、`dv_asset_*` 和 `dv_models_*` 工具，这些工具所在的包不声明名称。

一个插件只运行自己的操作。其他插件通过该插件的类型化 Cordis 服务使用这些操作：`dvTimeline.layout` 自己运行 `timeline.create` 或 `timeline.update`。[工作流](2026-10-17-dv-architecture-workflows.zh.md) 组合这些服务。

`StartedBy` 是 `{ record, slot, lane? }`：其 `execute` 启动了这次调用的记录、调用方为这次调用给出的位置（例如镜头槽位）或 null，以及调用方的并行序列（例如一个广告变体）。运行器把 `RunRequest.started_by` 复制到记录上，内核从不读取它。工作流写入这个字段，`packages/dv/ui-kit/src/client/chain.ts` 中的 `chainOf` 为画布和历史面板读取它（[UI 注册表](2026-10-17-dv-architecture-ui-registries.zh.md)）。

## 引用与陈旧标记

`RecordInputRef` 是一个素材、`{ record, output }`，或某个引用种类（reference kind）的一个版本，例如 `{ character: 'c1', version: 2 }`。文本形式分别是素材 ID、`<record>#<n>` 和 `<id>@<n>`。对于 `<id>@<n>`，`parseInputRef` 询问每个种类的 `createdBy`，并要求恰好有一个回答；没有回答或有两个回答时抛出 `invalid_inputs`。

种类的所有者把自己的键合并进 `ReferenceKinds`，并用 `ReferenceKindSpec` 调用 `registerReferenceKind`：`kind`、所属的 `component`，以及各自读取所有者切片的 `assetsOf`、`createdBy` 和 `latest`。内核拒绝种类 `asset`、`record` 和 `version`，拒绝同一种类的第二个所有者（`kind_exists`），也拒绝未注册的组件。注册或移除一个种类会重建每个操作工具，因为 `inputs` 文本列出了已注册的种类。ID 在各种类之间唯一：种类所有者的创建操作拒绝 `kindsWithId` 列出的 ID。[引用名词](2026-10-17-dv-architecture-reference-nouns.zh.md) 描述了 `@dv/reference-kit`，它为每个名词注册一个种类。

运行器把一个版本输入展开为该版本每个素材各一条 `RecordInput`，每条都带有自己的 `resolved_asset`。`proj` 切片保存 `records`、`created_by`（素材到记录）、`superseded` 和 `stale`。一个输入的生产者是创建其素材的记录；对于版本输入，还包括 `createdBy` 指出的记录。当一条记录的某个生产者被取代或陈旧时，这条记录就是陈旧的。一次取代会在一次正向遍历中重算所有标记，一条 `proj.stale_accept` 记录（工具 `dv_proj_stale_accept`）移除一个标记。`character.update` 取代写下当前版本的那条记录，因此每个读取过 `c1@1` 的渲染都会变为陈旧。

## agent 与视图读取的内容

`packages/dv/project/src/proj-tools.ts` 中的 `projectSummary` 向 agent 提供 `project_id`、`head` 和记录数，接着按组件键的字母顺序列出各个 reducer 的 `agentSummary` 字段，然后是 `stale` 和最近的 12 条记录。两个 reducer 使用同一个字段名时抛出 `invalid_params`。除 `dv_proj_history_list` 外，每个 `dv_proj_*` 工具都返回这份摘要；对于已绑定的项目，`dv:project` 系统提示词段在每一步都展示它，旁边是列出已注册种类的规则。

`packages/dv/api/src/wire.ts` 中的 `toWireState` 发送 `project`、`head`、`tip`、原样的切片，以及 `mentionedAssets` 收集的素材：每条记录的输出和已解析输入（其中包括每个版本的参考图）、导入的素材和时间线片段。`dvProject.subscribe` 为 `/dv/events` 的 SSE（Server-Sent Events）事件提供数据，`@dv/ui-kit` 中的 `useProjectState` 在一阵事件的最后一个事件之后 150 ms 重新获取状态。[客户端状态类型](2026-10-17-dv-architecture-client-state-types.zh.md) 描述浏览器如何为这些切片定义类型。

视图通过 `DvClient.runOperation`（`POST /api/dv/operation`）写入，画布编辑器通过 `EntryEditorHost.run` 走同一条路径。`ApiHandlers.runOperation` 用 `dvProject.parseInputs` 解析输入，并以 actor `user` 的身份调用 `dvProject.run`。

## 曾考虑的替代方案

**在 `run` 上使用类型化的操作名（`OperationMap`）。** 一个从操作名映射到参数的合并类型可以为每次 `dvProject.run` 调用提供类型。它被否决，因为类型化服务在知道参数的插件内部包装 `run`，agent 工具、`@dv/api` 和 `@dv/chat-references` 按名字调用，运行器在运行时校验参数，而映射条目可能与其 schema 脱节。

**把 `started_by` 设为单纯的记录 ID。** 它被否决，因为实时流和画布需要镜头位置，单个记录 ID 不携带这一位置；`slot` 保存这一位置。

**把链字段命名为 `origin`。** 它被否决，因为 `RecordOrigin` 表示谁在何处执行了动作（`actor`、`surface`）。

**不设 `lane`。** 同一个镜头的两个变体会在画布和历史中显示为第 1 个和第 2 个 take，而 `packages/dv/e2e/tests/stories/canvas-timeline.e2e.ts` 禁止这种显示；之后再修复就要修改内核和两个 UI core 包。

**在画布的 `ChainAnchor` 上提供 `lane` 方法。** 它输给了 `started_by.lane`：画布和历史面板读取同一个只有一个所有者的已存储事实。

**把 `resource` 字段复制到每条记录上。** 这样 UI 能识别其操作未加载的生成记录。它被否决，因为记录携带 `deterministic` 和输出的媒体类型，已存储的 2178 条记录中没有一条带有这个字段，也没有其他消费方需要它。

**内核 `inputs` 文本中跟随第一个已注册种类的示例 ID。** 它被否决，因为只有所有者知道一个种类的 ID 形式，而且第一个种类随加载顺序变化，因为每次注册种类都会重建这段文本。每个创建工具给出自己的示例。

**在 `ReferenceKindSpec` 上提供 `ids(slice)`，由 `mentionedAssets` 读取。** 它被否决，因为它为得到同一份素材列表而改动内核 API 和每个种类所有者：`proj.records` 的已解析输入包含每个版本的参考图。

**为所有者已变化的已存储记录提供读取器或迁移。** 它被否决，因为 `packages/AGENTS.md` 要求兼容路径对应一个当前的消费方，而这样的读取器会让另一个插件的操作名永久留在一个宿主包里。

## 后果

**这一设计带来的好处。** 插件无须修改 `@dv/project` 就能加入组件键、reducer、引用种类和操作：把 story bible 拆分为 `@dv/character`、`@dv/location` 和 `@dv/style` 没有改动 `packages/dv/project/src` 的任何一行。来自 agent、视图或工作流的每次写入都是一条记录，因此撤销、重做、历史和陈旧标记覆盖每个插件和每个引用种类。

**加载顺序会传到 agent。** `inputs` 文本和 `dv:project` 规则中的种类列表遵循注册顺序；`packages/bundle/dv/cordis.patch.yml` 按 character、location、style 的顺序加载它们。摘要按组件键排序字段，因此 `styles` 位于 `plan` 和 `story` 字段之后，与 `characters` 和 `locations` 分开。

**同一个 ID 空间。** 所有引用种类共享一个 ID 空间，每个种类的所有者都必须拒绝 `kindsWithId` 列出的 ID；`@dv/reference-kit` 为每个名词执行这项检查。

**没有所有者的记录。** 插件未加载的记录留在 `proj.records` 中，不进入其他任何切片。未注册种类的版本输入不是陈旧标记的生产者，指名该版本的调用以 `invalid_inputs` 失败。带有 `bible.*` 记录的项目可以加载，但其中的角色、场景和风格为空。

**不受检查的链字段。** 运行器复制 `started_by` 时不检查其记录是否存在；工作流和 UI 代码负责它的含义。

**已知缺口。** `packages/dv/project/src/types.ts` 中的 `Surface` 联合类型列出了视图 `timeline` 和 `asset_pool`，适应度测试跳过这个联合类型。`mentionedAssets` 读取 `state.components.timeline`，而 `@dv/api` 没有注入 `dvTimeline`；[客户端状态类型](2026-10-17-dv-architecture-client-state-types.zh.md) 记录了这个缺口。
