---
description: "Asset pool component of DreamVerse: the dvAssetPool service, the content-addressed asset store with its /dv/assets route, the asset nodes it registers with the canvas node list, and the operations asset.import, asset.grab_still, asset.cut_segment and asset.place with their agent tools."
kind: "package-reference"
---

# @dv/asset-pool

English | [中文](README.zh.md)

## Summary

Use this package to keep every image, video, audio, and text file of a project exactly once and never change it. An asset's ID is the SHA-256 of its bytes, so a record that names an asset always names the same bytes. The service is Project's asset store and registers four operations with `dvProject`: `asset.import`, where a file or base64 bytes become an asset; `asset.grab_still`, where one frame of a video becomes a PNG still; `asset.cut_segment`, where the part of a video between two times becomes a new MP4 video with its sound; and `asset.place`, which puts assets on the canvas. While the DSH web server runs, the service serves asset files at `/dv/assets/<AssetId>`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project` and `@dv/ffmpeg`. Other plugins inject `dvAssetPool`. The service registers itself with `dvProject.registerAssetStore`, so the same file imported twice into one project is one asset. A project keeps its assets in its own folder, so a copy of the folder holds the whole project: `<project folder>/.dreamverse/assets/` holds the bytes at `objects/<sha256>` and one `Asset` line per asset in `index.jsonl`. `asset.import` reads the pixel size and duration of an image or video through `dvFfmpeg`, `asset.grab_still` and `asset.cut_segment` run through `dvFfmpeg`, and `dvProject` turns the four operations into the agent tools `dv_asset_import`, `dv_asset_grab_still`, `dv_asset_cut_segment` and `dv_asset_place`. The component key `asset` has no reducer: the service registers with `dvCanvasNodes` of [`@dv/canvas`](../canvas/README.md), inside `ctx.inject(['dvCanvasNodes'], …)`, that a finished `asset.import` with `place: true` and each `asset.place` make nodes of kind `asset`, and it registers `asset.place` only while that service is loaded. `canvas.node_remove` of that service takes an asset node off the canvas, and the asset stays in the pool. The `proj` slice's `created_by` names the record that created each asset. Which assets are on the canvas is project content: each placement is a record, so History lists it and undo reverts it.

```yaml
- id: dv-asset-pool
  name: '@dv/asset-pool'
  config:
    publicBaseUrl: https://demo.example
