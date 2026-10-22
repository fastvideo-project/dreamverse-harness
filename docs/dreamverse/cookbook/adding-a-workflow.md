# Add a workflow

English | [中文](adding-a-workflow.zh.md)

## Summary

This guide adds a workflow to DreamVerse. A workflow is a component that previews and approves a shot plan version and writes its renders and its timeline. You write a host package `@dv/workflow-<key>` and a UI package `@dv/ui-workflow-<key>`, and then add the wiring. The agent gets the tools `dv_<key>_preview` and `dv_<key>_approve` and the skill `<key>-directing`. No file of `@dv/project`, `@dv/shot-plan`, `@dv/shot-render`, `@dv/timeline`, `@dv/workflow-kit`, `@dv/workflow-story` or the UI core changes. The example is an ad workflow with the key `ad`, whose operations take a list of aspect-ratio variants.

## Table of Contents

- [Before you start](#before-you-start)
- [Files that the guide creates or changes](#files-that-the-guide-creates-or-changes)
- [1. Create the workflow package](#1-create-the-workflow-package)
- [2. Create the UI package](#2-create-the-ui-package)
- [3. Add the wiring](#3-add-the-wiring)
- [4. Update the package map and run the checks](#4-update-the-package-map-and-run-the-checks)
- [Further Exploration](#further-exploration)

<a id="before-you-start"></a>
## Before you start

Read the [Workflows](../subsystems/workflows.md) page. It defines the workflow contract, the approval chain, and the shot walk of `@dv/workflow-kit`. The story workflow `@dv/workflow-story` is the example for every file of this guide.

Choose the key `<key>`, one lowercase word such as `ad`. The key names the component, the operations `<key>.preview` and `<key>.approve`, the skill `<key>-directing` and the packages.

Run every command from the repository root, after `pnpm install`.

<a id="files-that-the-guide-creates-or-changes"></a>
## Files that the guide creates or changes

The file tree shows each file and the step that creates or changes it.

```text
packages/dv/
├── workflow-<key>/                                step 1: the workflow package
├── ui-workflow-<key>/                             step 2: the UI package
└── README.md, README.zh.md                        step 4: package map rows
packages/bundle/dv/
├── cordis.patch.yml                               step 3: host row and client row
├── package.json                                   step 3: two dependencies
├── tests/composition.spec.ts                      step 3: plugin map
└── README.md, README.zh.md                        step 3: workflow and skill lists
docs/dreamverse/subsystems/
└── agent-and-api.md, agent-and-api.zh.md          step 3: skills table row
scripts/verify-package-readme-model-experience.ts  step 3: one entry
tsconfig.base.json                                 step 3: two paths
tsconfig.host.json                                 step 3: one reference
tsconfig.client.json                               step 3: one reference
pnpm-lock.yaml                                     step 3: pnpm install
```

<a id="1-create-the-workflow-package"></a>
## 1. Create the workflow package

The workflow package has the layout of `packages/dv/workflow-story`. Create `packages/dv/workflow-<key>/` with `package.json`, `tsconfig.json`, `src/index.ts`, `src/reducer.ts`, `skills/<key>-directing/SKILL.md`, the tests and the README triplet. Write these parts:

1. The service `dv<Name>`. It injects `dvProject`, `dvShotPlan`, `dvShotRender` and `dvTimeline`, and registers the component key `<key>` and its reducer.
2. The read `<key>.preview`, with `readOnly: true` and `confirm: 'never'`. It reports the preview lines, the GPU estimate, and `problems`.
3. The write `<key>.approve`, with `confirm: 'always'` and a `confirmSummary`. Its `prepareToolCall` and its `precondition` refuse the call while `problems` is not empty. Its `execute` writes the whole chain.
4. The `Owns` function, which accepts the `<key>.approve` records of the workflow.
5. The skill `<key>-directing`, registered inside `ctx.inject(['skills'], …)`.
6. A REAL-composition test that boots a test-only `cordis.yml` through the Loader, as `packages/dv/workflow-story/tests/fixture.ts` does.

Call the functions of `@dv/workflow-kit` and copy none of them: `walkShot`, `planShots`, `checkShots`, `shotLine`, `scheduleShots`, `takeFilter` and `keepTimeline`. Run renders through `dvShotRender` and layouts through `dvTimeline.layout`, and run no operation by name. An ad workflow passes each variant as a `walkShot` override and as the `lane`. It chains each variant `after` the last render of the variant before it.

Verify: run `CI=true pnpm exec vitest run packages/dv/workflow-<key>`. All tests pass.

<a id="2-create-the-ui-package"></a>
## 2. Create the UI package

The UI package has the layout of `packages/dv/ui-workflow-story`. In `src/client/index.ts`, register one chain anchor for `<key>.approve` in `dvCanvas.chainAnchors` and one History row in `dvHistory.rows`. The host package has no `./types` face, so the UI package narrows the `<key>` slice itself, as `isStorySlice` does.

Verify: run `CI=true pnpm exec vitest run packages/dv/ui-workflow-<key>`. All tests pass.

<a id="3-add-the-wiring"></a>
## 3. Add the wiring

The wiring mounts both packages and lists the workflow and its skill in the documentation. Edit these files:

1. In `packages/bundle/dv/cordis.patch.yml`, add the row `dv-workflow-<key>` after the row `dv-workflow-story`, and the row `dv-ui-workflow-<key>` after the row `dv-ui-workflow-story`.
2. In `packages/bundle/dv/package.json`, add both packages to `dependencies`.
3. In `packages/bundle/dv/tests/composition.spec.ts`, import the default export of `@dv/workflow-<key>` and add it to `PLUGINS`. The boot test fails for a bundle row whose package has no entry in `PLUGINS`.
4. Add `"@dv/workflow-<key>"` and `"@dv/ui-workflow-<key>"` to the `paths` of `tsconfig.base.json`. Add `{ "path": "./packages/dv/workflow-<key>" }` to `tsconfig.host.json` and `{ "path": "./packages/dv/ui-workflow-<key>" }` to `tsconfig.client.json`.
5. In `scripts/verify-package-readme-model-experience.ts`, add an entry for `packages/dv/ui-workflow-<key>` to `SENTENCE_MODEL_EXPERIENCE`, after the entry of `packages/dv/ui-workflow-story`.
6. In the bundle README pair `packages/bundle/dv/README.md` and `README.zh.md`, add the workflow to the sentence that lists the mounted packages. Add the skill `<key>-directing` to the `skill-filesystem` sentence.
7. In the pair `docs/dreamverse/subsystems/agent-and-api.md` and `agent-and-api.zh.md`, add a row for the skill `<key>-directing` to the skills table.
8. Run `pnpm install --no-frozen-lockfile`. It links the packages and adds them to `pnpm-lock.yaml`.

Verify:

1. Run `CI=true pnpm exec vitest run packages/bundle/dv`. All tests pass.
2. Run `CI=true pnpm run typecheck`. The command exits with code 0.

<a id="4-update-the-package-map-and-run-the-checks"></a>
## 4. Update the package map and run the checks

The fitness test `scripts/dv-architecture.ts` checks the imports, the operation names and the skill texts of each workflow. Only the workflow's own skill names its `dv_<key>_*` tools and its `<key>-directing` skill.

1. Add a row for each package to the package map in `packages/dv/README.md` and `packages/dv/README.zh.md`.
2. Record the pairs that this guide changes:

   ```sh
   CI=true pnpm run verify-translation-pairing --write packages/dv/workflow-<key>/README.md packages/dv/ui-workflow-<key>/README.md packages/dv/README.md packages/bundle/dv/README.md docs/dreamverse/subsystems/agent-and-api.md
   ```

Verify:

1. Run `CI=true pnpm exec vitest run scripts/dv-architecture.spec.ts`. All tests pass.
2. Run `CI=true pnpm run dv:owners | grep <key>`. The output lists the component `<key>` and the skill `<key>-directing` under the package `workflow-<key>`.
3. Run `CI=true pnpm run verify-package-readme-model-experience` and `CI=true pnpm run verify-translation-pairing`. Both commands exit with code 0.
4. Run `git status --short`. The list has no file of `@dv/project`, `@dv/shot-plan`, `@dv/shot-render`, `@dv/timeline`, `@dv/workflow-kit` or `@dv/workflow-story`.

<a id="further-exploration"></a>
## Further Exploration

- [Workflows](../subsystems/workflows.md): the workflow contract, the approval chain and the shot walk.
- [`@dv/workflow-kit` README](../../../packages/dv/workflow-kit/README.md): the functions of the shot walk.
- [Workflows Agent Note](../../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-workflows.md): why a workflow is an ordinary component and why the kit has a line limit.
- [Where new behavior goes](where-new-behavior-goes.md): how to choose an extension point.
