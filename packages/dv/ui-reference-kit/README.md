---
description: "The browser kit of DreamVerse reference nouns such as characters, locations and styles: defineReferenceUi turns one ReferenceUiSpec into the UI plugin that registers the noun's canvas node type, card and editor, version kind, references in use, @ menu kind and History row; referenceDescriptors returns the same descriptors without the plugin."
kind: "package-reference"
---

# @dv/ui-reference-kit

English | [中文](README.zh.md)

## Summary

Use this package to give a reference noun, such as characters, locations, or styles, its browser presence from one declaration. The plugin that `defineReferenceUi` returns draws the canvas node of each item, which holds every version of the item, offers each item in the asset picker and the `@` menu, names the noun's records in History, and opens an editor that adds or removes the item's reference assets. `@dv/ui-character`, `@dv/ui-location`, and `@dv/ui-style` are one declaration each.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add `@dv/ui-reference-kit` to the `devDependencies` of a noun's UI package and import `@dv/ui-reference-kit/reference-kit.tsx`; the `./*` export maps to `src/client/*`, and the noun package's client bundle inlines the kit. The kit has no Loader row: its Host half (`src/index.ts`) exports nothing. The noun package exports the plugin, as `@dv/ui-character` does:

```ts ignore-check
export const { inject, apply } = defineReferenceUi({
  id: '@dv/ui-character', key: 'character', slice: state => state.components.character,
  label: ['角色', 'Character'], mention: { section: ['角色', 'Characters'], order: 1 },
})
```

### The kit API

The kit is one module, [`src/client/reference-kit.tsx`](src/client/reference-kit.tsx). Its descriptors are the types of the canvas contract (`@dv/ui-canvas/contract`, [`src/client/contract/index.ts`](../ui-canvas/src/client/contract/index.ts) of `@dv/ui-canvas`), the History contract (`@dv/ui-history/contract`), and `@dv/ui-kit/registries.ts`.

