---
description: "The DreamVerse canvas: the nodes of the node types that plugins register through `@dv/ui-canvas/contract`, drawn in one chrome and linked by asset flow, the `dv.canvas` Factory that the workspace center and the right-Sidebar tab render, and the floating editor shell that lends each type's editor body the canvas's writes, asset picker, and asset preview."
kind: "package-reference"
---

# @dv/ui-canvas

English | [中文](README.zh.md)

## Summary

Use this package to give the web application a canvas over a DreamVerse project beside the chat. `CanvasView` draws the project's current state as nodes of plugin node types (`@dv/ui-canvas/contract`) on a surface that pans and zooms, linked by the assets that flowed between them, with stale records marked. Clicking a node opens a floating editor that renders a new take, adds references from the asset pool, or prefills the chat composer. The canvas is the 画布 / Canvas view of the shell's center (`dv.center.view`); the `dv-canvas` right-Sidebar tab type shows the same canvas under the project bar.

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

The canvas shows the project's current state only, with no history view, and every node comes from a registered `NodeType`. A type has slice entries, claimed nodes, or both. Slice entries (`entries`) are the `NodeEntry` values that a type reads from its own slice of the state, such as the plans of `@dv/ui-shot-plan` or the characters of `@dv/ui-character`. Claimed nodes (`claimed`) stand for the current records of the operations that the type claims, such as `shot.render` for the takes of `@dv/ui-shot-render`. The canvas builds each claimed node from its record: the node ID is the record ID, the node's assets are the record's outputs, and its edges are the record's inputs, chain, and `based_on`; the type supplies only the title, `meta`, preview, and body height. A record whose operation no type claims draws no node. Node IDs are unique: building the graph throws when two drawn nodes have one ID, and the message names both node types. The chain of a record is its `started_by`, else the `started_by` of its `based_on` root (`chainOf` of `@dv/ui-kit/chain.ts`), so a rerun keeps the chain of its original record. A chain is anchored when its starter record is loaded and a `ChainAnchor` for the starter's operation is registered; the anchor names the node that the chain hangs off, such as `plan:p1`, and an edge links that node to each claimed node of the chain. The current claimed records are the records of the chain that the newest starter of each starter operation started on each anchor node (so the chains of two workflows on one plan both show), every claimed record without an anchored chain, every claimed record whose outputs a registered `RecordsInUse` reports in use (through records that no type claims, such as a still grab), and, for each of these, the claimed records it read its inputs from and its `based_on` family. Records of an earlier starter's chain that nothing uses are left out, so an undo or a "go back" to an earlier step changes what the canvas shows. Records linked by `based_on`, else records with the same anchor, slot, and lane, form a group; each record of a group of several gets a 1-based `version` number in record order. A badge that a registered `RecordsInUse` reports for an asset, such as 已裁剪 / Trimmed for a clip that a timeline trims, shows as given on the node of that asset. The frame grid of an entry with `slots`, such as a plan, shows for each slot the preview of the newest finished claimed node of an anchored chain on that entry's node with that slot. The assets of slice entries belong to those entries, then the assets of every earlier version of an item that a registered `VersionKind` draws as a slice entry, then the outputs of claimed nodes. An entry with `standIn`, such as the asset node that `@dv/ui-asset-pool` draws for each asset on the canvas list (the `asset` slice's `placed`), draws only while no other node owns one of its assets. An asset goes on the canvas when the user drops its file or its asset pool tile on the canvas, or sends it in a chat message as an attached image or a `dv:asset/<id>` chip (`@dv/chat-references` places those). Each of these is a step of the history, so History lists it and undo takes it back. The canvas follows the current state when it changes, and its edits become steps of the history at once.

```yaml
- id: dv-ui-canvas
  name: '@dv/ui-canvas'
```

