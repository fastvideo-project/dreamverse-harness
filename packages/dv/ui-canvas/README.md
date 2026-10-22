---
description: "The DreamVerse canvas: the records of a project drawn as asset and take nodes and the nodes of registered node types, linked by asset flow, with a floating editor that renders a new take as a user record and lends a plugin's editor entry the canvas's writes, asset picker, and asset preview."
kind: "package-reference"
---

# @dv/ui-canvas

English | [中文](README.zh.md)

## Summary

Use this package to give the web application a canvas over a DreamVerse project beside the chat. `CanvasView` draws the records of the project's current state as nodes on a surface that pans and zooms, linked by the assets that flowed between them, with stale records marked. Clicking a node opens a floating editor that renders a new take, adds references from the asset pool, or prefills the chat composer. The canvas is the 画布 / Canvas view of the shell's center (`dv.center.view`); the `dv-canvas` right-Sidebar tab type shows the same canvas under the project bar.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app` (which provides the right Sidebar, the locale service, and the client module loader) and `@dv/api` (which serves the routes the canvas calls). Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

The canvas shows the project's current state only, with no history view: images and videos on the canvas as `asset` nodes, the entries of the node types registered in `dvCanvas` (`@dv/ui-shot-plan` draws each plan at its latest version as a `plan` node), and generation records as `take` nodes: a record whose operation `GET /api/dv/operations` lists as not deterministic, on the GPU, with an image, video, or audio output, so a take that is still rendering is drawn; a record whose operation the list does not name is a take when it is not deterministic and has an image, video, or audio output (`isGenerationRecord` of `@dv/ui-kit`). The chain of a record is its `started_by`, else the `started_by` of its `based_on` root (`chainOf` of `@dv/ui-kit`), so a canvas retake keeps the chain of its original take. A chain is anchored when its starter record is loaded and a `ChainAnchor` for the starter's operation is registered in `dvCanvas`; the anchor names the node that the chain hangs off, such as `plan:p1`. A take card of an anchored chain is titled by the chain's slot, followed by ` · <lane>` when the chain has a lane (镜头 1 · 9:16 / Shot 1 · 9:16), and an edge links the anchor node to it; any other take, a free take, is titled by the operation's label in the interface language (its name when it declares none or when the list does not name the operation). A take card shows its first image output; its editor plays its first video output, or its first audio output in an audio player with sound. Takes linked by `based_on`, else takes with the same anchor, slot, and lane, are numbered in record order. The takes drawn are the takes of the chain that the newest starter of each starter operation started on each anchor node (so the chains of two workflows on one plan both show), every free take, every take whose outputs are in use (a record that a registered `TakesInUse` reports, such as the record of a timeline clip that `@dv/ui-timeline` reports, or the producer of a reference of a current character, location, style or plan version), and for each drawn take the takes it read its inputs from and its `based_on` family (the original take and its retakes). Takes of an earlier starter's chain that nothing uses are left out, so an undo or a "go back" to an earlier step changes what the canvas shows. A badge that a registered `TakesInUse` reports for an asset, such as 已裁剪 / Trimmed for a clip that a timeline trims, shows as given on the node of that asset. The frame grid of an entry with `slots`, such as a plan, shows for each slot the newest finished take of an anchored chain on the entry's node with that slot. An image or video has one `asset` node only while its asset ID is on the canvas (the `asset` slice's `placed`), unless an entry node (such as a reference image of a character, location, or style) or a `take` node (a take output) already shows it; a take that reads an asset off the canvas has no edge from it, and its editor still lists the reference. An asset goes on the canvas when the user drops its file or its asset pool tile on the canvas, or sends it in a chat message as an attached image or a `dv:asset/<id>` chip (`@dv/chat-references` places those); the editor of an `asset` node takes it off with "Remove from canvas", and the asset stays in the asset pool. Each of these is a step of the history, so History lists it and undo takes it back. The canvas follows the current state when it changes, and its edits become steps of the history at once.

```yaml
- id: dv-ui-canvas
  name: '@dv/ui-canvas'
