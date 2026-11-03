---
description: "The DreamVerse asset pool panel: the project's images and videos in a right-Sidebar tab, with import, drag into the canvas or the timeline, and the asset preview; the canvas asset node; and the image, video, and audio media types and views."
kind: "package-reference"
---

# @dv/ui-asset-pool

English | [中文](README.zh.md)

## Summary

Use this package to give the web application a 素材库 / Asset pool panel beside the chat. `AssetsPanel` lists every image and video of the open project once, grouped into images, videos, and stills extracted from generation: every asset of the current state, and every asset that a record of the project imported, discarded records included, so an undo hides a generated asset of a step after the current position and never hides an imported asset. You can import images and videos by dropping them on the panel, drag a thumbnail into the canvas or the timeline, and click it to open the asset preview of `dvMedia.preview` (`@dv/ui-media`). The package also gives `dvMedia` the image, video, and audio media types with their views. The `dv-asset-pool` right-Sidebar tab type shows the panel of the project the shell has open.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app` (which provides the right Sidebar and the client module loader) and `@dv/api` (which serves the routes the panel calls). Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-asset-pool
  name: '@dv/ui-asset-pool'
```

The Host half registers nothing. The browser half registers the `dv-asset-pool` tab type (a page the Sidebar's guide offers as "Asset pool") and the tab body under its own id `@dv/ui-asset-pool`. The tab stays mounted while another tab is in front. It fills three keyed slots that `@dv/ui-canvas/contract` declares: `dv.canvas.picker` at key `assets` with `AssetsPanel`, the panel inside the canvas's asset picker, whose thumbnail clicks call the picker's `onOpen` and pick assets; `dv.canvas.card` at key `asset` with `AssetCard`, which draws the asset through the `dv.media` Factory at purpose `card`, filling the node's frame: an image or a video of known size shows bare in a frame whose height follows the frame width through the node's `sizing.heightAt` rule, `frameHeight` of `@dv/ui-kit/frame.ts` at that width (the width at the asset's aspect ratio, clamped between 3:4 and 16:9), and any other asset sits on `CARD_SURFACE` in the 16:9 frame; and `dv.canvas.editor` at key `asset` with `AssetEditor`, which draws the asset at purpose `player` in the box that `playerBox(asset, 360)` of `@dv/ui-kit` sizes. While the canvas service `dvCanvas` is present, it registers the node type `asset` (`assetNodeType`) in `dvCanvas.nodeTypes` and the action `@dv/ui-asset-pool:unplace` in `dvCanvas.actions`: 从画布移除 / Remove from canvas (order 20, on `asset` nodes) closes the editor and takes the asset off the canvas list through the host's `setPlaced`, and the asset stays in the asset pool. The node type has one stand-in node per asset on the canvas list (the `asset` slice's `placed`), drawn from the first `asset.import` record of the current state that imported the asset, else as `asset:<id>` with no record (an import that an undo went back past, a still, or an export), and titled by the asset's name with its duration; a stand-in shows only while no other node owns its asset. While the media service `dvMedia` of `@dv/ui-media` is present, it registers the media types `image`, `video`, and `audio` in `dvMedia.types`, each in one step with its view (`ImageView`, `VideoView`, `AudioView`) as the `dv.media.view` entry at the same key, so a type that does not register leaves no view; an image, a video, or an audio player that the browser cannot decode calls `unsupported()`, so the file card stands in for it. Every asset enters a project through `asset.import`, so this package owns these media types.

| Gesture | Request or event |
| --- | --- |
| Open the panel, any project change | `GET /api/dv/state` for the project's current state, refetched on every `/dv/events` event |
| Drop images or videos on the drop zone, or click it to choose files | `POST /api/dv/assets/import` once per image or video file with `surface=asset_pool` and the tab's chat session; the `asset.import` record is a step after the project's current position. The zone imports no other file and shows 「<name>」不是图片或视频，没有导入。 / "<name>" is not an image or a video, so it was not imported. for each one |
| Drag a thumbnail | a drag that carries the asset ID as `application/x-dv-asset`; the canvas moves the asset's node to the drop point, the timeline inserts a clip at the drop position |
| Click a thumbnail in the tab | `dvMedia.preview` with the project, the asset and the thumbnail: the asset preview of `@dv/ui-media` with the `dv.media.preview.action` buttons, such as 插入片段 / Insert clip of `@dv/ui-timeline` and 让智能体使用 / Ask the agent to use it of `@dv/ui-composer`; nothing opens while `dvMedia` is absent |
| Click a thumbnail in the canvas's picker | The picker's `onOpen` toggles the asset in the picker; no preview opens |

