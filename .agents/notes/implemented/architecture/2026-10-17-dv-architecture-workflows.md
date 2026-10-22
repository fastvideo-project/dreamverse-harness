# Agent Note: DreamVerse workflow plugins and the shared shot walk

Status: implemented

English | [中文](2026-10-17-dv-architecture-workflows.zh.md)

## Problem

Plan approval lived inside the Shot plan component `@dv/shot-plan`. Its operation `plan.approve` (tool `dv_plan_approve`) ran `shot.render`, `timeline.create` and `timeline.update` by name through `dvProject.run`, so one domain package wrote the records of two others. To find its takes and the plan's timeline again, it stamped the params `plan`, `plan_version` and `shot` on every render and `plan` on every timeline record; `@dv/shot-render` and `@dv/timeline` declared those params for this one caller, and the canvas grouped takes by `params.plan`. The `plan` slice carried `approved_by`. `@dv/shot-plan` injected `dvModels` to refuse an unknown model key, read the estimate of `shot.render` to report a GPU estimate from `plan.create`, and depended on `@dv/models` and `@dv/timeline`. The order of calls lived in the bundle skill `video-directing`, which named `dv_plan_approve`. A second way to approve a plan, such as an ad cut in two aspect ratios, had no home except `@dv/shot-plan`.

## Decision

A workflow is an ordinary component in its own package `@dv/workflow-<key>`, with the component key `<key>`. It owns a read that previews an approval, a write that approves, the slice of its approvals, and the skill that holds its flow. Code that every workflow needs and that holds no policy lives in the library `@dv/workflow-kit`. The bundle ships one workflow, the story workflow `@dv/workflow-story` (service `dvStory`), with its browser half `@dv/ui-workflow-story`. The [layers note](2026-10-17-dv-architecture-layers.md) places both layers in the dependency order.

`@dv/shot-plan` keeps `plan.create`, `plan.update`, the `plan` slice of versions, `dvShotPlan.get`, `dvShotPlan.shots`, and the structure checks of a plan. It injects only `dvProject`. The approval operation, take reuse, the choice of timeline, the GPU estimate, the model check of each shot, and the approval status of a version belong to the story workflow.

## The workflow contract

Each workflow package has these parts:

- **Preview.** `<key>.preview` is `readOnly: true` and `confirm: 'never'`. It writes no record and reports the preview lines, the GPU estimate, and `problems`, every reason that a render would be refused.
- **Approve.** `<key>.approve` is `confirm: 'always'`; its synchronous `confirmSummary` gives a head line and the preview lines. Its `prepareToolCall` and `precondition` refuse while `problems` is not empty, so every caller is refused before a record exists. Its execute writes the whole chain, with no step engine and no background process.
- **Chain.** Every record that the approval writes carries `started_by` with the approval record, a slot, and an optional lane, as the [data flow note](2026-10-17-dv-architecture-data-flow.md) defines. Take reuse and timeline ownership test the starter record in the log with the workflow's `Owns` function and never read the workflow slice.
- **Services.** The workflow runs no operation by name. Renders go through the generation service `dvShotRender` ([generation note](2026-10-17-dv-architecture-generation.md)), and layouts go through `dvTimeline.layout`.
- **Skill.** The skill `<key>-directing` lives in the package and registers inside `ctx.inject(['skills'], …)`. No other skill names it or its `dv_<key>_*` tools.
- **UI half.** `@dv/ui-workflow-<key>` registers one chain anchor and one History row, as the [UI registries note](2026-10-17-dv-architecture-ui-registries.md) defines.
- **Test.** A REAL-composition test boots a test-only `cordis.yml` through the Loader, as `packages/dv/workflow-story/tests/fixture.ts` does.

`scripts/dv-architecture.ts` checks the imports, operation names, and skill texts of each workflow; the [fitness test note](../process/2026-10-17-dv-architecture-fitness-test.md) states its rules.

## The shot walk: `@dv/workflow-kit`

