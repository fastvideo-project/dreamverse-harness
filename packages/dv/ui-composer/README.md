---
description: "The DreamVerse additions to the DSH chat composer: the @ source and the Reference row for project items, tool rows with creator-facing names and a Show in history link, and the dv:compose prefill."
kind: "package-reference"
---

# @dv/ui-composer

English | [中文](README.zh.md)

## Summary

Use this package to fit the DSH chat composer to a DreamVerse project. Typing `@`, or picking 引用 / Reference in the composer's ＋ menu, lists the items of the mention kinds that plugin UI halves register in `dvMentions` (the clips of `@dv/ui-timeline`, and the characters, locations, and styles of `@dv/ui-character`, `@dv/ui-location`, and `@dv/ui-style`) and the open project's assets as reference chips. DreamVerse tool rows in the chat show creator-facing names, and the link 在历史中查看 / Show in history selects a call's record. The canvas and the asset preview prefill the composer through `dv:compose`. The agent asks for the user's agreement in the conversation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app` (which provides the chat, the input triggers, the UI slots, and the right Sidebar), `@dv/api` (which serves the state and operation routes), and `@dv/chat-references` (which expands the `dv:` mentions of a sent message). Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-composer
  name: '@dv/ui-composer'
```

The Host half registers nothing. The browser half provides `dvMentions` at its `apply` top level: `kinds`, a `Registry<MentionKind>` of `@dv/ui-kit/registries.ts` keyed by `id`, which plugin UI halves fill inside `ctx.inject(['dvMentions'], …)`. It registers the `@` source `dv-project`, the ＋ menu row 引用 / Reference, described as 项目里的条目或素材 / An item or asset of the project with no reference kind named, through DSH's `commandUi` service when it is mounted, and the UI slot entries `conversation.input.left` (ID `dv-composer-compose`, which renders nothing and makes each mounted session composer a target of `dv:compose`), `conversation.input.permission` (an empty entry), `conversation.chat.markdown` (a chain entry that matches links, images, and tables by their `/dv/assets/<id>` paths), and, for every tool in `DV_TOOL_LABELS`, a `tool.call.toolview` entry `ToolLabelRow` at priority 0.5, so a plugin's own entry at the default priority 0 wins over it. While the canvas service `dvCanvas` of `@dv/ui-canvas` is present, it registers the node action `@dv/ui-composer:ask-agent` (问 agent / Ask the agent, order 10, shown on every node) in `dvCanvas.actions` of `@dv/ui-canvas/contract`. It registers the entry `@dv/ui-composer:use-asset` of the `dv.media.preview.action` slot, the button 让智能体使用 / Ask the agent to use it beside 关闭 / Close in the asset preview that `dvMedia.preview` of `@dv/ui-media` opens. It also registers a `ToolLabelRow` at priority 1 for every operation of `GET /api/dv/operations`, keyed by its tool name, so an entry at a lower priority wins over it (for `dv_shot_render`, the chat card of `@dv/ui-shot-render`); it reads the list when the slot is declared and again whenever a project opens, and when the list changes it removes these rows and registers the rows of the read list. It adds a `tool.name.<tool>` entry per labelled tool and per operation to DSH's `chat` dictionaries, which the running group title reads.

| Gesture | Request or event |
| --- | --- |
| Type `@`, or pick 引用 / Reference in the ＋ menu | `GET /api/dv/state` for the current state of the open project; the entry page lists nothing |
| 在历史中查看 / Show in history | `dv:history-focus` `{session, toolCall}`; the History panel selects the record that tool call wrote |
| Send a message that holds a `dv:asset/<id>` chip or attached images | The message is sent unchanged; `@dv/chat-references` on the host imports the images and puts them and the mentioned assets on the canvas |
| 问 agent / Ask the agent on a canvas node | `dv:compose` with the draft 修改 {title}： / Change {title}: and one reference to the node's `ref`, else its record, else the node, shown by the node's preview or first asset; the editor closes |
| 让智能体使用 / Ask the agent to use it in the asset preview | `dv:compose` with the draft 使用这个素材： / Use this asset: and one reference to the asset; the preview closes |
| `dv:compose` from another view | The newest mounted composer replaces its draft with the text and appends one chip per reference; nothing is sent |

The `@` list reads the project's current state: the items of each registered mention kind in its `order` (registration order on a tie) under its `section()`, where an item's `thumb` asset shows as that asset's icon, and the 40 newest assets of every media type; an asset's icon is the still that the `poster` of its media type in `dvMedia.types` of `@dv/ui-media` names, else the type's `icon` component, else a file glyph; a pick inserts a chip whose text is `@[<label>](dv:<kind>/<id>)`. The 引用 / Reference row opens the same list at the end of the draft. Every labelled tool row, and every operation row, shows the tool's name (an operation row shows `operationLabel` of `@dv/ui-kit`) and the status 进行中… / Running…, 完成 / Done, or 未完成 / Failed. Every settled row whose call wrote a record has the link 在历史中查看 / Show in history. A `dv:compose` event also brings the 对话 / Chat tab to the front. The package hides DSH's file-permission chip and draws the 对话 / Chat tab's composer card, its ＋ button, and its send button with the DreamVerse theme tokens.

