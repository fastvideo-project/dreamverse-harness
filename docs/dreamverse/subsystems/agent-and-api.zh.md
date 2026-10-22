# Agent 和 API

[English](agent-and-api.md) | 中文

agent（智能体）和浏览器通过本页的各包访问 DreamVerse 项目。[`@dv/api`](../../../packages/dv/api/README.zh.md) 提供 `dvApi` 服务：`/api/dv/*` 路由和 `/dv/events` 事件流，浏览器中的 UI 包消费它们（[界面](ui.zh.md)）。[`@dv/chat-references`](../../../packages/dv/chat-references/README.zh.md) 提供 `dvChatReferences` 服务，它在 `agent/pre-step` 瀑布链和每个 `user/message` 会话事件处工作。这两个服务都注入 `dvProject`。[素材](assets.zh.md)列出注入 `dvAssetPool` 的包。[`@dv/mcp-presets`](../../../packages/dv/mcp-presets/README.zh.md) 不提供服务。它消费 DSH MCP 插件的可选服务 `mcpServers`。[`@dv/project`](../../../packages/dv/project/README.zh.md) 构建 `dv_*` 工具和 `dv:project` 提示词段。浏览器半部 [`@dv/ui-mcp-presets` 和 `@dv/ui-skills`](ui.zh.md#ui-core-and-ui-plugins) 在界面页中。

<a id="what-the-agent-reads"></a>
## Agent 读到什么

agent 通过三个渠道读取项目，每个渠道归拥有其内容的包所有：

- **工具。** 每个操作的 `description` 说明它的工具怎么用；[`@dv/project`](../../../packages/dv/project/README.zh.md) 根据 `OperationSpec` 构建工具。
- **`dv:project` 提示词段。** `@dv/project` 在 DSH `systemPrompt` 服务挂载时注册它。该段先写项目组件的规则。这些规则涉及历史列表、撤销和重做、在对话中确认，以及陈旧记录。它们还说明如何称呼记录、素材、版本和其他条目。然后该段写当前状态的项目摘要。它不包含用户看不到的任何东西，例如视图中的选中项或偏好。
- **对话引用。** 在 `agent/pre-step`，[`@dv/chat-references`](../../../packages/dv/chat-references/README.zh.md) 展开输入框为 `@` 和 `+ → 引用` 写下的 `dv:` 提及。结果是一条带具体记录和素材 ID 的上下文消息。该包还以用户身份用 `asset.import` 导入用户在对话中附上的文件。它把这些文件和消息提及的素材放到画布上。会话的下一次工具调用等待导入完成（[对话引用](#chat-references)）。

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

<a id="chat-references"></a>
## 对话引用

输入框把提及写成 `@[<label>](dv:<kind>/<id>)`。在 `agent/pre-step`，`dvChatReferences` 读取该步新用户消息中的 `dv:` 提及。它追加一条来源类型为 `dv-mentions` 的用户消息。这条消息以 "The user referenced these project items:" 开头，每个提及占一行：

| 提及                                                            | 该行给出的内容                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `dv:asset/<AssetId>`                                            | 素材 ID 和产出该素材的记录，或 "imported (no producing record)"             |
| `dv:record/<RecordId>`                                          | 该 ID 指定的记录                                                            |
| `dv:clip/<ClipId>`                                              | 片段所在的时间线、它从 1 开始的位置和它的素材；占位片段写出它等待的渲染记录 |
| `dv:<kind>/<id>`，其中种类属于 `dvProject.listReferenceKinds()` | 最新版本 `<id>@<version>` 及其参考素材，可作为输入传入                      |
| 其他种类                                                        | "unknown mention kind"                                                      |

写出记录的一行给出记录的工具名、状态，有提示词和时长时也给出它们，以及输入和产出。这一行告诉 agent，要修改它就带 `based_on` 再次调用该工具。提及按一个项目的当前状态解析。这个项目是绑定到该对话的项目；没有时取某条记录产出了被提及素材的最新项目；再没有时取最新的项目。没有任何项目时，每一行都告诉 agent 先调用 `dv_proj_open`。

对于用户在活动的 agent 会话中输入的消息，`dvChatReferences` 在每个 `user/message` 事件处执行两次写入：

1. 它以 `actor: 'user'` 和 `surface: 'chat'`，用一次带 `place: true` 的 `asset.import` 导入每个附上的图片或文件。图片保留其内容块的媒体类型。其他文件按文件扩展名取媒体类型，扩展名不对应任何类型时取 `application/octet-stream`。`dvProject.holdToolCalls` 让该会话的下一次工具调用等待导入完成。
2. 它以用户身份用一次 `asset.place` 把消息中 `dv:asset` 提及的素材放到画布上。只有 `asset.place` 接受、且尚未在画布上的素材才计入。

没有绑定项目的会话不导入也不放置任何东西。导入或放置失败时，`dvChatReferences` 日志写一条警告。

<a id="api-routes"></a>
## API 路由

[`@dv/api`](../../../packages/dv/api/README.zh.md) 是项目组件面向浏览器的 HTTP 面。它的路由承担以下工作：

- `GET /api/dv/state` 把项目的当前状态返回为一份 JSON 文档。
- `GET /api/dv/operations` 列出已注册的操作。
- `POST /api/dv/operation` 以用户身份运行任意一个已注册的操作，记录带 `surface: 'canvas'`、`'timeline'` 或 `'asset_pool'`。
- `POST /api/dv/history` 返回历史的一页。
- `POST /api/dv/undo` 和 `POST /api/dv/redo` 移动当前位置。
- `POST /api/dv/stale/accept` 运行 `proj.stale_accept`。
- 其他路由管理项目、生成任务标签、素材导入、画布布局（节点位置和视口）和 Workspace 链接。
- `GET /dv/events` 推送每一次记录追加、记录更新和当前位置的移动。

[`@dv/api` README](../../../packages/dv/api/README.zh.md#use-this-package) 给出每个路由的请求和应答。[界面](ui.zh.md#views) 给出使用这些路由的视图。

<a id="agent-path-and-http-path"></a>
## Agent 路径和 HTTP 路径

agent 和视图通过 `dvProject.run` 运行同样的操作。两边各以自己的形式读取项目。agent 读取 `dv:project` 提示词段和对话引用消息。视图从 `GET /api/dv/state` 读取 `WireState`。[协议状态](project.zh.md#the-project-summary-and-the-wire-state)给出它的字段，以及视图何时重新获取它。[操作如何运行](project.zh.md#how-an-operation-runs) 给出运行器的步骤。

```text
agent in a chat session                             user in the browser
reads: dv:project prompt section                    reads: WireState from GET /api/dv/state,
       (Project's rules + project summary)                 fetched again after each /dv/events event
       dv-mentions context message
  │                                                   │
  │ calls a dv_* tool                                 │ makes a gesture on a view
  ▼                                                   ▼
dv_<operation> tool of @dv/project                  POST /api/dv/operation of @dv/api
actor 'agent', surface 'chat',                      actor 'user', surface 'canvas', 'timeline'
session, turn, tool_call                            or 'asset_pool', session
prepareToolCall, confirm policy                       │
  │                                                   │
  └──────────────────────┬────────────────────────────┘
                         ▼
                 dvProject.run (the runner)
                         │ validate params, resolve inputs, precondition,
                         │ append the record after the current position
                         ▼
                 records.jsonl ──▶ reducers ──▶ current state
                         │                          ├──▶ project summary in the dv:project section
                         │                          │    at the agent's next step
                         │                          └──▶ WireState of GET /api/dv/state
                         ▼
                 /dv/events: record, update, line ──▶ the views fetch WireState again
```

<a id="mcp-presets"></a>
## MCP 预设

`@dv/mcp-presets`（插件名 `dv-mcp-presets`）选择 DreamVerse 推荐的 MCP 服务器。它的 `presets` 配置把服务器名映射到一个 `title`、一个 `description` 和一个服务器 `spec`。当 DSH MCP 插件的 `mcpServers` 服务挂载时，该插件在一个 effect 中用 `mcpServers.offerPresets()` 提供这些预设。MCP 插件关闭时，effect 撤回提供。提供预设不会添加任何服务器或工具。由人在入口页的 MCP 标签中添加服务器，该标签由 `@dv/ui-mcp-presets` 绘制。[`@dv/mcp-presets` README](../../../packages/dv/mcp-presets/README.zh.md) 列出 DreamVerse bundle 的预设。
