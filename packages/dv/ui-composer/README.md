---
description: "The DreamVerse additions to the DSH chat composer: the @ source and the Reference row for project items, the dv.prompt composer of one generation call with its registry of parameter bars, tool rows with creator-facing names and a Show in history link, and the dv:compose prefill."
kind: "package-reference"
---

# @dv/ui-composer

English | [中文](README.zh.md)

## Summary

Use this package to fit the DSH chat composer to a DreamVerse project. Typing `@`, or picking 引用 / Reference in the composer's ＋ menu, lists the items of the mention kinds that plugins register in `dvMentions` and the open project's assets as reference chips. The `dv.prompt` Factory draws a generation call's composer: references, prompt, parameters, and send. DreamVerse tool rows in the chat show creator-facing names, and the link 在历史中查看 / Show in history selects a call's record. The canvas and the asset preview prefill the chat composer through `dv:compose`.

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
| Open a `dv.prompt` occurrence | `GET /api/dv/models` whenever an occurrence opens while no other is open; a failed read keeps the catalog it had, and while the editor has no catalog it shows 模型列表加载失败 / Couldn't load the model list with 重试 / Try again, which reads the catalog again; the alert (`dv-composer-models-failed`) leaves while that read runs and shows again if it fails |
| Show a chip in the chat composer bar | `GET /api/dv/state` of the open project, fetched again 150 ms after each burst of its project events while a chat chip shows |
| Edit the call in an editable `dv.prompt` occurrence, or lend it a new state | `POST /api/dv/operation/check` with the edited call and the host's `surface`, 250 ms after the last change; the route writes nothing |

The `@` list reads the project's current state: the items of each registered mention kind in its `order` (registration order on a tie) under its `section()`, where an item's `thumb` asset shows as that asset's icon, and the 40 newest assets of every media type; an asset's icon is the still that the `poster` of its media type in `dvMedia.types` of `@dv/ui-media` names, else the type's `icon` component, else a file glyph; a pick inserts a chip whose text is the citation `@[<label>](dv:<kind>/<id>)` that `formatCitation` of `@dv/project/grammar` writes, as a `dv:compose` prefill does. The 引用 / Reference row opens the same list at the end of the draft. Every labelled tool row, and every operation row, shows the tool's name (an operation row shows `operationLabel` of `@dv/ui-kit`) and the status 进行中… / Running…, 完成 / Done, or 未完成 / Failed. Every settled row whose call wrote a record has the link 在历史中查看 / Show in history. A `dv:compose` event also brings the 对话 / Chat tab to the front. The package hides DSH's file-permission chip and draws the 对话 / Chat tab's composer card, its ＋ button, and its send button with the DreamVerse theme tokens.

In settled chat Markdown, a link whose path is `/dv/assets/<id>` and whose asset the open project holds becomes a 16:9 card, 160 px wide, that draws the asset through the `dv.media` Factory of `@dv/ui-media` at purpose `thumb`, with a caption under it: the label that `dvHistory.describe` of `@dv/ui-history` gives the record that created the asset when History draws that record as media, such as a shot render, else the asset's name, such as the file name of an import. The caption follows `dvHistory` and its rows, so a card that is already drawn reads it again when a History row registers. A table in which every body row links such an asset becomes a three-column grid of these cards, each captioned with the row's other cells joined by ` · ` (for example `1 · 直播间开场「来一把吧」`). A Markdown image of such an asset becomes a thumbnail at most 240 px wide, at the asset's own width and aspect ratio when the asset has a size, else 240 px wide at 16:9. A click on a card or a thumbnail opens the asset preview through `dvMedia.preview`, which grows out of the clicked element; nothing opens while `dvMedia` is absent. An asset of a media type without a `dv.media.view` entry draws the file card of `@dv/ui-media`. The assets and the records that created them come from the current state of the open project, fetched again after each project event. Other links, images, and tables keep DSH's rendering.

### The `dv.prompt` composer

