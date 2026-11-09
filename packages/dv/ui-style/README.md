---
description: "Browser half of the DreamVerse style component: the canvas node type, card, editor, version kind, references in use, @ menu kind and History row of the styles, declared with defineReferenceUi."
kind: "package-reference"
---

# @dv/ui-style

English | [中文](README.zh.md)

## Summary

Use this package to show the styles of `@dv/style` in the DreamVerse views. One `defineReferenceUi` declaration of `@dv/ui-reference-kit/reference-kit.tsx` gives the noun its canvas node type `style` (label 风格 / Style, one node per item that `style.create` makes), its version kind, its references in use, its `dv.canvas.card` and `dv.canvas.editor` entries (the kit's default card and `ReferenceEditor`), its `@` menu kind (section 风格 / Styles, order 3, address `dv:style/<id>`), and its History row (`style.`).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app`, `@dv/api`, `@dv/style`, `@dv/ui-canvas`, and `@dv/ui-media`, whose `dv.media` Factory draws the reference assets. Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-style
  name: '@dv/ui-style'
```

The Host half registers nothing. The browser half registers each descriptor while its service is present, and each registration leaves with its service or with the plugin. Every change in the editor runs `style.update` through `host.run`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The inert Host Loader entry |
| [`src/client/index.ts`](src/client/index.ts) | The `defineReferenceUi` declaration, whose `inject` and `apply` the file exports |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/style`](../style/README.md): the `style` slice and its operations.
- [`@dv/ui-reference-kit`](../ui-reference-kit/README.md): what `defineReferenceUi` builds.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the `style.update` records that its editor writes reach the model only through the project state and update messages and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the package sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Column 0** — the node type sits in column 0 with every other noun, colored `var(--dv-node-7)`, because `defineReference` of `@dv/reference-kit` places every noun node there and has no column field.
