---
description: "The DreamVerse timeline editor as a right-Sidebar tab and a center view: each timeline of the project on one video track and its sound tracks, with clip and sound gestures that become `timeline.*` records."
kind: "package-reference"
---

# @dv/ui-timeline

English | [中文](README.zh.md)

## Summary

Use this package to give the web application a timeline editor beside the chat. The editor shows one tab per timeline, a viewer playing the selected timeline, a video track whose clips are as wide as they play and marked when stale, and sound tracks. You move, trim, split, and remove clips, insert asset-pool assets by dropping them or choosing them with ＋, and add audio to sound tracks. The right Sidebar's `dv-timeline` tab type wraps the editor in the project bar; `TimelineView` is the shell's 时间线 / Timeline center view (`dv.center.view`). Both follow the project's current state.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app` and `@dv/api`, and build the browser bundle first with `pnpm run build`.

The editor also has a toolbar and a ruler, and each clip carries its producer's last frame. Dragging a clip moves it, dragging its edges trims it, the toolbar splits the clip under the playhead, its 撤销 / Undo and 重做 / Redo icon buttons move the project's current position one step back or forward (whichever view made the step) and write no record, 重做 / Redo being disabled while the current position is the last step, and Delete removes the selected clip. The bar under the preview shows the timecode on the left; back 5 s, play or pause, and forward 5 s in the center (J, L, Shift+← and Shift+→ on the focused editor also skip 5 s); and on the right the playback speed button, which cycles 0.5×, 1×, 1.5× and 2× and keeps the speed for the browser tab's session, and full screen. The 原声 / Original audio track draws each clip's waveform over its played range. Dragging the line between the preview and the toolbar (or pressing ArrowUp and ArrowDown on it) changes the track area's height, which the browser remembers under the `localStorage` key `dv-timeline-track-height`; the preview keeps at least 160 px.

Sound tracks sit under the 原声 / Original audio track. Each track's header shows its name, 声音 {n} / Sound {n} until it has one, and its buttons on a line under the name. Double-clicking the header, or 重命名 / Rename in its right-click menu, opens a name box that Enter or leaving the box saves and Escape cancels; 删除音轨 / Delete track in the same menu, or the delete button on the header, deletes the track with its sounds. The header's speaker button mutes or unmutes the track through `timeline.mute`, and the preview plays a muted track's sounds silent and dims them; the speaker button on the 视频 / Video header does the same for the clips' own audio and dims the 原声 / Original audio track, and an export of a timeline with the clips' own audio muted has no audio. The speaker buttons are disabled while the project has no timeline. ＋ 添加音轨 / Add track under the last track adds an empty track; it is disabled while such an empty track is shown. The ＋ at the end of each track opens the 添加声音 / Add sound dialog, which shows where the new sound starts and lists 上传本地音频 / Upload local audio and the project's audio assets, newest first; uploading imports the chosen file into the asset pool and then adds it. A new sound starts where the last sound of its track ends, or at the playhead on an empty track; the ＋ buttons are disabled from an add until the sound that its record names shows, and enabled at once when the add fails, its record names no sound, or the editor switches to another timeline. Each sound is a block as wide as it plays, with its file name in a strip above its waveform. Clicking a sound selects it; Delete or Backspace, the toolbar's 删除声音 / Delete sound button, or 删除 / Delete in its right-click menu removes it. While the preview plays, each sound plays in step with the picture at the playback speed. While the timeline has sounds, the toolbar shows 导出暂不包含声音 / Export does not include sounds yet beside Export.

```yaml
- id: dv-ui-timeline
  name: '@dv/ui-timeline'
```

