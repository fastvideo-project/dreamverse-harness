# 新行为的归属位置

[English](where-new-behavior-goes.md) | 中文

本指南说明 DreamVerse 新行为放在哪里。它给出决定主人的原则、流程、扩展点查表，以及一个完整的例子。

DreamVerse 的新行为挂在某个包已拥有的扩展点上。DeepSeek Harness 的新行为遵循同一规则，见[架构页](../../architecture.zh.md)中“新行为的归属位置”一节。

## 原则

1. 每样东西只有一个主人。每份数据、每项能力、每段 agent（智能体）读取的文字都属于一个插件。这个插件把它注册到扩展点上。
2. 插件能用一句话说出自己拥有什么。如果一个插件只能描述成“把 A 接到 B”，这个插件什么也不拥有。把它拆分给 A 和 B 的主人。
3. 新行为挂在已有的扩展点上。从查表中选择扩展点。
4. 只有可替换的能力才做成能力 seam。有两个或更多可互换实现的能力，才做成一个 Service Definition 包加若干 Service Provider 包。
5. 依赖只朝一个方向。架构页的[导入表](../architecture.zh.md#import-direction)给出每一层可以导入的层。组件绝不在代码中写出另一个组件的操作名。
6. 给 agent 的文字跟着主人走，按下表放置：

| 文字讲的是                | 放在哪里                                                     |
| -------------------- | -------------------------------------------------------- |
| 一个组件的工具怎么用           | 该操作的 `description`                                       |
| 跨多个组件的做事流程           | `@dv/bundle` 或拥有该流程的工作流中的一个 skill（`story-directing`）     |
| 模型的限制和提示词写法，例如参考素材要求 | 模型的提供方插件为该生成任务注册的提示词 skill                               |
| 如何为镜头选择模型            | `@dv/models` 的 `video-model-selection` skill             |
| 每轮都会变的项目状态           | `@dv/project` 的 `dv:project` 提示词段，经由归约函数的 `agentSummary` |

## 流程

加一样新东西时，按顺序回答问题 1 到 5，然后执行步骤 6：

1. 它是哪一类？在查表的“要加的东西”列中找到它的行。
2. 它的主人是谁？没有包拥有它时，新建一个组件，并写下说明它拥有什么的那一句话。
3. 它挂在哪个扩展点上？查表中它那一行的“做法”列给出扩展点。
4. 它需要可替换吗？需要就做成能力 seam。不需要，它就是普通插件中的一个注册项。
5. 它带不带给 agent 的文字？带的话，按原则中的文字表把文字放到它的主人那里。
6. 验证放置位置。检查主人的那一句话仍然成立。运行 `CI=true pnpm exec vitest run scripts/dv-architecture.spec.ts`。测试通过，说明这次变更没有加入超出基线 `scripts/dv-architecture.baseline.json` 的违规。然后运行 `pnpm dv:owners`。列表为每个组件键、每个 skill，以及声明中以字符串字面量写出的每个操作名各给出一行。它还为每个 `defineReference`、`defineGeneration` 和 `defineReferenceUi` 声明给出各行。每个 `NodeType`、`VersionKind`、`MentionKind` 和 `HistoryRow` 描述对象也各有一行。找到你加入的名称所在的行，`package` 列是它们的主人。架构检查页面的[所有者列表一节](../architecture-checks.zh.md#owner-listing)给出列表的限制。

## 查表

| 要加的东西       | 做法                                                                                                                                            | 例子                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 项目数据        | 加进主人组件的归约函数状态，并在 `agentSummary` 中给出摘要                                                                                                         | 镜头的配乐                      |
| 操作          | 在主人组件中 `registerOperation`；项目组件据此生成工具、历史和撤销，视图通过 `POST /api/dv/operation` 运行任意已注册的操作                                                 | `timeline.clip_split`      |
| 可替换能力       | 一个 Service Definition 包加若干 Service Provider 包；用到它的组件是 Consumer                                                                                | 模型目录、3D 渲染                 |
| 模型          | 提供方插件的修改；见[添加提供方或模型](../../../packages/dv/models/README.zh.md#add-a-provider-or-a-model)                                                         | `@dv/fastvideo` 的 `fasth3` |
| 生成任务        | 一个 `TaskMap` 条目，由引入该生成任务的插件声明（[模型键](../../../packages/dv/models/README.zh.md#model-keys)），再加上它在其原语声明的 `tasks` 记录中的标签；生成任务若有任何原语都没有的输入角色，就有自己的原语包 | 由首帧和尾帧渲染的生成任务              |
| 输出模态        | 一个 `PrimitiveTypes` 行（[模型键](../../../packages/dv/models/README.zh.md#model-keys)），并带上在其上运行的生成任务和一个调用 `@dv/generation` 的 `defineGeneration` 的原语包  | 图像生成                       |
| 引用名词        | 两个声明：`@dv/reference-kit` 的 `defineReference` 和 `@dv/ui-kit` 的 `defineReferenceUi`                                                             | `@dv/character`            |
| 制作流程        | 一个工作流包 `@dv/workflow-<key>` 及其 UI 半部                                                                                                          | `@dv/workflow-story`       |
| 给 agent 的文字     | 按原则中的文字表放置                                                                                                                                    | “先出分镜计划再渲染”                |
| 视图          | 一个只通过 `@dv/api` 读写、并通过 `@dv/ui-canvas`、`@dv/ui-history` 和 `@dv/ui-composer` 的注册表绘制的 `@dv/ui-*` 插件                                             | 画布                         |
| 接到 agent loop 上的逻辑 | 由数据的主人在 DSH 事件上注册，例如 `agent/pre-step` 或 `tools/pre-execute`                                                                                   | `dv:` 提及展开                 |

## 例子：不带参考图的渲染

1. 类别：服务某个生成任务的一个模型；生成任务 `t2v` 已在 `@dv/models` 的 `TaskMap` 中存在。
2. 主人：服务该模型的提供方插件；`@dv/fastvideo` 为生成任务 `t2v` 服务 `fasth3`。
3. 扩展点：`@dv/fastvideo` 在其 `SERVED` 表中为 `fasth3` 声明生成任务 `t2v`。配置为该生成任务指定服务器时，它注册条目 `video/t2v/fastvideo/fasth3`。`@dv/shot-render` 无需改动，因为 `dv_shot_render` 接受每个已注册的条目。
4. 可替换：是；另一个提供方插件可以为生成任务 `t2v` 注册另一个模型，agent 用 `dv_models_list`、`dv_models_get` 和 `video-model-selection` skill 在它们之间选择。
5. 文字：`fasth3` 在生成任务 `t2v` 下的提示词规则是该提供方插件的 skill `fasth3-text-prompting`。规则“每个镜头必须有参考素材”只是 `fasth3` 在生成任务 `ref2v` 下的输入要求。`fasth3` 的 `schema()` 报告它，它的 `validateGenerationRequest` 执行它。skill `fasth3-reference-prompting` 和 `dv_shot_render` 的拒绝文本写出它。
