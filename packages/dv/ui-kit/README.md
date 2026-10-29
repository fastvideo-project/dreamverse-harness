---
description: "Browser code the DreamVerse views share: the /api/dv client, the wire types, the parameter form model, the track geometry, the window events, the view session hooks, and the project bar."
kind: "package-reference"
---

# @dv/ui-kit

English | [中文](README.zh.md)

## Summary

Use this package from a DreamVerse browser plugin to talk to `@dv/api` and to read the state it sends. `DvClient` wraps every `/api/dv` route and follows `/dv/events`; `fieldsOf` and `paramsOf` turn an operation's parameter schema into form fields and back; `useViewSession` keeps a view's project, the project's current state, and the operations in step with the host; `ProjectBar` is the project and undo bar of the Sidebar views; the event modules own the `dv:*` window events and page globals the panels exchange; `registries.ts` holds `createRegistry`, the `VersionKind` and `@` menu descriptors, and `UiPlugin`. The package is a library: it registers nothing and is bundled into each consumer.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Add `@dv/ui-kit` to a browser plugin's `devDependencies` and import one module at a time; the package's `./*` export maps to `src/client/*`, and the DSH client bundle inlines what it imports. There is no Loader row.

```ts
import { DvClient } from '@dv/ui-kit/api.ts'
import { useViewSession } from '@dv/ui-kit/useView.ts'
import { DV_HISTORY_FOCUS_EVENT } from '@dv/ui-kit/workspace-events.ts'
```

