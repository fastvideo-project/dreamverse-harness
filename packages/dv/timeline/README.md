---
description: "Timeline component of DreamVerse: the dvTimeline service, the timelines of a project with the clips of their video tracks and the sounds of their sound tracks, the twenty-two timeline.* edit operations and the timeline.export operation with their agent tools, and the timeline reducer."
kind: "package-reference"
---

# @dv/timeline

English | [中文](README.zh.md)

## Summary

Use this package to keep the timelines of a project, each one edited video. Video tracks hold clips, assets with in and out points that play from their start times and have clip IDs such as `cl3`; a clip covers the tracks with higher numbers. Sound tracks hold sounds. It registers twenty-three operations, the agent tools `dv_timeline_*`: twenty-two edits that never create a file, and `timeline.export`, which writes a timeline to one video through `dvFfmpeg`. Its `timeline` reducer folds the edit records into the `timeline` slice. It also registers the `timeline-editing` skill while the DSH skill registry is mounted.

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

The whole-timeline operations, `timeline.clip_add` and `timeline.export` name a timeline in the param `timeline` (a timeline ID such as `t1`): it is required for `timeline.update`, `timeline.rename`, `timeline.delete` and `timeline.clip_add`; `timeline.create` defaults it to `t1`, and `timeline.export` to the first timeline. The other clip operations name the clip by its clip ID in the param `clip`, which also names the timeline that holds it. `timeline.sound_add`, `timeline.sound_track_remove`, `timeline.sound_track_rename`, `timeline.mute`, `timeline.volume`, `timeline.track_add`, `timeline.video_track_remove` and `timeline.video_track_move` require `timeline`; `timeline.sound_remove` names the sound by its sound ID in the param `sound`. A video track is a number: `0` is the top track, which the timeline editor shows as 视频 1 (视频 while it is the only video track), `1` the next one, shown as 视频 2, and so on. A sound track is a number too: `0` is the first sound track, `1` the next, and so on.

