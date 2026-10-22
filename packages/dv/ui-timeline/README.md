---
description: "The DreamVerse timeline editor as a right-Sidebar tab and a center view: each timeline of the project on one track, with move, trim, split, insert, and remove gestures that become `timeline.*` records."
kind: "package-reference"
---

# @dv/ui-timeline

English | [中文](README.zh.md)

## Summary

Use this package to give the web application a timeline editor beside the chat. The editor shows one tab per timeline, a viewer that plays the selected timeline across its clips, and one video track whose clips are as wide as they play and are marked when stale. You move, trim, split, and remove clips on the track, and insert assets from the asset pool by dropping them there or choosing them with ＋. The `dv-timeline` tab type of the right Sidebar wraps the editor in the project bar; `TimelineView` is the 时间线 / Timeline view of the shell's center (`dv.center.view`). Both show the project's current state and follow it when it changes.

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

```yaml
- id: dv-ui-timeline
  name: '@dv/ui-timeline'
```

The Host half registers nothing. The browser half registers the `dv-timeline` tab type (offered by the Sidebar's guide page as "Timeline"), the `dvTimeline` locale namespace in Chinese and English, and the tab body under its own id `@dv/ui-timeline`. While the center service `dvCenter` of `@dv/ui-shell` is present, it registers `TimelineView` as the `dv.center.view` entry `timeline` (order 1, labeled with the tab type's label 时间线 / Timeline), which edits the project of the center's owner prop `projectId`, writes for the chat session of its owner prop `session`, and applies its owner prop `request`. In the same scope it registers the entry `dv.timeline.insert` of the `dv.media.preview.action` slot, a button of the asset preview that `dvMedia.preview` of `@dv/ui-media` opens: the button 插入片段 / Insert clip shows for a video asset while a project is open, and clicking it calls `dvCenter.show({ view: 'timeline', target: { insert } })` with the asset, which the open project's timeline view inserts, and closes the preview. While the canvas service `dvCanvas` of `@dv/ui-canvas` is present, it also registers a `TakesInUse` under the same id: it uses, for each clip of every timeline, the render the clip waits for (`source.record`), else the producer of the clip's asset, so the canvas draws the takes that the timelines play; and it puts the badge 已裁剪 / Trimmed on the asset of each clip with an in or out point. While the History service `dvHistory` of `@dv/ui-history` is present, it registers in `dvHistory.rows` the `HistoryRow` `timeline.` of `@dv/ui-history/contract`: it adds no subject to the label of a timeline record, and its `focus` returns the center target `{ view: 'timeline', target: { timeline, clip } }` with the record's timeline and clip. The timeline is the record's `timeline` param, else the timeline of its `clip` param (each clip belongs to the timeline of the record that assigned it; a split adds to the split clip's timeline), else `t1` for a `timeline.create` without one; the clip is the `clip` param, else the first clip the record assigned. A record whose timeline is not found focuses nothing. While `@dv/ui-composer` provides `dvMentions`, it also registers the mention kind `clip` (ID `@dv/ui-timeline`, section 片段 / Clips, order 0, so the `@` menu lists clips before every other kind): each clip of each timeline as 时间线 1 · 片段 2 / Timeline 1 · Clip 2 (for an unnamed timeline), with the first 40 characters of the prompt of the record that made the clip's asset (for a placeholder clip, the render it waits for), and as its thumbnail that record's image output, else the clip's asset. `TimelineView` takes each request that the center hands it once it applied the request. A request `{ timeline, clip }` selects that timeline, and with a `clip`, the editor selects that clip and moves the playhead to its start once it shows the timeline. A request `{ insert }` inserts the asset once the view has read the state, as `timeline.clip_insert` at the end of the selected timeline (else the first one), or as `timeline.create` of `t1` holding the clip when the state has no timeline, and selects `t1`. A request of neither form changes nothing.