| Module | Content |
| --- | --- |
| `types.ts` | `WireState` (`head` is the current position, `tip` the last step of the history list), `WireComponents` (the type of `WireState.components`: the `proj` and `asset` slices always, and any other slice only while the server loads the plugin that owns it, so the type of that slice includes `undefined`), `WireLine` (`{tip, at}`, the answer of undo and redo), `ProjectRecord`, `WireInputRef` (a stored input reference: an asset, a record output, or a `WireVersionRef`, one version of any reference kind), `Asset`, `ProjectAsset` (an asset with this project's import name and time and `made_by`), `WireOperation`, `WireProject`, `WireProjectSummary` and `WireProjectCover` (a project card's cover, shot count, duration, and last edit time), `SummaryQuery` (the `timeline` that narrows one project's summary), `ProjectEvent`, `OperationRequest`, `OperationCheck` (the answer of `POST /api/dv/operation/check`: `problems`, the refusal sentence that a run would get now, empty when the call can run), `WireModelEntry` (one entry of `GET /api/dv/models`, with the model's `schema()`), `HistoryQuery`, `HistoryEntry` (`{record, place}`), `WireHistory`, `ComponentStates` (the `proj` and `asset` slices; the slice of any other loaded component is `unknown`: a UI half whose host package has a client face merges the slice type of that face into it, and any other UI half narrows its slice with its own guard): the JSON `@dv/api` sends and receives, as structural types |
| `api.ts` | `DvClient` (`listProjects`, `listProjectSummaries` (`GET /api/dv/projects/summary`), `getState` (the current state), `listOperations`, `getTaskLabels` (`GET /api/dv/tasks`), `listModels` (`GET /api/dv/models`), `checkOperation` (`POST /api/dv/operation/check`, which writes nothing), `runOperation`, `importAsset`, `undo` (one step back), `moveTo` (to a step of the history list), `redo` (one step forward), `acceptStale`, `listHistory`, `placeOnCanvas` (`asset.place` or `asset.unplace` on the canvas surface), project, workspace, and session calls, `subscribe`), `ViewSurface`, `DvApiError`, `errorMessage(error)` (the text a view shows for a thrown value), `assetUrl` |
| `form.ts` | `fieldsOf(params, values)`, `paramsOf(fields)`, `valueOf(field)`, `FieldParseError`: one control per schema property, typed coercion; the default parameter chips of the `dv.prompt` composer of `@dv/ui-composer` read `fieldsOf` and `valueOf` |
| `timeline.ts` | `FALLBACK_CLIP_SECONDS`, `timelineName(timeline, numbered)` |
| `references.ts` | `versionRefOf(ref)` and `formatInputRef(ref)`: the kind, ID and version of a stored version reference, and the reference text of any stored input reference, with no reference kind named, written through `formatInputSyntax` of `@dv/project/grammar`; `requestInputsOf(record)`: a record's inputs as an operation request takes them, where a version that the record stores once per asset appears once; `referenceAssets(state, references, kinds)`: the reference assets of any media type a shot sends to the video model, read from each reference text with `splitInputRef` of `@dv/project/grammar` (a version `<id>@<n>` expands through the given `VersionKind`s); `referenceItems(state, references, kinds)`: one item per reference text with the name that a view shows, a version by its version kind's name and its first reference asset, any other reference by its asset's name |
| `state.ts` | `assetIndex(state)`: the assets of a state keyed by asset ID |
| `media-type.ts` | `mediaTypeOf(mime)`: the media type of a MIME type, its top-level type in lower case without spaces or parameters, which `@dv/ui-media` keys its views and media types by |
| `player-box.ts` | `playerBox(asset, maxHeight)`: the box of a playable asset across a surface, the full width at the asset's aspect ratio and at most `maxHeight` tall (the full `maxHeight` for unknown dimensions), such as the 360 px player of the canvas's node editor and the 220 px player of History; the media view fills it |
| `registries.ts` | `Registry` and `createRegistry(keys, owner)`: a descriptor list with one owner per key (`register` throws on a held key, naming the holder by `owner`, and returns the disposer), whose `getSnapshot()` returns the same array until a change and whose `subscribe(listener)` reports each change, so a slot registration can hand a registry to its component through the inject `hooks` source; `VersionKind` (`kind`, a reference kind of the kernel; `label()`, the title of the kind's section in the asset picker; `node(id)`, the canvas node ID of an item; `latest(state)`, every item at its newest version; `name` and `assets` of one version), which `@dv/ui-canvas` keeps in its `dvCanvas` registry `versionKinds`; `DvMentions` (`kinds` keyed by `id`) and its descriptor `MentionKind` (`kind` of the address `dv:<kind>/<id>`, `order` of its `@` menu section, `section()`, and `items(state)` with `uri`, `label`, `description`, and a `thumb` asset, whose media type's poster the `@` menu shows as the item's icon), which `@dv/ui-composer` provides as `ctx.dvMentions`, and the cordis `Context` merge of `dvMentions`; `UiPlugin` (`inject` and `apply`), what Cordis loads from a UI plugin file that writes `export const { inject, apply } = define…Ui({ … })`. `@dv/ui-canvas/contract` declares the canvas descriptors and `@dv/ui-history/contract` the History row types |
| `waveform.ts` | `useAudioEnvelope(assetId)`, `peakEnvelope`, `clipPeaks`: audio decoding and peak envelopes, which the timeline's 原声 track and the audio media view of `@dv/ui-asset-pool` draw as waveform bars |
| `chain.ts` | `chainOf(record, records)`: the chain of a record (`WireStartedBy`), which is its own `started_by`, else the `started_by` of its `based_on` root, else null |
| `useProject.ts` | `useProjects`, `useOperations`, `useTaskLabels`, `useProjectState`: loaders that refetch on every project event; `useLoader(load, deps)`, the request lifecycle they share, which aborts a stale request and keeps the last value while it reloads |
| `loaded.ts` | `loadedOnce(empty, load)`: an observable source that starts at `empty` and loads its value on its first subscription, for the inject `hooks` source of a slot registration; a failed load keeps `empty`, and the next subscription loads again |
| `useView.ts` | `useViewSession(client, surface, session?)`: the project choice, the project's current state, the operations, the last failure, and the project-bar callbacks; the view opens on the project the shell has open (`useCurrentProject`), else on the newest |
| `ProjectBar.tsx` | The Sidebar bar (test ID `dv-kit-project-bar`): the project picker, a new-project button, and undo, drawn as 28 px secondary controls with the `--dv-*` theme tokens; its copy arrives as `labels`, already localized by the owning plugin |
| `compose.ts`, `workspace-events.ts` | The window events `dv:compose`, `dv:history-focus`, `dv:trajectory-focus` (`DV_*_EVENT`) and the asset drag type `application/x-dv-asset` |
| `tool-labels.ts` | `DV_TOOL_LABELS`: the zh and en label of each `dv_proj_*`, `dv_asset_*` and `dv_models_*` tool, whose packages declare no operation label; `operationLabel`: the zh and en name of an operation (its `label` in `/api/dv/operations`, else the `DV_TOOL_LABELS` entry of its tool, else the operation name); `toolNameOf`: the tool name of an operation. The composer's tool rows and the History panel show these names. `taskLabel`: the zh and en name of a generation task (its label in `WireTaskLabels`, the model catalog's labels of `GET /api/dv/tasks`, else the task name), shown by the take editor and the chat card of `@dv/ui-generation` |
| `tool-rows.tsx` | The shared parts of the chat rows of tool calls: `argsOf(raw)` (the parsed call arguments, `{}` while they stream), `wroteRecord(block)` (whether the result metadata names a written record), `outputsOf(block)` (the role, asset ID, URL and MIME type of each output asset), and `HistoryLink` (在历史中查看 / Show in history, test ID `dv-composer-open-history`, which dispatches `dv:history-focus`; each caller passes the button class of its own CSS module) |
| `current-project.ts` | The open project, kept on `window.__dvCurrentProject` and announced with `dv:current-project` |
| `zoom.ts` | `useZoomPresence(value, openerOf, onOpened?)`: the zoom transition of the pop-ups (the canvas node editor and the asset preview of `@dv/ui-media`). The pop-up grows out of the element that opened it in 300 ms and shrinks back into it in 250 ms while its backdrop fades; it stays on screen until it has shrunk back, whatever closed it. When the opener is gone or off screen, the pop-up scales a little and fades instead; under `prefers-reduced-motion` it only fades. A pop-up closed while it still grows shrinks from where it is on screen. `mediaBox(width, height, maxWidth, maxHeight)` sizes an image or a video of known dimensions before it loads, so a pop-up whose media sets its size has its final box when the transition measures it |
| `frame.ts` | The frame of a canvas node, the outline under its caption inside which its `dv.canvas.card` body draws: `NODE_FRAME_HEIGHT`, the height of the 16:9 frame at the 208-unit node width, 117 units; `frameHeight(size, fallback)`, the frame height of a picture, the 208-unit width at the picture's aspect ratio clamped between 3:4 and 16:9, or `fallback` when the width or height is unknown; `CARD_SURFACE`, the fill that a card-like body paints (the card surface and text color at the frame's full height), while a body that shows a picture of known size paints nothing else |
| `locale.ts` | `useText`, `pickText`: the Chinese or English string of a pair, following `<html lang>` |