| Operation | Tool | Params | Effect |
| --- | --- | --- | --- |
| `timeline.create` | `dv_timeline_create` | `timeline`, `name`, `assets` (asset IDs in order); input role `clip` (many) | Adds a timeline whose clips play one after another on video track 0 from 0 s; fails when the ID exists. Without `assets` the clips are the `clip` inputs in order |
| `timeline.update` | `dv_timeline_update` | `timeline`, `assets` (asset IDs in order); input role `clip` (many) | Replaces the clips of video track 0 of an existing timeline with clips one after another from 0 s that get new clip IDs; keeps the name and the other tracks |
| `timeline.rename` | `dv_timeline_rename` | `timeline`, `name` | Sets the name |
| `timeline.delete` | `dv_timeline_delete` | `timeline` | Removes the timeline; its assets stay in the project |
| `timeline.clip_add` | `dv_timeline_clip_add` | `timeline`, `asset`, `track`, `start_sec` | Places a video asset as a clip on video track `track` (an existing one or the one after the last) from `start_sec`; it gets a new clip ID. Creates no timeline. Fails with "Asset <id> is not a video." for an asset of another media type |
| `timeline.clip_move` | `dv_timeline_clip_move` | `clip`, `start_sec`, `track` (default: the clip's own track) | Moves a clip to `start_sec`, and with `track` to that video track (an existing one or the one after the last), keeping its ID and in and out points; the other clips keep their times |
| `timeline.clip_remove` | `dv_timeline_clip_remove` | `clip` | Removes a clip; the other clips keep their times, so a gap stays where it played |
| `timeline.clip_split` | `dv_timeline_clip_split` | `clip`, `at_sec` | Splits a clip at a time inside its asset into two clips of the same asset; the second part gets a new clip ID and starts at the clip's start plus `at_sec` minus its in point, where it played |
| `timeline.clip_trim` | `dv_timeline_clip_trim` | `clip`, `in_sec`, `out_sec` | Sets the in and out points; an omitted point plays from the asset's start or to its end. A new in point moves the clip's start by as much, so the rest plays where it did, and a shorter clip leaves a gap |
| `timeline.clip_replace` | `dv_timeline_clip_replace` | `clip`, `asset` | Puts another video asset in the clip, keeps its clip ID, track and start, and resets its points; a shorter asset leaves a gap. Fails with "Asset <id> is not a video." for an asset of another media type |
| `timeline.sound_add` | `dv_timeline_sound_add` | `timeline`, `asset`, `start_sec`, `track` (default `0`) | Places an audio asset as a sound that starts `start_sec` seconds after the timeline's start; it may overlap clips and other sounds and gets a new sound ID. Fails with "Asset <id> is not an audio file." for an asset of another media type |
| `timeline.sound_remove` | `dv_timeline_sound_remove` | `sound` | Removes a sound; its asset stays in the project |
| `timeline.sound_split` | `dv_timeline_sound_split` | `sound`, `at_sec` | Splits a sound in two at `at_sec` seconds inside its asset: the first part keeps the sound ID and ends there, the second gets a new sound ID and starts there, at the timeline time where it played; no file is created |
| `timeline.sound_move` | `dv_timeline_sound_move` | `sound`, `start_sec`, `track` | Moves a sound to `start_sec`, and with `track` to that sound track (an existing one or the one after the last) |
| `timeline.sound_trim` | `dv_timeline_sound_trim` | `sound`, `in_sec`, `out_sec` | Sets a sound's in and out points (a missing one is the asset's start or end); its start moves by as much as its in point, so the rest plays where it did; no file is created |
| `timeline.sound_track_remove` | `dv_timeline_sound_track_remove` | `timeline`, `track` | Removes a sound track with all its sounds and its name; every later track moves up one |
| `timeline.sound_track_rename` | `dv_timeline_sound_track_rename` | `timeline`, `track`, `name` | Sets the track's name, trimmed; an empty name shows the numbered default name |
| `timeline.mute` | `dv_timeline_mute` | `timeline`, `target` (`video_track` or `sound`), `track`, `muted` | Mutes (`muted: true`) or unmutes the own audio of the clips of video track `track` (`target: video_track`; track 0 is the own audio of 视频 1), or sound track `track` (`target: sound`); the track is an existing one or the one after the last |
| `timeline.volume` | `dv_timeline_volume` | `timeline`, `target` (`video_track` or `sound`), `track`, `volume_db` | Sets the volume of the own audio of the clips of video track `track` (`target: video_track`) or of sound track `track` (`target: sound`), in dB from -40 to 0, where 0 dB is the audio as recorded; the preview and the export play the track at it. The track is an existing one or the one after the last |
| `timeline.track_add` | `dv_timeline_track_add` | `timeline`, `kind` (`video` or `sound`) | Adds an empty video track or sound track under all the timeline's tracks |
| `timeline.video_track_remove` | `dv_timeline_video_track_remove` | `timeline`, `track` | Removes a video track, track 0 included, with all its clips and its mute; every track with a higher number moves up one, so removing track 0 makes track 1 the top track |
| `timeline.video_track_move` | `dv_timeline_video_track_move` | `timeline`, `track`, `to` | Moves a video track, track 0 included, to the existing number `to` with its clips, its mute and its volume, so it covers the tracks with higher numbers; the tracks between move one number toward its old one, and `track_order` stays |
| `timeline.export` | `dv_timeline_export` | `timeline` | Writes the timeline to one MP4 file, the record's output `video`; changes no timeline |

