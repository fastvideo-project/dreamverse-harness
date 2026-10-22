# DreamVerse 子系统

[English](README.md) | 中文

DreamVerse 每个子系统一页：DreamVerse 各包中某一部分所拥有的记录、类型和规则。[架构页](../architecture.zh.md)给出各部分之间的依赖，[术语表](../glossary.zh.md)定义这些页面使用的名称。每一页都链接实现该部分的包 README。

| 页面 | 负责内容 |
|---|---|
| [project.md](project.zh.md) | `@dv/project`：操作记录、历史规则、操作如何运行、在对话中确认、项目状态、过期和确定性复用 |
| [generation.md](generation.zh.md) | `@dv/models` 的模型目录，以及 `shot.render` 在渲染前做的检查 |
| [agent-and-api.md](agent-and-api.zh.md) | 智能体读到什么（工具、`dv:project` 提示词段、对话引用和 skill）、`@dv/api` 路由，以及界面各包 |
| [ui.md](ui.zh.md) | `@dv/ui-history` 的历史面板，以及它到智能体轨迹的链接 |