```

The Host half registers nothing. The browser half provides the client service `dvCanvas` (`DvCanvas` of `@dv/ui-kit/registries.ts`: the registries `nodeTypes`, `chainAnchors`, `takesInUse`, and `versionKinds`), empty until plugin UI halves register into them. It also registers the `dv-canvas` tab type (a page the Sidebar's guide offers as "Video canvas"), the `dvCanvas` locale namespace in Chinese and English, and the tab body under its own id `@dv/ui-canvas`. It registers `CanvasCenter` as the `dv.center.view` entry `canvas` (order 0, labeled with the tab type's label 画布 / Canvas), a `CanvasView` of the project and the chat session of the center's owner props `projectId` and `session`. A plugin's UI half registers its descriptors inside `ctx.inject(['dvCanvas'], …)` and keeps the disposers; a second descriptor with a held key throws. The tab body and the center view pass the registries to `CanvasView` as its `canvas` prop. Each entry of a registered `NodeType` is a node with its type's `data-node-type`, in its type's layout `column`, drawn with one default card: the type dot in `NodeType.color`, `NodeType.label()` and ` · <subtitle>`, then for an entry with `slots` the frame grid when a slot has a frame and the title, and for any other entry its first image or video at 40 × 40, "+N" for more, and the title; an entry's media, and the assets of every earlier version of the item that a registered `VersionKind` draws as that entry, get no `asset` node of their own. The canvas reads a versioned item only through the registered `VersionKind`s: a take input `<id>@<n>` links from the node that the item's version kind names, the take editor's reference chips show and open the item, the asset picker offers the newest version of each item, and the plan editor lists the reference assets of each item version (`referenceAssets` of `@dv/ui-kit/references.ts`). The characters, locations and styles are the entries and version kinds of `@dv/ui-character`, `@dv/ui-location` and `@dv/ui-style`. The center view declares the keyed slots `dv.canvas.editor`, `dv.canvas.picker`, and `dv.canvas.preview` (their `SlotMap` entries are in `@dv/ui-kit/registries.ts`) and passes its `renderSlot` to `CanvasView` as `renderSlot`: the editor of an entry node shows the slot entry keyed by its `NodeType.id`, with `{ node, state, host }` as owner props, and only its header when no entry is registered. `host` (`EntryEditorHost`) runs an operation as a canvas write (the canvas's project, chat session, and `surface: 'canvas'`; a failure shows above the canvas), opens the asset picker of assets only, and opens the asset pool preview of an asset. The editor of a character, location or style is the entry of its UI package. The asset picker shows the `dv.canvas.picker` entry at key `assets` below the versioned items, and the asset preview shows the `dv.canvas.preview` entry at key `assets`; `@dv/ui-asset-pool` fills them with its asset pool panel and its preview. Only one entry can declare a slot, so the tab body declares no canvas slot and mounts `CanvasView` without `renderSlot`; its entry editors, those of characters, locations and styles included, show only their header, its asset picker offers only the versioned items, and an asset chip opens no preview.

| Gesture | Request |
| --- | --- |
| Edit a take's params or references and press "Render new take" | `POST /api/dv/operation` with the take's operation, the take's own params (its `modality`, `task`, `provider`, and `model` among them) with the edited fields, the edited inputs, `based_on` set to the shown take, `surface: 'canvas'` |
| An entry editor's `host.run`, such as the character editor adding or removing a reference | `POST /api/dv/operation` with the entry's operation, params, inputs, and intent; a file dropped in the picker first runs `asset.import` through `POST /api/dv/assets/import` |
| Drop image or video files on the canvas | `POST /api/dv/assets/import` with `surface=canvas`, whose `asset.import` also puts the asset on the canvas; the new node is placed under the pointer |
| Drop an asset pool tile on the canvas | a tile whose asset has a node moves that node under the pointer; any other image or video of the asset pool panel runs `POST /api/dv/operation` with `asset.place` and the asset as input role `asset`, and its new node is placed under the pointer |
| "Remove from canvas" in the editor of an `asset` node | `POST /api/dv/operation` with `asset.unplace` and the asset as input role `asset`; the asset stays in the asset pool |
| Ask the agent | the `dv:compose` window event, which prefills the chat composer with an `@` reference to the node |
| "Keep anyway" in the editor of a stale node | `POST /api/dv/stale/accept` for the node's record (`proj.stale_accept` as a step of the history) |
| Drag a node, pan, or zoom | `POST /api/dv/layout` with the moved positions, keyed by node ID, and the viewport |
| A node without a stored position appears | `POST /api/dv/layout` with its spot: its default layout position, moved down one row at a time until it covers no other card |

Every request carries `surface: 'canvas'` and the chat session the canvas sits beside, which the record stores as its `session`. A `dv:canvas-focus` window event with `{recordId}` centers and opens that record's node. When the record has no node of its own, the event opens the entry node of the version it wrote (`NodeEntry.records` of an entry, such as a plan for the record of an earlier version), else the node of its first output.

The floating editor opens centered over the dimmed canvas, at most 720 px wide and about 80% of the canvas height. Drag its title row to move it; drag its right edge, bottom edge, or bottom-right corner to resize it, or focus the corner handle and press the arrow keys (16 px per press); a double click on the title row puts it back at the centered default. The browser keeps one last position and size for every node in `localStorage` and fits them into the canvas the next time the editor opens. A click on the dimmed canvas or Escape closes the editor; with a second editor open over it, the same gestures close only the top one. The editor grows out of its node when it opens and shrinks back into the node when it closes, while the dimmed layer fades (`@dv/ui-kit/zoom.ts`).

Clicking a node selects it, which draws an accent ring, and opens its editor. Closing the editor keeps the ring, so the node stays easy to find; a click on empty canvas with no editor open clears it. After "Render new take" or a failed take's "Retry", the button reads "Rendering…" and is disabled until the new take's node appears; the editor then closes and the canvas centers and selects the new node, which shows "Rendering…" until the render ends. A request refused before that shows its error under the editor's button, or above the canvas for "Retry". A finished take that the user has not opened in this browser shows an accent dot beside its title until its editor opens. The browser keeps the opened takes per project in `localStorage`; a project opened for the first time in a browser starts with every finished take counted as opened.

The editor of a take shows its model and generation task from the record's params, the task by its label in the model catalog's `GET /api/dv/tasks` (else by its name), such as "fasth3 · From references" (task `ref2v`) or "fasth3 · From text" (task `t2v`), and one field for each other param that its operation declares in `GET /api/dv/operations`: the prompt first, then duration and seed under their localized labels, and any other param under its key. A take has reference chips when its operation declares a `reference` input and its task is not `t2v`. A take whose operation the list does not name shows no fields and no "Render new take". A reference chip shows its image or the first frame of its video; clicking it opens the asset pool preview of an asset, or the editor of the node of a versioned item over the take's editor, which keeps the take's unsaved changes. "Add asset" in a take's editor, and `host.pickAssets` of an entry editor, open the asset picker: one section per registered version kind, titled with the kind's `label()`, with the newest version of each of its items that the take does not reference yet (in a take's editor only; a kind with no such item shows no section), then the asset pool panel of `@dv/ui-asset-pool` with its import drop zone. Clicks pick and unpick items, and "Confirm" appends them in pick order. The editor of a `plan` entry shows the plan editor of `@dv/ui-shot-plan` (its versions, approval status, and shots).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`CanvasView` reads the project's current state with `useProjectState` from `@dv/ui-kit/useProject.ts`; `buildCanvasGraph` turns it into nodes, edges, and a default column layout: assets first, the entries of each node type in its column (plans in column 1), takes by first-frame depth, retakes beside their source take. Inside a column, takes are placed by the anchor of their chain, in the order of each anchor's first take (a free take keeps its own place), then by slot (a take without a slot last), then by lane, in the order of each lane's first take, then in record order. An entry node's ID is the entry's own, such as `character:<id>` or `plan:<PlanId>`; an `asset` node's ID is the current-state `asset.import` record that output the asset, else `asset:<AssetId>` with no record (an import that an undo went back past, a still, an export); every other node's ID is its record ID. Stored positions from `/api/dv/layout` override the default layout; a failed layout read or write is ignored. Requests carry inputs as reference text (`<asset>`, `<record>#<output>`, `<id>@<version>`), which `formatInputRef` of `@dv/ui-kit/references.ts` writes from a record's stored input references, for a version of any reference kind. The state refetches on every `/dv/events` frame, so an asset a chat message places appears without a reload; a placement this view sent shows at once and stays until the state shows it, and a refused placement is put back.

