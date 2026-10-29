---
description: "Timeline component of DreamVerse: the dvTimeline service, the timelines of a project and their clips, the ten timeline.* edit operations and the timeline.export operation with their agent tools, and the timeline reducer."
kind: "package-reference"
---

# @dv/timeline

English | [中文](README.zh.md)

## Summary

Use this package to keep the timelines of a project: each timeline is one edited video that holds clips in playback order, and a clip is an asset with in and out points and a clip ID such as `cl3`. The package registers eleven operations, which become the agent tools `dv_timeline_*`: ten edits that never create a file, and `timeline.export`, which writes a timeline to one video through `dvFfmpeg`. Its `timeline` reducer folds the edit records into the `timeline` slice. With the DSH skill registry mounted, it also registers the `timeline-editing` skill, which maps editing phrasings to exact `dv_*` calls. Each operation declares the label that the interface shows in place of its tool name, such as 移动片段 / Move clip for `timeline.clip_move` and 导出时间线 / Export timeline for `timeline.export`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project`, `@dv/ffmpeg`, and the asset pool `@dv/asset-pool`. It has no configuration. While the skill registry `skills` of `@deepseek-ai/dsh-skill` is mounted, the plugin registers the `timeline-editing` skill from [`skills/timeline-editing/SKILL.md`](skills/timeline-editing/SKILL.md) with `ctx.skills.register`; without the registry the operations work and no skill is registered.

```yaml
- id: dv-timeline
  name: '@dv/timeline'
```

The whole-timeline operations, `timeline.clip_insert` and `timeline.export` name a timeline in the param `timeline` (a timeline ID such as `t1`): it is required for `timeline.update`, `timeline.rename` and `timeline.delete`; `timeline.create` defaults it to `t1`, and `timeline.clip_insert` and `timeline.export` to the first timeline. The other clip operations name the clip by its clip ID in the param `clip`, which also names the timeline that holds it.

| Operation | Tool | Params | Effect |
| --- | --- | --- | --- |
| `timeline.create` | `dv_timeline_create` | `timeline`, `name`, `assets` (asset IDs in order); input role `clip` (many) | Adds a timeline; fails when the ID exists. Without `assets` the clips are the `clip` inputs in order |
| `timeline.update` | `dv_timeline_update` | `timeline`, `assets` (asset IDs in order); input role `clip` (many) | Replaces all clips of an existing timeline with clips that get new clip IDs; keeps the name |
| `timeline.rename` | `dv_timeline_rename` | `timeline`, `name` | Sets the name |
| `timeline.delete` | `dv_timeline_delete` | `timeline` | Removes the timeline; its assets stay in the project |
| `timeline.clip_insert` | `dv_timeline_clip_insert` | `timeline`, `at`, `asset` | Inserts the asset as a clip at position `at`; creates the timeline when it does not exist |
| `timeline.clip_move` | `dv_timeline_clip_move` | `clip`, `to` | Moves a clip to position `to` |
| `timeline.clip_remove` | `dv_timeline_clip_remove` | `clip` | Removes a clip; later clips shift |
| `timeline.clip_split` | `dv_timeline_clip_split` | `clip`, `at_sec` | Splits a clip at a time inside its asset into two clips of the same asset; the second part gets a new clip ID |
| `timeline.clip_trim` | `dv_timeline_clip_trim` | `clip`, `in_sec`, `out_sec` | Sets the in and out points; an omitted point plays from the asset's start or to its end |
| `timeline.clip_replace` | `dv_timeline_clip_replace` | `clip`, `asset` | Puts another asset in the clip, keeps its clip ID and resets its points |
| `timeline.export` | `dv_timeline_export` | `timeline` | Writes the timeline to one MP4 file, the record's output `video`; changes no timeline |

The `timeline` slice is `{timelines: Timeline[]}`; a `Timeline` is `{id, name, clips}` and a `Clip` is `{id, asset, source, in_sec, out_sec}`, where `id` is the clip ID, `source` is the render output `{record, output}` the clip was laid out from (null for a clip of an existing asset), and null points mean the asset's start and end. A clip is ready when `asset` is not null; a clip whose `asset` is null is a placeholder for a render that is not done. Its `ClipStatus` is derived from the source record and never stored: `ready`, `rendering` while the source record is pending or running, else `failed`. The package exports the types `Timeline`, `Clip`, `ClipId`, `ClipStatus`, `TimelineId`, and `TimelineState` (the slice).

`timeline.export` is not deterministic, because its output depends on the timeline's clips in the project state, which the params do not name; every call exports again. It runs in the `cpu` resource class and never asks for confirmation. A call fails its record for an unknown timeline, for a project without timelines, and for a timeline without clips. While a clip of the timeline is a placeholder, the call is refused before its record with the clip positions, such as "Clips 3, 5 of timeline t1 are not ready yet."; `exportTimeline` throws the same error. The service method `exportTimeline(timeline, dir)` writes the joined file into `dir` for other callers and returns its path.

A workflow skill, such as `story-directing` of `@dv/workflow-skills`, lays renders out with the agent tools `dv_timeline_create` and `dv_timeline_update`: each `clip` input names a render output `<record>#<output>`, and a clip whose render is not done is a placeholder until it is done.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The edit operations write only their records. Each one's `execute` checks the call against the state at the record's parent and fails the record with a reason when a created timeline exists, another named timeline or the named clip does not exist, a position is outside the timeline, a split or trim names a placeholder clip ("Clip cl3 is still rendering."), a split time is outside the clip, or a trim range is empty. The operations are not `deterministic`, so the runner runs that check on every call instead of reusing an earlier record. The reducer applies each finished record and ignores records that do not apply.

