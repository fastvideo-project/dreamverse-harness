---
description: "DreamVerse 的项目组件：dvProject 服务，保存每个项目的记录及其历史列表和当前位置，运行操作，计算状态和历史，把每个操作连同它的确认规则变成它的智能体工具，拥有 dv_proj_* 工具，提供 dv:project 规则段落，并把项目状态消息和项目更新消息追加到每个聊天会话的对话中。"
kind: "package-reference"
---

# @dv/project

[English](README.md) | 中文

## 概述

使用本包修改和读取 DreamVerse 项目。每次修改都是一条记录，由 `dvProject.run`（组件操作）或某个 `proj.*` 方法（接受过期记录）写在项目当前位置之后；`undo`、`redo` 和移到某一步只移动当前位置。[历史规则](../../../docs/subsystems/video-harness.zh.md#history-rules)说明哪些修改是步骤，以及撤销和重做做什么。组件用 `registerOperation` 注册操作，用 `registerReducer` 注册归约函数。挂载了 DSH `tools` 注册表时，每个操作都成为它的智能体工具 `dv_<把点换成下划线的操作名>`，与项目自己的 `dv_proj_*` 工具并列。项目的规则作为 `dv:project` 提示词段落到达智能体，项目的状态作为追加的项目状态消息和项目更新消息到达。`CONTRACTS.md` 规定了每个内部模块。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

用项目目录和会话目录挂载插件。每个组件插件先用 `registerComponent` 注册自己的组件键，再注册归约函数和操作，`registerReducer` 和 `registerOperation` 拒绝未注册的键（`invalid_params`）；项目注册自己的键 `proj`，核心不保存组件列表。拥有引用种类的插件在注册组件键之后用 `registerReferenceKind({kind, component, assetsOf, createdBy, latest})` 注册它（第二个所有者得到 `kind_exists`，种类 `asset`、`record` 和 `version` 得到 `invalid_params`），并在 `ReferenceKinds` 中声明该种类；输入以 `<id>@<version>` 指向一个版本，`parseReference` 按唯一拥有该版本的种类解析一段引用文字，`listReferenceKinds` 列出各种类供智能体文字使用。ID 在各种类之间唯一：种类所有者的创建操作拒绝 `kindsWithId(state, id)` 列出的 ID，`latestVersion(state, kind, id)` 给出一个 ID 的最新版本。素材库加载时用 `registerAssetStore` 注册它的存储，聊天会话用 `bindSession` 绑定到项目。智能体调用前需要用户同意的操作把 `OperationSpec.confirm` 设为 `always`，并提供 `confirmSummary(call, state)`，它返回 `{text}`：这次调用要做什么；没有 `confirmSummary` 的这种 spec 会被 `registerOperation` 拒绝（`invalid_params`）。项目随后给该操作的工具加上仅工具参数 `user_approved`，拒绝不带该参数的智能体调用，此时不写任何记录；拒绝文字让智能体在对话中询问用户，问题用粗体。该参数不进入记录的 params，用户和系统的调用从不被拒绝。每个归约函数经 `Reducer.agentSummary` 把自己切片的字段加入项目摘要。操作在 `OperationSpec.pendingInputRoles` 中列出可以指向尚未完成的记录输出的输入角色：运行器立即记录并执行这样的调用，`resolved_asset` 为 null，生产记录完成后由记录的当前形式填入（时间线中等待渲染的片段使用它）。在 `execute` 中运行其他操作的操作在每个运行请求中传入 `started_by: {record, slot, lane?}`：发起这次调用的记录、调用方在自己的序列中给这次调用的位置（或 null），以及调用方的并行序列，例如一个变体；运行器把它复制到新记录上，从不读取它，没有该字段的记录不是由记录发起的。操作可以声明 `OperationSpec.label`，即 `{zh, en}`：视图为它显示的名称；Project 只保存它。

提示词以 `@[<label>](dv:<kind>/<id>)` 引用项目条目。两种引用语法是 [`src/grammar.ts`](src/grammar.ts) 中的字符串函数，它不导入任何宿主模块，因此浏览器通过入口 `@dv/project/grammar` 用内核自己的代码读写它们。`parsePromptCitations` 和 `citedAsset` 读取引用；`citedInput` 读取按角色引用调用输入的引用，例如 `dv:input/first_frame`；`citedElement` 读取其他引用的种类和 ID，`citationTarget` 读取任一引用 URI 的种类和 ID，`formatCitation` 把它们写回；`elementCitationUri` 按引用种类给出输入引用所属元素的引用 `dv:<kind>/<id>`。`formatCitation` 是引用的唯一写入函数：它在 ID 中编码 `(` 和 `)`，从不写入空标签或带换行的标签。`splitInputRef` 和 `formatInputSyntax` 只按语法读写输入引用文本（`<asset>`、`<record>#<output>`、`<id>@<version>`）。[`src/citations.ts`](src/citations.ts) 中的 `promptAssets` 和 `replacePromptCitations` 按调用读取这些引用。模型提供方插件用它们把每个引用换成它的模型的写法。

`check(request)` 按 `run` 的顺序执行 `run` 的各项拒绝检查（params 和输入角色、`after` 指向的记录、输入，以及操作的 `precondition`），不写任何内容。它返回 `{problems}`：第一个拒绝的句子，`run` 在当前状态下会接受该调用时没有句子。读取操作从不等待产出者，所以无论 `after` 怎么写，只要读取的输入指向尚未完成的记录的输出，`check` 和 `run` 都拒绝它。这个答案仅供参考，因为 `run` 会在项目锁内再次检查该调用。

```yaml
- id: dv-project
  name: '@dv/project'
  config:
    root: $DV_STATE_ROOT/projects
    sessionRoot: $DV_STATE_ROOT/sessions
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `root` | 必填 | 每个项目一个 `<ProjectId>/` 的目录；不存在时创建 |
| `cpuConcurrency` | `4` | 可同时运行的已调度 `cpu` 记录数 |
| `gpuConcurrency` | `1` | 可同时运行的已调度 `gpu` 记录数 |
| `sessionRoot` | 必填 | 每个聊天会话一个 `<session>.json` 的目录，记录会话绑定的项目 |
| `promptSectionOrder` | `4900` | `dv:project` 段落在系统提示词中的顺序；在 5000 的工具 SDK 段落之前 |

<a id="understand-the-implementation"></a>
## 理解实现

`src/index.ts` 中的服务委托给十一个私有模块：记录存储（唯一读写 `project.json`、`records.jsonl` 和 `line.json` 的代码）、运行器、调度器、历史、归约函数注册表、订阅、聊天会话（绑定、暂缓的工具调用）、智能体工具（每个操作一个 DSH 工具，带确认检查）、`dv_proj_*` 工具、智能体上下文（`dv:project` 提示词段落）和项目更新（项目状态消息和项目更新消息，在 `agent/pre-step` 加入；以及会话的智能体看到过的项目内容，由 `dvProjectSight` 会话投影从会话日志折叠得出）。每个项目的 `line.json` 存放 `{tip, at}`：`tip` 是最后一步，历史列表是 `tip` 的 `parents[0]` 祖先链，`at` 是当前位置。每个执行者的每次写入都把记录追加在 `at` 之后，并让它同时成为 `tip` 和 `at`，因此原来在 `at` 之后的步骤被丢弃：它们永久离开历史列表，运行器取消其中每个尚未结束的步骤（`error.code: 'discarded'`）。`undo(project)` 把 `at` 往回移一步（在第一条记录处为 `nothing_to_undo`）；`moveTo(project, to)` 把它移到历史列表中的那一步，可在 `at` 之前或之后（被丢弃的记录为 `invalid_params`）；`redo(project)` 把 `at` 往前移一步（在 `tip` 处为 `nothing_to_redo`）；`line(project)` 返回 `{tip, at}`。这些移动不写记录，并发出 `line` 事件。当前状态（`getState(project)`）折叠以 `at` 结尾的链。记录带有 `session`、`turn` 和 `tool_call`，作为指向 DSH 会话日志的链接：智能体工具在工具运行时读取轮次，即调用方智能体会话的 DSH 轮次编号，来自智能体循环注册的 `turnBoundary` 会话投影（不在轮次中或没有智能体时为 null）。`CONTRACTS.md` 列出每个模块的函数、规则、错误和测试。`listHistory(query)` 是唯一的历史查询：`dv_proj_history_list` 工具和 `@dv/api` 的 `POST /api/dv/history` 路由都调用它。它按从新到旧列出历史列表中的步骤，每项为 `{record, place}`，`place` 是相对 `at` 的 `before`、`current` 或 `after`；被丢弃的记录不列出，`listRecords(project)` 返回包括被丢弃记录在内的每条记录。它的筛选条件（`actor`、`component`、`operation`、`kind`、`status`、`session`、`turn`、`tool_call`、`records`、`before`）以“且”组合，`limit` 在筛选之后生效。

<a id="further-exploration"></a>
## 进一步探索

- 本包的 `CONTRACTS.md`：模块约定和测试计划。

<a id="model-experience"></a>
## 模型体验

### 操作工具定义

#### 模型看到什么

挂载了 DSH `tools` 注册表时，每个已注册的操作以一个工具 `dv_<把点换成下划线的操作名>` 到达模型：操作的 `description`，后接资源提示（"Uses the GPU." 或 "Runs on the CPU."）以及只读操作（"A read that writes no record."）和确定性操作（"Repeating a call with the same inputs and params reuses the earlier result."）的说明；它的 `params` 加 `toolParams`，以及 `confirm: 'always'` 时加上的布尔参数 `user_approved`（"Set true only after the user agreed to this exact call in the conversation. …"）；还有共享参数 `reason`（记录的 intent）、`project_id`、`inputs`（按角色给出 `<asset>`、`<record>#<output>`，或已注册引用种类的版本 `<id>@<version>`，文字中列出这些种类；只用于有输入的操作）、`supersedes` 和 `based_on`（后两个只用于写记录的操作）。

#### Token 影响

共享参数给每个定义最多增加约 200 个 token，确认参数再加约 40 个；其余来自操作的描述和参数，每个组件的 README 给出其工具的总量。

#### KV Cache 影响

这些定义位于挂载了 DSH 工具注册表的智能体每次请求固定的工具段中；注册或移除操作会改变工具列表，使从工具段开始的缓存前缀失效。

### 操作工具结果

#### 模型看到什么

一次调用返回一个文本块：`<status> <record>: <summary>`（只读操作不写记录，为 `<status>: <summary>`）、每个输出一行带素材 ID、媒体类型和 URL、调度的记录、参数和报告；设置了 `OperationSpec.omitParamsFromResult` 的操作（例如分镜计划组件的 `plan.create` 和 `plan.update`）不含参数，因为参数重复模型自己的工具调用。挂载了附件服务时，每个图片输出再跟一个图片块。失败或取消的记录返回带其消息的工具错误，被停止的记录返回 "dv_<name> was stopped before it finished."。需要用户同意却没带参数的调用返回工具错误："dv_<name> needs the user's agreement."，然后是 "What it will do:" 加 `confirmSummary` 的文字，以及指示：把这些给用户看，在对话中用粗体提问，得到用户回答后带 `user_approved: true` 再次调用。

#### Token 影响

每次调用约 50 到 200 个 token 的文本，另加图片块；确认拒绝再加上其摘要文字的长度。

#### KV Cache 影响

每个结果在调用之后追加到对话中；已缓存的前缀保持不变。

### 项目工具

#### 模型看到什么

八个工具：`dv_proj_create`、`dv_proj_open`、`dv_proj_rename`、`dv_proj_state`、`dv_proj_history_list`、`dv_proj_undo`、`dv_proj_redo` 和 `dv_proj_stale_accept`。`dv_proj_history_list` 按从新到旧返回步骤（默认 20 条），每条带 `place`（`current`、`before` 或 `after`）、操作、状态、发起者、意图和输出。其他工具以缩进 JSON 返回当前状态的项目摘要：`record`（只在写记录的工具之后出现：该调用写下的最新记录）、`project_id`、`title`、`head`、`records`（数量），然后按组件键的字母顺序是各组件的 `agentSummary` 字段（角色 `characters`、场景 `locations`、分镜 `plans`、风格 `styles`、时间线 `timelines`），最后是 `stale` 和 `recent`（最多十二条记录，带摘要和输出 URL）。`dv_proj_undo` 不带 `to` 时往回移一步，带 `to`（`dv_proj_history_list` 里的记录 ID）时移到那一步，可在当前一步之前或之后；`dv_proj_redo` 往前移一步。这些移动不加一步；之后的修改会丢弃当前一步之后的步骤。`dv_proj_rename` 接受 `title`，只重命名本对话的项目；它去掉标题首尾空白，拒绝空标题，标题已被其他项目使用时加后缀 ` 2`、` 3`、…，不写记录。除 `dv_proj_history_list` 之外的每个工具，以及每个写记录的操作工具，还把结果展示过的内容作为 `dv_seen` 存入结果的持久化元数据，模型从不读取它；项目更新消息不再列出这些记录。

#### Token 影响

插件挂载期间，八个定义固定约 700 个 token。项目摘要起始约 150 个 token，并随项目增长：每条最近记录、每个角色、场景、风格、分镜计划和片段都加上自己的字段。

#### KV Cache 影响

八个定义是固定工具段中不变的一部分；每个结果在调用之后追加到对话中，所以已缓存的前缀保持不变。

### 项目提示词段落

#### 模型看到什么

挂载了 DSH `systemPrompt` 服务时，每一步的系统提示词都带有 `dv:project` 段落，其中只有项目的规则：没有项目的对话用 `dv_proj_create` 开始，一旦项目状态消息、`dv_proj_create` 或 `dv_proj_open` 给出了本对话的项目，所有工作都留在该项目中；智能体自己的工具结果没有展示过的变化以 DreamVerse 项目更新到达，`dv_proj_state` 随时读取整个项目；结果为 pending 的调用，以及结果在 `scheduled` 下列出的记录，在后台运行，没有什么会等待它们，智能体继续工作或结束本轮；它们结束时，一条项目更新逐条列出，轮次结束之后也是如此，智能体检查结果并告诉用户：完成的渲染给出链接，失败的给出错误；智能体的每次调用和用户的每次编辑都立即成为项目历史中的一步，用户不需要接受修改；回滚调用 `dv_proj_undo`（一步，或 `to` 某一步），`dv_proj_redo` 往前移一步，这些移动不加一步，移动之后的新修改会永久丢弃后面的步骤，所以用户可能还需要它们时，智能体先询问；回滚从不用新编辑重建之前的状态；用项目摘要中的 ID 指称对象（记录、`<record>#<n>`、已注册引用种类的版本 `<id>@<version>`（规则列出这些种类）、素材，以及其他任何条目的 ID），用户用 `dv:` 提及指出对象，有歧义的指称要询问而不是猜；因需要用户同意而被拒绝的调用要给用户看，并在对话中用粗体提问；过期记录只在用户同意时重新渲染。该段落不含项目状态、选中项，也不含用户看不到的偏好。

#### Token 影响

无论项目多大，每一步约 560 个 token。

#### KV Cache 影响

稳定。该段落位于系统提示词中 `promptSectionOrder` 的位置（4900，在工具 SDK 段落之前），它的文本只在引用种类注册或注销时变化，而这会在同一个请求中重建操作工具定义。

### 项目状态消息和项目更新消息

#### 模型看到什么

挂载了 DSH `sessionProjections` 服务时，绑定了项目的聊天会话的每一步最多在该步自己的消息之后得到一条用户角色消息。项目状态消息出现在第一个没有项目视图的步骤（绑定会话的第一步，智能体用 `dv_proj_create` 或 `dv_proj_open` 绑定未绑定会话之后的第一步，或压缩、工具结果裁剪遮蔽了该消息之后的第一步）："DreamVerse project state. This conversation belongs to project <ProjectId>: do all work in it and never call dv_proj_create or dv_proj_open. Later changes that your own tool results did not show reach you as DreamVerse project updates. The project summary, as dv_proj_state returns it without the reports of recent records:"，然后是缩进 JSON 形式的该摘要。之后，项目以智能体没见过的方式发生变化的步骤会得到项目更新消息："DreamVerse project updates since your last step:"，撤销、重做或移动改变了当前位置时，后面先有一行 `- history: the current step is <record>; dv_proj_history_list shows which steps are undone or discarded.`；然后，直到当前位置的历史列表中智能体没见过的每条记录，以及其中它见过未完成、之后已结束的每条记录，各一行 `- <status> <record> (<who>): <text>`，其中 who 是 `user on canvas`、`user on timeline`、`user in asset pool`、`user in chat`、`user in history`、`user via API`、`your call`、`another chat` 或 `scheduled`，text 对完成的记录是操作的摘要（每个输出再缩进一行 `- <role>: <asset> (<mime>) <url>`），对失败或取消的记录是 `<intent>: <error>`，对未结束的记录是意图。同一会话的操作工具结果或项目摘要工具结果展示过的记录不再重复，没有新内容的步骤不得到消息。没有步骤要运行时，智能体也会得到更新。由本会话开始（本会话的智能体记录，或其分镜计划批准写下的 `scheduled` 记录）、且智能体见过未完成的记录，在项目消息或工具结果展示其结束之前结束时，会引起一次渲染唤醒。智能体空闲时，渲染唤醒开启一个新轮次，其第一步只带项目更新，紧跟在智能体的上一条回复之后。智能体的最后一步正在运行时，该轮次再多运行一步，这一步带着项目更新。渲染唤醒本身（来源种类 `dv-project-wake`，文本 "DreamVerse operations you started have finished: <records>. A DreamVerse project update follows with their results."）在智能体的收件箱中等待，从不到达模型：项目更新取代它，所以每次结束只报告一次。

#### Token 影响

项目状态消息约 60 个 token，另加不含报告的项目摘要（新项目约 150 个 token，随项目增长）。一条更新约 15 个 token，移动行另加约 25 个，每个记录行另加约 20 个，每个输出行另加约 40 个；长时间离开后，它列出期间写入的每条记录。

#### KV Cache 影响

每条消息都记录为 `user/message`，追加在已缓存的历史之后，所以请求逐个 token 地延伸上一个请求。渲染唤醒开启的轮次和它增加的步骤只追加智能体的上一条回复和项目更新，所以它们的请求同样延伸上一个请求。压缩开始新的请求序列，下一步会再次发送项目状态消息。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 只由 `dv_proj_history_list` 结果或失败的操作工具调用展示过的记录，仍会在下一条项目更新中报告，因为这些结果不存 `dv_seen` 元数据。
- 移动行不说明是谁移动的，也不列出被撤销或被丢弃的步骤，因为 `line.json` 不记录谁移动了当前位置；`dv_proj_history_list` 给出每个步骤的位置。
- 项目更新不报告改名，也不报告变为过期的记录；下一份项目摘要会展示两者。
- 从 `pending` 到 `running` 的变化，以及记录运行期间写入的输出和报告不报告；结束会报告。
- 渲染唤醒只到达智能体在宿主中存活的会话。没有智能体加载的会话（重启之后，遗留记录被取消为 `stopped`）在下一步才得知结束。无头运行在一个任务之后结束，所以结束时仍在运行的记录会在下次启动时被取消为 `stopped`，不唤醒任何智能体。
- 用户停止开始了某个计划渲染的轮次之后，该渲染继续运行，它结束时会唤醒智能体。
- 引用种类不给出素材的版本解析后不产生任何输入，所以指向这种版本的记录不留下它的痕迹，版本变化后也不会过期。
