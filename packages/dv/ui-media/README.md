---
description: "DreamVerse media drawing in the browser: the dv.media Component Factory that draws one asset at a purpose (thumb, card, player, loop) through the dv.media.view entry of its MIME top-level type or a file card, the dvMedia registry of media types, and the asset preview with its dv.media.preview.action buttons."
kind: "package-reference"
---

# @dv/ui-media

English | [中文](README.zh.md)

## Summary

Use this package so that every DreamVerse view draws an asset and opens its preview the same way. A view asks the `dv.media` Component Factory for an asset at a purpose (a thumbnail, a card body, a player, or a muted loop), and the media view that a plugin registers for the asset's MIME top-level type draws it; an asset without a view draws as a file card with its name and MIME type. `dvMedia.preview` opens the asset at full size with its dimensions, duration, and size, and the buttons of other plugins. The package names no media type.

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

Mount the plugin in a profile that stacks `dsh-web-app`; `@dv/bundle` mounts it with this row. The browser half injects `@deepseek-ai/dsh-client-ui-layout`, which declares the root `shell.overlay` list that holds the preview, and `@deepseek-ai/dsh-client-ui-renderer`. The `bundle` script (`tsdown`) writes the browser bundle `lib/client.js`, which the `./client` export serves.

```yaml
- id: dv-ui-media
  name: '@dv/ui-media'
```

The Host half (`src/index.ts`) is an `apply` that does nothing, so the Loader row loads the plugin and the browser half does all of the work. The browser half provides the client service `dvMedia`, registers the `dv.media` Component Factory, and registers the preview as the entry `dv.media.preview` of `shell.overlay`. The media views come from other plugins: `@dv/ui-asset-pool` registers the `image`, `video`, and `audio` media types and their `dv.media.view` entries.

### The media contract

The contract is the types-only module [`src/client/contract/index.ts`](src/client/contract/index.ts), imported as `@dv/ui-media/contract`. It merges `dvMedia` into the cordis `Context`, the slots `dv.media.view` and `dv.media.preview.action` into `SlotMap`, and the Factory `dv.media` into `SlotFactoryMap`.