The browser half also provides `dvComposer`, whose types are in the types-only entry `@dv/ui-composer/contract` ([`src/client/contract/index.ts`](src/client/contract/index.ts)): `paramBars`, a `Registry<ParamBar>` keyed by `operation`, which the UI half of the plugin that owns an operation fills inside `ctx.inject(['dvComposer'], …)`, as the generation kit of `@dv/ui-generation` does for each operation of a kind. A second bar of one operation throws, naming the holder's `owner`. A `ParamBar` gives `chips({schema, params, operation})`, the chips of a call under a model's `schema()`, each a param key, a label, and a menu (the shown value and the choices as param patches), a text field, or a checkbox; `candidates(schema)`, the `@` filter of that model, with the media types and the `maxReferences` count of its `reference` input; and an optional `copy` with the `placeholder`, `send`, and `sending` texts. `chips` and `candidates` are optional too, and `candidates` answers null for no filter, such as for a schema that the catalog does not know. An editable occurrence keeps its unsent draft (document, params and typed chip text) in memory under its project, its `draftId` (the take editor passes the take's record), and its lent call, so closing the editor, such as with Escape or a click on empty canvas, and opening the same take again restores it, and another take with an equal call starts clean; a successful send, editing back to the lent call, or editing back to the call that a successful send sent drops the draft, a restored draft is checked again before its send, shows no failure from before the editor closed, and is never in the sending state, and a page reload clears every draft.

The browser half registers the root Component Factory `dv.prompt`, the composer of one generation call, which a plugin reaches with a bare `import type {} from '@dv/ui-composer/contract'` and draws with `renderFactorySlot('dv.prompt', props)`. Its props are `projectId`, `draftId` (the identity of what the call belongs to, such as a take's record, under which an editable occurrence keeps its unsent draft), `call` (a `PromptCall`: `operation`, `params` whose `prompt` holds the prompt with its citations, and `inputs` as `{role, ref}` request inputs), `state` and `operations` (the project state and the operation declarations that the host draws, against which the composer resolves every reference and finds the call's operation), `readOnly`, `surface` (where the user edits the call, such as `canvas`, which the check names), `host`, and an optional `onSubmit(call)`, which receives the edited call and decides what a send does. The host is a `PromptHost`: the optional `pickAssets(chosen, done)` opens the host's asset picker, the optional `importFiles(files)` imports local files into the project and resolves with their asset IDs in file order, `preview(asset, opener)` opens the preview of an asset, and `openNode(nodeId)` opens the editor of a canvas node. When the host passes another `call`, the occurrence starts over on it with an empty undo history, so an undo cannot bring back the call it replaced. To switch to another `draftId` or `projectId`, a host remounts the occurrence, such as with a React key. The take editor of [`@dv/ui-generation`](../ui-generation/README.md) draws it over a take's call.

Any text box can offer the same `@` picker and chips. Three entries export the code that the chat box and `dv.prompt` use: `@dv/ui-composer/mention` gives `MENTION_SOURCE` (the source name `dv-project`) and `projectMentionSource`, `@dv/ui-composer/reference-face` gives `ReferenceFace`, the chip face, and `@dv/ui-composer/reference-model` gives `editorContent`, which turns each citation `@[label](dv:…)` of a text into one chip. A text box draws `renderFactorySlot('conversation.prompt', { model })` with `sources: [MENTION_SOURCE]` and chips of source `MENTION_SOURCE`; the face that this plugin registers for that source draws each chip, and a `faceContext` of null makes the face read the open project's state, as a chat chip does.

The composer draws these parts from top to bottom:

- The reference tray, with one tile per call input: the preview through `dv.media` at purpose `thumb`, the label, the version it sends (such as `v2`), 未引用 / uncited when no chip cites the input, 用 vN / Use vN when a newer version exists, and the × that removes the input. A tile of a media type that the selected model does not take is dimmed, and so is each `reference` input whose assets end past the model's `maxReferences`, counted over the assets of the `reference` inputs in input order, where a version counts its assets and any other input without assets counts as one; a click on a tile opens the item's node or the asset's preview. When the host lends `pickAssets`, 添加素材 / Add asset opens it with the held references and appends each new pick as a `reference` input. When the host lends `importFiles`, 上传文件 / Upload files imports the chosen files and appends each as a `reference` input in file order.
- DSH's `conversation.prompt` editor, which draws each chip with the chip face, shows the placeholder while an editable prompt is empty, and imports a file that the user pastes as 上传文件 / Upload files does, when the tray offers it.
- The parameter bar: the model chip, a menu of the `GET /api/dv/models` entries of the call's `modality`, whose pick writes `modality`, `task`, `provider`, and `model`; then one chip per param that the operation declares other than `prompt` and those four, each with its name (时长（秒）/ Duration (s) and 种子 / Seed for the shared params, else its key): a menu for a param with choices, a checkbox for a boolean, and a text field otherwise, such as the seed, whose empty field reads 随机 / random, and `extra`, the model's own params, as JSON; a chip of the operation's registered bar under the selected model's schema replaces the chip of its key, and the bar's chips of undeclared params follow; a text field shows the text the user types, and while the text does not parse as its param's type, its problem shows under the bar and the send stays disabled; then the send button.

250 ms after the last edit, and after each new state that the host lends, the composer sends the edited call to `POST /api/dv/operation/check`. The answer's problem sentence shows under the bar, and the send stays disabled until the check of the edited call answers with no problem; an answer for an earlier form of the call does not count. A send passes the edited call to `onSubmit`; when `onSubmit` rejects, or the host's `importFiles` rejects, 失败：… / Failed: … shows under the bar until the call changes. The editor stays read-only until the composer knows the canvas's version kinds. The placeholder, the send text, and the text while a send runs come from the bar's `copy`; without it they are neutral: 描述要生成的内容 / Describe what to generate, 生成新版本 / Generate a new version, and 生成中… / Generating…. The tray's 添加素材 / Add asset and the editor's `@` offer references only when the operation declares a `reference` input and the bar's filter for the selected model names at least one media type, and the catalog has loaded; without a bar's filter or a catalog entry of the model, there is no filter, so every media type is offered. In read mode the composer shows only the tray, with no add, pin, or ×, and the read-only editor; it draws no bar, reads no model catalog, sends nothing, and checks nothing.

A chip cites an asset (`dv:asset/<id>`) or an element such as a character (`dv:<kind>/<id>`). The composer reads the citations of the editor's text with the kernel's parser, so it reads a citation wherever the kernel reads one: a citation that a paste or typing writes as text, such as a cut or copied chip pasted back, becomes a chip within the same undo step. A `reference` input satisfies an asset chip when it stands for the asset, and an element chip when it is a version `<id>@<n>` of the element that has at least one asset. The composer keeps the inputs in step with the chips: a new chip that no input satisfies appends the input it needs, the asset or the element at its newest version (R1); removing a tile turns each chip that only that input satisfied into its label, as one undo step of the editor (R2); deleting a chip removes each `reference` input that satisfied it and that no remaining chip cites, while an input that no chip cited and an input of another role, such as a first frame, stay (R3′); a chip that no input satisfies draws in the failure style (R4). 用 vN / Use vN rewrites the input to that version, and every chip of the element follows. The editor's history is the only undo: an undo or a redo that brings deleted chips back also brings back each input that the edit removed for them, at its stored place, while a chip that an edit brings back, such as a new `@` pick or a paste, adds its input by R1; and a tray edit that leaves the prompt unchanged, such as an add from the picker, a pin, or the removal of a tile that no chip cites, is outside that history. The module comments of [`src/client/DvPrompt.tsx`](src/client/DvPrompt.tsx) and [`src/client/reference-model.ts`](src/client/reference-model.ts) own these rules.

The chip face is the `conversation.prompt.reference` and the `conversation.input.reference` entry at key `dv-project`, so it draws every chip of the `dv-project` source in every prompt editor and in the chat composer bar: the preview through `dv.media` at purpose `thumb`, the label, and, in a `dv.prompt` occurrence, the version the call sends. In a `dv.prompt` occurrence the face draws what the occurrence resolved against the state that its host lends, so it fetches no state. A chat chip reads the live state of the open project and draws its element's newest version. A chip click in a `dv.prompt` occurrence opens the item's node or the asset's preview. The `@` source `dv-project` also has a `prompt` face for occurrences outside a Session, which lists the same items and leaves out an item whose asset is of a media type that the occurrence's model does not take, and an item of a kind that no version kind reads, such as a timeline clip, which no input of the call can satisfy.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

A `dv:compose` event that arrives while no composer is mounted waits for the next composer that mounts; a chip the input refuses falls back to its plain reference text. A tool row reads whether its call wrote a record from the presentation metadata of the call's result: an operation tool and a `dv_proj_*` tool that writes records name the record they wrote in `record`, a read operation such as `inspect.image` names `record: ''`, and a read `dv_proj_*` tool (`dv_proj_rename`, `dv_proj_state`, `dv_proj_history_list`, `dv_proj_wait`) or a failed call carries no metadata.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The Host half, which registers nothing |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | The type of the CSS Module imports |
| [`src/client/index.ts`](src/client/index.ts) | `dvMentions` and the registrations: the `@` source, the ＋ menu row, the UI slot entries, the tool names, and the `dv:compose` listener |
| [`src/client/mention.ts`](src/client/mention.ts) | The `@` source with its `prompt` face and its project items |
| [`src/client/contract/index.ts`](src/client/contract/index.ts) | The types-only entry `@dv/ui-composer/contract`: the call, the host, the parameter bar, `dvComposer`, and the `dv.prompt` Factory |
| [`src/client/prompt.ts`](src/client/prompt.ts) | `dvComposer`, the registrations of `dv.prompt` and the chip face with their inject, and the live state of each project that a chat chip reads |
| [`src/client/DvPrompt.tsx`](src/client/DvPrompt.tsx) | The composer: the reference tray, the editor, the parameter bar, the check, and the send |
| [`src/client/param-chips.ts`](src/client/param-chips.ts) | The chips of a call's parameter bar, and the typing of a text chip's text |
| [`src/client/draft.ts`](src/client/draft.ts) | The draft of an occurrence: the document, the params, the editor's content, the check, and the send, each change one action |
| [`src/client/drafts.ts`](src/client/drafts.ts) | The in-memory store of unsent drafts, keyed by project, draft id, and lent call, the 20 most recently written kept |
| [`src/client/reference-model.ts`](src/client/reference-model.ts) | The document of a call, the inputs that satisfy a citation, the edits R1 to R3′ and the version pin, and the views of chips and tiles |
| [`src/client/ReferenceFace.tsx`](src/client/ReferenceFace.tsx) | The chip face |
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
- [`@dv/ui-canvas`](../ui-canvas/README.md) — the canvas and its node actions.
- [`@dv/ui-generation`](../ui-generation/README.md) — the node editor of generation nodes, which draws `dv.prompt` over a version's call.
- [`@dv/ui-history`](../ui-history/README.md) — the History panel that answers `dv:history-focus`, and the record label of the chat cards.
- [`@dv/ui-kit`](../ui-kit/README.md) — the API client, the wire types, the compose event, and the tool labels.
- [`@dv/ui-media`](../ui-media/README.md) — the `dv.media` Factory that draws the chat cards, the media types that draw the `@` menu icons, and the asset preview.
- [`@dv/ui-shot-render`](../ui-shot-render/README.md) — the parameter bar of `shot.render`.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/chat-references`, which turns the `dv:` mentions of a sent message into a `dv-mentions` context message.

#### KV Cache effect

None from this package; the `dv-mentions` context message follows the user message it expands, and the README of `@dv/chat-references` describes its effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **`@` list of the current state** — the `@` list and the 引用 / Reference row read the project's current state, so a clip, character, location, or style that an undo took out of the state is not listed; assets stay listed, because the state lists every asset of the history.
- **Cards wait for the project state** — until the open project's state loads, and for an asset that the current state does not list (a shot rendered in a step after the current position), asset links and images keep DSH's rendering.
