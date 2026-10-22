# Agent Note: DreamVerse 工作流插件与共享的镜头遍历

Status: implemented

[English](2026-10-17-dv-architecture-workflows.md) | 中文

## 问题

计划审批曾放在 Shot plan 组件 `@dv/shot-plan` 内部。它的操作 `plan.approve`（工具 `dv_plan_approve`）通过 `dvProject.run` 按名称运行 `shot.render`、`timeline.create` 和 `timeline.update`，于是一个领域包写入了另外两个包的记录。为了再次找到自己的成片和计划的时间线，它在每次渲染上打上参数 `plan`、`plan_version` 和 `shot`，在每条时间线记录上打上 `plan`；`@dv/shot-render` 和 `@dv/timeline` 只为这一个调用方声明这些参数，画布按 `params.plan` 给成片分组。`plan` 切片带有 `approved_by`。`@dv/shot-plan` 注入 `dvModels` 来拒绝未知的模型键，读取 `shot.render` 的估算来让 `plan.create` 报告 GPU 估算，并依赖 `@dv/models` 和 `@dv/timeline`。调用顺序写在组合包的 skill（技能）`video-directing` 里，它指名 `dv_plan_approve`。第二种审批计划的方式，例如以两种画幅渲染的广告剪辑，除了 `@dv/shot-plan` 之外无处安放。

## 决策

工作流是一个普通组件，位于自己的包 `@dv/workflow-<key>` 中，组件键为 `<key>`。它拥有一个预览审批的只读操作、一个执行审批的写操作、记录其审批的切片，以及承载其流程的 skill。每个工作流都需要且不含策略的代码放在库 `@dv/workflow-kit` 中。组合包只带一个工作流，即故事工作流 `@dv/workflow-story`（服务 `dvStory`），以及它的浏览器一半 `@dv/ui-workflow-story`。[分层注记](2026-10-17-dv-architecture-layers.zh.md)给出这两层在依赖顺序中的位置。

`@dv/shot-plan` 保留 `plan.create`、`plan.update`、记录各版本的 `plan` 切片、`dvShotPlan.get`、`dvShotPlan.shots`，以及计划的结构检查。它只注入 `dvProject`。审批操作、成片复用、时间线的选择、GPU 估算、每个镜头的模型检查以及版本的审批状态都归故事工作流所有。

## 工作流约定

每个工作流包有以下部分：

- **预览。** `<key>.preview` 为 `readOnly: true` 且 `confirm: 'never'`。它不写记录，报告预览行、GPU 估算和 `problems`，即渲染会被拒绝的每条原因。
- **审批。** `<key>.approve` 为 `confirm: 'always'`；它的同步 `confirmSummary` 给出标题行和预览行。只要 `problems` 不为空，它的 `prepareToolCall` 和 `precondition` 就拒绝调用，所以每个调用方都在记录产生之前被拒绝。它的 execute 写完整条链，不经过步骤引擎，也不经过后台进程。
- **链。** 审批写入的每条记录都带 `started_by`，内容为审批记录、一个 slot 和可选的 lane，字段定义见[数据流注记](2026-10-17-dv-architecture-data-flow.zh.md)。成片复用和时间线归属都用工作流的 `Owns` 函数检查日志中的起始记录，从不读取工作流切片。
- **服务。** 工作流不按名称运行任何操作。渲染经过生成服务 `dvShotRender`（[生成注记](2026-10-17-dv-architecture-generation.zh.md)），排布经过 `dvTimeline.layout`。
- **Skill。** skill `<key>-directing` 放在包内，并在 `ctx.inject(['skills'], …)` 内注册。其他 skill 都不指名它，也不指名它的 `dv_<key>_*` 工具。
- **UI 一半。** `@dv/ui-workflow-<key>` 注册一个链锚点和一个 History 行，二者的定义见 [UI 注册表注记](2026-10-17-dv-architecture-ui-registries.zh.md)。
- **测试。** 一个 REAL-composition 测试通过 Loader 启动仅供测试的 `cordis.yml`，做法同 `packages/dv/workflow-story/tests/fixture.ts`。

`scripts/dv-architecture.ts` 检查每个工作流的 import、操作名称和 skill 文本；[适应度测试注记](../process/2026-10-17-dv-architecture-fitness-test.zh.md)列出它的规则。

## 镜头遍历：`@dv/workflow-kit`

