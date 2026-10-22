# Assets

English | [中文](assets.zh.md)

[`@dv/asset-pool`](../../../packages/dv/asset-pool/README.md) provides the `dvAssetPool` Cordis service. The service stores every asset of every project and serves the asset files at `GET /dv/assets/<AssetId>`. The service also owns the component key `asset` with its reducer and five operations. [`@dv/ffmpeg`](../../../packages/dv/ffmpeg/README.md) provides the `dvFfmpeg` service, which runs ffmpeg and ffprobe for operations. `@dv/project` reads and writes the pool through the asset store that the pool registers with `dvProject.registerAssetStore`. `@dv/api`, `@dv/chat-references`, `@dv/fastvideo`, `@dv/inspector`, and `@dv/timeline` inject `dvAssetPool`. `@dv/asset-pool`, `@dv/inspector`, and `@dv/timeline` inject `dvFfmpeg`. The package READMEs hold the configuration, the methods, and the operation params.

## What an asset is

An asset is one file: an image, a video, an audio file, or a text file. The pool derives the ID of an asset, `AssetId`, from a hash of the bytes of the asset ([package README](../../../packages/dv/asset-pool/README.md)). `@dv/project` defines `AssetId`, because records name assets, and the pool exports it again. The pool never changes the bytes of an asset, so a record that names an asset always names the same bytes. When two imports have identical bytes, they give one asset, and the pool keeps the name and the creator of the first import.

The pool stores one `Asset` for each asset. `Asset` is in `packages/dv/asset-pool/src/types.ts`:

| Field             | Meaning                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `id`              | The `AssetId`; also the file name under `objects/`                                                |
| `mime`            | The media type, such as `image/png` or `video/mp4`                                                |
| `name`            | The display name of the first import, such as the file name or `still.png`                        |
| `size_bytes`      | The size of the file in bytes                                                                     |
| `created_by`      | The record that stored the bytes first, in any project, or null for bytes stored outside a record |
| `created_at`      | The time of the first import, ISO-8601 UTC                                                        |
| `width`, `height` | The pixel size of an image or a video, or null when it is not known                               |
| `duration_sec`    | The duration of audio or video in seconds, or null when it is not known                           |
| `has_audio`       | Whether a video holds sound; absent until `dvAssetPool.hasAudio` first reads the video            |

The `created_by` field of `Asset` is a fact of the pool. In one project, the `created_by` map of the `proj` slice names the record that created each asset ([project state](project.md#project-state)). The two values can differ. For example, the import route of `@dv/api` stores the bytes with `created_by: null` before its `asset.import` record runs.

## Where the files are

One pool serves all projects. The `root` setting of `dvAssetPool` names its directory. The DreamVerse bundle sets `root` to `$DV_STATE_ROOT/assets`, beside the `projects` and `sessions` directories of `dvProject`.

| Path                       | Content                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `<root>/objects/<AssetId>` | The bytes of one asset. The pool writes `<AssetId>.partial` and renames it, so a crash never leaves a part of a file under the ID |
| `<root>/index.jsonl`       | One `Asset` line for each asset. A later line for the same ID adds media facts, and the last line wins when the pool starts       |

The agent and the chat cards get the URL `<publicBaseUrl>/dv/assets/<AssetId>` from `dvAssetPool.url`.

## Operations

The `asset` component registers five operations. The [package README](../../../packages/dv/asset-pool/README.md#use-this-package) gives their inputs and params.

| Operation           | What it does                                                                                           | Writes an asset    |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------------------ |
| `asset.import`      | Makes a file on this machine, or base64 bytes, into an asset; with `place`, also puts it on the canvas | The imported asset |
| `asset.grab_still`  | Makes one frame of a video into a PNG still                                                            | The still          |
| `asset.cut_segment` | Makes the part of a video between two times into an MP4 video with its sound                           | The segment        |
| `asset.place`       | Puts assets on the canvas                                                                              | None               |
| `asset.unplace`     | Takes assets off the canvas; the assets stay in the pool                                               | None               |

The `asset` slice holds `placed`, the list of the assets on the canvas of the current state in the order of placement. Because each placement is a record, an undo takes a placement back.

Three paths import a file. Each path writes one `asset.import` record:

1. The agent calls `dv_asset_import`.
2. The asset pool panel or a file dropped on the canvas sends `POST /api/dv/assets/import` to `@dv/api`. A file from the canvas also goes on the canvas.
3. `@dv/chat-references` imports each image that the user attaches in the chat, as the user, and puts it on the canvas.

Other operations write generated assets. An operation writes its files into `OperationContext.scratchDir` and calls `context.importAsset`. The runner binds that call to the running record, so each generated asset has a record as its creator.

<a id="imported-and-generated-assets"></a>
## Imported and generated assets

An imported asset is an output of an `asset.import` record. A generated asset is an output of any other record. [History rule 4](project.md#history-rules) tells which of them a project shows. `packages/dv/asset-pool/src/imports.ts` applies the rule for the packages that list or place assets:

- `importedAssets(records)` maps each asset that the project imported to the first finished `asset.import` record that output it. It reads every record of the project, discarded records included.
- `placeable(state, imported, asset)` is true for an imported asset and for an asset that a record of the current state created. `asset.place` refuses other assets with `invalid_inputs`.

`mentionedAssets` in `packages/dv/api/src/wire.ts` collects the `assets` of the wire state. The list holds every asset of the current state, every imported asset, and the asset of each timeline clip. The assets of the current state are the outputs and the resolved inputs of its records. Each entry is the `Asset` with the `name` and `created_at` of the first import in this project, when the project imported it. The entry also holds `made_by`. `made_by` is the operation of the record of the current state that created the asset, else `asset.import` for an imported asset, else null.

## What `@dv/ffmpeg` gives other packages

`dvFfmpeg` has two methods. `run` executes one ffmpeg or ffprobe command over input paths and writes declared outputs into a directory that the caller gives. `probe` reads the duration, the pixel size, the video codec, and the audio presence of a file. A failed command, or a declared output that the command did not write, throws `FfmpegError` with the stderr of the command. The service never reads the pool or a project. The operation that calls it imports the output files with `context.importAsset`, so each file links to its record.

| Package          | What it uses `dvFfmpeg` for                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `@dv/asset-pool` | The pixel size and the duration at import, `asset.grab_still`, `asset.cut_segment`, and `hasAudio` |
| `@dv/inspector`  | The media facts of an asset                                                                        |
| `@dv/timeline`   | The export of a timeline                                                                           |
