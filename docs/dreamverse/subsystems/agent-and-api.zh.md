# 智能体和 API

[English](agent-and-api.md) | 中文

本页是 DreamVerse 智能体和浏览器如何访问项目的参考：智能体读取的渠道和 skill，以及视图使用的 `@dv/api` 路由和界面各包。

## 智能体读到什么

智能体通过三个渠道读取项目，每个渠道归拥有其内容的包所有：

- **工具。** 每个操作的 `description` 说明它的工具怎么用；[`@dv/project`](../../../packages/dv/project/README.zh.md) 根据 `OperationSpec` 构建工具。
- **`dv:project` 提示词段。** `@dv/project` 在 DSH `systemPrompt` 服务挂载时注册它。它先写项目组件的规则（每次修改都是一步，撤销和重做移动当前位置，新的修改丢弃后面的步骤，如何称呼记录、素材、版本和片段，在对话中确认，过期记录），再写当前状态的项目摘要。它不包含用户看不到的任何东西：没有视图中的选中项，也没有偏好。
- **对话引用。** [`@dv/chat-references`](../../../packages/dv/chat-references/README.zh.md) 在 `agent/pre-step` 把输入框为 `@` 和 `+ → 引用` 写下的 `dv:` 提及展开成一条带具体记录和素材 ID 的上下文消息，以用户身份用 `asset.import` 导入用户在对话中附上的图片，并把这些图片和消息提及的素材放到画布上；会话的下一次工具调用等待导入完成。

skill 承载工作流程和模型专属的规则，各由其主人注册：

| Skill                                                | 主人                                                                              | 注册途径                  | 内容                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------- |
| `video-directing`                                    | [`@dv/bundle`](../../../packages/bundle/dv/README.zh.md)（`skills/video-directing`） | `skill-filesystem` 目录 | 跨组件的做计划流程：故事及其镜头、每个镜头的模型和输入、按该模型和生成任务的提示词 skill 写提示词、重拍和过时镜头                |
| `timeline-editing`                                   | [`@dv/timeline`](../../../packages/dv/timeline/README.zh.md)                       | `ctx.skills`          | 编辑时间线和片段                                                                    |
| `character`                                          | [`@dv/character`](../../../packages/dv/character/README.zh.md)                     | `ctx.skills`          | 创建和更新角色，以及每个工具的参数                                                           |
| `location`                                           | [`@dv/location`](../../../packages/dv/location/README.zh.md)                       | `ctx.skills`          | 创建和更新场景，以及每个工具的参数                                                           |
| `style`                                              | [`@dv/style`](../../../packages/dv/style/README.zh.md)                             | `ctx.skills`          | 创建和更新风格，以及每个工具的参数                                                           |
| `story-directing`                                    | [`@dv/workflow-story`](../../../packages/dv/workflow-story/README.zh.md)           | `ctx.skills`          | 从已规划的镜头到渲染好的镜头的调用顺序：新建或更新计划、预览、询问用户、批准、等待                                   |
| `video-model-selection`                              | [`@dv/models`](../../../packages/dv/models/README.zh.md)                           | `ctx.skills`          | 用 `dv_models_list` 和 `dv_models_get` 为每个镜头选择模型，以及何时询问用户                     |
| `fasth3-reference-prompting`、`fasth3-text-prompting` | 模型的提供方插件（[`@dv/fastvideo`](../../../packages/dv/fastvideo/README.zh.md)）           | `ctx.skills`          | 该生成任务下模型的限制和提示词规则                                                           |

## API 和视图

[`@dv/api`](../../../packages/dv/api/README.zh.md) 是项目组件面向浏览器的 HTTP 面：`/api/dv/state` 把项目的当前状态返回为一份 JSON 文档，`/api/dv/operations` 列出已注册的操作，`/api/dv/operation` 以用户身份运行一个操作，其记录带 `surface: 'canvas'`、`'timeline'` 或 `'asset_pool'`，`/api/dv/history` 返回历史的一页，`/api/dv/undo`、`/api/dv/redo` 和 `/api/dv/stale/accept` 暴露撤销、重做和过期操作，其他路由管理项目、素材导入、画布布局（节点位置和视口）和 Workspace 链接，`/dv/events` 推送每一次记录追加、记录更新和当前位置的移动。

界面各包是 web 应用的右侧栏标签类型和中央视图，因此在同一个 profile 里与对话页并存。[`@dv/ui-shell`](../../../packages/dv/ui-shell/README.zh.md) 把项目工作区放在中央，把 对话 / Chat 和 轨迹 / Trajectory 标签放在右侧，把 画布 / Canvas 和 时间线 / Timeline 切换按钮放在顶栏，并把 Ctrl+Z 绑定到撤销，把 Shift+Ctrl+Z 绑定到重做。[`@dv/ui-canvas`](../../../packages/dv/ui-canvas/README.zh.md) 把当前状态画成按素材流向相连的节点：导入的素材，带模型和生成任务的版本，以及 UI 插件注册的条目：处于当前版本的角色、场景和风格（`@dv/ui-character`、`@dv/ui-location`、`@dv/ui-style`），和处于最新版次的每个分镜计划，写出每个镜头的模型和生成任务，设置了的写出 接上一镜头 / Continues the previous shot（`@dv/ui-shot-plan`）；`@dv/ui-workflow-story` 把一次故事批准的版本挂在分镜计划节点下。`@dv/ui-canvas` 标记过期记录，它的编辑器以用户记录渲染新版本或替换参考图。[`@dv/ui-timeline`](../../../packages/dv/ui-timeline/README.zh.md) 把每条时间线画成一条轨道，把插入、移动、移除、拆分和裁剪手势变成按 `ClipId` 指定片段的 `timeline.*` 记录，把导出变成一条 `timeline.export` 记录。`@dv/ui-asset-pool` 列出项目的每个素材并导入文件；`@dv/ui-composer` 为对话加上 `@` 和 `+ → 引用` 引用和面向创作者的工具名，`@dv/ui-shot-render` 加上渲染卡片。