`@dv/workflow-kit`（`packages/dv/workflow-kit/src/index.ts`）没有组件、没有服务，也没有操作。它不指名任何工作流；它的 `src` 超过 300 个非空行时，适应度测试报告一条违规，所以这个库无法长成步骤引擎。每个函数只接收它调用的那些 `GenerationApi` 方法。

- `walkShot` 把 `dvShotPlan.shots` 的一个镜头映射为渲染参数；覆盖值优先，例如某个变体的画幅。
- `planShots` 解析每个镜头的参考，并通过 `findTake` 在 `where` 过滤器接受的记录中选出它复用的成片。接在需要渲染的镜头之后的接续镜头从不复用。
- `checkShots` 收集需要渲染的镜头的拒绝原因；接在需要渲染的镜头之后的接续镜头，在检查时把 `first_frame` 标为由链提供。
- `shotLine` 写出一个镜头的预览行。
- `scheduleShots` 为每个不保留成片的步骤发起渲染，每次排在前一次渲染之后，并带 `started_by: { record: call.approve, slot, lane }`。
- `chainStarter` 找出一条记录的起始记录：它自己的 `started_by`，否则为其 `based_on` 根记录的 `started_by`，所以画布上的重拍仍留在其工作流的链中。`takeFilter` 和 `keepTimeline` 用工作流的 `Owns` 检查这条起始记录。

读取用的函数不写任何东西，所以预览、拒绝检查和审批读到相同的步骤。

## 故事工作流：`@dv/workflow-story`

`dvStory` 注入 `dvProject`、`dvShotPlan`、`dvShotRender` 和 `dvTimeline`，并注册组件键 `story`。它的 `Owns` 函数接受 `plan` 参数指名该计划的 `story.approve` 记录。

`story.preview`（工具 `dv_story_preview`）报告预览行、`gpu_seconds`（需要渲染的镜头的 `dvShotRender.estimate` 之和）和 `problems`。`story.approve`（工具 `dv_story_approve`）以 `system` 行为者在一次 execute 中写完它的链：每个新增或改动的镜头渲染一次，然后一次 `dvTimeline.layout` 按镜头顺序排布每个成片。只有当 `keepTimeline` 发现该时间线的 `dvTimeline.lastWrite` 的起始记录是该计划的一次故事审批时，排布才复用计划的时间线。若之后有其他写入，例如用户的编辑，排布会创建下一个空闲时间线，并保持被编辑的时间线不变。

`story` reducer 把每次完成的审批按计划折叠进 `approvals` 和 `timelines`。skill `story-directing` 承载流程：预览，用粗体询问用户，在下一轮审批。`@dv/ui-workflow-story` 把一次审批的记录挂在画布节点 `plan:<PlanId>` 上，并返回计划已审批的版本；`@dv/ui-shot-plan` 的计划编辑器通过已注册的链锚点读取它们，不 import 任何工作流包。

## 添加第二个工作流

第二个工作流，例如 `ad.preview` 和 `ad.approve` 接收一组画幅变体的广告工作流 `@dv/workflow-ad`，由两个包加上接线组成：

1. 创建 `packages/dv/workflow-<key>`，包含它的服务、reducer、两个操作、`Owns` 函数、`<key>-directing` skill 和 REAL-composition 测试。它调用 kit 的函数，不复制其中任何一个。广告工作流把每个变体同时作为 `walkShot` 的覆盖值和 `lane` 传入，并把每个变体以 `after` 接在前一个变体的最后一次渲染之后。
2. 创建 `packages/dv/ui-workflow-<key>`，包含一个链锚点和一个 History 行，布局同 `@dv/ui-workflow-story`。
3. 加上接线：`packages/bundle/dv/cordis.patch.yml` 中的 host 行和 client 行、`packages/bundle/dv/package.json` 中的依赖、`packages/bundle/dv/tests/composition.spec.ts` 的插件映射、`tsconfig.base.json`、`tsconfig.host.json` 和 `tsconfig.client.json` 中的条目、`pnpm-lock.yaml`，以及组合包 README 对和 `docs/dreamverse/architecture.md` 对中列出已挂载工作流的行，还有列出插件所注册技能的行：组合包 README 对中的 `skill-filesystem` 句子，以及 `docs/dreamverse/subsystems/agent-and-api.md` 对中的技能表。

