# Agent Note: DreamVerse data flow — records, reducers and slices of the dvProject kernel

Status: implemented

English | [中文](2026-10-17-dv-architecture-data-flow.zh.md)

## Problem

Every DreamVerse project change is a record that the kernel `@dv/project` (the `dvProject` Cordis service) writes, and views read state that reducers compute from the records. The kernel knew the plugins that wrote and read this data, so a plugin change edited the kernel and other shared packages:

- `COMPONENT_KEYS` in `packages/dv/project/src/shared.ts` fixed the component keys (`proj`, `asset`, `bible`, `plan`, `shot`, `timeline`, `inspect`) and the order of the project summary fields. A plugin with its own key edited the kernel.
- `packages/dv/project/src/types.ts` declared `CharacterId`, `LocationId` and `StyleId`, gave `RecordInputRef` one arm per story-bible kind, and named the input flag `OperationInput.bible`. `parseInputRef` tried the three kinds by name, the agent text said "a character, location or style version such as c1@1", and the `dv:project` rules named clips. Adding a fourth reference noun meant editing the kernel's types, parser and agent text.
- The reducer registry let only one reducer define `Reducer.assetsOf` and `Reducer.createdBy`, so only the story bible could own versions.
- A render that a plan approval started carried the `shot.render` params `plan`, `plan_version` and `shot`, and the canvas matched renders by them. Any other workflow that started renders had to write plan params.
- The 37 entries of `DV_TOOL_LABELS` in `packages/dv/ui-kit/src/client/tool-labels.ts` named every agent tool, `dv_bible_*` included, so each added operation edited `@dv/ui-kit` to get a display name.
- `mentionedAssets` in `packages/dv/api/src/wire.ts` imported `@dv/story-bible` and walked its slice to collect reference images.

## Decision

`@dv/project` keeps mechanisms and open registries and names no plugin noun. It owns the record log, the history list, the operation runner and scheduler, stale marks, and the agent tools of operations. Plugins register their component keys, reducers, reference kinds and operations into it, each inside `ctx.effect`, so a disposed plugin removes its registrations. Data moves in one direction:

```
agent tool call   view (POST /api/dv/operation)   plugin service (ctx.dv<Name>.<method>)
        \                    |                              /
         +-------------> dvProject.run <-------------------+
                             |
                             v
          record line and update lines in <project>/records.jsonl
                             |
                             v
          every registered reducer, record by record, in registration order
                             |
                             v
          ProjectState.components: one slice per registered reducer
                 |                                   |
                 v                                   v
   project summary (dv_proj_* tools,      WireState (GET /api/dv/state)
   dv:project prompt section)                        |
                                                     v
                                        canvas, timeline, history, asset pool
```

Views and the agent never edit a slice. They write project data only by running an operation, and they read the state again after the change. Canvas node positions are view state outside the records, which the layout store of `@dv/ui-canvas` keeps: a drag stores them through its route, and the agent's `dv_canvas_move` stores them from its host half ([agent canvas tools](../feature/2026-10-26-dv-agent-canvas-tools.md)). The [fitness test](../process/2026-10-17-dv-architecture-fitness-test.md) checks that `packages/dv/project/src` names no plugin key or noun and never reads `started_by`.

## Records, components and slices

A project is three files under the store root: `project.json`, `records.jsonl` and `line.json`. Each `ProjectRecord` is one call of one operation, with its caller (`actor`, `surface`, `session`, `turn`, `tool_call`, `intent`), `params`, `inputs`, `outputs`, `based_on`, `supersedes`, the optional `started_by`, and a `status` that only moves forward. Update lines set the fields that change after the append. Only the record store reads or writes these files.

The history list is the `parents[0]` ancestry of the last step (`tip`), and the project state is the state at the current position (`at`). `undo`, `redo` and `moveTo` move the position and write no record.

