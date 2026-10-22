---
description: "The browser kit of DreamVerse reference nouns such as characters, locations and styles: defineReferenceUi turns one ReferenceUiSpec into the noun's canvas node type, version kind, takes in use, @ menu kind, History row and editor entry."
kind: "package-reference"
---

# @dv/ui-reference-kit

English | [中文](README.zh.md)

## Summary

Use this package to give a reference noun, such as characters, locations, or styles, its browser presence from one declaration. `defineReferenceUi` returns the noun's descriptors and the client plugin body that registers them: one canvas node per item at its newest version, the item's versions for the asset picker, the `@` menu items, the History subject of the noun's records, and an editor that adds or removes the item's reference assets. `@dv/ui-character`, `@dv/ui-location`, and `@dv/ui-style` are one declaration each.

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

Add `@dv/ui-reference-kit` to the `devDependencies` of a noun's UI package and import `@dv/ui-reference-kit/reference-kit.tsx`; the `./*` export maps to `src/client/*`, and the noun package's client bundle inlines the kit. The kit has no Loader row: its Host half (`src/index.ts`) exports nothing.

| Symbol | Meaning |
| --- | --- |
| `defineReferenceUi(spec)`, `ReferenceEditor` | `defineReferenceUi(spec)`: the descriptors of one reference noun from one `ReferenceUiSpec` (`id`, the package name and editor slot key; `key`, the component key, reference kind and node type; `slice(state)`, the noun's slice, `undefined` while the host half is not loaded, in which case the descriptors list no items; `label`; `mention`; an optional `editor`): a `NodeType` with one entry `<key>:<id>` per item at its newest version in column 0, a `VersionKind`, a `TakesInUse` of the producers of the newest references, a `MentionKind` of `dv:<key>/<id>` items, a `HistoryRow` that matches `<key>.` and names the record's `name`, else its ID param, and `apply(ctx)`, the client plugin body that registers them and the `dv.canvas.editor` entry; `ReferenceEditor`: the default editor body (the references, the description, the `children` rows and ＋ 添加素材), which writes each change as `<key>.update` through `host.run`, draws each reference through the `dv.media` Factory of `@dv/ui-media` at purpose `card` with the `renderFactorySlot` of the editor entry, in a box 220 px tall at the asset's aspect ratio (square for an asset of unknown dimensions), and opens `host.preview` on a click |
| `WireReferenceVersion` | One version of an item as the wire sends it: `id`, `version`, `name`, `description`, `references`, and `created_by` (the record that wrote it) |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`defineReferenceUi` builds every descriptor from the spec once, so the plugin and a test hold the same objects. A state without the noun's slice holds no items, so every descriptor lists nothing until the noun's Host half loads. `tests/reference-kit.client.spec.tsx` declares the test-only noun `test_ref` on the fixture state of `@dv/ui-kit/tests/fixture.client.tsx` and checks each descriptor, the registrations and their removal, and the editor's `<key>.update` writes.

| File | Content |
| --- | --- |
| [`src/client/reference-kit.tsx`](src/client/reference-kit.tsx) | The spec, the descriptors, the plugin body, and the editor |
| [`src/index.ts`](src/index.ts) | The empty Host entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/reference-kit`](../reference-kit/README.md) declares the Host half of a reference noun.
- [`@dv/ui-canvas`](../ui-canvas/README.md) draws the node type and renders the editor entry.
- [`@dv/ui-history`](../ui-history/README.md) draws the History rows.
- [`@dv/ui-composer`](../ui-composer/README.md) lists the `@` menu kinds.
- [`@dv/ui-media`](../ui-media/README.md) draws the editor's references through `dv.media`.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the `<key>.update` records that the reference editor writes reach the model only through the `dv:project` prompt section and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the kit sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The editor reads its copy through `@dv/ui-kit` hooks.** `ReferenceEditor` picks its text with `useText`, and the descriptor labels use `pickText`, which follow `<html lang>`, instead of an inject `hooks` source and the slot's `t`.
- **The last reference cannot be removed.** An `<key>.update` without references keeps the current ones, so the editor disables × on the last reference.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
