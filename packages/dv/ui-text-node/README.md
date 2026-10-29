---
description: "Browser half of the DreamVerse text node: the canvas node type that claims textnode.write and textnode.edit records, a card with the opening lines and the version, an editor whose Markdown shows citations as chips and saves the next version with base_version, the @ mention kind of text nodes, and the History row of text node records."
kind: "package-reference"
---

# @dv/ui-text-node

English | [中文](README.zh.md)

## Summary

Use this package to show and edit the text nodes of [`@dv/text-node`](../text-node/README.md) on the canvas. Each version of a text node is one canvas node; its caption shows the title and `v<version>`, and its card shows the opening lines as plain text and a footer such as `v3 · 1,240 chars`. Its editor shows the Markdown with each citation as a chip, and 保存 / Save writes the next version with `textnode.write` and the draft's `base_version`. The package also lists text nodes in the `@` menu and names the path and version of each `textnode.` record in History.

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
| `textNodeType` | `dvCanvas.nodeTypes` | `id: '@dv/ui-text-node'`, `type: 'textnode'`, label `文本` / `Text`, color `var(--dv-node-5)`, column 0; it claims the operations `textnode.write` and `textnode.edit`, so each record is one node: title the report's `title` (else the path), meta `v<version>`, and `bodyHeight` 106 |
| `TextCard` | the `dv.canvas.card` slot | key `textnode`; the opening lines of the version's Markdown, read from `/dv/assets/<asset>` once per asset, as plain text with each citation as its label, and the footer with the version and the code points of the body |
| `TextEditor` | the `dv.canvas.editor.claimed` slot | key `textnode`; the footer, and the body in a `conversation.prompt` editor whose citations are chips of the `@` source `dv-project` of `@dv/ui-composer`; on the newest version 编辑 / Edit opens the same editor with the `@` picker, and on an older version 打开第 N 版 / Open version N opens the newest one |
| `textMentionKind` | `dvMentions.kinds` | `id: '@dv/ui-text-node'`, `kind: 'textnode'`, order 4, section `文本` / `Texts`; one item per text node: URI `dv:textnode/<path>`, label the title, and description the first 40 characters of the first line |
| `textHistoryRow` | `dvHistory.rows` | `match: 'textnode.'`; the subject is ` <path> v<version>`, else ` <path>` |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

A text node version is a claimed node, so the canvas draws its edges from the record with no code here: a `source` input `{record, output}` that `@dv/text-node` writes for each text node a version was built from draws an edge from that source version, and the `based_on` of each version after the first draws the lineage edge from the previous version. The stale tag comes from the kernel's stale mark of the record. A save runs `POST /api/dv/operation` through its own `DvClient` with `textnode.write`, the params `path`, `body` and `base_version`, the `source` inputs of the newest version, and `based_on` the newest version's record; a saved draft closes the editor. A refused save keeps the draft and shows `有人先保存了第 N 版。你的草稿基于第 M 版。` / `Someone saved version N first. Your draft is based on version M.` when the newest version N is past the draft's version M, else the error of the refusal. A draft stays open when a newer version arrives.

The editor and the chips reuse three entries of `@dv/ui-composer`: `MENTION_SOURCE` of `@dv/ui-composer/mention`, `editorContent` of `@dv/ui-composer/reference-model`, which makes one chip per citation, and the chip face `ReferenceFace` that the composer registers for that source. The editor passes a `faceContext` of null, so each chip reads the state of the open project, as a chat chip does.

| File | Content |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | The node type, the mention kind, the History row and `apply` |
| [`src/client/TextCard.tsx`](src/client/TextCard.tsx) | The card body, the Markdown read and the footer |
| [`src/client/TextEditor.tsx`](src/client/TextEditor.tsx) | The editor and its save |
| [`src/client/texts.ts`](src/client/texts.ts) | The `textnode` slice and record readers |
| [`src/index.ts`](src/index.ts) | The empty host half |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/text-node`](../text-node/README.md): the operations, the `source` inputs and the reference kind.
- [`@dv/ui-canvas`](../ui-canvas/README.md): claimed nodes, edges and the editor slots.
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

- **One node per version**: every version is its own canvas node, linked to the previous one by a lineage edge, as every claimed record is.
- **No source picker on the canvas**: a canvas save keeps the sources of the newest version; only an agent write sets `from`.