The `timeline` slice is `{timelines: Timeline[]}`; a `Timeline` is `{id, name, clips, muted_video_tracks, video_track_volumes, track_order, sounds, sound_track_names, muted_sound_tracks, sound_track_volumes}` and a `Clip` is `{id, asset, source, in_sec, out_sec, start_sec, track}`, where `id` is the clip ID, `source` is the render output `{record, output}` the clip was laid out from (null for a clip of an existing asset), null points mean the asset's start and end, `start_sec` is the timeline time in seconds at which the clip starts, and `track` is its video track (0 for 视频 1, the top track). A clip is ready when `asset` is not null; a clip whose `asset` is null is a placeholder for a render that is not done. Its `ClipStatus` is derived from the source record and never stored: `ready`, `rendering` while the source record is pending or running, else `failed`. `clips` holds the clips of every video track in the order they were added. Where a clip plays, it covers the clips of every track with a higher number, picture and audio; a gap shows the track below, and where no clip plays the timeline is black and silent. Edits never move another clip: a removal, a shorter trim and a shorter replacement leave a gap. A trim of the in point moves that clip's start by the same amount, and the second part of a split starts at the clip's start plus the split time minus its in point. `placeClips` gives where each clip plays: from its `start_sec`, or where the clip before it on its track ends when that is later, so a render that comes out longer than planned pushes the later clips of its track back only as far as needed. `clipLength` gives how long a clip plays: from its in point to its out point, else to the asset's duration, else to the planned `params.duration_sec` of the render it waits for, else to 5 s; at least 0.1 s. A `Sound` is `{id, asset, in_sec, out_sec, start_sec, track}`, where `id` is the sound ID: it plays its asset from `in_sec` to `out_sec`, starting `start_sec` seconds after the timeline's start, null points meaning the asset's start and end, and the clips' own audio plays under it. `sounds` is in the order the sounds were added, and `sound_track_names` holds the track names by track number, where a missing or empty name shows as 声音 {n}. `muted_video_tracks` lists the video tracks whose clips' own audio is muted, and `muted_sound_tracks` the muted sound tracks, each in ascending order. `video_track_volumes` and `sound_track_volumes` hold each track's volume in dB by track number, from -40 to 0, where a missing entry is 0 dB; a volume stays with its track when a video track moves, and a track removal drops it. A track that holds only a mute still counts as a stored track. `track_order` lists the kinds (`video` or `sound`) of all tracks, top to bottom, where the n-th `video` is video track n and the n-th `sound` is sound track n: a new timeline holds `['video', 'sound']`, `timeline.track_add` and a call that names the track after the last add a track at the bottom, and a track removal drops its entry. An entry keeps its track stored, empty or not, until a removal deletes it, so a new timeline has an empty video track 0 and an empty sound track 0, a track whose last clip or sound goes stays, and a timeline whose tracks of one kind were all removed has none of that kind. The package exports the types `Timeline`, `Clip`, `ClipId`, `ClipStatus`, `TrackKind`, `Sound`, `SoundId`, `TimelineId`, and `TimelineState` (the slice).

`timeline.export` is not deterministic, because its output depends on the timeline's clips in the project state, which the params do not name; every call exports again. It runs in the `cpu` resource class. A call fails its record for an unknown timeline, for a project without timelines, and for a timeline without clips. While a clip of the timeline is a placeholder, the call is refused before its record with the IDs of the placeholder clips, such as "Clips cl3, cl5 of timeline t1 are not ready yet."; `exportTimeline` throws the same error. The service method `exportTimeline(timeline, dir)` writes the exported file into `dir` for other callers and returns its path.

While `@dv/canvas` is loaded, the plugin also registers `timeline.place` (tool `dv_timeline_place`, label 把时间线放到画布上 / Place timeline on canvas, required param `timeline`) and names it in `registerMaker` of `dvCanvasNodes`: each finished record makes one canvas node of kind `timeline` in layout column 3, with the declared size 640 × 390 that keeps the next placed node clear of its default frame. Its precondition refuses, before any record, a timeline that does not exist ("Timeline t9 does not exist.") and a timeline that a `timeline` node already shows ("Timeline t1 is already on the canvas as node <id>."); a timeline whose node was removed with `canvas.node_remove` goes on the canvas again as a new node. The node keeps its place when its timeline is deleted. The maker names `timeline.rename` as its `renameOperation`, so the node shows its timeline's name and has none of its own: `dv_canvas_node_rename` refuses a name for it with a message that names `dv_timeline_rename`. [`@dv/ui-timeline`](../ui-timeline/README.md) draws the node and puts a timeline on the canvas from the canvas's add menu.

A workflow skill, such as `story-directing` of `@dv/workflow-skills`, lays renders out with the agent tools `dv_timeline_create` and `dv_timeline_update`: each `clip` input names a render output `<record>#<output>`, and a clip whose render is not done is a placeholder until it is done.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The edit operations write only their records. Each one's `execute` checks the call against the state at the record's parent and fails the record with a reason when a created timeline exists, another named timeline or the named clip does not exist, a split or trim names a placeholder clip ("Clip cl3 is still rendering."), a split time is outside the clip, a trim range is empty or would start the clip before the timeline's start, a named sound does not exist, a sound split time is outside the sound, a sound trim leaves an empty range or would start the sound before the timeline's start, `start_sec` is negative, `track` is not a whole number of 0 or more, a call names a video track or sound track past the one after the last track, such as "Timeline t1 has no video track 3; it has 2.", `timeline.sound_track_remove`, `timeline.video_track_remove` or either number of `timeline.video_track_move` names a track the timeline does not have, a track name is not a string, `timeline.track_add` has a `kind` other than `video` or `sound`, `timeline.mute` or `timeline.volume` has a `target` other than `video_track` or `sound`, `timeline.mute` has a `muted` that is not a boolean, `timeline.volume` has a `volume_db` that is not a number from -40 to 0, the asset of `timeline.sound_add` is not an audio file, the asset of `timeline.clip_add` or `timeline.clip_replace` is not a video, or a call that adds, moves, trims or replaces a clip would overlap another clip of its track. A new timeline, with its empty sound track 0, takes a sound or a track name on track 0 or 1; a timeline whose sound tracks were all removed takes one only on track 0. The operations are not `deterministic`, so the runner runs that check on every call instead of reusing an earlier record. The reducer applies each finished record and ignores records that do not apply.

