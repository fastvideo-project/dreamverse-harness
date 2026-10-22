# DreamVerse 文档

[English](README.md) | 中文

DreamVerse 各包是 DeepSeek Harness 内视频制作的项目层。这些包位于 `packages/dv/` 下和 [`packages/video-harness/`](../../packages/video-harness/README.zh.md) 包组中。这些页面记录跨包规则。它们沿用 DeepSeek Harness 文档的层级。这些页面包括一份架构地图、一页架构检查说明、每个子系统一页参考页面、`cookbook/` 中的实操指南，以及一份术语表。各包 README 各自说明配置和服务 API。DeepSeek Harness 的[架构页](../architecture.zh.md)负责这些页面所依据的 Harness 事实。

| 页面                                                                                        | 负责内容                                       |
| ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| [architecture.md](architecture.zh.md)                                                     | 目标、十个层及其包、import 方向、宿主面和客户端面，以及项目数据的单一方向   |
| [architecture-checks.md](architecture-checks.zh.md)                                       | 检查各层的脚本：适应度测试、所有者列表和变更规模检查                 |
| [subsystems/README.md](subsystems/README.zh.md)                                           | DreamVerse 每个子系统的参考页面                      |
| [cookbook/where-new-behavior-goes.md](cookbook/where-new-behavior-goes.zh.md)             | 如何为 DreamVerse 新行为选择主人和扩展点                 |
| [cookbook/adding-a-reference-noun.md](cookbook/adding-a-reference-noun.zh.md)             | 如何在 reference kit 上添加引用名词：两个包、接线和检查        |
| [cookbook/adding-a-generation-primitive.md](cookbook/adding-a-generation-primitive.zh.md) | 如何用 `defineGeneration` 添加生成原语，并由提供方服务其生成任务 |
| [cookbook/adding-a-workflow.md](cookbook/adding-a-workflow.zh.md)                         | 如何在 `@dv/workflow-kit` 上添加工作流包及其 UI 半部     |
| [glossary.md](glossary.zh.md)                                                             | 代码、记录、工具和界面文案所用的名称，每个名称只有一个含义              |