| File | Content |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | The `dvCanvas` service and registrations |
| [`src/client/dv-canvas.ts`](src/client/dv-canvas.ts) | The `dvCanvas` registries |
| [`src/client/definition.ts`](src/client/definition.ts) | The tab type |
| [`src/client/CanvasBody.tsx`](src/client/CanvasBody.tsx) | The tab body: the project bar above a `CanvasView` |
| [`src/client/CanvasCenter.tsx`](src/client/CanvasCenter.tsx) | The center view: a `CanvasView` that renders the entry editor slot |
| [`src/client/CanvasView.tsx`](src/client/CanvasView.tsx) | The surface: pan, zoom, drag, drop, layout storage |
| [`src/client/graph.ts`](src/client/graph.ts) | Nodes, edges, and the default layout |
| [`src/client/NodeCard.tsx`](src/client/NodeCard.tsx), [`src/client/NodeEditor.tsx`](src/client/NodeEditor.tsx) | The node card and the floating editor |
| [`src/client/AssetPicker.tsx`](src/client/AssetPicker.tsx) | The asset picker and the asset preview, which render the `dv.canvas.picker` and `dv.canvas.preview` entries, and the image or video thumbnail |
| [`src/client/locales.ts`](src/client/locales.ts) | The `dvCanvas` dictionaries |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/api`](../api/README.md) — the routes behind every gesture.
- [`@dv/ui-kit`](../ui-kit/README.md) — the API client, the wire types, and the hooks.
- [DreamVerse Project](../../../docs/dreamverse/subsystems/project.md) — staleness, takes, and the history rules as the canvas shows them.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the records its gestures write reach the model only through the `dv:project` prompt section and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the canvas sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No new nodes from the canvas** — the editor renders new takes of existing records and changes the references of characters, locations, and styles; starting a plan or a character is left to the chat.
- **Whole-graph rebuild** — every project event refetches the state and rebuilds the graph; a long project redraws slowly.