The Host half registers nothing. The browser half provides the client service `dvCanvas` (`DvCanvas` of `@dv/ui-canvas/contract`), whose five registries stay empty until plugin UI halves register into them: `nodeTypes` (`NodeType`, keyed by `type` and by `op:<operation>` for each claimed operation, so two types never claim one operation), `chainAnchors` (`ChainAnchor`, keyed by `starter`), `recordsInUse` (`RecordsInUse`, keyed by `id`), `versionKinds` (`VersionKind` of `@dv/ui-kit/registries.ts`, keyed by `kind`), and `actions` (`NodeAction`, keyed by `id`). A plugin's UI half registers its descriptors inside `ctx.inject(['dvCanvas'], …)` and keeps the disposers; a second descriptor with a held key throws an error that names the holder. The browser half registers the `dv.canvas` Component Factory, which takes the props `projectId`, `session`, and `focus`, reads the registries through its inject `hooks`, and declares four keyed child slots that a node type fills under its `NodeType.type`: `dv.canvas.card` (the card body, with the owner props `CardOwner`: the node, the wire asset of each of its assets, the text scale, and a `CardHost`; without an entry the card shows the type label), `dv.canvas.editor` (the editor body of a slice node, with the owner props `EditorOwner`, whose `EditorHost` adds the editor's asset picker), `dv.canvas.editor.claimed` (the editor body of a claimed node, with the owner props `EditorOwner<ClaimedNodeView>`), and `dv.canvas.picker` (the asset pool inside the asset picker, at key `assets`, with the owner props `PickerOwner`). An editor without an entry shows only its header. It also registers the `dv-canvas` tab type (a page the Sidebar's guide offers as "Video canvas"), the `dvCanvas` locale namespace in Chinese and English, the tab body under its own id `@dv/ui-canvas`, and `CanvasCenter` as the `dv.center.view` entry `canvas` (order 0, labeled with the tab type's label 画布 / Canvas). The center view and the tab body each render a `dv.canvas` occurrence for their project and chat session, so both draw the same cards, editors, and picker. Card and editor bodies draw media through the `dv.media` Factory of `@dv/ui-media`. A `NodeAction` shows on each node for which its `shows` returns true, in `order`: in the editor header and in the failed row of a failed claimed node; its `run` receives the node and a `NodeHost`, which has no asset picker.