**Overlapping clips.** `overlapProblem` compares where `placeClips` puts the clips of the changed clip's track before and after the call. It refuses a call that adds, moves, trims or replaces a clip when the call would push another clip of the track later than it played before the call, or when the clip would not play from its own start time. An added or moved clip must always play from its own start time; a clip that a longer render already pushed may stay pushed, so a trim of its out point goes through. The reason names the clip and its track, such as "The new clip would overlap clip cl4 on video track 1 (2s to 7s); pick another start_sec or track.".

**Placeholder clips.** `timeline.create` and `timeline.update` declare the `clip` input role in `OperationSpec.pendingInputRoles`, so a `clip` input may name the output of a render that is not done: the call runs at once and its record is done while the render runs. The reducer lays out each `clip` input as a clip on video track 0 with that `source`; the input's `resolved_asset`, and so the clip's `asset`, is null until the render is done, when the record's current form fills it. Until then the clip plays for the render's planned length, as `clipLength` gives it. A failed render leaves the clip a placeholder. Move, remove and replace work on a placeholder; replace puts an asset in it and clears its `source`. The agent summary lists a placeholder clip as `{clip, asset: null, status, record, start_sec, in_sec, out_sec}`, where `record` is the render it waits for.

**Clip IDs and start times.** The operations that add clips assign their clip IDs in `execute` and store them in the record's `report.clips`, in clip order: one per clip for `timeline.create` and `timeline.update`, one for `timeline.clip_add`, and one for the second part of `timeline.clip_split` (the first part keeps the clip's ID). The number after `cl` is one more than the highest number in the `report.clips` of any Timeline record anywhere in the project's history list, including the steps after the current position, and than any number assigned to a call still running, so no two clips of the history list share an ID, whichever state they were added in. `timeline.create` and `timeline.update` lay their clips out back to back on video track 0 from 0 s, each as long as `clipLength` gives it; the asset lengths are known only to the service, so the call stores one start time per clip in `report.starts`. The reducer reads clip IDs only from `report.clips` and those start times only from `report.starts`. A finished record whose `report.clips` does not match the clips it adds, whose `report.starts` does not hold one start time per clip it lays out, or that names an ID already in use, applies nothing.

**Sound IDs.** `timeline.sound_add` and `timeline.sound_split` each assign one sound ID such as `sd2` in `execute` and stores it in the record's `report.sounds`. The number after `sd` follows the clip ID rule over the `report.sounds` of the history list and the calls still running, so sound IDs are also unique within the project and never reused. A finished record whose `report.sounds` does not hold exactly one ID for `timeline.sound_add` or `timeline.sound_split` and none for any other operation, or names an ID already in use, applies nothing.

