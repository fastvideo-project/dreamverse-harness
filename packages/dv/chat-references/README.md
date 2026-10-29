---
description: "The DreamVerse chat references: dv: mentions in user messages expand into record and asset IDs, mentioned assets and the files a user attaches in a chat go on the canvas of the session's project, and the files become imported assets."
kind: "package-reference"
---

# @dv/chat-references

English | [中文](README.zh.md)

## Summary

Use this package so that what a user points at in a chat message reaches the DreamVerse project. `dvChatReferences` expands the `dv:` mentions of new user messages into a context message with the concrete record and asset IDs, imports the files a user attaches in the chat, of any media type, as assets of the session's project and puts them on its canvas, and puts the assets that a typed message mentions on the canvas.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount `@dv/chat-references` after the DreamVerse components; it injects `dvProject` and `dvAssetPool` and uses `agents` and `attachments` when they are present. It has no configuration.

```yaml
- id: dv-chat-references
  name: '@dv/chat-references'
```

The composer of `@dv/ui-composer` serializes a picked project item as `@[<label>](dv:<kind>/<id>)`. At `agent/pre-step` the plugin finds these mentions in the step's user messages and appends one `dv-mentions` context message that describes each mention with concrete IDs, read from the current state of the session's project. Mention URIs: `dv:asset/<AssetId>`, `dv:record/<RecordId>`, `dv:clip/<ClipId>`, and `dv:<kind>/<id>` for every reference kind of `dvProject.listReferenceKinds()`, such as `dv:character/<CharacterId>`; any other kind is described as an unknown mention kind.

When a user message that the user typed in a live session carries attachments, the plugin runs one `asset.import` with `place: true` per attachment as the user, on the surface `chat`, as a step after the project's current position, so each attachment also goes on the canvas. Each `asset.import` reads the attachment from its host path in `attachments`: an image from `imageHostPath`, with the media type of its block, and any other file from `fileHostPath`, with the media type that its file name extension names, or `application/octet-stream` when the extension names none. When `attachments` keeps an attachment off this machine, the import stops at that attachment. The session's next tool call waits until the import finished (`dvProject.holdToolCalls`). When such a message mentions assets (`dv:asset/<id>`), the plugin puts the mentioned assets that `asset.place` accepts (an import of the project anywhere in its history, or an asset that a record in the current state created) and that are not on the canvas yet on it with one `asset.place` by the user, on the surface `chat`. A session whose folder is no project imports and places nothing.

The package reads the mentions of a message with `parsePromptCitations` of `@dv/project`, the kernel's own citation parser, so a mention with a malformed escape is described as unknown; `describeMention` is exported for other consumers; `dvChatReferences.expansionMessage(sessionId, messages)` returns the context message for one step.

<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Role |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `DvChatReferences`: the `agent/pre-step` listener that appends the `dv-mentions` message, the project a mention resolves against (the session's own project only: the project whose folder the session runs in), and the `session/event` listener that imports chat attachments and places mentioned assets |
| [`src/expand.ts`](src/expand.ts) | `describeMention` and `expansionBlock`: each mention URI described with concrete IDs and the record that produced it |

A mention of a clip names the clip by its `ClipId`, which is unique in the project; a placeholder clip names the render record it waits for. A mention of a reference kind reads only kernel methods of `dvProject`: the newest version from `latestVersion` and the version's assets from `assetsOf`. Its line is `<kind> <id>@<n>, reference assets [<assets>]; pass it as input <id>@<n>`, or `no <kind> <id> in the current state` for an ID without a version.

<a id="further-exploration"></a>
## Further Exploration

- [DreamVerse packages](../../../docs/subsystems/video-harness.md)
- [`@dv/project`](../project/README.md) for the current state, the records the expansion describes, and `holdToolCalls`
- [`@dv/ui-composer`](../ui-composer/src/index.ts) for the composer that writes the mentions
- [`@dv/bundle`](../../bundle/dv/README.md) for the profile that mounts everything

<a id="model-experience"></a>
## Model Experience

### Mention context

#### What the model sees

When a new user message holds `@[<label>](dv:<kind>/<id>)` mentions, a context message of source `dv-mentions` follows it: "The user referenced these project items:" and one line per mention with the asset, record, version of a reference kind, or clip and the record that produced it (tool, status, prompt, duration, inputs, outputs). In a conversation without a project, each line ends with "this conversation has no project yet; call dv_proj_create first". An imported chat attachment adds no text of its own; it appears as an asset in the project summary of `@dv/project`.

#### Token effect

About 60 tokens per mention.

#### KV Cache effect

The message is appended after the user's message, so it leaves the cached prefix intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Chat attachments come from `session/event`, which does not wait for its listeners; the import holds the session's next tool call, but a reply that reads the project before that call does not see the new assets.