The UI plugins that fill the canvas are `@dv/ui-asset-pool` (the asset node type, its card and editor bodies, the "Remove from canvas" action, and the picker's asset pool), `@dv/ui-shot-plan` (the plan node type, its card and editor bodies, and the records that plans use), `@dv/ui-workflow-story` (the chain anchor of `story.approve`, which hangs a chain off `plan:<id>`), `@dv/ui-timeline` (the records that timeline clips use and their trim badges), and `@dv/ui-composer` (the "Ask the agent" action, which prefills the chat composer through the `dv:compose` window event). Each generation UI plugin that `defineGenerationUi` of [`@dv/ui-generation`](../ui-generation/README.md) defines, such as `@dv/ui-shot-render` for the shot render takes, registers a claimed node type, its card and claimed-editor bodies, and the "Retry" action of a failed take. The reference nouns `@dv/ui-character`, `@dv/ui-location`, and `@dv/ui-style` come from `defineReferenceUi` of [`@dv/ui-reference-kit`](../ui-reference-kit/README.md): each registers a node type with slice entries, its card and editor bodies, a version kind, and the records that its references use.

| Gesture | Request |
| --- | --- |
| `host.run` of a card body, an editor body, or an action, such as a reference noun's editor adding or removing a reference | `POST /api/dv/operation` with the body's operation, params, inputs, and intent, completed with the canvas's project, chat session, and `surface: 'canvas'`; a failure shows above the canvas |
| `host.rerun`, such as a take editor's "Render new take" or a failed take's "Retry" | `POST /api/dv/operation` with the request and its `based_on` record, completed the same way; the canvas waits for the new node |
| Drop files on the canvas | `POST /api/dv/assets/import` with `surface=canvas` for each file, of any media type, whose `asset.import` also puts the asset on the canvas; the first new node is placed under the pointer and each further one 32 units right of and below the one before |
| Drop an asset pool tile on the canvas | a tile whose asset has a node moves that node under the pointer; any other asset of the asset pool panel runs `POST /api/dv/operation` with `asset.place` and the asset as input role `asset`, and its new node is placed under the pointer |
| `host.setPlaced`, such as "Remove from canvas" in the editor of an asset node | `POST /api/dv/operation` with `asset.place` or `asset.unplace` and the asset as input role `asset`; the view shows the change at once and puts it back when the request is refused |
| "Keep anyway" in the editor of a stale node | `POST /api/dv/stale/accept` for the node's record (`proj.stale_accept` as a step of the history) |
| Drag a node, pan, or zoom | `POST /api/dv/layout` with the moved positions, keyed by node ID, and the viewport |
| A node without a stored position appears | `POST /api/dv/layout` with its spot: its default layout position, moved down one row at a time until it covers no other card |

Every request except the layout requests carries `surface: 'canvas'` and the chat session the canvas sits beside, which the record stores as its `session`. The center view opens the node of a record when the workspace center hands it the request `{ record: <id> }`, which `dvCenter.show({ view: 'canvas', target: { record } })` of `@dv/ui-shell/contract` names, as History does for a selected record. The canvas centers, selects, and opens the record's own node, else the node whose `record` is that record, else the entry node whose `records` lists it (such as a plan for the record of an earlier version), else the node that holds the record's first output. A request waits while no node matches, so a node type that registers later still opens its node; the canvas takes the request when it opens the node, so a remounted canvas does not open the node again. The tab body passes no focus.

The floating editor opens centered over the dimmed canvas, at most 720 px wide and about 80% of the canvas height. Drag its title row to move it; drag its right edge, bottom edge, or bottom-right corner to resize it, or focus the corner handle and press the arrow keys (16 px per press); a double click on the title row puts it back at the centered default. The browser keeps one last position and size for every node in `localStorage` and fits them into the canvas the next time the editor opens. A click on the dimmed canvas or Escape closes the editor; with a second editor open over it, the same gestures close only the top one. The editor grows out of its node when it opens and shrinks back into the node when it closes, while the dimmed layer fades (`@dv/ui-kit/zoom.ts`). Its header shows the type dot and the type label (left out when it equals the title), the title, the actions that show on the node, and close; a stale node shows 已过期 / Stale and "Keep anyway" above the body.

Clicking a node selects it, which draws an accent ring, and opens its editor. Closing the editor keeps the ring, so the node stays easy to find; a click on empty canvas with no editor open clears it. After a body or an action calls `host.rerun`, the node's actions are disabled (`NodeView.rerunning`), and in the failed row the button of the action that started the rerun reads the type's running words, until a new node whose record is `based_on` the rerun record appears; the editor then closes and the canvas centers and selects the new node. When the request returns first, as for a record that no type draws, the editor closes then. The `host.rerun` of an editor body (`EditorHost`) rejects with the error of a request that fails before the new node appears. The canvas waits for one rerun at a time, so a later rerun settles the rerun that it replaces, which shows no failure. The body shows the error, and the rerun of an action or a card body (`NodeHost`) shows that error in the canvas notice over any open editor, alike from the editor header and the failed row. A finished claimed node that the user has not opened in this browser shows an accent dot beside its title until its editor opens. The browser keeps the opened nodes per project in `localStorage`; a project opened for the first time in a browser starts with every finished node counted as opened.

The canvas draws every card in one chrome around its type's `dv.canvas.card` body: a header with the type dot in `NodeType.color`, the title, the unseen dot, the 已过期 / Stale tag, and `meta` in the mono style; for an entry with `slots`, a three-column frame grid when a slot has a frame; then the body, with the type's status words (`claimed.status`, else 运行中… / Running… and 失败 / Failed) over it while the record is pending or running or after a slice node's record failed, and the badges over its bottom-left corner. A failed claimed node shows no body: a danger row with the type's failure words and the actions that show on it, with the record's error message on hover. A superseded record's node is dimmed, and a stale node has a danger outline. Each edge takes the color of its source node's type; a `based_on` edge is dashed, and the edges of the selected node are drawn on top in the accent color. The `NodeHost` that an editor body and an action receive adds these to `run` and `rerun`: `pickAssets` opens the asset picker, `preview` opens the asset preview of `dvMedia.preview` of `@dv/ui-media` growing out of the opener (nothing opens while no media plugin is loaded), `reference` returns the name, asset, and item node that reference text such as `hero@1` or an asset ID names, read through the registered version kinds, `openNode` opens another node's editor over this one, which keeps its unsaved changes, `setPlaced` puts an asset on the canvas list or takes it off, and `close` closes the editor. With `versions: true`, the asset picker shows one section per registered version kind, titled with the kind's `label()`, with the newest version of each item that the editor does not hold, drawn through `dv.media`; below them it shows the `dv.canvas.picker` entry at key `assets`. Clicks pick and unpick items, and "Confirm" hands the picked references over in pick order.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`CanvasView` reads the project's current state and the operations with `useProjectState` and `useOperations` from `@dv/ui-kit/useProject.ts`; `buildCanvasGraph` of `graph.ts` turns them and the registered descriptors into nodes, edges, and a default layout: each node in its type's `column`, a node one column right of the node it reads a `deepenOn` input role from (such as `first_frame` for a video take that continues the previous shot), and a rerun right after its source in the source's column. Inside a column, claimed nodes are placed by the anchor of their chain, in the order of each anchor's first record (a node without a chain keeps its own place), then by slot (a node without a slot last), then by lane, in the order of each lane's first record, then in record order; a column with more nodes than the shared row count wraps into sub-columns. A slice node's ID is its entry's own, such as `character:<id>` or `plan:<PlanId>`; a claimed node's ID is its record ID. A claimed node draws one edge per input, from the node of the versioned item that an `<id>@<version>` input names when a version kind draws that node, else from the node of the input's asset (the node that owns it, else the nearest drawn claimed record up its producer chain), plus a chain edge from its anchor and a lineage edge from its `based_on` record; a slice node draws no edges. `NodeEntry.bodyHeight` gives the card height before mount (chrome header, frame grid when a slot has a frame, and body), which the free positions, the edge anchors, and the focus use. Stored positions from `/api/dv/layout` override the default layout; a failed layout read or write is ignored. The state refetches on every `/dv/events` frame, so an asset a chat message places appears without a reload; a placement this view sent shows at once and stays until the state shows it, and a refused placement is put back.

| File | Content |
| --- | --- |
| [`src/client/contract/index.ts`](src/client/contract/index.ts) | `@dv/ui-canvas/contract`: the node contract, `DvCanvas`, and the `dv.canvas.*` slots (types only) |
| [`src/client/index.ts`](src/client/index.ts) | The `dvCanvas` service and registrations |
| [`src/client/dv-canvas.ts`](src/client/dv-canvas.ts) | The five `dvCanvas` registries |
| [`src/client/definition.ts`](src/client/definition.ts) | The tab type |
| [`src/client/CanvasFactory.tsx`](src/client/CanvasFactory.tsx) | The `dv.canvas` Factory: the registries read through the inject hooks, handed to `CanvasView` |
| [`src/client/CanvasBody.tsx`](src/client/CanvasBody.tsx) | The tab body: the project bar above a `dv.canvas` occurrence |
| [`src/client/CanvasCenter.tsx`](src/client/CanvasCenter.tsx) | The center view: a `dv.canvas` occurrence that opens the node of the request's record |
| [`src/client/CanvasView.tsx`](src/client/CanvasView.tsx) | The surface: pan, zoom, drag, drop, layout storage, focus, rerun, the node hosts |
| [`src/client/graph.ts`](src/client/graph.ts) | Nodes, edges, current records, version numbers, slot frames, and the default layout |
| [`src/client/NodeCard.tsx`](src/client/NodeCard.tsx), [`src/client/NodeEditor.tsx`](src/client/NodeEditor.tsx) | The node chrome and the floating editor shell |
| [`src/client/AssetPicker.tsx`](src/client/AssetPicker.tsx) | The asset picker, which renders the version kinds' items and the `dv.canvas.picker` entry |
| [`src/client/locales.ts`](src/client/locales.ts) | The `dvCanvas` dictionaries |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/api`](../api/README.md) — the routes behind every gesture.
- [`@dv/ui-kit`](../ui-kit/README.md) — the API client, the wire types, the registries, and the hooks.
- [`@dv/ui-shell`](../ui-shell/README.md) — the workspace center and `dvCenter`, which moves it to the canvas.
- [`@dv/ui-media`](../ui-media/README.md) — the `dv.media` Factory that draws the canvas's assets, and the asset preview.
- [DreamVerse packages](../../../docs/subsystems/video-harness.md) — staleness, takes, and the history rules as the canvas shows them.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the records its gestures write reach the model only through the `dv:project` prompt section and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the canvas sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No new nodes from the canvas** — the registered bodies and actions rerun existing records, change the references of characters, locations, and styles, and place or remove assets; starting a plan or a character is left to the chat.
- **Whole-graph rebuild** — every project event refetches the state and rebuilds the graph; a long project redraws slowly.
- **State through `@dv/ui-kit` hooks** — `CanvasView` reads the project state, the operations, and the interface language through `useProjectState`, `useOperations`, and `useLanguage` of `@dv/ui-kit` instead of an inject `hooks` source, and the plugin injects a `DvClient` instance into the `dv.canvas` Factory and the tab body instead of plain callbacks ([client rules](../../client/AGENTS.md)). No contract type names `DvClient` or a React hook.
