---
description: "Shot render component of DreamVerse: the dvShotRender service, the Consumer of the model catalog of @dv/models, with the operation shot.render that renders one take of a shot with a named model and mode, the shot reducer of takes, and the agent tool dv_shot_render."
kind: "package-reference"
---

# @dv/shot-render

English | [中文](README.zh.md)

## Summary

Use this package to render shots. It is the Consumer of the model catalog of [`@dv/models`](../models/README.md): its one operation, `shot.render` (tool `dv_shot_render`), renders one take of a shot with the video model and the generation mode the call names, both required. Mode `reference` renders from a prompt, reference media of the types the model declares and an optional first frame; mode `text` from the prompt alone. The model's own parameters go in the `extra` param. The operation exists while the catalog holds a model. Every take's outputs are the video and its last still; the reducer groups the takes of each shot.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project` and `@dv/models`, and mount a company plugin that registers models into the catalog, such as [`@dv/fastvideo`](../fastvideo/README.md). The `shot` reducer is always registered; `shot.render` is registered while the catalog holds at least one model and registered again when the registered model names change, so its `model` param lists exactly the registered models.

```yaml
- id: dv-shot-render
  name: '@dv/shot-render'
```

The plugin has no configuration. The GPU estimate of a render, `estimate(params)`, is `duration_sec` (5 when the call names none) times the `gpuSecondsPerVideoSecond` that the named model declares for the named mode when it registers, so the synchronous estimate serves the GPU budget of a turn and the agreement text of `confirmSummary` without reading the backend. For a model or mode that is not in the catalog, the estimate is 0.

| Operation | Tool | Inputs and params | Outputs and report |
| --- | --- | --- | --- |
| `shot.render` | `dv_shot_render` | inputs `reference` (assets of any media type the model declares for the role, or character, location and style versions `<id>@<n>`, in prompt order) and `first_frame` (one image), each only when the model accepts it in the mode; params `model` and `mode` (required: a registered model and a mode it supports), `prompt` (required), `duration_sec`, `aspect_ratio`, `resolution`, `seed`, `extra` (the model's own parameters in the mode, as `dv_models_get` lists them), and `plan`, `plan_version` and `shot` (the PlanId, the approved version and the shot position in it, set when an approved plan schedules the render); tool-only `continue_from` (a render record whose output `#1` becomes `first_frame`) | outputs `video`, `last_still`; report `{seed, model_id, aspect_ratio, resolution, duration_sec, frame_width, frame_height, num_frames, model, mode, timings}`; cost `gpu_seconds` from the backend's timings |

The operation uses the GPU, is not deterministic, and declares `confirm: over_gpu_budget`: an agent call that would bring its turn past the GPU budget of `dvProject` is refused until the agent asks the user in the conversation and calls again with `user_requested: true`; `confirmSummary` gives the refusal one line (`Render shot with <model> (<mode>), 5 s: "<prompt>"`) and the call's GPU estimate. Omitted params take the model's first aspect ratio and resolution and its shortest duration in the mode; a seed is drawn when the call names none. A call that `based_on` an earlier render is a new take of that shot, whatever model and mode each take used; the `shot` slice maps each shot's root record to its takes (`takes`) and each take to its root (`roots`). Other callers use the service method `renderShot(context)`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`renderShot` looks up the named model in `dvModels` and the declaration of the named mode, reads the model's facts in the mode with `facts(mode)`, and builds the render request: the prompt, the asset IDs of the reference input in input order, the asset ID of the one first frame, the frame size and frame count resolved from the params, the seed, and the `extra` values. It passes every input to the request and leaves the judgment to the model: the declaration's `validateGenerationRequest(request)` runs again before the request goes to the model's `render(mode, request, signal)`, because an output of a record that had not finished when the precondition ran is an asset now. The model reads each asset's bytes and media type from the asset pool and numbers the references in its prompt by its own rule. `renderShot` writes the stream into a scratch file and imports the video and the PNG last still through `context.importAsset`. While the optional live stream service of `@video-harness/stream` is mounted, the video chunks also go to its `openSegment` as they arrive, with the plan's `shot` number as the segment index.