**Placeholder clips.** `timeline.create` and `timeline.update` declare the `clip` input role in `OperationSpec.pendingInputRoles`, so a `clip` input may name the output of a render that is not done: the call runs at once and its record is done while the render runs. The reducer lays out each `clip` input as a clip with that `source`; the input's `resolved_asset`, and so the clip's `asset`, is null until the render is done, when the record's current form fills it. A failed render leaves the clip a placeholder. Move, remove and replace work on a placeholder; replace puts an asset in it and clears its `source`. The agent summary lists a placeholder clip as `{clip, asset: null, status, record, in_sec, out_sec}`, where `record` is the render it waits for.

**Clip IDs.** The operations that add clips assign their clip IDs in `execute` and store them in the record's `report.clips`, in clip order: one per clip for `timeline.create` and `timeline.update`, one for `timeline.clip_insert`, and one for the second part of `timeline.clip_split` (the first part keeps the clip's ID). The number after `cl` is one more than the highest number in the `report.clips` of any Timeline record anywhere in the project's history list, including the steps after the current position, and than any number assigned to a call still running, so no two clips of the history list share an ID, whichever state they were added in. The reducer reads clip IDs only from `report.clips`. A finished record whose `report.clips` does not match the clips it adds, or names an ID already in use, applies nothing.

**Export.** `exportTimeline` takes the file of each clip from the asset pool. A clip whose `in_sec` and `out_sec` are both null plays the whole asset and uses the asset's file as it is. Any other clip is trimmed into a new file in the operation's `scratchDir` with the seek after `-i` and re-encoding (H.264 in yuv420p, AAC audio), so the trim lands on the exact frame. The clip files are then joined with the concat demuxer and stream copy. When ffmpeg rejects the stream copy, for example because the files disagree on codec, the concat filter re-encodes the video of every file at the first file's frame size, scaled and padded. The operation probes the joined file and imports it with its duration and frame size, named after the timeline's name. The reducer ignores export records.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvTimeline`: the ten edit operation specs, the registration of all eleven operations, and clip ID assignment |
| [`src/export.ts`](src/export.ts) | The `timeline.export` operation spec and `exportTimeline` |
| [`src/reducer.ts`](src/reducer.ts) | The `timeline` reducer and the clip checks it shares with the operations |
| [`src/types.ts`](src/types.ts) | `Timeline`, `Clip`, `ClipId`, `TimelineId`, and the `timeline` slice declaration |
| [`skills/timeline-editing/SKILL.md`](skills/timeline-editing/SKILL.md) | The body of the `timeline-editing` skill |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/project`](../project/README.md): operations, reducers, undo, and agent tools.
- [`@dv/ffmpeg`](../ffmpeg/README.md): `run` and `probe`, which the export uses.
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md): the layout this package follows.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