`subscribe` uses `EventSource` when the browser has it and polls every three seconds otherwise. Every bundle that follows a project shares one stream per project through `window.__dvEventSources`; `window.__dvStreams` counts the open streams.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`DvClient` decodes every error body into a `DvApiError` that keeps the HTTP status and the `ProjectError` code; `listProjectSummaries` also checks every field type of the summaries and throws an `Error` for a malformed answer. `useLoader` keeps the last value while a reload is in flight and ignores a response whose inputs changed; `useProjectState` reads the project's current state and folds several project events of one burst into one refetch, so an undo or redo made anywhere refreshes every view. The types in `types.ts` copy the `@dv/project` types by hand because a host package's server modules cannot be imported into a browser bundle, and a plugin's slice type comes from the client face `./types` of its host package; a record arrives as `ProjectRecord` with its inputs' `ref` as the stored object.

| File | Content |
| --- | --- |
| [`src/client/api.ts`](src/client/api.ts) | The client and the shared event streams |
| [`src/client/form.ts`](src/client/form.ts) | The form model |
| [`src/client/timeline.ts`](src/client/timeline.ts) | Timeline helpers |
| [`src/client/references.ts`](src/client/references.ts) | Stored input references, record request inputs and shot reference assets |
| [`src/client/zoom.ts`](src/client/zoom.ts) | The pop-up zoom transition |
| [`src/client/useProject.ts`](src/client/useProject.ts), [`src/client/useView.ts`](src/client/useView.ts) | The hooks |
| [`src/client/ProjectBar.tsx`](src/client/ProjectBar.tsx) | The shared bar |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/api`](../api/README.md) — the routes and the JSON this client reads.
- [`@dv/ui-canvas`](../ui-canvas/README.md) and [`@dv/ui-timeline`](../ui-timeline/README.md) — the two views that use the hooks and the bar.
- [DreamVerse packages](../../../docs/subsystems/video-harness.md) — what a record, the history rules, and a stale mark mean.

-----

<a id="model-experience"></a>
## Model Experience

None, as browser-side client, form, and track helpers; they touch no prompt, schema, or tool result.

#### KV Cache effect

None; the kit sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Hand-copied wire types** — `types.ts` restates the host's types; a field added on the host side must be added here by hand.
- **Flat forms** — the form model renders nested objects and arrays as one JSON text field.
- **Polling fallback** — without `EventSource` a view polls every three seconds and cannot tell what changed.
