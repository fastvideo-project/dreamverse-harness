# Add a generation primitive

English | [中文](adding-a-generation-primitive.zh.md)

## Summary

This guide adds a generation primitive to DreamVerse. A primitive is one input and output signature of a model call, such as image generation from a prompt. You write one primitive package that declares its catalog row and its tasks and calls `defineGeneration` of `@dv/generation`. A provider plugin then serves the tasks, and the bundle mounts both. The agent gets one operation tool while a model serves one of the tasks. The packages `@dv/models`, `@dv/generation`, `@dv/project` and `@dv/shot-render` do not change. The example is an image primitive with the package `@dv/image-generate`, the component `image`, the operation `image.generate` and the task `t2i`.

## Table of Contents

- [Before you start](#before-you-start)
- [Files that the guide creates or changes](#files-that-the-guide-creates-or-changes)
- [1. Create the primitive package](#1-create-the-primitive-package)
- [2. Register the package](#2-register-the-package)
- [3. Serve the tasks from a provider](#3-serve-the-tasks-from-a-provider)
- [4. Mount the primitive in the bundle](#4-mount-the-primitive-in-the-bundle)
- [5. Update the documentation and run the checks](#5-update-the-documentation-and-run-the-checks)
- [Further Exploration](#further-exploration)

<a id="before-you-start"></a>
## Before you start

Read the [Generation](../subsystems/generation.md) page. It defines the model catalog, `PrimitiveTypes`, `TaskMap` and `defineGeneration`.

Make sure that you need a primitive. Use this table:

| You add                                                     | Do this                                                                                                                                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An output type or input roles that no primitive has         | Follow this guide. Lip sync is video out with other input roles, so it is its own primitive.                                                                                   |
| A task with the input roles of an existing primitive        | Edit the provider, the `tasks` record of the primitive's declaration, and the task rules `takesReferences` and `takesFirstFrame` in `packages/dv/shot-plan/src/index.ts`.    |
| A provider, a model or a server for a task that exists      | Follow the repository skill [`dv-add-model-provider`](../../../.agents/skills/dv-add-model-provider/SKILL.md).                                                                 |

Choose these values:

- The primitive name, such as `image`, and its `modality`.
- The tasks of the primitive, such as `t2i`, with a Chinese and an English label for each.
- The package directory, such as `image-generate`, the component key, such as `image`, and the operation `<component>.<verb>`, such as `image.generate`. The agent tool is `dv_image_generate`.
- The entry fields that only this primitive reads, such as `gpuSecondsPerCall`.

Run every command from the repository root, after `pnpm install`.

<a id="files-that-the-guide-creates-or-changes"></a>
## Files that the guide creates or changes

The file tree shows each file and the step that creates or changes it.

```text
packages/dv/
├── <dir>/                         step 1: the primitive package
├── <provider>/                    step 3: entries for the primitive tasks
└── README.md, README.zh.md        step 5: package map row
docs/dreamverse/                   step 5: primitive package lists
packages/bundle/dv/
├── cordis.patch.yml               step 4: one row, provider config
├── package.json                   step 4: one dependency
└── tests/composition.spec.ts      step 4: plugin map
tsconfig.base.json                 step 2: one path
tsconfig.host.json                 step 2: one reference
pnpm-lock.yaml                     steps 2 and 4: pnpm install
```

<a id="1-create-the-primitive-package"></a>
## 1. Create the primitive package

The primitive package is a domain package with the layout of `packages/dv/shot-render`. Create `packages/dv/<dir>/` with `package.json`, `tsconfig.json`, `src/index.ts`, `tests/<dir>.spec.ts` and the README triplet. `packages/dv/COMPONENT-TEMPLATE.md` gives the rules of each file. List `@dv/generation`, `@dv/models` and `@dv/project` in `dependencies`.

In `src/index.ts`, write these parts:

1. A `declare module '@dv/models'` block that adds the primitive's row to `PrimitiveTypes` and each task to `TaskMap`. The row has `modality`, `facts`, `request`, `result` and `entry`. Each `TaskMap` value is the primitive name.
2. A `GenerationSpec<'<primitive>'>` declaration with `service`, `component`, `operation`, `primitive`, `tasks` with their labels, `label`, `description`, `params`, `inputs`, `outputs`, `toRequest`, `toOutputs`, `estimate` and `summarize`. The [`@dv/generation` README](../../../packages/dv/generation/README.md#use-this-package) defines each field. `toOutputs` can call the helper `importOne` of `@dv/generation` to import one output as an asset.
3. The default export `class <Name> extends defineGeneration(<declaration>) {}` and its `declare module '@deepseek-ai/cordis'` entry for the service name.

`src/index.ts` of `@dv/shot-render` is the example: its `RENDER_DECLARATION` and the class `DvShotRender`.

In the test, register a fake model entry in `dvModels` for each task, as `packages/dv/shot-render/tests/shot-render.spec.ts` does. Type the tasks of a fake as `TaskOfPrimitive<'<primitive>'>`, so that a task added to `TaskMap` later breaks no test. Assert that the operation and its tool exist only while the fake entry is registered.

Verify: run `CI=true pnpm exec vitest run packages/dv/<dir>`. All tests pass.

<a id="2-register-the-package"></a>
## 2. Register the package

Add the path alias and the project reference after the `shot-render` lines:

| File                 | Add                                                    |
| -------------------- | ------------------------------------------------------ |
| `tsconfig.base.json` | `"@dv/<dir>": ["./packages/dv/<dir>/src/index.ts"]`    |
| `tsconfig.host.json` | `{ "path": "./packages/dv/<dir>" }`                    |

Run `pnpm install --no-frozen-lockfile`. It links the package and adds it to `pnpm-lock.yaml`.

Verify: run `CI=true pnpm run typecheck`. The command exits with code 0.

<a id="3-serve-the-tasks-from-a-provider"></a>
## 3. Serve the tasks from a provider

A provider plugin registers one model entry for each task that a model serves. The repository skill [`dv-add-model-provider`](../../../.agents/skills/dv-add-model-provider/SKILL.md) gives the provider procedure. For a primitive, also do these things:

1. Import the request type from the primitive package with `import type`. This import is the only import of a domain package that a provider may make.
2. Fill each entry field of the primitive's row, such as `gpuSecondsPerCall`, from a required `Config` field of the provider.
3. Give each entry a `promptSkill` whose description names the model and the task and no tool.

Verify: run `CI=true pnpm exec vitest run packages/dv/<provider>`. All tests pass.

<a id="4-mount-the-primitive-in-the-bundle"></a>
## 4. Mount the primitive in the bundle

The bundle `@dv/bundle` mounts the primitive package after `@dv/project` and `@dv/models`, which its service injects. Edit these files:

1. In `packages/bundle/dv/cordis.patch.yml`, add the row `dv-<dir>` with `name: '@dv/<dir>'` after the row `dv-shot-render`. In the provider row, add a server for each task of the primitive.
2. In `packages/bundle/dv/package.json`, add `"@dv/<dir>": "workspace:*"` to `dependencies`.
3. In `packages/bundle/dv/tests/composition.spec.ts`, import the default export of `@dv/<dir>` and add it to `PLUGINS`. The boot test fails for a bundle row whose package has no entry in `PLUGINS`.
4. Run `pnpm install --no-frozen-lockfile`.

Verify: run `CI=true pnpm exec vitest run packages/bundle/dv`. All tests pass.

<a id="5-update-the-documentation-and-run-the-checks"></a>
## 5. Update the documentation and run the checks

The fitness test `scripts/dv-architecture.ts` checks the placement of a primitive. The base packages name no primitive. A provider imports only the request types of a primitive package. Skill texts name no consumer tool.

1. Add a row for `<dir>` to the package map in `packages/dv/README.md` and `packages/dv/README.zh.md`.
2. Run `git grep -n '@dv/shot-render' -- docs/dreamverse ':!*.zh.md'`. The command prints the lines of the DreamVerse pages that name the primitive packages. Add `@dv/<dir>` to each line that lists the primitive packages, and make the same change in the `.zh.md` page.
3. Record the README pairs:

   ```sh
   CI=true pnpm run verify-translation-pairing --write packages/dv/<dir>/README.md packages/dv/README.md
   ```

4. Record each page that you changed in item 2 with `CI=true pnpm run verify-translation-pairing --write <English path>`.

Verify:

1. Run `CI=true pnpm exec vitest run scripts/dv-architecture.spec.ts`. All tests pass.
2. Run `CI=true pnpm run dv:owners | grep <component>`. The output lists the component `<component>` under the package `<dir>`.
3. Run `CI=true pnpm run verify-package-readme-model-experience` and `CI=true pnpm run verify-translation-pairing`. Both commands exit with code 0.
4. Run `git status --short`. The list has no file of `@dv/models`, `@dv/generation`, `@dv/project` or `@dv/shot-render`.

<a id="further-exploration"></a>
## Further Exploration

- [Generation](../subsystems/generation.md): the model catalog, `defineGeneration` and `GenerationApi`.
- [`@dv/models` README](../../../packages/dv/models/README.md#model-keys): the key fields, the entry members and the render request.
- [Generation Agent Note](../../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-generation.md): why one package serves one input and output signature.
- [Where new behavior goes](where-new-behavior-goes.md): how to choose an extension point.