`@dv/project`、`@dv/shot-plan`、`@dv/shot-render`、`@dv/timeline`、`@dv/workflow-kit`、`@dv/workflow-story` 和 UI 核心的文件都不改动。两个工作流可以审批同一个计划，因为每个工作流只复用起始记录被自己的 `Owns` 接受的成片和时间线。

## 曾考虑的替代方案

**带通用步骤引擎的工作流注册表。** 内核会注册工作流并运行它们的步骤。它落选的原因是：工作流除了操作和 reducer 之外不需要内核提供任何东西；一个试验性的广告工作流除了自己的包和接线之外没有改动任何文件，所以引擎没有可统一的东西。kit 的行数上限和不得指名工作流的规定，防止共享代码变成那样的引擎。

**只含 `planShots` 和 `scheduleShots` 的 kit。** 只共享这两个函数时，试验性的广告工作流重写了四段不含策略的代码：从计划镜头到渲染参数的映射、带首帧规则的检查遍历、只在工作流最后写入时才保留时间线的规则，以及查找工作流自己审批的逻辑。`pnpm run duplication` 能通过，只是因为广告代码换了写法，而两种审批查找的结论并不一致。这些代码改由 kit 持有。

**从工作流自己的切片读取归属。** 试验性的广告工作流从它的 `ad` 切片中找自己的成片，而故事工作流读取日志。reducer 只折叠完成的审批，所以一次失败审批的渲染被一个工作流复用，却被另一个工作流重新渲染。检查日志中的链起始记录让两者行为一致：第二次 `ad.approve` 会复用第一次失败审批中已完成的渲染。

**读取 `plan.approve` 所写日志的兼容读取器。** `story` reducer 中一个 49 行的读取器把日志里的 `plan.approve` 和 `timeline.create` 记录折叠进 `story` 切片，并配合 `findTake` 上的 `ignore` 列表和 `owns` 旁边的 `legacy` 检查。它落选的原因是：它给故事工作流加上了第二个目标，即读取其他插件的记录，并且需要在适应度测试中加两个例外标记。`packages/AGENTS.md` 要求每条兼容路径对应一个当前的消费方，而没有任何 e2e 故事加载这样的日志。重置存储同样落选，因为这些日志仍可加载。

**把 GPU 估算放在 `plan.create` 报告里，或用审批的拒绝充当预览。** `@dv/shot-plan` 不按名称读取渲染操作就无法为计划估价。不带 `user_approved` 的 `dv_story_approve` 调用会返回同样的文本，但它会训练 agent（智能体）在用户同意之前就调用审批。`story.preview` 是只读操作，不写记录也不加锁，把 `problems` 作为数据返回，代价是同一轮中多一次调用。

**在 `video-directing` 中加一行指向各工作流 skill。** 那样每个工作流都要改组合包的 skill。每个工作流改为通过 `ctx.skills` 注册自己的 skill。

## 后果

`packages/dv/shot-plan/src/index.ts` 有 304 行，而它持有 `plan.approve` 时为 561 行；`@dv/project` 是它唯一的 DreamVerse 依赖。`packages/dv/workflow-kit/src/index.ts` 有 230 个非空行，适应度测试允许 300 行。

一个试验性的广告工作流带有一个 host 包和一个 UI 一半，除接线外没有改动其他包的任何文件，两个工作流之间也没有重复代码。组合包没有挂载它。

`packages/dv/workflow-story/tests/parity.spec.ts` 把 `story.approve` 固定到 `plan.approve` 曾写出的运行请求上，这些请求记录在 `parity.golden.json` 中。

每次审批让 agent 多一次调用，即预览。两个工具定义约占 450 个 token，`story-directing` skill 在 skill 目录中约占 70 个 token。`plan.create` 接受模型目录不提供的模型键；agent 在同一轮中从 `story.preview` 得知这一点。

以下缺口仍然存在：

- `plan.approve` 渲染的成片没有 `started_by`，所以对这类计划的第一次故事审批会把每个镜头重新渲染到下一个空闲时间线上。确认文本会显示这项代价。
- 接续镜头总是从前一个成片的输出 1 开始，即视频的最后一帧静帧，所以一个基于其他 primitive 成片的工作流需要修改 `@dv/workflow-kit`。
- `@dv/ui-workflow-story` 把 `story` 切片读作 `unknown`，并用 `isStorySlice` 收窄，它只检查 `approvals` 是否为对象（见[客户端状态类型注记](2026-10-17-dv-architecture-client-state-types.zh.md)）。