| Symbol | Meaning |
| --- | --- |
| `ReferenceUiSpec<V>` | One noun: `id` (the package name, the owner of every descriptor), `key` (the component key, which is also the reference kind and the node type key), `color` (the noun's slot of the theme's node palette, such as `var(--dv-node-1)`), `slice(state)` (the noun's slice, a map from item ID to its versions, `undefined` while the Host half of the noun is not loaded), `label` (the Chinese and English pair of the card label and the picker section), and `mention` (`{ section, order }` of the `@` menu section) |
| `WireReferenceVersion` | One version of an item as the wire sends it: `id`, `version`, `name`, `description`, `references`, and `created_by` (the record that wrote it) |
| `referenceDescriptors(spec)` | Returns `{ nodeType, versionKind, referencesInUse, mentionKind, historyRow }` for one noun |
| `defineReferenceUi(spec)` | Returns the `UiPlugin` (`{ inject: [], apply }`) that registers those descriptors and the card and editor entries |

The descriptors read only the noun's own slice, the `proj` records, and the node list of [`@dv/canvas`](../canvas/README.md), where `<key>.create` of `@dv/reference-kit` makes the item's node in column 0 and each `<key>.update` is a version of it:

- `nodeType` is a `NodeType` that draws the nodes of kind `key`, colored by the spec's `color`, with a body 30 px tall. For a version, it reads the item that the record's `<key>` param names: its title is the newest version's name, else the record's `name` param (for a failed create), else the item ID; `assets` are the newest references, and `ref` is `{ kind: key, id }`.
- `versionKind` is a `VersionKind` whose `node(state, id)` is the node that holds the record of the item's newest version, else null, whose `latest(state)` lists the newest version of each item, and whose `name` and `assets` read one version, null and empty for a version that does not exist.
- `referencesInUse` is a `RecordsInUse` whose `uses(state)` lists the producer records (`proj.created_by`) of the newest references.
- `mentionKind` is a `MentionKind` of `@dv/ui-composer` whose items are `dv:<key>/<id>`, labeled with the name, else the ID, described by the first 40 characters of the description, with the first reference as the thumbnail.
- `historyRow` is a `HistoryRow` that matches `<key>.` and gives the subject 「name」 (Chinese) or “name” (English) from the record's `name` param, else from its `<key>` param, else no subject.

While `dvCanvas` and the slot registry exist, the plugin registers the node type first, then the references in use, the version kind, and the `dv.canvas.card` and `dv.canvas.editor` entries, keyed by `key`, once the canvas declares those slots; within that, it registers the mention kind while `dvMentions` exists. A refused node type therefore leaves none of these registrations of the noun. The plugin registers the History row while `dvHistory` exists, also while `@dv/ui-canvas` is not loaded, because the row is keyed by the noun's operations. Each registration works in any load order and leaves with its service or with the plugin.

The card body paints `CARD_SURFACE` of `@dv/ui-kit/frame.ts` and draws three parts on it. The first reference fills the box above the thumbnail row and the footer through `dv.media` at purpose `card`, with a chip of the noun's color and label over its top-left corner. For an item with two or more references, a row of thumbnails at purpose `thumb` follows, each 44 units tall and up to 44 units wide, narrower when the frame is too narrow for the row, with the first one ringed; an item with more than four references shows three thumbnails and `+N` for the rest. A footer gives the reference count and the version on show, such as 2 张参考图 · 第 2 版 / 2 references · v2. Text scales by `textScale`; above 1 the card drops the footer, so the enlarged text fits the frame. The node is a window node: its `sizing` has a frame 208 units wide by default and 104 units wide at the narrowest, each as tall as the first reference at 4:3 of that width plus the 32-unit footer, plus the 52-unit thumbnail row for an item with two or more references (208 × 188 and 208 × 240 by default). The body fills the frame the canvas sizes, so a larger frame shows a larger first reference above the same row and footer. The editor body draws the references of the version on show, the item version that the shown record wrote, else the newest one, through `dv.media` at purpose `card`, each in a box 220 px tall at the asset's aspect ratio (square for an asset of unknown dimensions). A click on a reference that is a project asset opens `host.preview`; × removes the reference and is disabled while it is the last one. The editor shows the description when it is not empty. ＋ 添加素材 / + Add asset opens `host.pickAssets(references, { versions: false }, …)` and appends the picks that the item does not hold. Each change runs `host.run` with the operation `<key>.update`, the params `{ [key]: id }`, the references as inputs of role `reference`, and the intent 在画布上给 <name> 添加参考 / Add references to <name> from the canvas, or 在画布上移除 <name> 的一个参考 / Remove a reference of <name> from the canvas. The editor draws nothing before the item has a version.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`referenceDescriptors` builds every descriptor from the spec once, so the plugin and a test hold the same objects. A state without the noun's slice holds no items, so every descriptor lists nothing until the noun's Host half loads. `defineReferenceUi` wraps the card and the editor in components that close over the spec, and opens one `ctx.inject` block per optional service, so a missing service skips only its own registrations.

`tests/reference-kit.client.spec.tsx` declares the test-only noun `test_ref` on the fixture state of `@dv/ui-kit/tests/fixture.client.tsx`. It checks each descriptor against a state with several versions, an unnamed item, an item without references, and an item without versions, and a state without the slice. It mounts the plugin with the real `@dv/ui-media` and `@dv/ui-asset-pool` plugins and checks that every registration appears and leaves on disposal. It draws the card and the editor on nodes that `buildCanvasGraph` of `@dv/ui-canvas` builds, and checks the picture, the thumbnails, the `+N` count, the footer, the body height, the `<key>.update` requests, the preview, the picker, and the disabled last ×.

| File | Content |
| --- | --- |
| [`src/client/reference-kit.tsx`](src/client/reference-kit.tsx) | The spec, the descriptors, the plugin, the card, and the editor |
| [`src/index.ts`](src/index.ts) | The empty Host entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/reference-kit`](../reference-kit/README.md) declares the Host half of a reference noun.
- [`@dv/ui-canvas`](../ui-canvas/README.md) draws the node type and renders the card and editor entries.
- [`@dv/ui-history`](../ui-history/README.md) draws the History rows.
- [`@dv/ui-composer`](../ui-composer/README.md) lists the `@` menu kinds.
- [`@dv/ui-media`](../ui-media/README.md) draws the editor's references through `dv.media`.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the `<key>.update` records that the reference editor writes reach the model only through the project state and update messages and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the kit sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The card and the editor read their copy through `@dv/ui-kit` hooks.** `ReferenceCard` and `ReferenceEditor` pick their text with `useText`, and the node type, version kind, and mention kind labels use `pickText`, which follow `<html lang>`, instead of an inject `hooks` source and the slot's `t`.
- **Every noun has one column.** `defineReference` of `@dv/reference-kit` places every noun node in column 0; neither `ReferenceUiSpec` nor `ReferenceSpec` has a field to change it.
- **The last reference cannot be removed.** An `<key>.update` without references keeps the current ones, so the editor disables × on the last reference.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
