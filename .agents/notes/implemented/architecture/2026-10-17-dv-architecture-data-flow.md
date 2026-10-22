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

`@dv/project` keeps mechanisms and open registries and names no plugin noun. It owns the record log, the history list, the operation runner and scheduler, stale marks, and the agent tools of operations. Plugins register their component keys, reducers, reference kinds and operations into it, each inside `ctx.effect`, so a disposed plugin removes its registrations. An operation declares its own display label, and a reference kind answers for its own versions, so no shared package lists the plugins.

Data moves in one direction. Every write from the agent, a view or a plugin service is a call of `dvProject.run`, which appends a record; the reducers compute the slices from the records; the agent and the views read the state again after the change and never edit a slice. A plugin runs only its own operations, and another plugin reaches them through the plugin's typed Cordis service. The kernel stores `started_by` and never reads it; workflows and UI code own its meaning. The [fitness test](../process/2026-10-17-dv-architecture-fitness-test.md) checks that `packages/dv/project/src` names no plugin key or noun and never reads `started_by`.

The records, the registries, the run sequence and the state that the agent and the views read are documented in [DreamVerse project](../../../../docs/dreamverse/subsystems/project.md), and the one-direction data flow is drawn in [DreamVerse architecture](../../../../docs/dreamverse/architecture.md).

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