In settled chat Markdown, a link whose path is `/dv/assets/<id>` and whose asset the open project holds becomes a 16:9 card, 160 px wide, that draws the asset through the `dv.media` Factory of `@dv/ui-media` at purpose `thumb`, with a caption under it: the label that `dvHistory.describe` of `@dv/ui-history` gives the record that created the asset when History draws that record as media, such as a take, else the asset's name, such as the file name of an import. The caption follows `dvHistory` and its rows, so a card that is already drawn reads it again when a History row registers. A table in which every body row links such an asset becomes a three-column grid of these cards, each captioned with the row's other cells joined by ` · ` (for example `1 · 直播间开场「来一把吧」`). A Markdown image of such an asset becomes a thumbnail at most 240 px wide, at the asset's own width and aspect ratio when the asset has a size, else 240 px wide at 16:9. A click on a card or a thumbnail opens the asset preview through `dvMedia.preview`, which grows out of the clicked element; nothing opens while `dvMedia` is absent. An asset of a media type without a `dv.media.view` entry draws the file card of `@dv/ui-media`. The assets and the records that created them come from the current state of the open project, fetched again after each project event. Other links, images, and tables keep DSH's rendering.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

A `dv:compose` event that arrives while no composer is mounted waits for the next composer that mounts; a chip the input refuses falls back to its plain reference text. A tool row reads whether its call wrote a record from the presentation metadata of the call's result: an operation tool and a `dv_proj_*` tool that writes records name the record they wrote in `record`, a read operation such as `inspect.image` names `record: ''`, and a read `dv_proj_*` tool (`dv_proj_open`, `dv_proj_state`, `dv_proj_history_list`, `dv_proj_wait`) or a failed call carries no metadata.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The Host half, which registers nothing |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | The type of the CSS Module imports |
| [`src/client/index.ts`](src/client/index.ts) | `dvMentions` and the registrations: the `@` source, the ＋ menu row, the UI slot entries, the tool names, and the `dv:compose` listener |
| [`src/client/mention.ts`](src/client/mention.ts) | The `@` source, its project items, and the reference text |
| [`src/client/chat-assets.ts`](src/client/chat-assets.ts) | The open project's assets, the record that created each one, and the operation declarations, fetched again after each project event |
| [`src/client/chat-media.ts`](src/client/chat-media.ts) | The `conversation.chat.markdown` entry and its choice of links, images, and tables |
| [`src/client/ChatMedia.tsx`](src/client/ChatMedia.tsx) | The asset cards, the card grid, and the image thumbnail, drawn through `dv.media` |
| [`src/client/actions.tsx`](src/client/actions.tsx) | 问 agent / Ask the agent on canvas nodes and 让智能体使用 / Ask the agent to use it in the asset preview |
| [`src/client/compose.ts`](src/client/compose.ts) | Delivery of `dv:compose` to the newest mounted composer |
| [`src/client/views.tsx`](src/client/views.tsx) | The tool rows |
| [`src/client/views.module.css`](src/client/views.module.css) | Styles of the tool rows, of their history link, and of the 让智能体使用 button |
| [`src/client/composer.css`](src/client/composer.css) | Styles of the 对话 / Chat tab's composer card, ＋ button, and send button |
| [`src/client/tool-labels.ts`](src/client/tool-labels.ts) | The rows of the operation tools, and the tool names added to DSH's `chat` dictionaries |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/chat-references`](../chat-references/README.md) — the expansion of the `dv:` mentions of a sent message into a context message with record and asset IDs.
- [`@dv/project`](../project/README.md) — the `dv:project` prompt section, which tells the agent to ask for the user's agreement in the conversation with the question in bold.
- [`@dv/ui-canvas`](../ui-canvas/README.md) — the canvas and its node actions.
- [`@dv/ui-history`](../ui-history/README.md) — the History panel that answers `dv:history-focus`, and the record label of the chat cards.
- [`@dv/ui-kit`](../ui-kit/README.md) — the API client, the wire types, the compose event, and the tool labels.
- [`@dv/ui-media`](../ui-media/README.md) — the `dv.media` Factory that draws the chat cards, the media types that draw the `@` menu icons, and the asset preview.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/chat-references`, which turns the `dv:` mentions of a sent message into a `dv-mentions` context message.

#### KV Cache effect

None from this package; the `dv-mentions` context message follows the user message it expands, and the README of `@dv/chat-references` describes its effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **`@` list of the current state** — the `@` list and the 引用 / Reference row read the project's current state, so a clip, character, location, or style that an undo took out of the state is not listed; assets stay listed, because the state lists every asset of the history.
- **Cards wait for the project state** — until the open project's state loads, and for an asset that the current state does not list (a take rendered in a step after the current position), asset links and images keep DSH's rendering.
