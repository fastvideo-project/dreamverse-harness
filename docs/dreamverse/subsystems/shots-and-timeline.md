# Shots and timeline

English | [中文](shots-and-timeline.zh.md)

This page is the reference for the shots and the timelines of a DreamVerse project. It describes plans, renders and their takes, the live render stream, timelines and clips, the takes in use, export, and the inspector. Five services provide them. [`@dv/shot-plan`](../../../packages/dv/shot-plan/README.md) provides `dvShotPlan`, [`@dv/shot-render`](../../../packages/dv/shot-render/README.md) provides `dvShotRender`, [`@dv/timeline`](../../../packages/dv/timeline/README.md) provides `dvTimeline`, [`@dv/inspector`](../../../packages/dv/inspector/README.md) provides `dvInspector`, and [`@video-harness/stream`](../../../packages/video-harness/stream/README.md) provides `vhStream`. The agent calls their operations through the `dv_*` tools, and the views run them through `@dv/api`. The story workflow `@dv/workflow-story` calls `dvShotPlan`, `dvShotRender` and `dvTimeline` ([workflows](workflows.md)). Each package README defines the contract of its own package.

<a id="plans"></a>
## Plans

A plan is the list of shots of a video before anything renders. `plan.create` writes version 1 of a new plan and gives it a `PlanId`. The number after `p` is one above the highest plan number in the history of the project. `plan.update` writes the next version of the plan that its `plan` param names, with every shot of that version. The `plan` reducer keeps every version of every plan in the `plan` slice.

A shot names the model that renders it by its key (`modality`, `task`, `provider` and `model`) and holds its prompt. The [`@dv/shot-plan` README](../../../packages/dv/shot-plan/README.md) lists the other fields of a shot and a plan. The plan stores each model key as written and never reads the model catalog. The workflow that approves the plan checks the key.

Before the record is written, for every caller, `plan.create` and `plan.update` refuse a plan in these conditions:

- A shot has references, and its task is not `ref2v`.
- A shot has `continue_previous`, and it is shot 1 or its task is not `ref2v`.
- A prompt cites the first frame (`dv:input/first_frame`) of a shot that does not continue the previous shot.
- A reference names an unknown version of a reference kind.
- The `plan` param of `plan.update` names an unknown plan.

`dvShotPlan.shots(state, plan, version?)` resolves the shots of one version in the same way for every workflow. Each `ResolvedShot` has its 1-based `slot`, the plan-level values, the references that apply to the shot, and `continuePrevious`. In the browser, `plansOf(state)` of `@dv/ui-shot-plan` reads the `plan` slice and returns `{}` while `@dv/shot-plan` is not loaded. A plan renders nothing. A workflow plugin approves a plan version and renders its shots ([workflows](workflows.md)).

<a id="renders-and-takes"></a>
## Renders and takes

A take is one `shot.render` record. It is one render of one shot with the catalog entry that the record's model key names ([`shot.render`](generation.md#shot-render)). The outputs of a take are `video` and `last_still`, the last frame of the video as a PNG image. The cost of a take is the GPU time that the backend reports.

Renders are not deterministic, so each call writes a new take. A retake names the earlier take in `based_on`, whatever model each take used. A render that a workflow schedules carries `started_by` with the starter record and the shot's slot. An agent call starts from the last still of an earlier take with the tool-only argument `continue_from` ([`shot.render`](generation.md#shot-render)). When a workflow renders a plan shot with `continue_previous`, the workflow adds output `#1` of the take of the previous shot as the `first_frame` input. A workflow finds a take to reuse with `dvShotRender.findTake`, which compares the declared params and the inputs ([`GenerationApi`](generation.md#define-generation)).

<a id="live-render-stream"></a>
## Live render stream

`@video-harness/stream` sends the video of a take to browsers while the take renders. `shot.render` looks up the `vhStream` service with `ctx.get` on each render. When the service exists, `shot.render` writes the video chunks to `vhStream.openSegment(project, record, {mime, segmentIdx})` as the model produces them. The record ID becomes the `stream_id` that the browser receives, and `started_by.slot` becomes `segment_idx` (0 for a render without a slot).