**Export.** `exportTimeline` takes the file of each clip from the asset pool and places the clips with `placeClips`. A clip whose `in_sec` and `out_sec` are both null plays the whole asset and uses the asset's file as it is. Any other clip is trimmed into a new file in the operation's `scratchDir` with the seek after `-i` and re-encoding (H.264 in yuv420p, AAC audio, or no audio while its track is muted), so the trim lands on the exact frame. When track 0 alone plays from 0 s without a gap, its clip files are joined with the concat demuxer and stream copy, without audio (`-an`) while track 0 is muted. When ffmpeg rejects the stream copy, for example because the files disagree on codec, the concat filter re-encodes the video of every file at the first file's frame size, scaled and padded, and the joined file has no audio. When clips of the other tracks end after the joined video, the joined video gets black frames up to the last such clip's end, and each such clip is drawn from the joined video's end to its own end; a clip of another track that ends before the joined video stays out. Any other timeline, whose track 0 starts after 0 s, has a gap, or has no clip, is drawn on black of its whole length at the frame size and the frame rate of the first clip of the track with the lowest number, every clip at its time; when ffprobe reports no frame rate for that clip, the black runs at 30 frames per second. In both drawings each clip is scaled to fit the frame with black bars, and the track with the highest number is drawn first, so a track with a lower number covers those with higher numbers. The audio follows the picture: the audio of each drawn clip is silenced where the joined video plays and where a clip of a track with a lower number plays, the rest is mixed with the joined video's audio, and a muted track gives no audio. The sounds of the sound tracks that are not muted are then mixed in by one more ffmpeg run, which copies the picture: each sound plays its range of its asset from its start time, over the clips' audio and the other sounds, and every part of the mix is brought to 48 kHz stereo first. The result ends where the video of the clips ends, so a sound is cut there and a sound that starts at or after that end is left out, as in the preview. Before any clip is trimmed, the export reads the file of each of those sounds with ffprobe and fails with the sound's ID when a file has no audio that ffprobe can read. The operation probes the result and imports it with its duration and frame size, named after the timeline's name, or its ID when the name is empty. The reducer ignores export records.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvTimeline`: the twenty-two edit operation specs, the registration of all twenty-three operations, clip and sound ID assignment, and the start times of `report.starts` |
| [`src/export.ts`](src/export.ts) | The `timeline.export` operation spec and `exportTimeline` |
| [`src/place.ts`](src/place.ts) | The `timeline.place` operation spec and the node maker of `timeline` nodes |
| [`src/reducer.ts`](src/reducer.ts) | The `timeline` reducer, the clip and sound checks it shares with the operations, `overlapProblem`, `placeClips` and `clipLength` |
| [`src/types.ts`](src/types.ts) | `Timeline`, `Clip`, `ClipId`, `ClipStatus`, `Sound`, `SoundId`, `TrackKind`, `TimelineId`, and the `timeline` slice declaration |
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

Twenty-three tools, `dv_timeline_create`, `dv_timeline_update`, `dv_timeline_rename`, `dv_timeline_delete`, `dv_timeline_clip_add`, `dv_timeline_clip_move`, `dv_timeline_clip_remove`, `dv_timeline_clip_split`, `dv_timeline_clip_trim`, `dv_timeline_clip_replace`, `dv_timeline_sound_add`, `dv_timeline_sound_remove`, `dv_timeline_sound_split`, `dv_timeline_sound_move`, `dv_timeline_sound_trim`, `dv_timeline_sound_track_remove`, `dv_timeline_sound_track_rename`, `dv_timeline_mute`, `dv_timeline_volume`, `dv_timeline_track_add`, `dv_timeline_video_track_remove`, `dv_timeline_video_track_move` and `dv_timeline_export`, in the format `@dv/project` gives every operation tool. The edit tools name a timeline by `timeline` (such as `t1`), a clip by `clip` (such as `cl3`) and a video track by `track` (0 for 视频 1), and their parameter descriptions point the agent to `video_tracks` and their `clips` in `dv_proj_state`; `dv_timeline_sound_remove` names a sound by `sound` (such as `sd2`) from the `sounds` of `timelines`. The description of `dv_timeline_clip_add` says "Where a clip plays, it covers the clips of every track with a higher number, so the user sees and hears the clip of the lowest track at each time; track 0 (视频 1) is on top. It must not overlap another clip of its track.", and the descriptions of `dv_timeline_clip_move`, `dv_timeline_clip_remove` and `dv_timeline_clip_trim` say that the other clips keep their times. The description of `dv_timeline_sound_add` ends with "The exported video plays it over the clips' audio, up to the end of the last clip.". The description of `dv_timeline_export` says "Export a timeline to one video: each clip with an in or out point is trimmed to that range and plays at its time. Where clips of several video tracks play, the track with the lowest number covers the others, picture and audio; where no clip plays, the video is black and silent. The sounds of the sound tracks play over the clips' audio, up to the end of the last clip. Muted audio (dv_timeline_mute) is left out, and every track plays at its volume (dv_timeline_volume). Runs on the CPU.", and its only own param is `timeline`. While `@dv/canvas` is loaded, a twenty-fourth tool, `dv_timeline_place`, has the description "Put a timeline on the canvas as one node. The node shows the timeline's picture and tracks in small, with a line from each node whose output the timeline plays; selecting the node outlines those nodes. A timeline goes on the canvas once, and its node stays until dv_canvas_node_remove takes it off. Works whether or not the user has a canvas open. The change is a step of the project history, so dv_proj_undo reverts it." and the one own param `timeline`.