| Gesture | Record |
| --- | --- |
| Drag a clip edge | `timeline.clip_trim {clip, in_sec, out_sec}` (`clip` is the clip ID); an unset end is left out |
| Drag a clip | `timeline.clip_move {clip, to}` (`to` is the 1-based position) |
| Split | `timeline.clip_split {clip, at_sec}` for the clip under the playhead |
| Delete key on the selected clip | `timeline.clip_remove {clip}` |
| Drop an asset on the track, or pick one with ＋ | `timeline.clip_insert {timeline, at, asset}` |
| ＋ New, rename, delete a tab | `timeline.create {timeline, assets: []}` (no name, so the tab shows 时间线 {n} / Timeline {n}), `timeline.rename {timeline, name}`, `timeline.delete {timeline}` |
| Export | One `timeline.export {timeline}` call; the link opens the exported video |
| "Keep anyway" for a selected stale clip | `POST /api/dv/stale/accept` for the record that made the clip's asset (`proj.stale_accept`) |

Every record carries `surface: 'timeline'`, the chat session the view sits beside (stored as the record's `session`; the record is a step after the project's current position), and an intent in the DSH interface language naming the gesture. `TimelineView` shows the timeline that the open project's center field `timeline` names, else the first timeline, and a timeline that the user picks or creates there sets the field through the owner prop `note`, so the shell keeps it in the URL and the session switcher's cover follows it. The tab body keeps its own selected timeline per project, which leaves the center alone. `TimelineView` follows `<html lang>` through `@dv/ui-kit/locale.ts`; switching timeline tabs stops playback and resets the viewer and playhead. Clicking a clip selects it and sends nothing. A clip whose asset reports no duration is drawn as five seconds.

The DOM carries test IDs `dv-timeline-body`, `dv-timeline-editor`, `dv-timeline-viewer`, `dv-timeline-viewer-empty`, `dv-timeline-time`, `dv-timeline-exported`, `dv-timeline-ruler` and `dv-timeline-playhead`; each clip carries `data-clip` (its clip ID), `data-clip-position` and `data-clip-stale`, and each tab carries `data-timeline`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`TimelineBody` holds the view session from `@dv/ui-kit/useView.ts` and renders the project bar above `TimelineEditor`. `TimelineView` reads the project's current state itself. `placeTimeline` turns one timeline of the state into positioned clips; `useTimelinePlayer` plays them through two stacked `<video>` elements. The waveforms of the 原声 track come from `clipPeaks` and `useAudioEnvelope` of `@dv/ui-kit/waveform.ts`. Each gesture is one `DvClient.runOperation` call followed by a state refetch.

| File | Content |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | Registrations |
| [`src/client/InsertClipAction.tsx`](src/client/InsertClipAction.tsx) | The 插入片段 / Insert clip action of the asset preview (`dv.media.preview.action`) |
| [`src/client/definition.ts`](src/client/definition.ts) | The tab type |
| [`src/client/TimelineBody.tsx`](src/client/TimelineBody.tsx) | The tab body: project bar and editor |
| [`src/client/TimelineView.tsx`](src/client/TimelineView.tsx) | The center view: state, writes, the `timeline` center field, and the requests of History and 插入片段 |
| [`src/client/selection.ts`](src/client/selection.ts) | The tab body's selected timeline of each project, and the reading of the center view's requests |
| [`src/client/TimelineEditor.tsx`](src/client/TimelineEditor.tsx) | The editor: tabs, viewer, toolbar, ruler, tracks, gestures |
| [`src/client/timelines.ts`](src/client/timelines.ts) | `timelinesOf(state)` (the timelines of the `timeline` slice, `[]` while `@dv/timeline` is not loaded), clip placement, drop position, timecode |
| [`src/client/takes-in-use.ts`](src/client/takes-in-use.ts) | The `TakesInUse` of the canvas: clip records and trim badges |
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

Indirectly, through `@dv/project`; the records its gestures write reach the model only through the `dv:project` prompt section and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the timeline sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One video track** — the 原声 (original audio) track mirrors the video clips and has no edits of its own; subtitles and music have no lane.
- **Waveforms decode in the browser** — the 原声 track draws each clip's waveform (`@dv/ui-kit/waveform.ts`) by downloading the clip's whole media file and decoding its audio with the Web Audio API, one asset at a time and cached in memory per page load; a clip keeps a plain block while its audio decodes, when decoding fails, and when the media has no audio track. When the media file cannot be fetched (a network error or a 5xx status), the result is not cached: the clip asks again after 2, 8, and 30 seconds, and a later mount of the clip starts over.
