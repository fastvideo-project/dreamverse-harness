---
description: "The shot walk of DreamVerse workflows: walkShot, planShots, checkShots and shotLine read a plan version without writing, scheduleShots schedules the renders in order, and chainStarter, takeFilter and keepTimeline test the record that started a take or a layout; open it to write or debug a workflow that renders the shots of a version."
kind: "package-reference"
---

# @dv/workflow-kit

English | [中文](README.zh.md)

## Summary

Use this package in a workflow that renders a list of shots. `walkShot`, `planShots`, `checkShots` and `shotLine` turn a plan version into render steps, reused takes, refusals and preview lines; none of them writes, so a preview, a refusal check and an approval read the same steps. `scheduleShots` asks the generation service for one render per remaining step, each after the one before and marked with `started_by`. `chainStarter`, `takeFilter` and `keepTimeline` test the record that started a take or a layout with the workflow's `Owns` rule. The package has no component, service or operation and names no workflow.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Import the functions in a workflow's operation and pass the generation service that renders the shots, such as `ctx.dvShotRender`. Each function takes only the `GenerationApi` methods (`@dv/generation`) that it calls. `Owns` is the workflow's rule for a starter record, such as "a `<key>.approve` record of this plan".

| Function | Behavior |
| --- | --- |
| `walkShot(resolved, overrides?)` | The `WalkShot` of one `ResolvedShot` of `dvShotPlan.shots`: params with the model key, `prompt`, and `duration_sec`, `aspect_ratio`, `resolution` and `seed` when set; the overrides win |
| `planShots(render, state, shots, where)` | One `WalkStep` per `WalkShot`, in order: the parsed `reference` inputs and the take `findTake` returns among the records `where` accepts, or null. A continuing shot matches with the previous shot's reused take as its `first_frame` (output 1, the last still); after a rendered shot it never reuses |
| `checkShots(render, state, steps)` | `{ slot, reason }` for each reason `check` gives a rendering step. A continuing step after a reused step is checked with that take's last still; after a rendered step, with `first_frame` chained |
| `shotLine(step, shot)` | `shot <n>: keeps its take`, or `shot <n> (<model key>, <s> s, continues from the previous shot): <first 80 characters of the prompt>` |
| `scheduleShots(render, steps, { ...origin, project, approve, intent, lane?, after? })` | Renders every step whose `reuse` is null, `after` the previous scheduled render (the first after `call.after`, else `after: []`), with `first_frame` from the previous take when continuing, the intent `intent(slot)` and `started_by: { record: approve, slot, lane }`. Returns `takes`, one per step, and `scheduled`, the renders in order |
| `chainOf(state, record)` | The record's own `started_by`, else the `started_by` of its `based_on` root, else null |
| `chainStarter(state, record)` | The record that `chainOf` names, from the state's log, or null |
| `takeFilter(state, owns)` | A `where` filter: the record's chain starter exists and `owns` accepts it |
| `keepTimeline(timeline, state, linked, owns)` | `linked` while `timeline.lastWrite(state, linked)` has a chain starter that `owns` accepts, else null |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`planShots` keeps the previous step while it walks: a continuing shot asks `findTake` with the previous reused take as its `first_frame` input and skips the lookup when the previous shot renders, because that take does not exist yet. `checkShots` follows the same rule; for a take that does not exist yet it passes `first_frame` as a chained role, so the role count and the prompt citations see it and the model check waits for execute. Its calls carry only the project, the params and the inputs, which is all that `check` reads, and no origin. `scheduleShots` awaits each `render` call in order, so the `after` chain and the `first_frame` inputs can name the record of the render before. `chainOf` follows `based_on` through the state's records and stops after one step per record, so a malformed line that loops still ends.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `WalkShot`, `WalkStep`, `Owns`, `walkShot`, `planShots`, `checkShots`, `shotLine`, `scheduleShots`, `chainOf`, `chainStarter`, `takeFilter`, `keepTimeline` |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/project`](../project/README.md): `run`, `after` and the scheduler, `started_by` and `based_on` on records.
- [`@dv/generation`](../generation/README.md): `GenerationApi`, the methods of a generation service that the walk calls.
- [`@dv/shot-plan`](../shot-plan/README.md): `dvShotPlan.shots`, which resolves the shots of a plan version.
- [`@dv/timeline`](../timeline/README.md): `dvTimeline.lastWrite`, the newest record that set the clips of a timeline.

-----

<a id="model-experience"></a>
## Model Experience

### Render records of a walk

#### What the model sees

Nothing from this package directly; the records that `scheduleShots` asks a generation service to write reach the model as ordinary records through the project state and update messages and the `dv_proj_*` tools of `@dv/project`.

#### Token effect

Zero direct tokens; each scheduled render adds one record to the project history.

#### KV Cache effect

None; the package sends nothing to a model and adds no tool or prompt text.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Video start frame** — a continuing shot always starts from role `first_frame` with output 1 of the previous take, the last still of a video render.