```

| Field | Default | Meaning |
| --- | --- | --- |
| `publicBaseUrl` | `''` | Base of the asset URLs that the agent and chat cards show, such as a tunnel origin; empty keeps them relative |

| Operation | Tool | Inputs and params | Outputs |
| --- | --- | --- | --- |
| `asset.import` | `dv_asset_import` | params `path` (a file on this machine) or `base64` (the bytes), `mime` (required), `name` (default: the file name), `place` (true also puts the asset on the canvas) | `asset` |
| `asset.grab_still` | `dv_asset_grab_still` | input `video`, param `at`: `first`, `last` (default), or a time in seconds | `still` (PNG) |
| `asset.cut_segment` | `dv_asset_cut_segment` | input `video`, params `in_sec` and `out_sec` (both required, seconds from the video's start); refused with `invalid_params` unless `0 <= in_sec < out_sec`; the record fails when the range holds no video frame | `segment` (MP4 with its sound, pixel size, and duration) |
| `asset.place` | `dv_asset_place` | input `asset` (one or more); refused with `invalid_inputs` for an asset that is neither imported by a record of the project (discarded records included) nor made by a step of the current state, and with `invalid_params` when every asset is already on the canvas, that is shown by a canvas node | none |

| Method | Behavior |
| --- | --- |
| `importAsset(project, bytes \| {path}, {mime, name, durationSec?, width?, height?}, createdBy)` | Stores the bytes under their hash in the project's folder and appends an index line there; identical content in the same project returns the existing ID and keeps the first asset; a project that does not exist, or whose folder holds no `.dreamverse/records.jsonl`, throws `unknown_project` before anything is written |
| `get(asset)` | The `Asset`: `id`, `mime`, `name`, `size_bytes`, `created_by`, `created_at`, `width`, `height`, `duration_sec`, and `has_audio` once `hasAudio` has read a video |
| `hasAudio(asset)` | Whether the asset holds sound: true for audio, false for an image or other file, and for a video the stored `has_audio`; the first read of a video probes it with ffprobe and appends the answer to the index |
| `mediaType(asset)` | The top-level type of the asset's MIME type, such as `video` for `video/mp4`; other packages ask the pool instead of reading the MIME type |
| `path(asset)` / `read(asset)` | The stored file's absolute path, or its bytes |
| `has(asset)` | Whether the folder of a project holds the asset |
| `url(asset)` | `<publicBaseUrl>/dv/assets/<AssetId>` |
| `grabStill(video, at, dir)` | Writes one frame of a video as `still.png` into `dir` and returns its path; the operation imports it |

Reads take an asset ID alone and find the bytes in any project folder that holds them. `get`, `hasAudio`, `mediaType`, `path`, and `read` throw `ProjectError` with code `unknown_asset` for an asset that no project folder holds. `GET /dv/assets/<AssetId>` answers the whole file with its media type and an immutable cache header; any other path or method under `/dv/assets` is 404.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`importAsset` writes the bytes to `objects/<sha>.partial` in the project's `.dreamverse/assets/` directory and renames the file into place, so a crash never leaves a half-written object under its hash. The index is one `Asset` JSON line per asset, appended after the object exists. The service replays a folder's index the first time it needs that folder and skips lines whose object file is missing. A read looks in the folders it has read; when none holds the asset, it reads the folders of the projects of `dvProject.listProjects()` that it has not read yet, such as a copied folder added after start, and looks once more. The same bytes in two projects are two files under one ID, and a read may answer either file. `asset.import` reads the width, height, and duration of an image or video that the entry does not know yet with ffprobe (`dvFfmpeg.probe`); a video whose header has no duration (a WebM file a browser recorded) is decoded once with `-progress pipe:1`, and the last `out_time` is its duration. `describe` appends the updated entry to the importing project's index, and the last line of an ID wins at replay. A probe failure leaves the facts null and does not fail the import. `grabStill` seeks to the first frame or the given time; for the last frame it probes the video and tries an input seek just before the video stream's end, then a full decode that keeps the last frame, because a fragmented MP4 from a streaming backend has no reliable duration in its header. `asset.cut_segment` runs ffmpeg with `-ss` and `-to` after `-i` and re-encodes the video with libx264 and the audio with AAC, so the segment starts and ends on the exact frames, like the clip trimming of `@dv/deliver`. It probes the segment, fails the record when the file holds no video stream (a range that starts after the video's end), and imports the segment with its pixel size and duration. The route registers on `webServer` through `ctx.inject`, so the plugin also works in compositions without a web server.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvAssetPool`: the store in the project folders, the index replay, the route, the five operations, `mediaType`, and `grabStill` |
| [`src/imports.ts`](src/imports.ts) | `importedAssets(records)`, the project's first finished `asset.import` record of each imported asset, and `placeable(state, imported, asset)`, the rule of `asset.place`; `@dv/api` and `@dv/chat-references` use both |
| [`src/types.ts`](src/types.ts) | `Asset`, one line of `index.jsonl`, and `StillAt` |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/project`](../project/README.md): operations, agent tools, and the asset store registration.
- [`@dv/ffmpeg`](../ffmpeg/README.md): the ffmpeg runner that `grabStill` and `asset.cut_segment` use.
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md): the layout this component follows.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

Four tools, `dv_asset_import`, `dv_asset_grab_still`, `dv_asset_cut_segment` and `dv_asset_place` (the last while `@dv/canvas` is loaded), in the format `@dv/project` gives every operation tool. `dv_asset_import` says "Bring a file into the asset pool: a path on this machine, or base64 bytes. Returns the asset ID to reference later." and takes `path`, `base64`, `mime` (required), `name` and `place` ("Also put the asset on the canvas."). `dv_asset_grab_still` says "Grab one frame of a video as a PNG still, to look at it or to use it as a reference." and "Runs on the CPU.", and takes the input `video` and the param `at` (`'first'`, `'last'`, or a time in seconds; default last). `dv_asset_cut_segment` says "Cut the part of a video between two times into a new video asset with its sound, for example to use it as a reference." and "Runs on the CPU.", and takes the input `video` and the required params `in_sec` and `out_sec` (seconds from the video's start). These three descriptions end with "Repeating a call with the same inputs and params reuses the earlier result." `dv_asset_place` says "Put assets of the project on the canvas, where the user sees each one as a node. The assets must come from a record in the current state of the project." It takes the input `asset`.

#### Token effect

About 1,400 tokens for the five definitions, fixed while the plugin is mounted; the shared arguments of `@dv/project` add about 200 tokens to each definition.

#### KV Cache effect

The definitions sit in the stable tool section of every agent request; mounting or removing the plugin changes the tool list and invalidates the cached prefix from the tool section on.

### Tool results

#### What the model sees

A call returns one text block: `done <record>: <summary>` (`imported face.png`, `still at last`, `segment 1–2 s`, `placed 2 asset(s) on the canvas`), one line per output with its asset ID (the SHA-256 of its bytes), media type and `/dv/assets/<AssetId>` URL, and the params. Image outputs also arrive as image blocks while an attachment service is mounted.

#### Token effect

About 80 tokens of text per call, most of it the 64-character asset ID and the URL. A `dv_asset_import` call with `base64` repeats the bytes in the echoed params, so its result costs about as much as its argument again. Each image block costs what the model charges for one image.

#### KV Cache effect

The result is appended to the conversation after the call; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No `Range` requests**: the route sends whole files; seeking inside a long video through this route downloads it from the start.
- **No deletion**: a project's unreferenced assets stay on disk; garbage collection is deferred until projects can be deleted.
- **Index grows without compaction**: the first read of a folder replays every line of its index; a project with very many assets opens slowly.
- **Removed projects stay readable until restart**: the service keeps every folder it has read, so the assets of a removed project still answer by ID until the server restarts.
