---
description: "Timeline component of DreamVerse: the dvTimeline service, the timelines of a project with their clips, video tracks and sounds, the twenty-five timeline.* edit operations and the timeline.export operation with their agent tools, and the timeline reducer."
kind: "package-reference"
---

# @dv/timeline

English | [中文](README.zh.md)

## Summary

Use this package to keep the timelines of a project: each timeline is one edited video that holds clips in playback order, and a clip is an asset with in and out points and a clip ID such as `cl3`. A timeline also holds video tracks under those clips, whose clips play at their own start times after the main clips end, and sounds, audio assets on sound tracks. The package registers twenty-six operations, the agent tools `dv_timeline_*`: twenty-five edits that never create a file, and `timeline.export`, which writes a timeline to one video through `dvFfmpeg`. Its `timeline` reducer folds the edit records into the `timeline` slice. With the DSH skill registry mounted, it also registers the `timeline-editing` skill.

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

Each operation declares the label that the interface shows in place of its tool name, such as 移动片段 / Move clip for `timeline.clip_move` and 导出时间线 / Export timeline for `timeline.export`.

The whole-timeline operations, `timeline.clip_insert` and `timeline.export` name a timeline in the param `timeline` (a timeline ID such as `t1`): it is required for `timeline.update`, `timeline.rename` and `timeline.delete`; `timeline.create` defaults it to `t1`, and `timeline.clip_insert` and `timeline.export` to the first timeline. The other clip operations name the clip by its clip ID in the param `clip`, which also names the timeline that holds it. `timeline.sound_add`, `timeline.sound_track_remove`, `timeline.sound_track_rename` and `timeline.mute` require `timeline`; `timeline.sound_remove` names the sound by its sound ID in the param `sound`. A sound track is a number: `0` is the first track under the clips' own audio, `1` the next, and so on. `timeline.track_clip_add` and `timeline.video_track_remove` require `timeline`, and `timeline.track_clip_move` names the clip by `clip`. A video track under the main video track (the 视频 track, whose clips play one after another) is a number too: `0` is the first one added, `1` the next, and so on; once there is one, the timeline editor shows the main video track as 视频 1 and video track `n` as 视频 `n` + 2.