Each thumbnail draws its asset through the `dv.media` Factory at purpose `thumb`, in a box of the asset's aspect ratio centered in the square cell, so a portrait image or a 16:9 video frame shows whole; an asset of unknown dimensions fills the cell. The thumbnails and the media views load the asset files from `GET /dv/assets/<AssetId>`.

The panel lists every image and video that the state lists in `assets` (every asset of the current state, and every asset that a record of the project imported, discarded records included; see the [history rules](../../../docs/subsystems/video-harness.md#history-rules)) once, in three sections, each newest first: 图片 / Images (`image/*`), 视频 / Videos (`video/*`), 从生成中截取的帧 / Extracted from generation (the images whose `made_by` is `shot.render`, such as the last still of a take). Assets of other media types are not listed. An image stays under 图片 / Images when a character, location, or style uses it, and a still of `asset.grab_still` is listed under 图片 / Images. A section without assets is hidden, and a project without assets shows 暂无 / None yet. An imported asset that an undo took out of the current state drags, inserts, and previews like any other asset, so inserting one writes a normal `timeline.clip_insert` record as a step after the current position.

Each media view fills the box of the surface that renders the `dv.media` occurrence. An image is cover-fitted at purposes `thumb` and `card`, where it loads lazily and decodes off the main thread, and at `player` and `loop` it fills the box that the surface sizes and is contained in it, where it reports its loaded size through `onSize`. A video shows its first frame, muted, inline and hidden from assistive technology, at `thumb` and `card`, with a play badge when the surface sets `playBadge`; it plays with controls and sound at `player`, and with controls, muted, and looping at `loop`, where it shows its `poster` until it plays; at `player` and `loop` it reports its loaded size. An audio asset shows a decorative note glyph at `thumb`; at `card` it shows the waveform of the whole asset (`@dv/ui-kit/waveform.ts`) with a play and pause button, and no waveform while the audio decodes, when the asset has no audio, or when its duration is 0; a source that fails to load ends the play state; at `player` and `loop` it shows an audio player. The `poster` of the `image` type is the image itself, and the `poster` of the `video` type is an image output of the record that made the video (none for an imported video); the `@` menu of `@dv/ui-composer` draws these stills as icons.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`assetLibrary` groups the assets of the state, each asset once, into images and videos; an image whose producer record (`created_by`) also output a video, such as the last frame of a rendered shot, goes to `extracted`. The state already carries this project's own import name and time of each asset (`ProjectAsset`), because the asset pool keeps the name and time of the first import of identical bytes in any project. `AssetsPanel` takes the API client `client` and the `preview` callback as required props. Without the `onOpen` prop, a click on a thumbnail calls `preview` with the thumbnail, and the plugin binds `preview` to `dvMedia.preview`; with it, the click calls `onOpen` instead, which the canvas passes to the `dv.canvas.picker` entry. The slot entries register while their slots are declared, the registry entries register while their services are present, and all of them leave with the plugin.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The Host half, which registers nothing |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | The type of the CSS Module imports |
| [`src/client/index.ts`](src/client/index.ts) | Registrations of the tab type, the tab body, the canvas's picker, card, and editor entries, the node type and its action, and the media types and their views |
| [`src/client/definition.ts`](src/client/definition.ts) | The tab type |
| [`src/client/AssetsPanel.tsx`](src/client/AssetsPanel.tsx) | The panel, the drop zone, the thumbnail grids by section, and the tab body |
| [`src/client/AssetsPanel.module.css`](src/client/AssetsPanel.module.css) | Styles of the panel |
| [`src/client/media.tsx`](src/client/media.tsx) | The image, video, and audio media types and their `dv.media.view` entries |
| [`src/client/library.ts`](src/client/library.ts) | Grouping of the project's assets by media type with the render stills apart |
| [`src/client/canvas.tsx`](src/client/canvas.tsx) | The `asset` node type, its card and editor bodies, and 从画布移除 / Remove from canvas |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/api`](../api/README.md) — the state route and the asset import route.
- [`@dv/asset-pool`](../asset-pool/README.md) — the asset pool that stores the files and serves them.
- [`@dv/ui-canvas`](../ui-canvas/README.md) — the canvas, its asset picker, and the node type and action registries.
- [`@dv/ui-kit`](../ui-kit/README.md) — the API client, the wire types, the asset drag type, and the waveform.
- [`@dv/ui-media`](../ui-media/README.md) — the `dv.media` Factory, the media type registry, and the asset preview.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the `asset.import` records that the asset pool panel's imports write reach the model only through the project state and update messages and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the panel sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Whole state per project change** — every project change refetches the whole state, the asset list included; there is no incremental asset route.
