# Agent Note: DreamVerse 生成——模型目录、原语与 defineGeneration

Status: implemented

[English](2026-10-17-dv-architecture-generation.md) | 中文

## 问题

在 DreamVerse 模型目录和提供模型的提供方插件之间，曾按媒体类型各设一个插件：视频由 shot render 负责，另有 image generate 和 audio generate。这一层把一次模型调用变成一条项目记录：固定的参数、输入角色和输出，记录前的检查，GPU 确认，以及素材导入。但它按媒体类型切分，而模型之间真正变化的是一次调用的输入和输出签名。图像包和音频包几乎是彼此的副本：音频文件的 134 行中有 106 行与图像文件相同。

每增加一种媒体类型，还要修改共享包。图像生成的改动涉及 35 个文件，音频生成的改动涉及 37 个。两者都在 `@dv/models`（`packages/dv/models/src/types.ts`）内部声明自己的类型，尽管该文件自己的注释写明插件通过声明合并添加类型；两者也都修改了 `packages/dv/ui-kit/src/client/tool-labels.ts`。图像和音频操作从不请用户确认 GPU 用量，并记录 `gpu_seconds: 0`，因此一个 agent（智能体）轮次的 GPU 总量从未计入它们。两个提供方复制了同一段提示词 skill（技能）注册代码，提供方的 skill 文本还点名了 `dv_shot_render` 工具。任务标签放在只认识视频任务的 UI 分支里，因此中文界面显示 `<model> · t2i` 这样的原始名称。按项目负责人的估计，增加一个口型同步阶段需要修改七个包。

## 决策

生成由三部分组成（[分层 note](2026-10-17-dv-architecture-layers.zh.md) 负责层次图）：

- `@dv/models`（基础层）是模型目录，即 `dvModels` 服务，提供方插件向其中注册条目。它是一个[能力 seam](2026-06-13-capability-seams.zh.md)。它不注册操作，也不写记录。
- `@dv/generation`（基础层）是一个库。`defineGeneration(spec)` 把一个原语的声明变成一个 Cordis 服务，该服务拥有一个组件键和一个操作。它不点名任何原语。
- 每个输入和输出签名对应一个原语包（领域层），它声明自己的类型并调用 `defineGeneration`。

*原语*是一次模型调用的一种输入和输出签名：一个包、一个组件键、一个操作和一次 `defineGeneration` 调用。*任务*指明模型使用哪些输入，每个任务运行在一个原语上。

切分依据签名而不是媒体类型，因为模型之间变化的是签名。`defineGeneration` 把不依赖签名的部分一次固定下来：记录、GPU 确认、必需的估计值、种子，以及记录前的检查。原语包通过 `declare module '@dv/models'` 声明自己的模型目录行和任务，只提供不同的代码，因此添加原语既不修改 `@dv/models`，也不修改其他原语。`@dv/models` 之外只服务视频任务的测试 fake 用 `TaskOfPrimitive<'video'>` 为任务定型，因此添加一行 `TaskMap` 不会破坏其他包的测试。任务标签从声明经模型目录传到视图，模型目录注册每个提供方条目的提示词 skill，因此没有提供方复制注册代码，模型目录和提供方的 skill 也都不点名消费方。模型目录、辅助库、`shot.render`、模型线 skill 和提供方记录在 [DreamVerse 生成](../../../../docs/dreamverse/subsystems/generation.zh.md)中，添加原语的步骤记录在[添加生成原语](../../../../docs/dreamverse/cookbook/adding-a-generation-primitive.zh.md)中。

## 曾考虑的替代方案

**每种媒体类型一个插件和一行模型目录，所有行都声明在 `@dv/models` 中。** 它落选，因为口型同步是用其他输入角色输出视频，所以按模态作键会导致第二次破坏性变更，而行放在模型目录中会让每个原语都修改 `@dv/models`。每个签名一个操作只增加一个包，不触及其他包。

**一个通用的 `generate` 操作。** 它落选，因为内核在操作注册时就固定 `inputs`、`outputs` 和 `confirm`。视频有两个输出而图像只有一个，所以一个操作需要角色的联合，每个读取方都要按参数分支。

**由提供方注册操作。** 它落选，因为计划把模型键当作数据保存，而且每个提供方都要复制记录代码。

**把辅助库放进 `@dv/models`。** 它落选，因为模型目录随之就要写记录。

**每个条目上的 `estimate(params)` 方法取代 entry 字段。** 它落选，因为 `OperationSpec.estimate` 必须是同步的，而且提供方将要读取 `duration_sec` 这类原语参数名。

**`OperationSpec` 上的 `kind: 'generation'` 字段。** 它落选，因为它把一个层名词放进内核；UI 改为读取 `deterministic`、`resource` 和输出类型。

**每个声明可选的 `confirm` 和可选的 `estimate`。** 它落选，因为图像和音频随之跳过 GPU 确认，也不记录成本。

**由提供方自己注册提示词 skill。** 它落选，因为两个提供方复制了注册代码，而共享的 `prompt` 描述承诺了一个某任务并不具备的 skill。

**UI 分支中的任务标签。** 它落选，因为在每项测试都通过的同时，创作者在中文界面中看到了原始任务名称。标签经由模型目录传递，因为 `OperationSpec.label` 每个操作只有一个标签。

**重命名 `shot.render`。** 它落选，因为 `findTake` 匹配 `record.operation`，take 编辑器也重新运行 `record.operation`，所以重命名会让每个已存储的镜头重新渲染。

**为链式角色在 `GenerationCall` 上加 `pending` 字段。** 它落选，因为 `check` 的参数从类型上就无法到达 `render`，而且「pending」在内核中已经指一种记录状态。

**在记录之前为链式角色做部分模型检查。** 它落选，因为模型检查读取每个素材的媒体类型，所以它需要一个占位素材，或在每个提供方中增加第二个检查方法。

## 后果

共享代码只需付出一次：`packages/dv/generation/src/index.ts` 有 309 行，`packages/dv/shot-render/src/index.ts` 有 357 行，而在使用 `defineGeneration` 之前为 488 行。为衡量这一设计而把图像和音频生成重建为原语包时，没有修改 `@dv/models` 的任何文件（此前的改动分别修改了六个和四个），`defineGeneration` 调用约 20 行。图像生成修改的外部文件从两个包中的 7 个降到 2 个只改类型行的测试文件，音频生成修改的包从三个降到一个，即其提供方。一个口型同步原语没有修改其他包，而故事工作流中的一个口型同步步骤修改了 `@dv/workflow-story` 和 `@dv/shot-plan` 的 21 行源码，项目负责人此前估计要修改七个包。

每个生成操作在超出轮次 GPU 限额时都要求确认并需要估计值，即使模型很便宜也是如此；它的版本固定为 `1`，所以声明无法标记其参数的变化。模型只在 `execute` 中检查未完成或链式的输入，因此该拒绝会让记录失败，而不是拒绝调用。操作及其工具随其任务的第一个条目出现、随最后一个条目离开，这会改变 agent 看到的工具列表。为已有标签的任务再加标签的第二个声明无法启动。

视频是仓库中唯一的原语，所以 `RenderRequest`、`RenderModelFacts` 和 `video-model-selection` skill 都是视频专用的，并位于拥有视频行的模型目录中。输入角色已知的任务仍要修改 `@dv/shot-plan` 的任务规则，而另一种值类型（例如 3D 网格）还要修改内核，因为 `packages/dv/project/src/types.ts` 中的 `OperationValueType` 是封闭的联合类型。
