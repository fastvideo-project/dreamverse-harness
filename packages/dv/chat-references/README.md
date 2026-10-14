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

The composer of `@dv/ui-composer` serializes a picked project item as `@[<label>](dv:<kind>/<id>)`. At `agent/pre-step` the plugin finds these mentions in the step's user messages and appends one `dv-mentions` context message that describes each mention with concrete IDs, read from the current state of the session's project. Mention URIs: `dv:asset/<AssetId>`, `dv:record/<RecordId>`, `dv:character/<CharacterId>`, `dv:location/<LocationId>`, `dv:style/<StyleId>`, `dv:clip/<ClipId>`, and `dv:attachment/<n>`. The composer writes `dv:attachment/<n>` for a file attached to the same message, whose asset ID does not exist before the host imports the file; `<n>` is the 1-based position of that file among the image and file blocks of the message, in content order. The line for such a mention names the asset imported from that block of its own message, so two messages of one step can each mention `dv:attachment/1`; a position without a block, or a block that was not imported, gets a line that says so.

When a user message that the user typed enters a step and carries attachments, the plugin runs at `agent/pre-step` one `asset.import` with `place: true` per attachment as the user, on the surface `chat`, as a step after the project's current position, so each attachment also goes on the canvas. Each `asset.import` reads the attachment from its host path in `attachments`: an image from `imageHostPath`, with the media type of its block, and any other file from `fileHostPath`, with the media type that its file name extension names, or `application/octet-stream` when the extension names none. When `attachments` keeps an attachment off this machine, the import stops at that attachment. The session's next tool call waits until the import finished (`dvProject.holdToolCalls`); the step itself waits for the import of a message only when that message holds a `dv:attachment/<n>` mention. When a message that the user typed in a live session mentions assets (`dv:asset/<id>`), the plugin puts the mentioned assets that `asset.place` accepts (an import of the project anywhere in its history, or an asset that a record in the current state created) and that are not on the canvas yet on it with one `asset.place` by the user, on the surface `chat`. A message whose session has no bound project yet (a chat started on the entry page) keeps its attachments waiting: the first step after the session gets a project, for example after `dv_proj_create`, imports them the same way, and a mention line says `attachment <n> of this message; it is imported as an asset once this conversation has a project`. A session without a bound project places nothing.

The mention helpers `parseMentions`, `formatMention`, and `describeMention` are exported for other consumers; `dvChatReferences.expansionMessage(sessionId, messages)` returns the context message for one step from the text of its user messages and the asset imported from each of their attachment blocks (`MentionMessage`).

<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Role |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `DvChatReferences`: the `agent/pre-step` listener that imports chat attachments and appends the `dv-mentions` message, the project a mention resolves against (the session's bound project, else the newest project that produced a mentioned asset, else the newest project), and the `session/event` listener that places mentioned assets |
| [`src/expand.ts`](src/expand.ts) | `parseMentions`, `formatMention`, and `describeMention`: each mention URI described with concrete IDs and the record that produced it |

A mention of a clip names the clip by its `ClipId`, which is unique in the project; a placeholder clip names the render record it waits for. A mention of a character, location, or style names its latest version in the current state and tells the model to pass that version as an input.

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

When a new user message holds `@[<label>](dv:<kind>/<id>)` mentions, a context message of source `dv-mentions` follows it: "The user referenced these project items:" and one line per mention with the asset, record, character, location, style, or clip and the record that produced it (tool, status, prompt, duration, inputs, outputs). A `dv:attachment/<n>` line reads `- <label> (dv:attachment/<n>): attachment <n> of this message, asset <AssetId>` followed by the `asset.import` record that imported it. An imported chat attachment adds no text of its own; it appears as an asset in the project summary of `@dv/project`. The step that imports the attachments that waited for the project starts the same context message with "The files the user attached while this conversation had no project are now imported into its project:" and one line per file, `- "<name>" (dv:attachment/<n> of the earlier message): asset <AssetId>`.

#### Token effect

About 60 tokens per mention.

#### KV Cache effect

The message is appended after the user's message, so it leaves the cached prefix intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A step waits for the import of chat attachments only when its message holds a `dv:attachment/<n>` mention; otherwise the import holds the session's next tool call, but a reply that reads the project before that call does not see the new assets.
- The import starts at `agent/pre-step`, before the step logs the user message; a step that is cancelled between the two leaves imported assets of a message that the session log does not hold.