A browser opens the WebSocket route `/vh/ws` of the DSH web server and sends `{type: 'subscribe', project_id}`. For each take of the project, the route sends `media_init`, the binary fMP4 chunks, and `media_segment_complete`. A browser that subscribes during a render first receives the chunks that the route already sent, up to `bufferBytes`. The same socket also sends the record changes (`op`) and the moves of the current position (`line`) of `dvProject`. The [`@video-harness/stream` README](../../../packages/video-harness/stream/README.md) defines the messages and the config.

`@dv/bundle` does not mount `@video-harness/stream`. A profile that mounts the plugin gets the route. Without the plugin, `shot.render` renders and stores takes in the same way.

<a id="timelines-and-clips"></a>
## Timelines and clips

A timeline is one edited video of a project. It has a `TimelineId` (`t1`, `t2`, …), a name, and its clips in playback order. A clip plays one asset from `in_sec` to `out_sec`; a null point is the start or the end of the asset. A `ClipId` (`cl1`, `cl2`, …) is unique in the project and is never used again. The operations that add clips assign the IDs and store them in `report.clips`, and the `timeline` reducer reads the IDs only from there.

`@dv/timeline` registers the operations of the component `timeline` that the [glossary](../glossary.md) lists. Each of these operations except `timeline.export` is an edit operation. An edit operation writes only its record and never creates a file. The edit operations named `timeline.clip_<verb>` change clips, and the other edit operations change a whole timeline.

Each edit checks the call against the state in `execute`. When the call cannot apply, the edit fails the record with the reason.

`timeline.create` and `timeline.update` declare the `clip` input role in `pendingInputRoles`, so a clip input can name the output of a render that is not done. That clip is a placeholder. Its `asset` is null, and its `source` names the render output. The clip gets its asset when the render is done, and a failed render leaves it a placeholder. `ClipStatus` comes from the source record and is never stored. It has three values:

- `ready` when the clip has an asset.
- `rendering` while the source record is pending or running.
- `failed` in all other cases.

Trim and split refuse a placeholder. Move, remove and replace accept it.

A workflow lays takes out with `dvTimeline.layout(call)`. The method writes one `timeline.update` of the named timeline, or one `timeline.create` of the next free `t<n>`. `dvTimeline.lastWrite(state, timeline)` returns the newest done create or update record of a timeline.

<a id="takes-in-use"></a>
## Takes in use

The canvas draws a take when the project data uses the outputs of the take, also when the take comes from an earlier workflow run. A UI plugin reports the takes that its data uses with a `TakesInUse` descriptor in `dvCanvas.takesInUse`:

- For each clip of each timeline, `@dv/ui-timeline` reports the render that the clip waits for. When the clip waits for no render, `@dv/ui-timeline` reports the record that created the asset of the clip. It also puts the badge 已裁剪 / Trimmed on the asset of each clip with an in point or an out point.
- `@dv/ui-shot-plan` reports the records that created the reference assets of the latest version of each plan.
- `@dv/ui-character`, `@dv/ui-location` and `@dv/ui-style` report the records that created the reference assets of the newest version of each item.

An undo or a move to an earlier step changes the current state, so it also changes the takes in use. The [`@dv/ui-canvas` README](../../../packages/dv/ui-canvas/README.md) defines which takes the canvas draws.

<a id="export"></a>
## Export

`timeline.export` writes one timeline to one MP4 asset, the `video` output of the record. The `timeline` param names the timeline; without it, the operation exports the first timeline. Through `dvFfmpeg`, it trims each clip that has an in point or an out point, then joins all clips in playback order. The operation runs in the `cpu` resource class, never asks for agreement, and is not deterministic, so each call exports again. The `timeline` reducer ignores export records, so an export changes no timeline. `timeline.export` refuses a timeline with a placeholder clip before the record. The refusal names the clip positions, such as `Clips 3, 5 of timeline t1 are not ready yet.`

<a id="inspector"></a>
## Inspector

`@dv/inspector` lets the agent examine assets without a change to the project. Its two operations are reads, so they write no record, and the component has no reducer:

- `inspect.image` (tool `dv_inspect_image`): the default model of the harness answers a question about one PNG, JPEG, WebP or GIF asset. The plugin registers this operation only while `llm`, `agentDefaultModel` and `attachments` are mounted. When the model takes no images, or the config sets `imageInput: false`, the plugin does not call the model. The report field `unsupported` then gives the reason.
- `inspect.asset` (tool `dv_inspect_asset`): ffprobe reads the duration, the frame size, the codec, and the audio presence of an asset through `dvFfmpeg`.