A plugin calls `registerComponent(key)` before its reducer and operations; a second claim throws `component_exists`, and the kernel registers `proj` itself. `registerReducer` refuses an unregistered key (`invalid_params`) and a second reducer for one key (`reducer_exists`). The slice type joins `ComponentStates` by declaration merging ([client state types](2026-10-17-dv-architecture-client-state-types.md)). A key may have no reducer: `shot` and `inspect` register a key and operations only.

`ReducerRegistry.reduceChain` passes each record of the chain through every registered reducer before the next record. A reducer is pure and ignores the records that it does not interpret.

## Operations

An operation name has the form `<key>.<verb>`, and `registerOperation` refuses a name outside the key of `OperationSpec.component`. `dvProject.run` is the one change path: it validates params and inputs, runs the operation's `precondition`, appends the `pending` record, and executes it at once or after the records in `after`. A `readOnly` operation writes no record.

Each operation becomes the agent tool `dv_<name with _>`. `OperationSpec.label` holds the display name `{ zh, en }`; the kernel only stores it, `toWireOperation` sends it in `GET /api/dv/operations`, and `operationLabel` in `@dv/ui-kit` reads it. `DV_TOOL_LABELS` keeps only the `dv_proj_*`, `dv_asset_*` and `dv_models_*` tools, whose packages declare no label.

A plugin runs only its own operations. Another plugin reaches them through the plugin's typed Cordis service: `dvTimeline.layout` runs `timeline.create` or `timeline.update` itself. [Workflows](2026-10-17-dv-architecture-workflows.md) compose these services.

`StartedBy` is `{ record, slot, lane? }`: the record whose `execute` started the call, the caller's position for it (such as a shot slot) or null, and the caller's parallel sequence, such as an ad variant. The runner copies `RunRequest.started_by` onto the record, and the kernel never reads it. Workflows write the field, and `chainOf` in `packages/dv/ui-kit/src/client/chain.ts` reads it for the canvas and the history panel ([UI registries](2026-10-17-dv-architecture-ui-registries.md)).

## References and staleness

A `RecordInputRef` is an asset, `{ record, output }`, or a version of a reference kind, such as `{ character: 'c1', version: 2 }`. The text forms are the asset ID, `<record>#<n>` and `<id>@<n>`. For `<id>@<n>`, `parseInputRef` asks every kind's `createdBy` and needs exactly one answer; no answer or two answers throw `invalid_inputs`.

A kind owner merges its key into `ReferenceKinds` and calls `registerReferenceKind` with a `ReferenceKindSpec`: `kind`, the owning `component`, and `assetsOf`, `createdBy` and `latest`, which each read the owner's slice. The kernel refuses the kinds `asset`, `record` and `version`, a second owner of a kind (`kind_exists`), and an unregistered component. Registering or removing a kind rebuilds every operation tool, because the `inputs` text lists the registered kinds. IDs are unique across kinds: a kind owner's create operation refuses an ID that `kindsWithId` lists. [Reference nouns](2026-10-17-dv-architecture-reference-nouns.md) describes `@dv/reference-kit`, which registers one kind per noun.

The runner turns a version input into one `RecordInput` per asset of the version, each with its `resolved_asset`. The `proj` slice holds `records`, `created_by` (asset to record), `superseded` and `stale`. The producers of an input are the record that created its asset and, for a version, the record that `createdBy` names. A record is stale when one of its producers is superseded or stale. A supersede recomputes every mark in one forward pass, and a `proj.stale_accept` record (the tool `dv_proj_stale_accept`) removes one mark. `character.update` supersedes the record that wrote the current version, so every render that read `c1@1` becomes stale.

## What the agent and the views read

`projectSummary` in `packages/dv/project/src/proj-tools.ts` gives the agent `project_id`, `head` and the record count, then the `agentSummary` fields of each reducer in the alphabetical order of the component keys, then `stale` and the 12 most recent records. Two reducers that use one field name throw `invalid_params`. Every `dv_proj_*` tool except `dv_proj_history_list` returns this summary, and the `dv:project` system-prompt section shows it at every step for the bound project, beside rules that list the registered kinds.