| Symbol | Kind | Meaning |
| --- | --- | --- |
| `MediaPurpose` | type | What a view asks for: `'thumb'` (a small square), `'card'` (a card body), `'player'` (a full-width playable form), or `'loop'` (a full-width playable form that starts muted and loops, such as a take in its editor) |
| `MediaAsset` | type | The facts of an asset that a view draws: `id` and `mime`, and `name`, `width`, `height` and `duration_sec` where the surface knows them, such as a project cover that the summary names by ID and MIME type only |
| `MediaOwner` | type | The props of a `dv.media` occurrence and the owner props of each `dv.media.view` entry: `asset` (a `MediaAsset`), `purpose`, the optional `poster` (the asset ID of a still that a playable form shows before it plays, such as a take's image output), the optional `playBadge` (a play badge over the still of a playable asset, such as on a chat card whose click opens the player), and the optional `onSize({ width, height })` (receives the pixel size of the loaded media, for an asset whose stored size is unknown) |
| `MediaType` | type | One media type in `dvMedia.types`: `id` (the media type, such as `'audio'`, and the key of its `dv.media.view` entry), `icon` (the icon component, with the props of the DSH icons, for places with no poster, such as the `@` menu), and the optional `poster(asset, state)` (the asset ID of a still that stands for the asset where only an `<img>` can draw, or null) |
| `DvMedia` | service | `ctx.dvMedia`: `types`, a `Registry<MediaType>` of `@dv/ui-kit/registries.ts` keyed by `id`, so a second type with one `id` throws; and `preview(projectId, asset, opener)`, which opens the asset preview of an asset of a project |
| `PreviewActionOwner` | type | The owner props of one preview button: `projectId` (the project of the previewed asset), `asset`, `buttonClass` (the class of the preview's buttons, which an action's button takes so that it looks, hovers and focuses as 关闭 / Close does) and `close()` |
| `dv.media` | Component Factory | Root scope; props `MediaOwner`; one keyed child slot `dv.media.view`. A view renders an occurrence with `renderFactorySlot('dv.media', { asset, purpose })` and declares no slot of its own; the surface owns the box and gives it a definite size, and the media view fills it |
| `MediaViewOwner` | type | The owner props of each `dv.media.view` entry: `MediaOwner` and `unsupported()`, which a view calls when the browser cannot draw the asset, such as an image format that it cannot decode; the Factory then draws the file card |
| `dv.media.view` | keyed slot, root | The view of one media type, keyed by `MediaType.id`; the fallback is the file card |
| `dv.media.preview.action` | list slot, root | The buttons of the preview beside 关闭 / Close; each entry decides whether it shows for the asset |

A media plugin registers its type while `dvMedia` exists and its view once `dv.media` declares `dv.media.view`, as `@dv/ui-asset-pool` does:

```ts
ctx.inject(['dvMedia'], (scope) => {
  scope.effect(() => scope.dvMedia.types.register(imageType), 'my-plugin: media type image')
})
ctx.effect(() => ctx.slots.inject('dv.media.view', () => ctx.slots.register({ name: 'dv.media.view', key: 'image' }, ImageView)), 'my-plugin: image view')
```

The Factory keys the view by `mediaTypeOf(asset.mime)` of `@dv/ui-kit/media-type.ts`: the top-level type in lower case, without spaces or parameters. The file card shows the asset's name and MIME type; at purpose `thumb`, and for an asset whose name the surface does not know, it shows the MIME type alone, with the name as its tooltip. The `@` menu of `@dv/ui-composer` reads `MediaType.icon` and `MediaType.poster`.

### Open the asset preview

Call `dvMedia.preview(projectId, asset, opener)` with the asset's project and the element that the user clicked; the reference chips and entry editors of `@dv/ui-canvas` (`EntryEditorHost.preview`), the asset pool panel of `@dv/ui-asset-pool`, and the chat media of `@dv/ui-composer` call it. The preview is a modal dialog named after the asset. It draws the asset through `dv.media` at purpose `player`, then a row with the asset's name, its facts, the `dv.media.preview.action` entries, and 关闭 / Close. The facts are the dimensions, such as `1920×1080`, the duration with one decimal, such as `4.0 秒` or `4.0 s`, and the size in KB below 1 MiB and in MB above, such as `2.5 MB`, joined by ` · `. For an asset without stored dimensions, the facts show the size that the media view reports through `onSize`, for that asset only. For an asset with stored dimensions, the preview sizes the media box from them before the media loads (`mediaBox` of `@dv/ui-kit/zoom.ts`), so the dialog has its final box when it grows out of `opener`. A second `preview` call replaces the shown asset, and a change of the open project of the DreamVerse shell (`dv:current-project`) closes the preview. 关闭 / Close, a click outside the dialog, and Escape close the preview; the preview takes Escape in the capture phase, so the canvas or an editor under it does not see the key. 关闭 / Close has the focus when the preview opens, and `opener` gets the focus back when it closes while it is still on the page. The dialog grows out of `opener` when it opens and shrinks back into it when it closes (`useZoomPresence` of `@dv/ui-kit/zoom.ts`). `@dv/ui-composer` adds the entry `dv.composer.use-asset` (让智能体使用 / Ask the agent to use it) and `@dv/ui-timeline` adds `dv.timeline.insert` (插入片段 / Insert clip) to `dv.media.preview.action`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` creates the `types` registry at its top level, because other plugins register into it from their own fibers. One open request (the asset and a serial number) lives in an observable that the overlay entry reads through its inject `hooks.preview`; the opener element stays in the `apply` closure, outside the observable, because it is not JSON data, and the overlay entry reads it through the injected `openerOf`. `MediaView` keys `dv.media.view` by the part of `asset.mime` before `/` and passes `poster` and `onSize` only when the occurrence sets them. The Factory and the overlay entry register through `ctx.effect`, so disposing the plugin removes them, `dvMedia`, and every drawn occurrence.

`tests/media.client.spec.tsx` mounts the plugin under `SlotTestRuntime` of `@deepseek-ai/dsh-client-test-runtime`, the real slot runtime, with a test image view and a test preview button. It checks that a second media type of one `id` throws, that an occurrence draws through the view of its MIME top-level type with the purpose and poster that the view asks for, that a type without a view draws the file card, that the preview shows the media at `player`, the facts, the buttons, and the size of loaded media, and that 关闭 / Close, the backdrop, and Escape close it before a listener under it sees the key. One case draws an image through the one root-scoped Factory from a session-scoped `tool.call.toolview` entry; the last case disposes the plugin and checks that the Factory, `dvMedia`, the overlay entry, and the drawn media leave.

| File | Content |
| --- | --- |
| [`src/client/contract/index.ts`](src/client/contract/index.ts) | The media contract |
| [`src/client/index.ts`](src/client/index.ts) | `dvMedia`, the Factory registration, and the overlay entry |
| [`src/client/MediaView.tsx`](src/client/MediaView.tsx) | The Factory definition and the file card |
| [`src/client/MediaPreview.tsx`](src/client/MediaPreview.tsx) | The asset preview |
| [`src/client/media.module.css`](src/client/media.module.css) | The file card and preview styles |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/ui-asset-pool`](../ui-asset-pool/README.md) registers the image, video, and audio views.
- [`@dv/ui-canvas`](../ui-canvas/README.md) draws node media through `dv.media` and opens the preview from its editors.
- [`@dv/ui-kit`](../ui-kit/README.md) owns `Registry`, the wire `Asset`, and the zoom transition.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package draws assets and opens the asset preview in the browser and writes no record.

#### KV Cache effect

None; the package sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The preview reads its copy through `useText`.** `MediaPreview` picks 关闭 / Close and the 秒 / s unit with `useText` of `@dv/ui-kit/locale.ts`, which follows `<html lang>`, instead of a locale namespace and the slot's `t`.
- **One view per MIME top-level type.** `dv.media.view` is keyed by the media type of `asset.mime`, the part before `/`, so `image/png` and `image/svg+xml` share one view, and a plugin cannot give a subtype its own view.
- **A media type and its view are two registrations.** Registering a `MediaType` adds no view, and a `dv.media.view` entry draws without a `MediaType`; the package does not check that the two agree. The registrant installs both in one step under one key, as `@dv/ui-asset-pool` does.
- **Only review keeps media types out of the package.** `scripts/dv-architecture.ts` lists the package as UI core, whose rule R5 checks plugin nouns only. A rule about one media type belongs in the plugin that registers its view.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
