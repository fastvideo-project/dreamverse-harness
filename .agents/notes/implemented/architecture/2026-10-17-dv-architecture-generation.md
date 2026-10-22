# Agent Note: DreamVerse generation — model catalog, primitives and defineGeneration

Status: implemented

English | [中文](2026-10-17-dv-architecture-generation.zh.md)

## Problem

Between the DreamVerse model catalog and the provider plugins that serve models sat one plugin per media type: shot render for video, plus image generate and audio generate. That layer turned one model call into one project record, with fixed params, input roles and outputs, a check before the record, a GPU confirmation and the asset import. But it was cut by media type, while what varies between models is the input and output signature of a call. The image and audio packages were near copies: the audio file matched the image file in 106 of its 134 lines.

Each added media type also edited shared packages. The image-generation change touched 35 files and the audio-generation change 37. Both declared their types inside `@dv/models` (`packages/dv/models/src/types.ts`), although that file's own comment said a plugin adds its types by declaration merging, and both edited `packages/dv/ui-kit/src/client/tool-labels.ts`. The image and audio operations never asked the user to confirm GPU use and recorded `gpu_seconds: 0`, so the GPU sum of an agent turn never counted them. Two providers copied the same prompt-skill registration code, and provider skill text named the `dv_shot_render` tool. Task labels lived in UI switches that knew only the video tasks, so the Chinese interface showed raw names such as `<model> · t2i`. By the project owner's estimate, adding one lip-sync stage meant changing seven packages.

## Decision

Generation has three parts (the [layers note](2026-10-17-dv-architecture-layers.md) owns the layer map):

- `@dv/models` (base layer) is the model catalog, the `dvModels` service, into which provider plugins register entries. It is a [capability seam](2026-06-13-capability-seams.md). It registers no operation and writes no record.
- `@dv/generation` (base layer) is a library. `defineGeneration(spec)` turns the declaration of one primitive into a Cordis service with one component key and one operation. It names no primitive.
- One primitive package (domain layer) per input and output signature declares its types and calls `defineGeneration`.

A *primitive* is one input and output signature of a model call: one package, one component key, one operation and one `defineGeneration` call. A *task* names which inputs a model uses, and each task runs on one primitive.

The cut follows the signature, not the media type, because the signature is what varies between models. `defineGeneration` fixes once the parts that do not depend on the signature: the record, the GPU confirmation, the required estimate, the seed, and the check before the record. A primitive package declares its own catalog row and tasks through `declare module '@dv/models'` and supplies only the code that differs, so an added primitive edits neither `@dv/models` nor another primitive. Video-only test fakes outside `@dv/models` type their tasks as `TaskOfPrimitive<'video'>`, so an added `TaskMap` row breaks no other package's test. Task labels travel from the declaration through the catalog to the views, and the catalog registers the prompt skill of each provider entry, so no provider copies registration code and no catalog or provider skill names a consumer. The catalog, the helper, `shot.render`, the model-line skills and the providers are documented in [DreamVerse generation](../../../../docs/dreamverse/subsystems/generation.md), and the steps to add a primitive in [Adding a generation primitive](../../../../docs/dreamverse/cookbook/adding-a-generation-primitive.md).

## Alternatives considered

**One plugin and one catalog row per media type, all rows declared in `@dv/models`.** It lost because lip sync is video out with other input roles, so a modality key forces a second breaking change, and rows in the catalog make every primitive edit `@dv/models`. One operation per signature adds one package and touches no other.

**One generic `generate` operation.** It lost because the kernel fixes `inputs`, `outputs` and `confirm` when an operation registers. Video has two outputs and image one, so one operation needs a union of roles, and every reader branches on params.

**Operations registered by providers.** It lost because a plan keeps the model key as data, and each provider would copy the record code.

**The helper inside `@dv/models`.** It lost because the catalog would then write records.

**An `estimate(params)` method on each entry in place of entry fields.** It lost because `OperationSpec.estimate` must be synchronous, and providers would read primitive param names such as `duration_sec`.

**A `kind: 'generation'` field on `OperationSpec`.** It lost because it puts a layer noun into the kernel; the UI reads `deterministic`, `resource` and the output types instead.

**An optional `confirm` and an optional `estimate` per declaration.** It lost because image and audio then skipped the GPU confirmation and recorded no cost.

**Providers that register their own prompt skills.** It lost because two providers copied the registration, and the shared `prompt` description promised a skill that one task lacked.

**Task labels in UI switches.** It lost because a creator read raw task names in the Chinese interface while every test passed. The labels travel through the catalog because `OperationSpec.label` holds one label per operation.

**Renaming `shot.render`.** It lost because `findTake` matches `record.operation` and the take editor reruns `record.operation`, so a rename renders every stored shot again.

**A `pending` field on `GenerationCall` for chained roles.** It lost because a `check` argument cannot reach `render`, by type, and "pending" already names a record status in the kernel.

**A partial model check before the record for chained roles.** It lost because the model check reads each asset's media type, so it would need a placeholder asset or a second check method in every provider.

## Consequences

The shared code is paid once: `packages/dv/generation/src/index.ts` has 309 lines, and `packages/dv/shot-render/src/index.ts` has 357 lines, against 488 before it used `defineGeneration`. Image and audio generation, rebuilt as primitive packages to measure this design, changed no file of `@dv/models` (the earlier changes edited six and four), with `defineGeneration` calls of about 20 lines. Image generation went from 7 edited files in two outside packages to 2 test files with type lines only, and audio generation from three edited packages to one, its provider. A lip-sync primitive edited no other package, and a lip-sync step in the story workflow edited `@dv/workflow-story` and 21 source lines of `@dv/shot-plan`, against the project owner's estimate of seven packages.

Every generation operation asks for confirmation past the turn's GPU limit and needs an estimate, even for a cheap model, and has version `1`, so a declaration cannot mark a change of its params. The model checks an unfinished or chained input only in `execute`, so that refusal fails the record instead of refusing the call. The operation and its tool appear with the first entry of its tasks and leave with the last, which changes the tool list the agent sees. A second declaration that labels an already labeled task fails to start.

Video is the only primitive in the repository, so `RenderRequest`, `RenderModelFacts` and the `video-model-selection` skill are video-specific and live in the catalog that owns the video row. A task with known roles still edits the task rules of `@dv/shot-plan`, and another value type, such as a 3D mesh, also edits the kernel, because `OperationValueType` in `packages/dv/project/src/types.ts` is a closed union.
