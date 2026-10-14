---
description: "DreamVerse 的对话引用：用户消息里的 dv: 提及展开为记录和素材 ID，被提及的素材和用户在对话里附上的文件放到该对话项目的画布上，文件成为已导入素材。"
kind: "package-reference"
---

# @dv/chat-references

[English](README.md) | 中文

## 概要

用这个包让用户在对话消息里指向的对象到达 DreamVerse 项目。`dvChatReferences` 把新用户消息里的 `dv:` 提及展开为一条带具体记录和素材 ID 的上下文消息，把用户在对话里附上的任意媒体类型的文件导入为该对话项目的素材并放到其画布上，并把用户输入的消息提及的素材放到画布上。

## 目录

- [使用这个包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用这个包

在 DreamVerse 组件之后挂载 `@dv/chat-references`；它注入 `dvProject` 和 `dvAssetPool`，并在 `agents` 和 `attachments` 存在时使用它们。它没有配置项。

```yaml
- id: dv-chat-references
  name: '@dv/chat-references'
```

`@dv/ui-composer` 的输入框把选中的项目对象写成 `@[<label>](dv:<kind>/<id>)`。在 `agent/pre-step`，插件在本步的用户消息里找到这些提及，并追加一条 `dv-mentions` 上下文消息，用具体 ID 描述每个提及，内容读自对话所属项目的当前状态。提及 URI：`dv:asset/<AssetId>`、`dv:record/<RecordId>`、`dv:character/<CharacterId>`、`dv:location/<LocationId>`、`dv:style/<StyleId>`、`dv:clip/<ClipId>` 和 `dv:attachment/<n>`。输入框为同一条消息里附上的文件写出 `dv:attachment/<n>`，因为主机导入该文件之前它还没有素材 ID；`<n>` 是该文件在这条消息的图片块和文件块中按内容顺序的位置，从 1 开始。这种提及的那一行写出从它所在消息的该块导入的素材，因此同一步里的两条消息可以各自提及 `dv:attachment/1`；该位置没有块，或该块没有导入时，那一行会写明。

用户输入的消息进入一步且带附件时，插件在 `agent/pre-step` 以用户身份、在来源 `chat` 上、作为项目当前位置之后的一步为每个附件执行一次带 `place: true` 的 `asset.import`，因此每个附件也放到画布上。每次 `asset.import` 都从附件在 `attachments` 中的主机路径读取：图片用 `imageHostPath`，媒体类型取自它的块；其他文件用 `fileHostPath`，媒体类型由文件名扩展名决定，扩展名对应不到媒体类型时用 `application/octet-stream`。`attachments` 没有把附件存在本机时，导入在该附件处停止。对话的下一次工具调用会等导入完成（`dvProject.holdToolCalls`）；只有当消息含 `dv:attachment/<n>` 提及时，这一步本身才等待该消息的导入。活着的对话里用户输入的消息提及素材（`dv:asset/<id>`）时，插件把被提及、`asset.place` 接受（项目历史中任何一处导入的素材，或由当前状态中的记录创建的素材）且还不在画布上的素材，以用户身份、在来源 `chat` 上用一次 `asset.place` 放到画布上。对话还没有绑定项目时（在入口页开始的对话），消息的附件先等待：对话有了项目之后的第一步（例如 `dv_proj_create` 之后）以同样方式导入它们，提及行写 `attachment <n> of this message; it is imported as an asset once this conversation has a project`。没有绑定项目的对话不放置素材。

提及辅助函数 `parseMentions`、`formatMention`、`describeMention` 供其他使用者导出；`dvChatReferences.expansionMessage(sessionId, messages)` 根据某一步用户消息的文字和从它们每个附件块导入的素材（`MentionMessage`）返回这一步的上下文消息。

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 作用 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `DvChatReferences`：导入对话附件并追加 `dv-mentions` 消息的 `agent/pre-step` 监听、提及所对应的项目（对话绑定的项目，否则产生被提及素材的最新项目，否则最新项目），以及放置被提及素材的 `session/event` 监听 |
| [`src/expand.ts`](src/expand.ts) | `parseMentions`、`formatMention` 与 `describeMention`：用具体 ID 和产生它的记录描述每个提及 URI |

片段提及用 `ClipId` 指明片段，`ClipId` 在项目内唯一；占位片段写出它等待的渲染记录。角色、场景或风格的提及写出它在当前状态中的最新版本，并告诉模型把该版本作为输入传入。

<a id="further-exploration"></a>
## 延伸阅读

- [DreamVerse 各包](../../../docs/subsystems/video-harness.zh.md)
- [`@dv/project`](../project/README.zh.md)，当前状态、展开所描述的记录，以及 `holdToolCalls`
- [`@dv/ui-composer`](../ui-composer/src/index.ts)，写出提及的输入框
- [`@dv/bundle`](../../bundle/dv/README.zh.md)，挂载全部组件的 profile

<a id="model-experience"></a>
## 模型体验

### 提及上下文

#### 模型看到什么

新用户消息里有 `@[<label>](dv:<kind>/<id>)` 提及时，它后面跟一条来源为 `dv-mentions` 的上下文消息："The user referenced these project items:"，每个提及一行，写出素材、记录、角色、场景、风格或片段，以及产生它的记录（工具、状态、prompt、时长、输入、输出）。`dv:attachment/<n>` 的那一行是 `- <label> (dv:attachment/<n>): attachment <n> of this message, asset <AssetId>`，后面跟导入它的 `asset.import` 记录。导入的对话附件本身不加文字；它作为素材出现在 `@dv/project` 的项目摘要里。导入等待项目的附件的那一步，同一条上下文消息以 "The files the user attached while this conversation had no project are now imported into its project:" 开头，每个文件一行：`- "<name>" (dv:attachment/<n> of the earlier message): asset <AssetId>`。

#### Token 影响

每个提及约 60 个 token。

#### KV Cache 影响

这条消息追加在用户消息之后，不改动已缓存的前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 只有当消息含 `dv:attachment/<n>` 提及时，这一步才等待对话附件的导入；否则导入会挡住对话的下一次工具调用，但在那次调用之前读取项目的回复看不到新素材。
- 导入在 `agent/pre-step` 开始，早于这一步记录用户消息；在两者之间被取消的一步会留下已导入的素材，而对话日志里没有对应的消息。