| Operation | Tool | Params | Effect |
| --- | --- | --- | --- |
| `timeline.create` | `dv_timeline_create` | `timeline`, `name`, `assets` (asset IDs in order); input role `clip` (many) | Adds a timeline; fails when the ID exists. Without `assets` the clips are the `clip` inputs in order |
| `timeline.update` | `dv_timeline_update` | `timeline`, `assets` (asset IDs in order); input role `clip` (many) | Replaces all clips of an existing timeline with clips that get new clip IDs; keeps the name |
| `timeline.rename` | `dv_timeline_rename` | `timeline`, `name` | Sets the name |
| `timeline.delete` | `dv_timeline_delete` | `timeline` | Removes the timeline; its assets stay in the project |
| `timeline.clip_insert` | `dv_timeline_clip_insert` | `timeline`, `at`, `asset` | Inserts the asset as a clip at position `at`; creates the timeline when it does not exist |
| `timeline.clip_move` | `dv_timeline_clip_move` | `clip`, `to` | Moves a clip to position `to` of the main video track; a clip of a video track moves into it there, keeping its ID and in and out points |
| `timeline.clip_remove` | `dv_timeline_clip_remove` | `clip` | Removes a clip; later clips shift |
| `timeline.clip_split` | `dv_timeline_clip_split` | `clip`, `at_sec` | Splits a clip at a time inside its asset into two clips of the same asset; the second part gets a new clip ID |
| `timeline.clip_trim` | `dv_timeline_clip_trim` | `clip`, `in_sec`, `out_sec` | Sets the in and out points; an omitted point plays from the asset's start or to its end |
| `timeline.clip_replace` | `dv_timeline_clip_replace` | `clip`, `asset` | Puts another asset in the clip, keeps its clip ID and resets its points |
| `timeline.sound_add` | `dv_timeline_sound_add` | `timeline`, `asset`, `start_sec`, `track` (default `0`) | Places an audio asset as a sound that starts `start_sec` seconds after the timeline's start; it may overlap clips and other sounds and gets a new sound ID. Fails with "Asset <id> is not an audio file." for an asset of another media type |
| `timeline.sound_remove` | `dv_timeline_sound_remove` | `sound` | Removes a sound; its asset stays in the project |
| `timeline.sound_split` | `dv_timeline_sound_split` | `sound`, `at_sec` | Splits a sound in two at `at_sec` seconds inside its asset: the first part keeps the sound ID and ends there, the second gets a new sound ID and starts there, at the timeline time where it played; no file is created |
| `timeline.sound_move` | `dv_timeline_sound_move` | `sound`, `start_sec`, `track` | Moves a sound to `start_sec`, and with `track` to that sound track (an existing one or the one after the last) |
| `timeline.sound_trim` | `dv_timeline_sound_trim` | `sound`, `in_sec`, `out_sec` | Sets a sound's in and out points (a missing one is the asset's start or end); its start moves by as much as its in point, so the rest plays where it did; no file is created |
| `timeline.sound_track_remove` | `dv_timeline_sound_track_remove` | `timeline`, `track` | Removes a sound track with all its sounds and its name; every later track moves up one |
| `timeline.sound_track_rename` | `dv_timeline_sound_track_rename` | `timeline`, `track`, `name` | Sets the track's name, trimmed; an empty name shows the numbered default name |
| `timeline.mute` | `dv_timeline_mute` | `timeline`, `target`, `track`, `muted` | Mutes (`muted: true`) or unmutes the own audio of the main video track's clips (`target: video`), the own audio of the clips of video track `track` (`target: video_track`), or sound track `track` (`target: sound`) |
| `timeline.track_clip_add` | `dv_timeline_track_clip_add` | `timeline`, `asset`, `start_sec`, `track` | Places a video asset on video track `track` from `start_sec`; it gets a new clip ID. Fails with "Asset <id> is not a video." for an asset of another media type |
| `timeline.track_clip_move` | `dv_timeline_track_clip_move` | `clip`, `start_sec`, `track` (default: the clip's own track) | Moves a clip of a video track to `start_sec`, on video track `track`; a rendered clip of the main video track moves out of it onto `track`, which it then needs, keeping its ID and in and out points and leaving its render source behind |
| `timeline.video_track_remove` | `dv_timeline_video_track_remove` | `timeline`, `track` | Removes a video track with all its clips and its mute; every lower one moves up one |
| `timeline.video_track_move` | `dv_timeline_video_track_move` | `timeline`, `track`, `to` | Moves a video track to number `to` with its clips and its mute, so it covers the tracks after that number; the tracks between move one number toward its old one, and `track_order` stays |
| `timeline.main_track_remove` | `dv_timeline_main_track_remove` | `timeline` | Deletes the main video track's clips; video track 0 becomes the main video track, its clips joined in the order of their start times without the gaps and keeping their IDs and in and out points, its mute becoming the mute of the main track's own audio, and the other video tracks move up one number. Without video tracks, the main video track stays empty |
| `timeline.main_track_swap` | `dv_timeline_main_track_swap` | `timeline` | Swaps the main video track with video track 0: the main track's clips go onto video track 0 at the times they played, which the call stores in `report.starts` from the asset lengths, and video track 0's clips become the main track's clips in the order of their start times without the gaps; all keep their IDs, and the two mutes swap |
| `timeline.track_add` | `dv_timeline_track_add` | `timeline`, `kind` (`video` or `sound`) | Adds an empty video track or sound track under all the timeline's tracks |
| `timeline.export` | `dv_timeline_export` | `timeline` | Writes the timeline to one MP4 file, the record's output `video`; changes no timeline |

The `timeline` slice is `{timelines: Timeline[]}`; a `Timeline` is `{id, name, clips, track_clips, muted_video_tracks, track_order, sounds, sound_track_names, video_muted, muted_sound_tracks}` and a `Clip` is `{id, asset, source, in_sec, out_sec}`, where `id` is the clip ID, `source` is the render output `{record, output}` the clip was laid out from (null for a clip of an existing asset), and null points mean the asset's start and end. A clip is ready when `asset` is not null; a clip whose `asset` is null is a placeholder for a render that is not done. Its `ClipStatus` is derived from the source record and never stored: `ready`, `rendering` while the source record is pending or running, else `failed`. A `Sound` is `{id, asset, in_sec, out_sec, start_sec, track}`, where `id` is the sound ID: it plays its asset from `in_sec` to `out_sec`, starting `start_sec` seconds after the timeline's start, null points meaning the asset's start and end, and the clips' own audio plays under it. `sounds` is in the order the sounds were added, and `sound_track_names` holds the track names by track number, where a missing or empty name shows as 声音 {n}. `video_muted` says whether the clips' own audio is muted, and `muted_sound_tracks` lists the muted track numbers in ascending order. A track that holds only a mute still counts as a stored track. A `TrackClip` of `track_clips` is `{id, asset, in_sec, out_sec, start_sec, track}`: it plays its asset from `in_sec` to `out_sec`, starting `start_sec` seconds after the timeline's start, and the clips of one track never overlap. The main video track covers the track clips up to its end. After it, the timeline shows and plays the clip of the track with the lowest number there, alone; where that track has no clip, the next track shows. `clip_remove`, `clip_split`, `clip_trim` and `clip_replace` work on a track clip too: a trim of its in point moves its start by the same amount, and the second part of a split starts where the first part ends. `track_clips` is in the order the clips were added, and `muted_video_tracks` lists the muted video tracks in ascending order. `track_order` lists the kinds (`video` or `sound`) of the tracks under the main video track and its own audio, top to bottom, where the n-th `video` is video track n and the n-th `sound` is sound track n: a new timeline holds `['sound']`, `timeline.track_add` and a call that names the track after the last add a track at the bottom, and a track removal drops its entry. An entry keeps its track stored, empty or not, until a removal deletes it, so a new timeline has an empty sound track 0, a track whose last clip or sound goes stays, and a timeline whose sound tracks were all removed has none. The package exports the types `Timeline`, `Clip`, `ClipId`, `ClipStatus`, `TrackClip`, `TrackKind`, `Sound`, `SoundId`, `TimelineId`, and `TimelineState` (the slice).

`timeline.export` is not deterministic, because its output depends on the timeline's clips in the project state, which the params do not name; every call exports again. It runs in the `cpu` resource class. A call fails its record for an unknown timeline, for a project without timelines, and for a timeline without clips on its main video track. While a clip of the timeline is a placeholder, the call is refused before its record with the clip positions, such as "Clips 3, 5 of timeline t1 are not ready yet."; `exportTimeline` throws the same error. The service method `exportTimeline(timeline, dir)` writes the joined file into `dir` for other callers and returns its path.

While `@dv/canvas` is loaded, the plugin also registers `timeline.place` (tool `dv_timeline_place`, label 把时间线放到画布上 / Place timeline on canvas, required param `timeline`) and names it in `registerMaker` of `dvCanvasNodes`: each finished record makes one canvas node of kind `timeline` in layout column 3. Its precondition refuses, before any record, a timeline that does not exist ("Timeline t9 does not exist.") and a timeline that a `timeline` node already shows ("Timeline t1 is already on the canvas as node <id>."); a timeline whose node was removed with `canvas.node_remove` goes on the canvas again as a new node. The node keeps its place when its timeline is deleted. [`@dv/ui-timeline`](../ui-timeline/README.md) draws the node and puts a timeline on the canvas from the canvas's add menu.

A workflow skill, such as `story-directing` of `@dv/workflow-skills`, lays renders out with the agent tools `dv_timeline_create` and `dv_timeline_update`: each `clip` input names a render output `<record>#<output>`, and a clip whose render is not done is a placeholder until it is done.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The edit operations write only their records. Each one's `execute` checks the call against the state at the record's parent and fails the record with a reason when a created timeline exists, another named timeline or the named clip does not exist, a position is outside the timeline, a split or trim names a placeholder clip ("Clip cl3 is still rendering."), a split time is outside the clip, a trim range is empty, a named sound does not exist, a sound split time is outside the sound, a sound trim leaves an empty range or would start the sound before the timeline's start, `start_sec` is negative, `track` is not a whole number of 0 or more, `timeline.sound_track_remove` names a track the timeline does not have, `timeline.sound_add` or `timeline.sound_track_rename` names a track past the one after the last track (a new timeline, with its empty sound track 0, takes tracks 0 and 1; a timeline whose sound tracks were all removed takes tracks 0 and 1, as earlier builds did), a track name is not a string, the asset of `timeline.sound_add` is not an audio file, `timeline.mute` names a track past the one after the last track or has a `target` other than `video`, `video_track` or `sound` or a `muted` that is not a boolean, the asset of `timeline.track_clip_add` is not a video, a video track call names a track past the one under the lowest (for `timeline.video_track_remove` and both numbers of `timeline.video_track_move`, a track the timeline does not have), `timeline.main_track_remove` names a timeline with neither a main video track clip nor a video track, `timeline.main_track_swap` names a timeline without a video track, with a main video track clip still rendering ("Clip cl2 is still rendering; it cannot leave the main video track yet.") or with one whose length is not known, `timeline.track_clip_move` names a clip of the main video track without `track`, or the call would leave a track clip overlapping another clip of its track, starting before the timeline's start, or with an unknown length (an asset without a known duration and no out point), such as "The new clip would overlap clip cl4 on video track 0 (2s to 6s); pick another start_sec or track.". The operations are not `deterministic`, so the runner runs that check on every call instead of reusing an earlier record. The reducer applies each finished record and ignores records that do not apply.

**Placeholder clips.** `timeline.create` and `timeline.update` declare the `clip` input role in `OperationSpec.pendingInputRoles`, so a `clip` input may name the output of a render that is not done: the call runs at once and its record is done while the render runs. The reducer lays out each `clip` input as a clip with that `source`; the input's `resolved_asset`, and so the clip's `asset`, is null until the render is done, when the record's current form fills it. A failed render leaves the clip a placeholder. Move, remove and replace work on a placeholder; replace puts an asset in it and clears its `source`. The agent summary lists a placeholder clip as `{clip, asset: null, status, record, in_sec, out_sec}`, where `record` is the render it waits for.

**Clip IDs.** The operations that add clips assign their clip IDs in `execute` and store them in the record's `report.clips`, in clip order: one per clip for `timeline.create` and `timeline.update`, one for `timeline.clip_insert`, and one for the second part of `timeline.clip_split` (the first part keeps the clip's ID). The number after `cl` is one more than the highest number in the `report.clips` of any Timeline record anywhere in the project's history list, including the steps after the current position, and than any number assigned to a call still running, so no two clips of the history list share an ID, whichever state they were added in. The reducer reads clip IDs only from `report.clips`. A finished record whose `report.clips` does not match the clips it adds, or names an ID already in use, applies nothing.