#### Token effect

About 5,350 tokens for the twenty-three definitions, and about 300 more for `dv_timeline_place` while `@dv/canvas` is loaded, fixed while the plugin is mounted; the shared arguments of `@dv/project` add up to about 200 tokens to each definition.

#### KV Cache effect

The definitions sit in the stable tool section of every agent request; mounting or removing the plugin changes the tool list and invalidates the cached prefix from the tool section on.

### Tool results

#### What the model sees

A call returns one text block with the record's status and a one-line summary such as `clip cl3 moved to 20s`; a call that adds clips also returns their clip IDs in `report.clips`, such as `t1 clip cl7 added to video track 1 at 4s` for `dv_timeline_clip_add`, and `dv_timeline_sound_add` returns `t1 sound sd2 added at 3s` with the sound ID in `report.sounds`; and a call that does not fit the timeline returns a tool error with the failed record's reason. `dv_timeline_export` returns `done <record>: exported timeline t1` (`exported the first timeline` without `timeline`), the line `- video: <AssetId> (video/mp4) <url>`, and the params; the video sends no image block. `dv_proj_state` lists every timeline with `video_tracks`, one `{track, clips}` for each video track, track 0 first, with `muted: true` on a muted track and each clip as `{clip, asset, url, start_sec, in_sec, out_sec}` by start time, and the agent's project block lists the clips with each clip's producing record; a placeholder clip shows as `{clip, asset: null, status, record, start_sec, in_sec, out_sec}`, with its status (`rendering` or `failed`) and the render record it waits for instead of an asset. A timeline with sound tracks, a new one included, also lists `sound_tracks` as `{track, name}` for each track, with `''` for an unnamed track and `muted: true` on a muted track, and a timeline with sounds lists `sounds` as `{sound, asset, url, start_sec, in_sec, out_sec, track}`; a timeline without them leaves those two fields out. `dv_timeline_place` returns `done <record>: t1 placed on the canvas` and the params, and its refusals return a tool error with the precondition's message; the new node shows in the `canvas` field of `dv_proj_state` with kind `timeline`.

#### Token effect

Roughly 50 to 150 tokens per call; a create or update with many clips adds its asset list. An export call returns about 80 tokens.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact.

### Skill

#### What the model sees

The skill catalog lists `timeline-editing` with its description and when to use it. When the agent loads the skill, it reads a table from the user's editing phrasings (trims, retakes, reference and style changes, moving, deleting and adding clips, going back to an earlier take, undo, redo, rolling back, stills, muting, splitting, moving and trimming sounds, adding, moving and deleting tracks, putting the timeline on the canvas, export) to the `dv_*` calls in order and their required arguments, and the rules that apply to every row. A retake calls `dv_shot_render` with the model and task of the record that produced the clip.

#### Token effect

About 60 tokens in the skill catalog while the plugin is mounted; about 1,700 tokens each time the agent loads the skill.

#### KV Cache effect

The catalog entry sits in the stable skill section; mounting or removing the plugin changes the catalog. A loaded skill is appended to the conversation as a tool result; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Assets are params, not inputs**: `asset` and `assets` are recorded as params, so a clip does not make its record stale when the asset's producer is superseded.
- **Video-only join fallback**: when stream copy fails, the re-encoding fallback of `timeline.export` drops the clips' audio, so the exported video has only the sounds of the sound tracks.
- **Stream copy accepts some mismatched files**: ffmpeg copies clips of different frame sizes without an error, and players then show the later clips at the wrong size; only a rejected copy falls back to re-encoding.
- **No GPU encoders**: export trims and the fallback join re-encode with `libx264` on the CPU.
- **Only create and update take unfinished renders**: `timeline.clip_add` takes an existing video asset, so a render that is not done enters a timeline only through `timeline.create` or `timeline.update`, on video track 0.
- **A clip always fills the frame**: every clip is scaled to fit the frame; there is no position, size or opacity.
- **Sounds play at full volume**: no operation sets a sound's volume or fades it in or out.
- **The skill does not add sounds**: the `timeline-editing` skill maps no phrasing to `dv_timeline_sound_add`, `dv_timeline_sound_track_remove` or `dv_timeline_sound_track_rename`.
