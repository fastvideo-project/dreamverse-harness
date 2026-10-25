---
description: "Browser half of the DreamVerse shot plan: the canvas node type that draws each plan at its latest version with a frame grid of one slot per shot, its plan card, the records in use that keep the producers of a plan's reference assets on the canvas, the plan editor with its versions, approval status and shots, and the History row of plan records."
kind: "package-reference"
---

# @dv/ui-shot-plan

English | [中文](README.zh.md)

## Summary

Use this package to show the plans of the `plan` slice (`@dv/shot-plan`) on the canvas. It registers a node type and a records-in-use descriptor in `dvCanvas` of `@dv/ui-canvas`, and the plan card and editor at key `plan` in `dv.canvas.card` and `dv.canvas.editor`. Each plan is one node `plan:<PlanId>` at its latest version: the title `3 个镜头 · 0:12` / `3 shots · 0:12`, a frame grid of one slot per shot, and the card `分镜计划 · 第 2 版` / `Plan · v2`. The records that produced the reference assets of the latest version stay on the canvas. It also registers one History row in `dvHistory` of `@dv/ui-history`, which names the plan of a `plan.create` or `plan.update` record.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app`, `@dv/api`, `@dv/ui-canvas`, `@dv/ui-media`, whose `dv.media` Factory draws the plan editor's reference assets, and `@dv/ui-composer`, whose `dv.prompt` Factory draws each shot's prompt. Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-shot-plan
  name: '@dv/ui-shot-plan'
```

| Descriptor | Registry | Value |
| --- | --- | --- |
| `planNodeType` | `dvCanvas.nodeTypes` | `id: '@dv/ui-shot-plan'`, `type: 'plan'`, label `分镜计划` / `Plan`, color `var(--dv-node-2)`, column 1; one slice entry per plan with a version: ID `plan:<PlanId>`, `record` the record that wrote the latest version, `records` the records that wrote the earlier versions (absent for a plan at version 1), title the shot count followed by ` · <total duration>` when every shot has a duration, no assets, `slots` the shot count, and `bodyHeight` 46 |
| `PlanCard` | the `dv.canvas.card` slot | key `plan`; the card body, which paints `CARD_SURFACE` of `@dv/ui-kit/frame.ts`: the type label and the version on show, one past the count of the node's `records`, `分镜计划 · 第 2 版` / `Plan · v2`, at the canvas's text scale |
| `PlanEditor` | the `dv.canvas.editor` slot | key `plan`, owner `{ node, state, operations, host }` (it uses `node`, `state` and `host`), and the inject `hooks` `chainAnchors` and `versionKinds` (the `dvCanvas` registries) and `taskLabels` (`GET /api/dv/tasks`, loaded once); shows the chosen version's `title`, switches between the plan's versions (`第 1 版` / `v1`, …; the latest first) and shows the chosen version's status (`已批准` / `Approved` when a registered chain anchor lists it among the approved versions of the node, `已被第 N 版取代` / `Replaced by vN` when a later version replaced it before approval, else `待批准` / `Awaiting approval`), its shot count, total duration, aspect ratio and references (an asset or a record output drawn through `dv.media` at purpose `thumb` with the asset's name, and a version with its first reference asset and the name that its version kind gives, such as `Hero`), then one card per shot: duration, model and task label, whether it continues the previous shot, and the prompt as the read-only `dv.prompt` composer of the call `shot.render` with the shot's `prompt`, `model` and `task` and its references as `reference` inputs, which draws each citation as a chip and the reference assets as its tray; a chip opens its item's node and a tile opens its asset's preview through `host`; a shot in task `t2v`, and a shot without references, shows why under `参考` / `References` |
| `planReferencesInUse` | `dvCanvas.recordsInUse` | `id: '@dv/ui-shot-plan'`; `uses` gives the producer (`created_by`) of each asset among the references of each plan's latest version and of its shots; a version reference such as `c1@1` names no record |
| `planHistoryRow` | `dvHistory.rows` | `match: 'plan.'`; the subject of `plan.create` is its title as `《猫》` / ` “猫”`, else its PlanId as ` p1`; the subject of `plan.update` is ` p1 → v2` with the version it wrote, else ` p1`; the PlanId and the version come from the record's `report`, else from its params, and a plan named by its record ID gives no subject; any other `plan.*` record has no subject |

The Host half registers nothing. The browser half's `inject` is empty: it registers both descriptors inside `ctx.inject(['dvCanvas'], …)`, the card and editor entries inside `ctx.inject(['dvCanvas', 'slots'], …)` once the canvas declares `dv.canvas.card` and `dv.canvas.editor` (child slots of its `dv.canvas` Factory, which the canvas tab body and the canvas center view both render), and the History row inside `ctx.inject(['dvHistory'], …)`, so it loads without these services, and each registration leaves with its services or with the plugin. The texts follow the interface language of `<html lang>` (`pickText` and `useText` of `@dv/ui-kit/locale.ts`); the canvas reads the entries again when the language changes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/client/index.ts` merges `PlanState` of the client face `@dv/shot-plan/types` into the client `ComponentStates` of `@dv/ui-kit`, so the package reads the `plan` slice typed. The canvas fills the frame grid with the previews of the takes anchored on the entry by slot, opens the entry for a center focus on a record in `records`, and shows the editor entry under its own editor header. The plan editor reads the approved versions from the chain anchors, the assets of version references from the version kinds, and the task labels from `GET /api/dv/tasks`, all through its inject `hooks`. `plansOf(state)` in `src/client/PlanEditor.tsx` reads the `plan` slice and gives `{}` while `@dv/shot-plan` is not loaded; the canvas entries and the plan editor read through it.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The inert Host Loader entry |
| [`src/client/index.ts`](src/client/index.ts) | `planNodeType`, `planReferencesInUse`, `planHistoryRow`, and the registrations |
| [`src/client/PlanEditor.tsx`](src/client/PlanEditor.tsx) | `PlanEditor`, `shotReferences`, and `totalSec` |
| [`src/client/PlanCard.tsx`](src/client/PlanCard.tsx) | `PlanCard` |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/shot-plan`](../shot-plan/README.md): `plan.create`, `plan.update` and the `plan` slice.
- [`@dv/ui-canvas`](../ui-canvas/README.md): the canvas node contract (`NodeType`, `NodeEntry`, `RecordsInUse`, `ChainAnchor`) and how the canvas fills a frame grid.
- [`@dv/ui-history`](../ui-history/README.md): how a History row gets its subject, and the `HistoryRow` descriptor type of `@dv/ui-history/contract`.
- [`@dv/ui-media`](../ui-media/README.md): the `dv.media` Factory that draws the reference assets.
- [`@dv/ui-composer`](../ui-composer/README.md): the `dv.prompt` Factory that draws a shot's prompt, citations and reference tray.

-----

<a id="model-experience"></a>
## Model Experience

None, as a browser-side plan node and plan editor; they show plans and write no record.

#### KV Cache effect

None; the package sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Plan title only in the editor body** — the entry title is the shot count and total duration, so a plan's own `title` appears in the plan editor's version row, but on no card and in no editor header.