**Sound IDs.** `timeline.sound_add` and `timeline.sound_split` each assign one sound ID such as `sd2` in `execute` and stores it in the record's `report.sounds`. The number after `sd` follows the clip ID rule over the `report.sounds` of the history list and the calls still running, so sound IDs are also unique within the project and never reused. A finished record whose `report.sounds` does not hold exactly one ID for `timeline.sound_add` or `timeline.sound_split` and none for any other operation, or names an ID already in use, applies nothing.

**Export.** `exportTimeline` takes the file of each clip from the asset pool. A clip whose `in_sec` and `out_sec` are both null plays the whole asset and uses the asset's file as it is. Any other clip is trimmed into a new file in the operation's `scratchDir` with the seek after `-i` and re-encoding (H.264 in yuv420p, AAC audio, or no audio while `video_muted` is on), so the trim lands on the exact frame. The clip files are then joined with the concat demuxer and stream copy. When ffmpeg rejects the stream copy, for example because the files disagree on codec, the concat filter re-encodes the video of every file at the first file's frame size, scaled and padded, and the joined file has no audio. When a track clip ends after the joined video, the joined video gets black frames up to the last such clip's end, and the file of each such clip (trimmed the same way, without audio while its track is muted) is scaled to fit the frame with black bars and drawn from the joined video's end to its own end, the highest track number first, so a track with a lower number covers those with higher numbers. A track clip that ends before the joined video stays out. The audio follows the picture: the audio of each drawn clip is silenced up to the joined video's end and where a clip of a track with a lower number plays, and the rest is mixed with the main video track's audio. The operation probes the result and imports it with its duration and frame size, named after the timeline's name. The export leaves out the timeline's sounds, and while `video_muted` is on, the stream copy leaves out the clips' own audio too (`-an`), so the joined file has no audio either way. The reducer ignores export records.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvTimeline`: the twenty-five edit operation specs, the registration of all twenty-six operations, and clip and sound ID assignment |
| [`src/export.ts`](src/export.ts) | The `timeline.export` operation spec and `exportTimeline` |
| [`src/place.ts`](src/place.ts) | The `timeline.place` operation spec and the node maker of `timeline` nodes |
| [`src/reducer.ts`](src/reducer.ts) | The `timeline` reducer and the clip and sound checks it shares with the operations |
| [`src/types.ts`](src/types.ts) | `Timeline`, `Clip`, `ClipId`, `Sound`, `SoundId`, `TimelineId`, and the `timeline` slice declaration |
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

Twenty-six tools, `dv_timeline_create`, `dv_timeline_update`, `dv_timeline_rename`, `dv_timeline_delete`, `dv_timeline_clip_insert`, `dv_timeline_clip_move`, `dv_timeline_clip_remove`, `dv_timeline_clip_split`, `dv_timeline_clip_trim`, `dv_timeline_clip_replace`, `dv_timeline_sound_add`, `dv_timeline_sound_remove`, `dv_timeline_sound_split`, `dv_timeline_sound_move`, `dv_timeline_sound_trim`, `dv_timeline_sound_track_remove`, `dv_timeline_sound_track_rename`, `dv_timeline_mute`, `dv_timeline_track_clip_add`, `dv_timeline_track_clip_move`, `dv_timeline_video_track_remove`, `dv_timeline_video_track_move`, `dv_timeline_main_track_remove`, `dv_timeline_main_track_swap`, `dv_timeline_track_add` and `dv_timeline_export`, in the format `@dv/project` gives every operation tool. The edit tools name a timeline by `timeline` (such as `t1`; default the first timeline) and a clip by `clip` (such as `cl3`), and their parameter descriptions point the agent to `timelines` and their `clips` in `dv_proj_state`; `dv_timeline_sound_remove` names a sound by `sound` (such as `sd2`) from the `sounds` of `timelines`. The description of `dv_timeline_sound_add` ends with "The exported video does not include sounds yet.". The description of `dv_timeline_export` says "Export a timeline to one video: each clip with an in or out point is trimmed to that range, the clips of the main video track are joined in timeline order, and the clips of the video tracks under it play after its end, a track with a lower number covering those with higher numbers, picture and audio. Muted audio (dv_timeline_mute) is left out. The sound tracks are not included yet. Runs on the CPU.", and its only own param is `timeline`. The description of `dv_timeline_track_clip_add` says that track 0 is the first track under the main one and that the user sees and hears the clip only after the main track's last clip ends, where no track with a lower number has a clip. While `@dv/canvas` is loaded, a twenty-seventh tool, `dv_timeline_place`, has the description "Put a timeline on the canvas as one node. The node shows the timeline's picture and tracks in small, with a line from each node whose output the timeline plays; selecting the node outlines those nodes. A timeline goes on the canvas once, and its node stays until dv_canvas_node_remove takes it off. Works whether or not the user has a canvas open. The change is a step of the project history, so dv_proj_undo reverts it." and the one own param `timeline`.

#### Token effect

About 6,000 tokens for the twenty-six definitions, and about 300 more for `dv_timeline_place` while `@dv/canvas` is loaded, fixed while the plugin is mounted; the shared arguments of `@dv/project` add up to about 200 tokens to each definition.

#### KV Cache effect

The definitions sit in the stable tool section of every agent request; mounting or removing the plugin changes the tool list and invalidates the cached prefix from the tool section on.

### Tool results

#### What the model sees

A call returns one text block with the record's status and a one-line summary such as `clip cl3 moved to 1`; a call that adds clips also returns their clip IDs in `report.clips`, and `dv_timeline_sound_add` returns `t1 sound sd2 added at 3s` with the sound ID in `report.sounds`; and a call that does not fit the timeline returns a tool error with the failed record's reason. `dv_timeline_export` returns `done <record>: exported timeline t1` (`exported the first timeline` without `timeline`), the line `- video: <AssetId> (video/mp4) <url>`, and the params; the video sends no image block. `dv_proj_state` lists every timeline with its clips by clip ID (field `clip`), and the agent's project block lists them with each clip's producing record; a placeholder clip shows its status (`rendering` or `failed`) and the render record it waits for instead of an asset. A timeline with sound tracks, a new one included, also lists `sound_tracks` as `{track, name}` for each track, with `''` for an unnamed track and `muted: true` on a muted track, a timeline whose clips' own audio is muted shows `video_muted: true`, a timeline with video tracks under the main one lists `video_tracks` as `{track, clips}` for each track, track 0 first, with `muted: true` on a muted track and each clip as `{clip, asset, url, start_sec, in_sec, out_sec}` by start time, and a timeline with sounds lists `sounds` as `{sound, asset, url, start_sec, in_sec, out_sec, track}`; a timeline without them leaves the fields out. `dv_timeline_place` returns `done <record>: t1 placed on the canvas` and the params, and its refusals return a tool error with the precondition's message; the new node shows in the `canvas` field of `dv_proj_state` with kind `timeline`.

#### Token effect

Roughly 50 to 150 tokens per call; a create or update with many clips adds its asset list. An export call returns about 80 tokens.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact.

### Skill

#### What the model sees

The skill catalog lists `timeline-editing` with its description and when to use it. When the agent loads the skill, it reads a table from the user's editing phrasings (trims, retakes, reference and style changes, reordering, deletion, going back to an earlier take, undo, redo, muting, export) to the `dv_*` calls in order and their required arguments, and the rules that apply to every row. A retake calls `dv_shot_render` with the model and task of the record that produced the clip.

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
- **Export has no sounds**: `timeline.export` writes only the clips and their own audio, so the exported video leaves out every sound.
- **Video tracks take existing assets only**: a render that is not done cannot go on a video track under the main one, no operation moves a clip between the main video track and those tracks, and a track clip always fills the frame; there is no position, size or opacity.
- **Sounds play at full volume**: no operation sets a sound's volume or fades it in or out.
- **The skill does not cover sounds**: the `timeline-editing` skill maps no phrasing to the sound tools.