Eleven tools, `dv_timeline_create`, `dv_timeline_update`, `dv_timeline_rename`, `dv_timeline_delete`, `dv_timeline_clip_insert`, `dv_timeline_clip_move`, `dv_timeline_clip_remove`, `dv_timeline_clip_split`, `dv_timeline_clip_trim`, `dv_timeline_clip_replace` and `dv_timeline_export`, in the format `@dv/project` gives every operation tool. The edit tools name a timeline by `timeline` (such as `t1`; default the first timeline) and a clip by `clip` (such as `cl3`), and their parameter descriptions point the agent to `timelines` and their `clips` in `dv_proj_state`. The description of `dv_timeline_export` says "Export a timeline to one video: each clip with an in or out point is trimmed to that range, and all clips are joined in timeline order. Runs on the CPU.", and its only own param is `timeline`.

#### Token effect

About 2,750 tokens for the eleven definitions, fixed while the plugin is mounted; the shared arguments of `@dv/project` add up to about 200 tokens to each definition.

#### KV Cache effect

The definitions sit in the stable tool section of every agent request; mounting or removing the plugin changes the tool list and invalidates the cached prefix from the tool section on.

### Tool results

#### What the model sees

A call returns one text block with the record's status and a one-line summary such as `clip cl3 moved to 1`; a call that adds clips also returns their clip IDs in `report.clips`, and a call that does not fit the timeline returns a tool error with the failed record's reason. `dv_timeline_export` returns `done <record>: exported timeline t1` (`exported the first timeline` without `timeline`), the line `- video: <AssetId> (video/mp4) <url>`, and the params; the video sends no image block. `dv_proj_state` lists every timeline with its clips by clip ID (field `clip`), and the agent's project block lists them with each clip's producing record; a placeholder clip shows its status (`rendering` or `failed`) and the render record it waits for instead of an asset.

#### Token effect

Roughly 50 to 150 tokens per call; a create or update with many clips adds its asset list. An export call returns about 80 tokens.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact.

### Skill

#### What the model sees

The skill catalog lists `timeline-editing` with its description and when to use it. When the agent loads the skill, it reads a table from the user's editing phrasings (trims, retakes, reference and style changes, reordering, deletion, going back to an earlier take, undo, redo, export) to the `dv_*` calls in order and their required arguments, and the rules that apply to every row. A retake calls `dv_shot_render` with the model and task of the record that produced the clip.

#### Token effect

About 60 tokens in the skill catalog while the plugin is mounted; about 1,800 tokens each time the agent loads the skill.

#### KV Cache effect

The catalog entry sits in the stable skill section; mounting or removing the plugin changes the catalog. A loaded skill is appended to the conversation as a tool result; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Assets are params, not inputs**: `asset` and `assets` are recorded as params, so a clip does not make its record stale when the asset's producer is superseded.
- **Video-only join fallback**: when stream copy fails, the re-encoding fallback of `timeline.export` drops audio, so the exported video has no sound.
- **Stream copy accepts some mismatched files**: ffmpeg copies clips of different frame sizes without an error, and players then show the later clips at the wrong size; only a rejected copy falls back to re-encoding.
- **No GPU encoders**: export trims and the fallback join re-encode with `libx264` on the CPU.
