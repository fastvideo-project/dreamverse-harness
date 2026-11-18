---
description: "Canvas component of DreamVerse: the dvCanvasNodes service and the canvas slice, the node list of a project with each node's kind, versions and position rebuilt from the records, the canvas.node_position, canvas.node_remove and canvas.node_rename operations with their agent tools, and the registrations through which producers name the operations that make nodes."
kind: "package-reference"
---

# @dv/canvas

English | [中文](README.zh.md)

## Summary

Use this package to keep what sits on a project's canvas as part of the project. The `canvas` slice lists every node with its kind, versions, position and size, and it is rebuilt from the records, so undo, redo, and History cover every change to a node. A rerun joins the node of the version it reruns, which keeps its name. One record moves or resizes a node (`canvas.node_position`), removes nodes (`canvas.node_remove`), or renames a node (`canvas.node_rename`); the agent's tools `dv_canvas_node_position`, `dv_canvas_node_remove` and `dv_canvas_node_rename` work whether or not a canvas is open.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project`, which the service injects. The service has no configuration. It registers the component key `canvas`, the `canvas` reducer, and the operations `canvas.node_position`, `canvas.node_remove` and `canvas.node_rename` with `dvProject`, which turns them into the agent tools `dv_canvas_node_position`, `dv_canvas_node_remove` and `dv_canvas_node_rename`. `@dv/api` injects `dvCanvasNodes`, so the browser always receives the `canvas` slice.

```yaml
- id: dv-canvas
  name: '@dv/canvas'