`toWireState` in `packages/dv/api/src/wire.ts` sends `project`, `head`, `tip`, the slices unchanged, and the assets that `mentionedAssets` collects: the outputs and resolved inputs of every record (these include the reference images of every version), the imported assets, and the timeline clips. `dvProject.subscribe` feeds the server-sent events at `/dv/events`, and `useProjectState` in `@dv/ui-kit` fetches the state again 150 ms after the last event of a burst. [Client state types](2026-10-17-dv-architecture-client-state-types.md) describes how the browser types these slices.

A view writes through `DvClient.runOperation` (`POST /api/dv/operation`), and a canvas editor through `EntryEditorHost.run` on the same path. `ApiHandlers.runOperation` parses the inputs with `dvProject.parseInputs` and calls `dvProject.run` as actor `user`.

## Alternatives considered

**Typed operation names on `run` (`OperationMap`).** A merged map from operation name to params would type each `dvProject.run` call. It lost because a typed service wraps `run` inside the plugin that knows the params, the agent tools, `@dv/api` and `@dv/chat-references` call by name, the runner validates params at runtime, and a map entry can drift from its schema.

**`started_by` as a bare record ID.** It lost because the live stream and the canvas need the shot position, which a record ID alone does not carry; `slot` holds that position.

**The name `origin` for the chain field.** It lost because `RecordOrigin` means who acted and from where (`actor`, `surface`).

**No `lane`.** Two variants of one shot would read as takes 1 and 2 on the canvas and in history, which `packages/dv/e2e/tests/stories/canvas-timeline.e2e.ts` forbids, and a later fix would edit the kernel and two UI-core packages.

**A `lane` method on the canvas `ChainAnchor`.** It lost to `started_by.lane`: the canvas and the history panel read one stored fact with one owner.

**A `resource` field copied onto each record.** It would let the UI recognize a generation record whose operation is not loaded. It lost because the record carries `deterministic` and its output media types, none of the 2178 stored records had the field, and no other consumer needed it.

**An example ID in the kernel's `inputs` text that follows the first registered kind.** It lost because only the owner knows the ID form of a kind, and the first kind changes with load order, since every kind registration rebuilds the text. Each create tool gives its own example.

**`ids(slice)` on `ReferenceKindSpec`, read by `mentionedAssets`.** It lost because it changes the kernel API and every kind owner for the same asset list: the resolved inputs of `proj.records` hold the reference images of every version.

**A reader or migration for stored records whose owner changed.** It lost because `packages/AGENTS.md` ties a compatibility path to a current consumer, and such a reader keeps the operation names of another plugin in a host package for good.

## Consequences

**What the design buys.** A plugin adds a component key, a reducer, a reference kind and operations without an edit to `@dv/project`: splitting the story bible into `@dv/character`, `@dv/location` and `@dv/style` changed no line of `packages/dv/project/src`. Every write from the agent, a view or a workflow is a record, so undo, redo, history and stale marks cover every plugin and every reference kind.

**Load order reaches the agent.** The kind list in the `inputs` text and in the `dv:project` rules follows registration order; `packages/bundle/dv/cordis.patch.yml` loads character, location and style in that order. The summary sorts fields by component key, so `styles` sits after the `plan` and `story` fields, away from `characters` and `locations`.

**One ID space.** All reference kinds share one ID space, and each kind owner must refuse an ID that `kindsWithId` lists; `@dv/reference-kit` makes that check for every noun.

**Records without an owner.** A record whose plugin is not loaded stays in `proj.records` and contributes to no other slice. A version input of an unregistered kind is no producer for stale marks, and a call that names that version fails with `invalid_inputs`. A project with `bible.*` records loads, but its characters, locations and styles are empty.

**An unchecked chain field.** The runner copies `started_by` without a check that its record exists; workflows and UI code own its meaning.

**Known gaps.** The `Surface` union in `packages/dv/project/src/types.ts` names the views `timeline` and `asset_pool`, and the fitness test skips that union. `mentionedAssets` reads `state.components.timeline`, and `@dv/api` does not inject `dvTimeline`; [client state types](2026-10-17-dv-architecture-client-state-types.md) records this gap.
