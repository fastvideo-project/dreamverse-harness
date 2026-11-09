---
description: "Browser half of the DreamVerse text node: the canvas node type text, whose nodes hold every textnode.write and textnode.edit version of one path, a card with the opening lines, an editor whose Markdown shows citations as chips and saves the next version with base_version, the @ mention kind of text nodes, and the History row of text node records."
kind: "package-reference"
---

# @dv/ui-text-node

English | [中文](README.zh.md)

## Summary

Use this package to show and edit the text nodes of [`@dv/text-node`](../text-node/README.md) on the canvas. Each text node is one canvas node with all its versions; its caption shows the title and the version count, and its card shows the opening lines as plain text. Its editor shows the Markdown with each citation as a chip, and Save writes the next version with `textnode.write` and the draft's `base_version`. The package also lists text nodes in the `@` menu and names the path and version of each `textnode.` record in History.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app`, `@dv/api`, `@dv/text-node`, `@dv/ui-canvas`, `@dv/ui-media` and `@dv/ui-composer`. Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-text-node
  name: '@dv/ui-text-node'
```

| Descriptor | Registry | Value |
| --- | --- | --- |
| `textNodeType` | `dvCanvas.nodeTypes` | `id: '@dv/ui-text-node'`, `type: 'text'` (the kind that `@dv/text-node` registers for the first `textnode.write` of a path), label `Text`, color `var(--dv-node-5)`; for a version, the title is the report's `title` (else the path), and `sizing` a window node 208 × 84 by default (four opening lines) and at least 104 × 36 (one opening line); a larger frame shows more of the opening text |
| `TextCard` | the `dv.canvas.card` slot | key `text`; the opening lines of the version's Markdown, read from `/dv/assets/<asset>` once per asset, as plain text with each citation as its label |
| `TextEditor` | the `dv.canvas.editor` slot | key `text`; for the version that the canvas's version strip selects, the footer, and the body, read from the version's asset as the card reads it, rendered as Markdown with each citation as a chip of the `@` source `dv-project` of `@dv/ui-composer`; on the newest version Edit opens a `conversation.prompt` editor with the same chips and the `@` picker, whose menu opens below the editor, and an older version is read only |
| `textMentionKind` | `dvMentions.kinds` | `id: '@dv/ui-text-node'`, `kind: 'textnode'`, order 4, section `Texts`; one item per text node: URI `dv:textnode/<path>`, label the title, and description the first 40 characters of the first line |
| `textHistoryRow` | `dvHistory.rows` | `match: 'textnode.'`; the subject is ` <path> v<version>`, else ` <path>` |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The canvas draws a text node's edges from its newest version with no code here: a `source` input `{record, output}` that `@dv/text-node` writes for each text node a version was built from draws an edge from the node that holds that source version. Every version after the first is `based_on` the previous one, so it joins the same node. The stale tag comes from the kernel's stale mark of the record. A save runs `POST /api/dv/operation` through its own `DvClient` with `textnode.write`, the params `path`, `body` and `base_version`, the `source` inputs of the newest version, each moved to the newest version of its text node, and `based_on` the newest version's record; a saved draft closes the editor. When the newest version N is past the draft's version M, the editor keeps the draft, shows `Someone saved version N first. Your draft is based on version M.`, and its save button reads `Save on top of vN`, which saves with `base_version` N. Any other refusal and a record that comes back `failed` or `cancelled` show their error and keep the draft.

The editor and the chips reuse entries of `@dv/ui-composer`: `MENTION_SOURCE` of `@dv/ui-composer/mention`, `editorContent`, `resolveAtom` and `faceOf` of `@dv/ui-composer/reference-model`, and the chip face `ReferenceFace` of `@dv/ui-composer/reference-face`. Read mode renders the Markdown with `MarkdownText` of `@deepseek-ai/dsh-client-ui-primitives`, the renderer of DSH chat, and a `MarkdownDelegateProvider` that draws each citation link through the Factory `dv.text.reference`, which this package registers with `ReferenceFace` as its component. Each chip carries its face, resolved against the canvas state and the version kinds of `dvCanvas`, so it shows the cited item's newest version. In edit mode the editor passes a `faceContext` of null, so each chip reads the state of the open project, as a chat chip does.

Every UI string comes from the `dv-text-node` dictionary, which `apply` registers through `ctx.locale` of `@deepseek-ai/dsh-client-locale`. The `intent` of a save, which the agent reads, is English.

| File | Content |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | The node type, the mention kind, the History row and `apply` |
| [`src/client/TextCard.tsx`](src/client/TextCard.tsx) | The card body, the Markdown read and the version label of the editor |
| [`src/client/TextEditor.tsx`](src/client/TextEditor.tsx) | The editor and its save |
| [`src/client/texts.ts`](src/client/texts.ts) | The `textnode` slice and record readers |
| [`src/client/locales.ts`](src/client/locales.ts) | The `dv-text-node` dictionary namespace over `locales/en.json` and `locales/zh.json` |
| [`src/index.ts`](src/index.ts) | The empty host half |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/text-node`](../text-node/README.md): the operations and the `source` inputs.
- [`@dv/ui-canvas`](../ui-canvas/README.md): the node contract, edges and the editor slots; [`@dv/canvas`](../canvas/README.md): the node list.
- [`@dv/ui-composer`](../ui-composer/README.md): the `@` source and the chip face.

-----

<a id="model-experience"></a>
## Model Experience

### Text node records

#### What the model sees

The model sees no text from this package. A save writes a `textnode.write` record with `surface: canvas`, which reaches the model through the project block of `@dv/project` and the `texts` summary of `@dv/text-node`.

#### Token effect

None from this package; each saved version adds the tokens that `@dv/text-node` documents for one version.

#### KV Cache effect

A save changes the project block from the next agent request on, as any canvas write does.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One node per path**: every version of a path is a version of one canvas node, so an older version shows only in the editor's version strip, and a new path is a new node.
- **No source picker on the canvas**: a canvas save keeps the sources of the newest version, each at its newest version; only an agent write sets `from`.
