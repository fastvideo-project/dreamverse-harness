---
description: "Image generation in the DreamVerse browser workspace: one defineGenerationUi declaration of @dv/ui-generation that claims the image.generate records as image takes, with their label, status words and node palette slot."
kind: "package-reference"
---

# @dv/ui-image-generate

English | [中文](README.zh.md)

## Summary

Use this package to show image generation in the DreamVerse workspace. It declares the `image.generate` records as image takes through `defineGenerationUi` of `@dv/ui-generation`, with their label, status words, and node palette slot. The kit draws the takes on the canvas, in the take editor, in the chat, and in History. The takes appear only in a composition whose host plugins declare the `image.generate` operation, such as `@dv/image-generate`.

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

Mount the plugin in a profile that stacks `dsh-web-app`, `@dv/ui-canvas`, `@dv/ui-media`, and `@dv/ui-history`; `@dv/bundle` mounts it with this row. The browser half injects `@deepseek-ai/dsh-client-ui-renderer` and `@deepseek-ai/dsh-client-ui-tool`, which declares the `tool.call.toolview` slot of the chat card. The `bundle` script (`tsdown`) writes the browser bundle `lib/client.js`, which the `./client` export serves.

```yaml
- id: dv-ui-image-generate
  name: '@dv/ui-image-generate'
```

The Host half (`src/index.ts`) is an `apply` that does nothing. The browser half ([`src/client/index.ts`](src/client/index.ts)) exports only `inject` and `apply`, the plugin of one `defineGenerationUi` declaration of [`@dv/ui-generation`](../ui-generation/README.md):

| Field | Value |
| --- | --- |
| `id` | `'@dv/ui-image-generate'` |
| `type` | `'image'` |
| `operations` | `['image.generate']` |
| `label` | 图片 / Image |
| `color` | `var(--dv-node-4)`, slot 4 of the node palette of `@dv/ui-shell` |
| `status` | running 生成中… / Generating…, failed 生成失败 / Generation failed, done 已生成 / Generated |

The declaration sets no `preview` and no other field, so the takes use the kit's defaults. The canvas card, the take editor, the 重试 / Retry action, the chat card, and the History row of the takes are the kit's; [`@dv/ui-generation`](../ui-generation/README.md) documents them and every `GenerationUiSpec` field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package holds no logic of its own: every registration comes from `defineGenerationUi`, and no UI core package names the `image` type.

`tests/image-generate.client.spec.tsx` checks only what the plugin registers. It checks that the package exports only `inject` and `apply`, that the node type `image` claims `image.generate` with the label, the palette slot, and the status words of the declaration, and that the entries keyed by the type, the tool `dv_image_generate`, and the operation register and leave with the plugin.

| File | Content |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | The `defineGenerationUi` declaration |
| [`src/index.ts`](src/index.ts) | The empty Host entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/ui-generation`](../ui-generation/README.md) owns the kit that this package declares: the take card, the take editor, 重试 / Retry, the chat card, and the History rows.
- [`@dv/ui-canvas`](../ui-canvas/README.md) draws the takes.
- [`@dv/image-generate`](../image-generate/README.md) owns the `image.generate` operation.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the `image.generate` records that the kit writes from the canvas reach the model only through the `dv:project` prompt section and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the package sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The kit's deferred work applies.** The take card, take editor and chat card of this plugin come from `@dv/ui-generation`; see [its Known Limitations](../ui-generation/README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