The Host half registers nothing. The browser half registers the `dv-timeline` tab type (offered by the Sidebar's guide page as "Timeline"), the `dvTimeline` locale namespace in Chinese and English, and the tab body under its own id `@dv/ui-timeline`. While the center service `dvCenter` of `@dv/ui-shell` is present, it registers `TimelineView` as the `dv.center.view` entry `timeline` (order 1, labeled with the tab type's label 时间线 / Timeline), which edits the project of the center's owner prop `projectId`, writes for the chat session of its owner prop `session`, and applies its owner prop `request`. In the same scope it registers the entry `dv.timeline.insert` of the `dv.media.preview.action` slot, a button of the asset preview that `dvMedia.preview` of `@dv/ui-media` opens: the button 插入片段 / Insert clip shows for a video asset of the open project, and clicking it calls `dvCenter.show({ view: 'timeline', target: { insert } })` with the asset, which the open project's timeline view inserts, and closes the preview. While the canvas service `dvCanvas` of `@dv/ui-canvas` is present, it also registers a `RecordsInUse` of `@dv/ui-canvas/contract` in `dvCanvas.recordsInUse` under the same id: its `uses` lists, for each clip of every timeline, the render the clip waits for (`source.record`), else the producer of the clip's asset, so the canvas draws the takes that the timelines play; its `badges` puts 已裁剪 / Trimmed on the asset of each clip with an in or out point. In the same scope it registers the node type `timeline` in `dvCanvas.nodeTypes`, for the nodes that `timeline.place` of [`@dv/timeline`](../timeline/README.md) makes, and the section 时间线 / Timelines (order 1) in `dvCanvas.addMenu`, which lists every timeline of the project by its shown name and puts a picked one on the canvas with one `timeline.place` record; a timeline that a node already shows names that node. A timeline node's title is the timeline's name, its meta the timeline's length such as `7.0s`, and its card, the `dv.canvas.card` entry `timeline`, holds `TimelineEditor` for that timeline with its `card` option: no timeline tabs and no track-area resize, the toolbar ending with 打开编辑器 / Open editor, which shows the timeline in the 时间线 view, and, while the node is selected, the editor's preview above the node, as wide as the node at the first ready clip's aspect ratio (16:9 when its size is unknown), playing in step with the editor's playhead. The preview grows with the node in both directions: it is as wide as the node, or, when the node is taller than the default 640 × 390 proportions give, height × 640 / 390 wide and centered over the node; under its picture a progress bar shows the playhead, and a press on it moves the playhead there. The editor and the preview draw their text and controls larger as the node grows, by the smaller of width / 480 and height / 290 and at least 1, so a default node draws them at 4 / 3 of the panel's size and a node enlarged in both directions draws them larger still. A press on the editor's controls (its buttons and slider, ruler, clips, sounds, and sound track headers) selects the node and stays with the editor; a press anywhere else in the card, the preview included, moves the node, and a click there selects it. The editor keeps its keys, such as Delete on a selected clip, and its own right-click menus; a right click elsewhere opens the canvas's node menu. Its menus open inside the editor, it divides pointer distances by the canvas zoom, and its track area scrolls both ways by wheel or touchpad without showing a scrollbar. A refused write shows its error above the editor until the next write succeeds. Its `uses` names the assets of the clips and the sounds and the render of each placeholder clip, so the canvas draws a line from each of their nodes and, while the timeline node is selected, outlines them with a glow and fades the other nodes. A double click calls `dvCenter.show({ view: 'timeline', target: { timeline, clip: null } })` while `dvCenter` is present. A node whose timeline was deleted shows 这条时间线已删除 / This timeline was deleted, and one without clips 时间线还没有片段 / The timeline has no clips yet. While the History service `dvHistory` of `@dv/ui-history` is present, it registers in `dvHistory.rows` the `HistoryRow` `timeline.` of `@dv/ui-history/contract`: it adds no subject to the label of a timeline record, and its `focus` returns the center target `{ view: 'timeline', target: { timeline, clip } }` with the record's timeline and clip. The timeline is the record's `timeline` param, else the timeline of its `clip` param (each clip belongs to the timeline of the record that assigned it; a split adds to the split clip's timeline), else `t1` for a `timeline.create` without one; the clip is the `clip` param, else the first clip the record assigned. A record whose timeline is not found focuses nothing. While `@dv/ui-composer` provides `dvMentions`, it also registers the mention kind `clip` (ID `@dv/ui-timeline`, section 片段 / Clips, order 0, so the `@` menu lists clips before every other kind): each clip of each timeline as 时间线 1 · 片段 2 / Timeline 1 · Clip 2 (for an unnamed timeline), with the first 40 characters of the prompt of the record that made the clip's asset (for a placeholder clip, the render it waits for), and as its thumbnail that record's image output, else the clip's asset. `TimelineView` takes each request that the center hands it once it applied the request. A request `{ timeline, clip }` selects that timeline, and with a `clip`, the editor selects that clip and moves the playhead to its start once it shows the timeline. A request `{ insert }` inserts the asset once the view has read the state, as `timeline.clip_insert` at the end of the selected timeline (else the first one), or as `timeline.create` of `t1` holding the clip when the state has no timeline, and selects `t1`. A request of neither form changes nothing.

| Gesture | Record |
| --- | --- |
| Drag a clip edge | `timeline.clip_trim {clip, in_sec, out_sec}` (`clip` is the clip ID); an unset end is left out |
| Drag a clip | `timeline.clip_move {clip, to}` (`to` is the 1-based position) |
| Split | `timeline.clip_split {clip, at_sec}` for the clip under the playhead |
| Delete key on the selected clip | `timeline.clip_remove {clip}` |
| Drop an asset on the track, or pick one with ＋ | `timeline.clip_insert {timeline, at, asset}`; an asset other than a video dropped there sends nothing and shows 视频轨道只接受视频。音频请拖到声音轨道上。 / The video track takes videos only. Drag audio onto a sound track. when it is audio, and 视频轨道只接受视频。 / The video track takes videos only. otherwise |
| ＋ New, rename, delete a tab | `timeline.create {timeline, assets: []}` (no name, so the tab shows 时间线 {n} / Timeline {n}), `timeline.rename {timeline, name}`, `timeline.delete {timeline}` |
| ＋ on a sound track, then an audio asset or 上传本地音频 / Upload local audio | `timeline.sound_add {timeline, asset, start_sec, track}`; an upload first imports the file through `/api/dv/assets/import` with `surface: asset_pool` |
| Drop an audio asset from the asset pool on a sound track | `timeline.sound_add {timeline, asset, start_sec, track}` with `start_sec` at the drop point; while another sound add runs, or in a project without timelines, the drop sends nothing; an asset other than audio sends nothing and shows 声音轨道只接受音频。 / A sound track takes audio only. The editor reads the media type from the drag's `application/x-dv-asset-mime` value. |
| Delete or Backspace on the selected sound, the toolbar's 删除声音 / Delete sound, or 删除 / Delete in its right-click menu | `timeline.sound_remove {sound}` (`sound` is the sound ID) |
| Rename a sound track | `timeline.sound_track_rename {timeline, track, name}`; a blank or unchanged name sends nothing |
| 删除音轨 / Delete track | `timeline.sound_track_remove {timeline, track}`; an empty track that only this view shows goes without a record |
| Export | One `timeline.export {timeline}` call; the link opens the exported video. Export stays disabled while a clip is rendering (the toolbar names it as not ready) or failed (the toolbar names it in the danger color, with `dv-timeline-export-failed`, and asks to render it again or remove it) |
| "Keep anyway" for a selected stale clip | `POST /api/dv/stale/accept` for the record that made the clip's asset (`proj.stale_accept`) |

Every record carries `surface: 'timeline'`, the chat session the view sits beside (stored as the record's `session`; the record is a step after the project's current position), and an intent in the DSH interface language naming the gesture. `TimelineView` shows the timeline that the open project's center field `timeline` names, else the first timeline, and a timeline that the user picks or creates there sets the field through the owner prop `note`, so the shell keeps it in the URL and the session switcher's cover follows it. The tab body keeps its own selected timeline per project, which leaves the center alone. `TimelineView` follows `<html lang>` through `@dv/ui-kit/locale.ts`; switching timeline tabs stops playback and resets the viewer and playhead. Clicking a clip selects it and sends nothing. The ＋ picker takes focus when it opens. Its close button, Escape while focus is in the picker, on ＋, or on an element that contains the picker, a press outside it, or tabbing out of it closes it and inserts nothing. The 添加声音 / Add sound dialog takes focus and closes the same ways, adding nothing. A clip whose asset reports no duration is drawn as five seconds; a sound whose asset reports no duration is drawn as long as its `<audio>` element measures, else five seconds. The tracks reach to the end of the last clip or sound, whichever is later.

The DOM carries test IDs `dv-timeline-body`, `dv-timeline-editor`, `dv-timeline-viewer`, `dv-timeline-viewer-empty`, `dv-timeline-time`, `dv-timeline-exported`, `dv-timeline-export-no-sounds`, `dv-timeline-ruler` and `dv-timeline-playhead`; each clip carries `data-clip` (its clip ID), `data-clip-position` and `data-clip-stale`, each sound block and its `<audio>` element carry `data-sound` (its sound ID), each sound track carries `data-sound-track` and its header `data-sound-track-head` (the track number), and each tab carries `data-timeline`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`TimelineBody` holds the view session from `@dv/ui-kit/useView.ts` and renders the project bar above `TimelineEditor`. `TimelineView` reads the project's current state itself. `placeTimeline` turns one timeline of the state into positioned clips; `useTimelinePlayer` plays them through two stacked `<video>` elements. The waveforms of the 原声 track and of the sound blocks come from `clipPeaks` and `useAudioEnvelope` of `@dv/ui-kit/waveform.ts`. `placeSounds` positions the sounds of the shown timeline; each sound has a hidden `<audio>` element, and `useSoundPlayback` plays, pauses, and seeks each element when the player's position, playing state, or speed changes, seeking again when the element is more than 0.25 s from the playhead. Each gesture is one `DvClient.runOperation` call followed by a state refetch.

| File | Content |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | Registrations |
| [`src/client/InsertClipAction.tsx`](src/client/InsertClipAction.tsx) | The 插入片段 / Insert clip action of the asset preview (`dv.media.preview.action`) |
| [`src/client/definition.ts`](src/client/definition.ts) | The tab type |
| [`src/client/TimelineBody.tsx`](src/client/TimelineBody.tsx) | The tab body: project bar and editor |
| [`src/client/TimelineView.tsx`](src/client/TimelineView.tsx) | The center view: state, writes, the `timeline` center field, and the requests of History and 插入片段 |
| [`src/client/selection.ts`](src/client/selection.ts) | The tab body's selected timeline of each project, and the reading of the center view's requests |
| [`src/client/TimelineEditor.tsx`](src/client/TimelineEditor.tsx) | The editor: tabs, viewer, toolbar, ruler, tracks, gestures |
| [`src/client/timelines.ts`](src/client/timelines.ts) | `timelinesOf(state)` (the timelines of the `timeline` slice, `[]` while `@dv/timeline` is not loaded), clip and sound placement, drop position, timecode, `videoAssets(state)` (the video assets that ＋ offers, newest first), and `audioAssets(state)` (the audio assets that the 添加声音 / Add sound dialog offers, newest first) |
| [`src/client/sound-playback.ts`](src/client/sound-playback.ts) | Preview playback of the sounds in step with the player |
| [`src/client/records-in-use.ts`](src/client/records-in-use.ts) | The `RecordsInUse` of the canvas: clip records and trim badges |
| [`src/client/canvas-node.tsx`](src/client/canvas-node.tsx) | The `timeline` node type, its card, and the add menu section of the canvas |
| [`src/client/history-row.ts`](src/client/history-row.ts) | The `HistoryRow` of timeline records: the timeline of each clip and the focus of a selected record |
| [`src/client/mention.ts`](src/client/mention.ts) | The clip mention kind of the composer's `@` menu |
| [`src/client/first-frame.ts`](src/client/first-frame.ts) | The first frame of a video, read once per page; a track clip without a still image repeats it across its width |
| [`src/client/player.ts`](src/client/player.ts) | Continuous playback across clips |
| [`src/client/locales.ts`](src/client/locales.ts) | The `dvTimeline` dictionaries |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/api`](../api/README.md) — the routes behind every gesture.
- [`@dv/ui-kit`](../ui-kit/README.md) — the client, the track geometry, the waveforms and the hooks.
- [`@dv/timeline`](../timeline/README.md) — the `timeline.*` operations the editor calls, including the `timeline.export` operation that Export calls.
- [`@dv/ui-shell`](../ui-shell/README.md) — the workspace center, `dvCenter`, and the `dv.center.view` slot.
- [`@dv/ui-media`](../ui-media/README.md) — the asset preview and its `dv.media.preview.action` slot.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the records its gestures write reach the model only through the project state and update messages and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the timeline sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One video track** — the 原声 (original audio) track mirrors the video clips and has no edits of its own; subtitles have no lane.
- **Export has no sounds** — `timeline.export` of `@dv/timeline` leaves out every sound; the toolbar note says so.
- **Sounds play only with the picture** — a sound plays only while the preview plays the clips: a timeline without a ready clip cannot play, and a sound that runs past the last clip stops at the end of the clips.
- **An empty added track stays in the open editor** — ＋ 添加音轨 / Add track writes no record, so an empty track is kept only while the editor shows that timeline, until it holds a sound or a name.
- **Sounds cannot be edited in place** — a sound cannot be dragged, trimmed, moved to another track, or given a volume.
- **Waveforms decode in the browser** — the 原声 track draws each clip's waveform, and a sound block its sound's waveform, (`@dv/ui-kit/waveform.ts`) by downloading the clip's whole media file and decoding its audio with the Web Audio API, one asset at a time and cached in memory per page load; a clip keeps a plain block while its audio decodes, when decoding fails, and when the media has no audio track. When the media file cannot be fetched (a network error or a 5xx status), the result is not cached: the clip asks again after 2, 8, and 30 seconds, and a later mount of the clip starts over.