`@dv/workflow-kit` (`packages/dv/workflow-kit/src/index.ts`) has no component, no service, and no operation. It names no workflow, and the fitness test reports a violation when its `src` exceeds 300 non-blank lines, so the library cannot grow into a step engine. Each function takes only the `GenerationApi` methods that it calls.

- `walkShot` maps one shot of `dvShotPlan.shots` to render params; overrides, such as a variant's aspect ratio, win.
- `planShots` parses the references of each shot and picks its reused take through `findTake` among the records that a `where` filter accepts. A continuing shot after a rendered shot never reuses.
- `checkShots` collects the refusals of the shots that render; a continuing shot after a rendered shot is checked with `first_frame` marked as chained.
- `shotLine` writes the preview line of one shot.
- `scheduleShots` renders each step that keeps no take, each after the render before it, with `started_by: { record: call.approve, slot, lane }`.
- `chainStarter` finds the starter of a record: its own `started_by`, else that of its `based_on` root, so a canvas retake stays in its workflow's chain. `takeFilter` and `keepTimeline` test that starter with the workflow's `Owns`.

The reading functions write nothing, so a preview, a refusal check, and an approval read the same steps.

## The story workflow: `@dv/workflow-story`

`dvStory` injects `dvProject`, `dvShotPlan`, `dvShotRender`, and `dvTimeline` and registers the component key `story`. Its `Owns` function accepts a `story.approve` record whose `plan` param names the plan.

`story.preview` (tool `dv_story_preview`) reports the preview lines, `gpu_seconds` (the sum of `dvShotRender.estimate` over the shots that render), and `problems`. `story.approve` (tool `dv_story_approve`) writes its chain in one execute as the `system` actor: one render per added or changed shot, then one `dvTimeline.layout` of every take in shot order. The layout reuses the plan's timeline only while `keepTimeline` finds a story approval of the plan as the starter of `dvTimeline.lastWrite` for that timeline. After another write, such as the user's edit, the layout creates the next free timeline and leaves the edited one unchanged.

The `story` reducer folds each finished approval into `approvals` and `timelines` per plan. The skill `story-directing` holds the flow: preview, ask the user in bold, and approve in the next turn. `@dv/ui-workflow-story` anchors the records of an approval on the canvas node `plan:<PlanId>` and returns the approved versions of a plan; the plan editor of `@dv/ui-shot-plan` reads them through the registered chain anchors and imports no workflow package.

## Adding a second workflow

A second workflow, such as an ad workflow `@dv/workflow-ad` whose `ad.preview` and `ad.approve` take a list of aspect-ratio variants, is two packages plus wiring:

1. Create `packages/dv/workflow-<key>` with its service, reducer, two operations, `Owns` function, `<key>-directing` skill, and REAL-composition test. It calls the kit functions and copies none of them. An ad workflow passes each variant as a `walkShot` override and as the `lane`, and chains each variant `after` the last render of the one before it.
2. Create `packages/dv/ui-workflow-<key>` with one chain anchor and one History row, laid out as `@dv/ui-workflow-story` is.
3. Add the wiring: the host and client rows in `packages/bundle/dv/cordis.patch.yml`, the dependency in `packages/bundle/dv/package.json`, the plugin map of `packages/bundle/dv/tests/composition.spec.ts`, the `tsconfig.base.json`, `tsconfig.host.json` and `tsconfig.client.json` entries, `pnpm-lock.yaml`, the lines that list the mounted workflows in the bundle README pair and the `docs/dreamverse/architecture.md` pair, and the lines that list the skills that plugins register: the `skill-filesystem` sentence of the bundle README pair and the skills table of the `docs/dreamverse/subsystems/agent-and-api.md` pair.

No file of `@dv/project`, `@dv/shot-plan`, `@dv/shot-render`, `@dv/timeline`, `@dv/workflow-kit`, `@dv/workflow-story`, or the UI core changes. Two workflows can approve the same plan, because each reuses only the takes and timelines whose starter its own `Owns` accepts.

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