Before any record is written, for every caller, the `precondition` of `shot.render` refuses a call whose model is not registered (naming the registered models), whose mode the model does not support (naming its modes), whose `extra` names a parameter the model does not take in the mode or a value of the wrong type (`dvModels.checkExtra`), whose prompt is missing or whose params lie outside the model's facts, with more than one `first_frame` input, or whose render request the model's `validateGenerationRequest` refuses. The precondition resolves each input to assets: an asset is itself, a record output is that output of a finished record (read through `dvProject.getRecord`), and a character, location or style version stands for the assets `dvProject.assetsOf` returns for it. It builds the same render request as `renderShot`, with a seed of its own when the call names none, and passes it to the declaration's `validateGenerationRequest`. A call with an output of a record that has not finished has no complete request yet, so the precondition records it unvalidated and `renderShot` validates it once the output exists. A refusal starts with "Model <model> in mode <mode> cannot render this shot:", lists the model's problems, and tells the agent to change the inputs and ask the user for an asset the shot needs; a call that a plan scheduled (param `plan`) is told to update the plan with `dv_plan_update`. Before an agent call, `prepareToolCall` turns `continue_from` into the `first_frame` input `{record, output: 1}` and runs the same precondition, whose call to the model's `validateGenerationRequest` decides whether the model takes that first frame, so the agent is refused before Project asks for the user's agreement.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvShotRender`: `shot.render`, its registration on catalog changes, `renderShot`, the precondition, the GPU estimate |
| [`src/render.ts`](src/render.ts) | `shotGeometry`, `backendSeconds` |
| [`src/reducer.ts`](src/reducer.ts) | `shotReducer`, the takes of each shot from the finished `shot.render` records |
| [`src/types.ts`](src/types.ts) | `ShotState`, the `shot` slice |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/project`](../project/README.md): operations, approval, and agent tools.
- [`@dv/asset-pool`](../asset-pool/README.md): the reference assets and the imported outputs.
- [`@dv/models`](../models/README.md): the model catalog this package consumes, with the model list and `dv_models_get`.
- [`@dv/fastvideo`](../fastvideo/README.md): a company plugin that registers models and their prompt skills.
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md): the layout this package follows.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

One tool, `dv_shot_render`, while the catalog holds a model, in the format `@dv/project` gives every operation tool, with the hint "Uses the GPU." and the argument `user_requested` that Project adds for `confirm: over_gpu_budget`. The description says that `model` and `mode` are required and come from the video model list, that mode `reference` renders from reference media (`c1@1`), whose accepted media types and counts `dv_models_get` lists, and mode `text` from the prompt alone, that `continue_from` starts from the last still of an earlier shot when the model takes a first frame in the mode, and that the model's own parameters go in `extra` (see `dv_models_get`); it names the two outputs and that every call is a new take whose changed prompt passes `based_on`. The `model` param is an enum of the registered models. The `reference` input is typed `any`, and the `prompt` param says that the prompt names the references with the numbering of the model's prompt skill.

#### Token effect

About 700 tokens for the definition, fixed while the plugin and at least one model are mounted; the shared arguments of `@dv/project` add up to about 200 tokens.

#### KV Cache effect

The definition sits in the stable tool section of every agent request. Registering or removing a model changes the `model` enum, and the first registered or last removed model adds or removes the tool; each changes the tool list and invalidates the cached prefix from the tool section on.

### Tool results

#### What the model sees

A call returns one text block with the record, its status, the summary `shot "<prompt>" (<n>s, seed <seed>)` (`shot <n> of plan <plan> v<version> "<prompt>" …` when an approved plan scheduled it), the outputs with their URLs, the params, and the report; the last still also arrives as an image block when an attachment service is mounted. A call whose render request the model refuses is refused before any record with the model's problems and what to change: "Model <model> in mode <mode> cannot render this shot: <problems> Nothing was rendered; change the inputs (ask the user for an asset the shot needs; they can attach it in the chat), then call again." An unknown model, an unsupported mode, an unknown or ill-typed `extra` parameter, a missing prompt, and params outside the model's facts are refused with one sentence that names the allowed values.

#### Token effect

Roughly 200 tokens of text per call, plus the image block of the last still.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Tool definition follows the catalog**: the `model` enum of `dv_shot_render` lists the registered models, so every model registration or removal changes the tool definition and invalidates the cached prefix from the tool section on.
- **GPU estimate**: the GPU estimate is `duration_sec × gpuSecondsPerVideoSecond`, the rate the company plugin is configured with for the model in the mode, not a measured one.
