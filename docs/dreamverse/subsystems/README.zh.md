# DreamVerse 子系统

[English](README.md) | 中文

每一页记录 DreamVerse 各包中某一部分所拥有的记录、类型和规则。各行按[架构页](../architecture.zh.md)的层排列。它们从内核开始，经过 base、领域和工作流各包，到 agent（智能体）、API 和 UI 各包。[术语表](../glossary.zh.md)定义这些页面使用的名称。每一页都链接实现该部分的包 README。

| 页面 | 负责内容 |
|---|---|
| [project.md](project.zh.md) | `@dv/project`：操作记录、记录日志、历史规则、组件、操作、输入引用、操作如何运行、在对话中确认、项目状态、项目摘要和协议状态、陈旧和确定性复用 |
| [generation.md](generation.zh.md) | 模型目录、`defineGeneration` 与 `GenerationApi`、`shot.render`、模型线 skill，以及提供方 |
| [assets.md](assets.zh.md) | `@dv/asset-pool` 和 `@dv/ffmpeg`：素材是什么、文件在哪里、素材操作、导入的素材和生成的素材，以及 ffmpeg 执行器 |
| [reference-nouns.md](reference-nouns.zh.md) | 引用名词（`@dv/character`、`@dv/location`、`@dv/style` 及其 UI 包）和 reference kit：kit 形状、`defineReference`、`defineReferenceUi`、扩展点和 kit 成员规则 |
| [shots-and-timeline.md](shots-and-timeline.zh.md) | 分镜计划、渲染与版本（take）、`@video-harness/stream` 的实时渲染流、时间线与片段、在用的版本、导出，以及检查器 |
| [workflows.md](workflows.zh.md) | `@dv/workflow-kit`、`@dv/workflow-story` 和 `@dv/ui-workflow-story`：工作流约定、审批链与 `started_by`、镜头遍历和故事工作流 |
| [agent-and-api.md](agent-and-api.zh.md) | agent 读到什么、对话引用、`@dv/api` 路由、agent 路径和 HTTP 路径，以及 `@dv/mcp-presets` |
| [ui.md](ui.zh.md) | UI 核心和 UI 插件：`dvCanvas`、`dvHistory` 和 `dvMentions` 注册表，shell 和画布的 slot，协议类型，视图，以及历史面板 |
