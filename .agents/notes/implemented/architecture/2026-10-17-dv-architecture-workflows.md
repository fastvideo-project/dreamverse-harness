# Agent Note: DreamVerse workflow plugins and the shared shot walk

Status: implemented

English | [中文](2026-10-17-dv-architecture-workflows.zh.md)

## Problem

Plan approval lived inside the Shot plan component `@dv/shot-plan`. Its operation `plan.approve` (tool `dv_plan_approve`) ran `shot.render`, `timeline.create` and `timeline.update` by name through `dvProject.run`, so one domain package wrote the records of two others. To find its takes and the plan's timeline again, it stamped the params `plan`, `plan_version` and `shot` on every render and `plan` on every timeline record; `@dv/shot-render` and `@dv/timeline` declared those params for this one caller, and the canvas grouped takes by `params.plan`. The `plan` slice carried `approved_by`. `@dv/shot-plan` injected `dvModels` to refuse an unknown model key, read the estimate of `shot.render` to report a GPU estimate from `plan.create`, and depended on `@dv/models` and `@dv/timeline`. The order of calls lived in the bundle skill `video-directing`, which named `dv_plan_approve`. A second way to approve a plan, such as an ad cut in two aspect ratios, had no home except `@dv/shot-plan`.

## Decision

A workflow is an ordinary component in its own package `@dv/workflow-<key>`, with the component key `<key>`. It owns a read that previews an approval, a write that approves, the slice of its approvals, and the skill that holds its flow. Code that every workflow needs and that holds no policy lives in the library `@dv/workflow-kit`. The bundle ships one workflow, the story workflow `@dv/workflow-story` (service `dvStory`), with its browser half `@dv/ui-workflow-story`. The [layers note](2026-10-17-dv-architecture-layers.md) places both layers in the dependency order.

`@dv/shot-plan` keeps `plan.create`, `plan.update`, the `plan` slice of versions, `dvShotPlan.get`, `dvShotPlan.shots`, and the structure checks of a plan. It injects only `dvProject`. The approval operation, take reuse, the choice of timeline, the GPU estimate, the model check of each shot, and the approval status of a version belong to the story workflow.

The approval writes its whole chain inside its own execute, with no step engine and no background process, and runs no operation by name: renders go through the generation service `dvShotRender` ([generation note](2026-10-17-dv-architecture-generation.md)), and layouts go through `dvTimeline.layout`. Take reuse and timeline ownership test the starter record of the chain (`started_by`, [data flow note](2026-10-17-dv-architecture-data-flow.md)) in the log with the workflow's `Owns` function and never read the workflow slice, so two workflows can approve the same plan: each reuses only the takes and timelines whose starter its own `Owns` accepts. The shot walk `@dv/workflow-kit` names no workflow, and the fitness test reports a violation when its `src` exceeds 300 non-blank lines, so the library cannot grow into a step engine. Its reading functions write nothing, so a preview, a refusal check, and an approval read the same steps. The workflow contract, the approval chain, the shot walk and the story workflow are documented in [DreamVerse workflows](../../../../docs/dreamverse/subsystems/workflows.md), and the steps to add a workflow are in [Adding a workflow](../../../../docs/dreamverse/cookbook/adding-a-workflow.md).

## Alternatives considered

**A workflow registry with a generic step engine.** The kernel would register workflows and run their steps. It lost because a workflow needs nothing from the kernel beyond operations and reducers, and a trial ad workflow needed no edit outside its own package and the wiring, so an engine had nothing to unify. The kit's line limit and its ban on workflow names keep shared code from becoming that engine.

**A kit that holds only `planShots` and `scheduleShots`.** With only those shared, the trial ad workflow rewrote four pieces that hold no policy: the map from a plan shot to render params, the check walk with its first-frame rule, the rule that keeps a timeline only while the workflow wrote it last, and the lookup of the workflow's own approvals. `pnpm run duplication` passed only because the ad code reworded them, and the two approval lookups disagreed. The kit holds those pieces instead.

**Ownership read from the workflow's own slice.** The trial ad workflow found its own takes in its `ad` slice, while the story workflow read the log. A reducer folds only finished approvals, so the renders of a failed approval were reused by one workflow and rendered again by the other. The chain starter in the log treats both alike: a second `ad.approve` reuses the done renders of a failed first one.

**A legacy reader for logs that `plan.approve` wrote.** A 49-line reader in the `story` reducer folded logged `plan.approve` and `timeline.create` records into the `story` slice, with an `ignore` list on `findTake` and a `legacy` test beside `owns`. It lost because it gave the story workflow a second goal, reading the records of other plugins, and it needed two exception markers in the fitness test. `packages/AGENTS.md` ties each compatibility path to a current consumer, and no end-to-end story loads such a log. A store reset lost as well, because those logs stay loadable.

**The GPU estimate in the `plan.create` report, or the approval refusal as the preview.** `@dv/shot-plan` cannot price a plan without reading the render operation by name. A `dv_story_approve` call without `user_approved` returns the same text, but it trains the agent to call the approval before the user agrees. `story.preview` is a read with no record and no lock, returns `problems` as data, and costs one call in the same turn.

**A line in `video-directing` that points to the workflow skills.** Each workflow would then edit the bundle skill. Each workflow registers its own skill through `ctx.skills` instead.

## Consequences

`packages/dv/shot-plan/src/index.ts` has 304 lines, against 561 when it held `plan.approve`, and `@dv/project` is its only DreamVerse dependency. `packages/dv/workflow-kit/src/index.ts` has 230 non-blank lines of the 300 that the fitness test allows.

A trial ad workflow, with a host package and a UI half, changed no file of another package beyond the wiring and left no clone between the two workflows. The bundle does not mount it.

`packages/dv/workflow-story/tests/parity.spec.ts` pins `story.approve` to the run requests that `plan.approve` wrote, recorded in `parity.golden.json`.

Each approval costs the agent one more call, the preview. The two tool definitions take about 450 tokens, and the `story-directing` skill about 70 tokens in the skill catalog. `plan.create` accepts a model key that the catalog does not serve; the agent learns about it from `story.preview` in the same turn.

These gaps remain:

- A take that `plan.approve` rendered has no `started_by`, so the first story approval of its plan renders every shot again onto the next free timeline. The confirm text shows that cost.
- A continuing shot always starts from output 1 of the previous take, the last still of a video, so a workflow over the takes of another primitive needs a change in `@dv/workflow-kit`.
- `@dv/ui-workflow-story` reads the `story` slice as `unknown` and narrows it with `isStorySlice`, which checks only that `approvals` is an object (see the [client state types note](2026-10-17-dv-architecture-client-state-types.md)).
