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

`@dv/project` 只保留机制和开放的注册表，不提任何插件名词。它负责记录日志、历史列表、操作运行器与调度器、陈旧标记，以及各个操作的 agent 工具。插件在各自的 `ctx.effect` 中向它注册组件键、reducer、引用种类和操作，因此插件被 dispose（资源释放）时会移除自己的注册。操作声明自己的显示名称，引用种类为自己的版本作答，因此没有任何共享包列出这些插件。

数据单向流动。来自 agent、视图或插件服务的每次写入都是一次 `dvProject.run` 调用，它追加一条记录；reducer 根据记录算出切片；agent 和视图在修改之后重新读取状态，从不编辑切片。一个插件只运行自己的操作，其他插件通过该插件的类型化 Cordis 服务使用这些操作。内核存储 `started_by`，但从不读取它；工作流和 UI 代码负责它的含义。[适应度测试](../process/2026-10-17-dv-architecture-fitness-test.zh.md) 检查 `packages/dv/project/src` 不提任何插件键或名词，也从不读取 `started_by`。

记录、注册表、运行顺序以及 agent 和视图读取的状态记录在 [DreamVerse 项目](../../../../docs/dreamverse/subsystems/project.zh.md) 中，单向数据流的图在 [DreamVerse 架构](../../../../docs/dreamverse/architecture.zh.md) 中。

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