```

| Operation | Tool | Inputs and params | Outputs |
| --- | --- | --- | --- |
| `canvas.node_position` | `dv_canvas_node_position` | params `node` (required, a node ID), `x`, `y`, `width`, `height`; at least one of the four; `width` and `height` more than 0 | none |
| `canvas.node_remove` | `dv_canvas_node_remove` | param `nodes` (required, one or more node IDs); the record's `report.removed` keeps each removed node as it was | none |
| `canvas.node_rename` | `dv_canvas_node_rename` | params `node` (required, a node ID) and `name` (required, a string or null; trimmed, line breaks become spaces, at most 80 characters; empty or null clears the name) | none |

The precondition refuses, for every caller and before any record, a node that the current state does not hold (the message lists the node IDs) and a call without any of `x`, `y`, `width` and `height`. It does not check overlap with other nodes. A field that the call leaves out keeps its value. The precondition of `canvas.node_remove` refuses, before any record, an empty `nodes` and a node that the current state does not hold; each message ends `Nothing was removed.` A removed node's versions, their assets, and every reference to them stay: shot inputs, timeline clips, chat mentions, `based_on`, and the asset pool. A node whose newest version is pending or running can be removed; its render continues and its output goes to the asset pool. The precondition of `canvas.node_rename` refuses an unknown node, a name longer than 80 characters, and a name equal to the node's current name. A name sets only the canvas label: the character, location, or style name, the text node's path, and the asset names and files stay as they are, and no record becomes stale. Names need not be unique, because node IDs tell nodes apart.

A producer names the operations whose records make nodes, inside `ctx.inject(['dvCanvasNodes'], …)`, so it loads without this package and registers again when the canvas loads:

| Method | Registration | Used by |
| --- | --- | --- |
| `registerMaker({operations, kind, column, size?, makes?})` | The records of `operations` make nodes of `kind` in layout `column` (0 at the left); `size`, the `{width, height}` frame that the browser draws an unsized node of `kind` with, is the box that the free row keeps clear; `makes(record)`, given the record's `params` and `status`, returning false skips a record | `defineGeneration` of `@dv/generation` (`shot`, `image`, `audio` in column 2), `defineReference` of `@dv/reference-kit` (`<k>.create`, kind `<k>`, column 0), `@dv/text-node` (`textnode.write`, kind `text`, column 0), `@dv/asset-pool` (a finished `asset.import` with `place: true`, kind `asset`, column 0), `@dv/timeline` (a finished `timeline.place`, kind `timeline`, column 3, size 640 × 390) |
| `registerPlacement({place, kind, column})` | A finished `place` record adds a node of `kind` for each input asset that no node shows; `canvas.node_remove` takes such a node off as any other node | `@dv/asset-pool` (`asset.place`, kind `asset`, column 0) |

Each method returns the disposer of its registration. An operation that a maker or a placement already names throws `invalid_params`. The `kind` is the node type key that the browser half draws the node with: the UI plugin registers a `NodeType` of `@dv/ui-canvas/contract` whose `type` is the same string, and a kind without one draws a plain card.

The slice `state.components.canvas` holds `nodes` by node ID, `order` (the node IDs in creation order), and `assets` (the node that shows each asset). A node holds `kind`; `name` (null: the card shows the title that its node type computes); `versions`, the records it shows, oldest first, with the newest on the card; `asset`, for a node that a placement made; and `position`, `{x, y, width, height}` in canvas units with y growing downward, where `x` and `y` are the top-left corner of the node (the top of its 20-unit caption) and `width` and `height` are the frame below the caption, null for the default size of the node's type. A node's ID is the ID of the record that created it; a placement of several assets gives the second and later nodes the record ID with `.2`, `.3`, and so on.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The reducer reads every record of the chain up to the current position, oldest first, and applies the first rule that matches. (1) A record whose `based_on` is a version of node N becomes the newest version of N, unless its operation is one of the canvas's own (`canvas.node_position`, `canvas.node_remove`, `canvas.node_rename`), a placement's, or a maker's of another kind than N's; such a record goes on to the next rules. (2) A record of an operation that a maker names, and that `makes` accepts, creates a node of the maker's kind in the first free row of its column, with the default size. (3) A finished placement `place` record creates a node for each input asset that no node shows. (4) A finished `canvas.node_remove` record deletes the nodes that its `nodes` param names from `nodes`, `order`, and `assets`; an undo replays the chain without the record, so each node comes back with its name, versions, and position. (5) A finished `canvas.node_position` record sets the position fields that its params give, on a node that the slice holds. (6) A finished `canvas.node_rename` record sets the name of a node that the slice holds; an empty or null name clears it. (7) Every other record leaves the slice as it is. Rules 1 and 2 take records in any status, so a pending, running, or failed version shows its state on the node; a failed render stays a version with its Retry action. `assets` maps the placed asset of a placement node and the outputs of each node's newest version to the node.

The producers set `based_on` without a canvas field. The editor's prompt edit, Rerun, and Retry pass `based_on` with the rerun version. `OperationSpec.basedOn` of `@dv/project` fills `based_on` for a call whose caller names none: `<k>.update` of `@dv/reference-kit` and `textnode.write` and `textnode.edit` of `@dv/text-node` name the record of the item's newest version, so every version of a character, location, style, or text path joins one node. A record whose `based_on` names a record that no node holds, such as a version of a removed node, falls through to rule 2 and makes a new node.

A new node takes the first row of its column where its box overlaps no node's box: a column is 240 units wide and a row 200 units tall, and a node of the default size has the `size` that its kind's maker declares, plus the 20-unit caption, or else one cell at its corner, because only the browser knows the default size of other node types. The slice is computed from the records at every read, so it follows the registrations that are loaded at that read.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvCanvasNodes`: the component, the reducer, `canvas.node_position`, `canvas.node_remove`, `canvas.node_rename`, `registerMaker`, and `registerPlacement` |
| [`src/reducer.ts`](src/reducer.ts) | The `canvas` reducer with its seven rules, the name rules, the free-row placement, and the agent summary |
| [`src/types.ts`](src/types.ts) | `NodeId`, `NodePosition`, `CanvasNode`, `CanvasState`, `NodeMaker`, `AssetPlacement`, and the `canvas` slice declaration |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/project`](../project/README.md): reducers, `based_on`, `OperationSpec.basedOn`, undo, and the agent tool of each operation.
- [`@dv/ui-canvas`](../ui-canvas/README.md): the browser canvas that draws the node list, writes `canvas.node_position` for a drag or a resize, `canvas.node_remove` for 从画布移除 / Remove from canvas, and `canvas.node_rename` for a rename.
- [`@dv/asset-pool`](../asset-pool/README.md): the asset nodes and the operation `asset.place`.
- [Canvas node list](../../../.agents/notes/implemented/architecture/2026-11-08-dv-canvas-node-list.md): why the node list is a host base package and why moves are records.

-----

<a id="model-experience"></a>
## Model Experience

### `dv_canvas_node_position` tool definition

#### What the model sees

One tool, `dv_canvas_node_position`, in the format `@dv/project` gives every operation tool, with the shared arguments `reason`, `supersedes` and `based_on` and no `inputs`. The description and the param descriptions are below.

##### dv_canvas_node_position description

```markdown
Move or resize one canvas node: give the new x and y of the top-left corner of the node (the top of its 20-unit caption), and the new width and height of its frame, which sits below the caption; canvas units, y grows downward. Fields you leave out keep their value. Works whether or not the user has a canvas open, and the user sees the change at once. The change is a step of the project history, so dv_proj_undo reverts it. dv_proj_state lists the nodes under canvas.
```

##### dv_canvas_node_position argument descriptions

```markdown
- node: The node ID, as dv_proj_state or dv_canvas_read lists it.
- x: The new left edge of the node.
- y: The new top edge of the node.
- width: The new frame width; more than 0.
- height: The new frame height; more than 0.
```

#### Token effect

About 380 tokens, fixed while the plugin is mounted; the shared arguments of `@dv/project` are about 200 of them.

#### KV Cache effect

The definition sits in the stable tool section of every agent request; mounting or removing the plugin changes the tool list and invalidates the cached prefix from the tool section on.

### `dv_canvas_node_position` results

#### What the model sees

A call returns one text block: `done <record>: moved node <id>`, or `resized node <id>` when the call gives `width` or `height`, and the params. An unknown node fails with `The canvas has no node <id>. Its nodes are: <ids>.`, a call without a field with `Give at least one of x, y, width and height.`, and a size of 0 or less with `width must be more than 0.` or `height must be more than 0.` A move or a resize by the user reaches the agent as a project update line such as `- done <record> (user on canvas): moved node <id>`.

#### Token effect

About 40 tokens per call.

#### KV Cache effect

The result is appended to the conversation after the call; the cached prefix stays intact.

### `dv_canvas_node_remove` tool definition

#### What the model sees

One tool, `dv_canvas_node_remove`, in the same format, with the shared arguments `reason`, `supersedes` and `based_on` and no `inputs`. The description and the param description are below.

##### dv_canvas_node_remove description

```markdown
Remove nodes from the canvas. Each node goes with all its versions and the edges to and from it. Its assets stay in the asset pool, and every use of them stays: shot inputs, timeline clips, and nodes made from its outputs. A node that is still rendering can be removed; its output goes to the asset pool. A later step based on a version of a removed node makes a new node. Works whether or not the user has a canvas open. The removal is a step of the project history, so dv_proj_undo brings the nodes back with their versions and positions.
```

##### dv_canvas_node_remove argument descriptions

```markdown
- nodes: The node IDs to remove, as dv_proj_state or dv_canvas_read lists them.
```

#### Token effect

About 330 tokens, fixed while the plugin is mounted; the shared arguments of `@dv/project` are about 200 of them.

#### KV Cache effect

The definition sits in the stable tool section of every agent request; mounting or removing the plugin changes the tool list and invalidates the cached prefix from the tool section on.

### `dv_canvas_node_rename` tool definition

#### What the model sees

One tool, `dv_canvas_node_rename`, in the same format, with the shared arguments `reason`, `supersedes` and `based_on` and no `inputs`.

##### dv_canvas_node_rename description

```markdown
Rename one canvas node: the name replaces the title on its card, in dv_canvas_read and in dv_proj_state. The name is trimmed, line breaks become spaces, and it has at most 80 characters; an empty or null name clears it, so the card shows the title its type computes again. The name is only the canvas label: the node keeps its id, versions, assets, files, text path and character, location or style name, and nothing becomes stale. Names need not be unique. Works whether or not the user has a canvas open. The change is a step of the project history, so dv_proj_undo reverts it.
```

##### dv_canvas_node_rename argument descriptions

```markdown
- node: The node ID, as dv_proj_state or dv_canvas_read lists it.
- name: The new name; empty or null clears it.
```

#### Token effect

About 330 tokens, fixed while the plugin is mounted; the shared arguments of `@dv/project` are about 200 of them.

#### KV Cache effect

The definition sits in the stable tool section of every agent request; mounting or removing the plugin changes the tool list and invalidates the cached prefix from the tool section on.

### `dv_canvas_node_remove` results

#### What the model sees

A call returns one text block: `done <record>: removed node <ids> from the canvas`, the params, and `report: {"removed": {<id>: <node>}}`, each removed node as it was, with `kind`, `name`, `versions` and `position`. A call that names a node that the canvas does not hold fails with `The canvas has no node <ids>; its nodes are: <ids>. Nothing was removed.`, and a call with an empty `nodes` with `Name at least one node. Nothing was removed.` A removal by the user reaches the agent as a project update line such as `- done <record> (user on canvas): removed node <id> from the canvas`.

#### Token effect

About 60 tokens per call, plus about 60 per removed node for the report.

#### KV Cache effect

The result is appended to the conversation after the call; the cached prefix stays intact.

### `dv_canvas_node_rename` results

#### What the model sees

A call returns one text block: `done <record>: renamed node <id> to "<name>"`, or `cleared the name of node <id>` for an empty or null name, and the params. An unknown node fails as for `dv_canvas_node_position`, a long name with `The name can have at most 80 characters; this one has <n>.`, and the current name with `The node is already named "<name>".` or, for a node without a name, `The node has no name to clear.` A rename by the user reaches the agent as a project update line such as `- done <record> (user on canvas): renamed node <id> to "<name>"`.

#### Token effect

About 40 tokens per call.

#### KV Cache effect

The result is appended to the conversation after the call; the cached prefix stays intact.

### `canvas` field of the project summary

#### What the model sees

The project summary that `dv_proj_state` and the project state message give carries `canvas`: one entry per node in creation order, `{node, kind, name, shown, x, y, width, height}`, where `name` is the name the user or the agent gave, null for the title that the node type computes, `shown` is the record of the newest version, and a null `width` or `height` is the default size of the node's type.

#### Token effect

About 40 tokens per node.

#### KV Cache effect

The field is part of a tool result or of the project state message, which are appended to the conversation; a later move changes only later summaries, so the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **New nodes can overlap a tall card**: the host places a new node by a nominal 240 × 200 cell for a kind whose maker declares no `size`, because only the browser knows that node type's default size, so a default card taller than one row can overlap the node placed in the next row until the user or the agent moves it.
- **No overlap check on moves**: `canvas.node_position` accepts a position that covers another node, because the host knows a node's size only after a resize.
- **Projects with `asset.unplace` records**: the operation is gone, so the reducer skips such a record of an earlier build, and the asset node that it removed shows again until the user or the agent removes it with `canvas.node_remove`.
- **Nodes follow the loaded producers**: while a producer is not loaded, its records make no nodes, and the moves of those nodes have no effect until it loads again.
