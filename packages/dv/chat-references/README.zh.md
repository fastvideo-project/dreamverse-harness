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

`@dv/ui-composer` 的输入框把选中的项目对象写成 `@[<label>](dv:<kind>/<id>)`。在 `agent/pre-step`，插件在本步的用户消息里找到这些提及，并追加一条 `dv-mentions` 上下文消息，用具体 ID 描述每个提及，内容读自对话所属项目的当前状态。提及 URI：`dv:asset/<AssetId>`、`dv:record/<RecordId>`、`dv:clip/<ClipId>`，以及 `dvProject.listReferenceKinds()` 中每个引用种类的 `dv:<kind>/<id>`，例如 `dv:character/<CharacterId>`；其他种类按未知提及种类描述。

活着的对话里用户输入的消息带附件时，插件以用户身份、在来源 `chat` 上、作为项目当前位置之后的一步为每个附件执行一次带 `place: true` 的 `asset.import`，因此每个附件也放到画布上。每次 `asset.import` 都从附件在 `attachments` 中的主机路径读取：图片用 `imageHostPath`，媒体类型取自它的块；其他文件用 `fileHostPath`，媒体类型由文件名扩展名决定，扩展名对应不到媒体类型时用 `application/octet-stream`。`attachments` 没有把附件存在本机时，导入在该附件处停止。对话的下一次工具调用会等导入完成（`dvProject.holdToolCalls`）。这样的消息提及素材（`dv:asset/<id>`）时，插件把被提及、`asset.place` 接受（项目历史中任何一处导入的素材，或由当前状态中的记录创建的素材）且还没有画布节点显示的素材（[`@dv/canvas`](../canvas/README.zh.md) 的 `canvas` 切片的 `assets` 映射），以用户身份、在来源 `chat` 上用一次 `asset.place` 放到画布上；没有 `dvCanvasNodes` 时 `asset.place` 未注册，插件不放置任何素材。所在文件夹不是项目的对话不导入也不放置。

本包用 `@dv/project` 的 `parsePromptCitations`，即内核自身的引用解析器，读取消息中的提及，所以转义格式错误的提及被描述为未知；`describeMention` 供其他使用者导出；`dvChatReferences.expansionMessage(sessionId, messages)` 返回某一步的上下文消息。

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 作用 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `DvChatReferences`：追加 `dv-mentions` 消息的 `agent/pre-step` 监听、提及所对应的项目（只用对话自己的项目，即对话所在文件夹的项目），以及导入对话附件并放置被提及素材的 `session/event` 监听 |
| [`src/expand.ts`](src/expand.ts) | `describeMention` 与 `expansionBlock`：用具体 ID 和产生它的记录描述每个提及 URI |

片段提及用 `ClipId` 指明片段，`ClipId` 在项目内唯一；占位片段写出它等待的渲染记录。引用种类的提及只读 `dvProject` 的内核方法：最新版本来自 `latestVersion`，该版本的素材来自 `assetsOf`。它的一行为 `<kind> <id>@<n>, reference assets [<assets>]; pass it as input <id>@<n>`；没有版本的 ID 为 `no <kind> <id> in the current state`。

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

新用户消息里有 `@[<label>](dv:<kind>/<id>)` 提及时，它后面跟一条来源为 `dv-mentions` 的上下文消息："The user referenced these project items:"，每个提及一行，写出素材、记录、引用种类的版本或片段，以及产生它的记录（工具、状态、prompt、时长、输入、输出）。在没有项目的对话中，每行以 "this conversation has no project yet; call dv_proj_create first" 结尾。导入的对话附件本身不加文字；它作为素材出现在 `@dv/project` 的项目摘要里。

#### Token 影响

每个提及约 60 个 token。

#### KV Cache 影响

这条消息追加在用户消息之后，不改动已缓存的前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 对话附件来自 `session/event`，它不等待监听者；导入会挡住对话的下一次工具调用，但在那次调用之前读取项目的回复看不到新素材。
