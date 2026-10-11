---
description: "Shot render component of DreamVerse: the dvShotRender service, the Consumer of the model catalog of @dv/models, with the operation shot.render that renders one take of a shot with a named model and mode, the shot reducer of takes, and the agent tool dv_shot_render."
kind: "package-reference"
---

# @dv/shot-render

English | [中文](README.zh.md)

## Summary

Use this package to render shots. It is the Consumer of the model catalog of [`@dv/models`](../models/README.md): its one operation, `shot.render` (tool `dv_shot_render`), renders one take of a shot with the video model and the generation mode the call names, both required. Mode `reference` renders from a prompt, reference images and an optional first frame; mode `text` from the prompt alone. The model's own parameters go in the `extra` param. The operation exists while the catalog holds a model. Every take's outputs are the video and its last still; the reducer groups the takes of each shot.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project`, `@dv/asset-pool` and `@dv/models`, and mount a company plugin that registers models into the catalog, such as [`@dv/fastvideo`](../fastvideo/README.md). The `shot` reducer is always registered; `shot.render` is registered while the catalog holds at least one model and registered again on every catalog change, so its `model` param lists exactly the registered models.

```yaml
- id: dv-shot-render
  name: '@dv/shot-render'
```

The plugin has no configuration. The GPU estimate of a render, `estimate(params)`, is `duration_sec` (5 when the call names none) times the `gpuSecondsPerVideoSecond` that the named model reports in its facts for the named mode. Shot render keeps the latest facts of each model in each of its modes, keyed `<model>/<mode>`: it reads them in the background when a model registers (a failed read is logged and retried by the next call) and again on every call, so the synchronous estimate serves the GPU budget of a turn and the agreement text of `confirmSummary`. While a model has reported no facts in a mode, the estimate is 0.

| Operation | Tool | Inputs and params | Outputs and report |
| --- | --- | --- | --- |
| `shot.render` | `dv_shot_render` | inputs `reference` (images, or character, location and style versions `<id>@<n>`, in prompt order) and `first_frame` (one image), each only when the model accepts it in the mode; params `model` and `mode` (required: a registered model and a mode it supports), `prompt` (required), `duration_sec`, `aspect_ratio`, `resolution`, `seed`, `extra` (the model's own parameters in the mode, as `dv_models_get` lists them), and `plan`, `plan_version` and `shot` (the PlanId, the approved version and the shot position in it, set when an approved plan schedules the render); tool-only `continue_from` (a render record whose output `#1` becomes `first_frame`) | outputs `video`, `last_still`; report `{seed, model_id, aspect_ratio, resolution, duration_sec, frame_width, frame_height, num_frames, model, mode, image_labels, timings}`, with `image_labels` only when the request carries images; cost `gpu_seconds` from the backend's timings |

The operation uses the GPU, is not deterministic, and declares `confirm: over_gpu_budget`: an agent call that would bring its turn past the GPU budget of `dvProject` is refused until the agent asks the user in the conversation and calls again with `user_requested: true`; `confirmSummary` gives the refusal one line (`Render shot with <model> (<mode>), 5 s: "<prompt>"`) and the call's GPU estimate. Omitted params take the model's first aspect ratio and resolution and its shortest duration in the mode; a seed is drawn when the call names none. A call that `based_on` an earlier render is a new take of that shot, whatever model and mode each take used; the `shot` slice maps each shot's root record to its takes (`takes`) and each take to its root (`roots`). Other callers use the service method `renderShot(context)`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`renderShot` looks up the named model in `dvModels` and the declaration of the named mode, reads the model's facts in the mode with `facts(mode)`, resolves the frame size and frame count from the params, and refuses more reference images than the facts' `maxReferenceImages`. It reads the bytes of the reference images and the first frame from the asset pool, only for the input roles the model accepts in the mode, sends the request with the `extra` values to the model's `render(mode, request, signal)`, writes the stream into a scratch file, and imports the video and the PNG last still through `context.importAsset`. When the request carries images, the report's `image_labels` names them by the facts' `imageLabels`: the reference images in order, then the first frame. While the optional live stream service of `@video-harness/stream` is mounted, the video chunks also go to its `openSegment` as they arrive, with the plan's `shot` number as the segment index.

Before any record is written, for every caller, the `precondition` of `shot.render` refuses a call whose model is not registered (naming the registered models), whose mode the model does not support (naming its modes), whose `extra` names a parameter the model does not take in the mode or a value of the wrong type (`dvModels.checkExtra`), whose inputs include a role the model does not accept in the mode, or that carries fewer reference images than the model's minimum in the mode. An asset or a record output counts one image, and a character, location or style version counts the assets `dvProject.assetsOf` returns for it. The refusal for missing reference images names the model's range from its facts and tells the agent to ask the user for a reference image; a call that a plan scheduled (param `plan`) is told to update the plan with `dv_plan_update`, and while any model supports mode `text`, the refusal also names those models for a shot that needs no reference image. Before an agent call, `prepareToolCall` reads the model's facts in the mode, turns `continue_from` into the `first_frame` input `{record, output: 1}` (refused when the model takes no first frame in the mode), and runs the same precondition, so the agent is refused before Project asks for the user's agreement.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvShotRender`: `shot.render`, its registration on catalog changes, `renderShot`, the precondition, the GPU estimate |
| [`src/render.ts`](src/render.ts) | `shotGeometry`, `imageLabels`, `backendSeconds` |
| [`src/reducer.ts`](src/reducer.ts) | `shotReducer`, the takes of each shot from the finished `shot.render` records |
| [`src/types.ts`](src/types.ts) | `ShotState`, the `shot` slice |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/project`](../project/README.md): operations, approval, and agent tools.
- [`@dv/asset-pool`](../asset-pool/README.md): the reference images and the imported outputs.
- [`@dv/models`](../models/README.md): the model catalog this package consumes, with the model list and `dv_models_get`.
- [`@dv/fastvideo`](../fastvideo/README.md): a company plugin that registers models and their prompt skills.
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md): the layout this package follows.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

One tool, `dv_shot_render`, while the catalog holds a model, in the format `@dv/project` gives every operation tool, with the hint "Uses the GPU." and the argument `user_requested` that Project adds for `confirm: over_gpu_budget`. The description says that `model` and `mode` are required and come from the video model list, that mode `reference` renders from reference images (`c1@1`) and mode `text` from the prompt alone, that `continue_from` starts from the last still of an earlier shot when the model takes a first frame in the mode, and that the model's own parameters go in `extra` (see `dv_models_get`); it names the two outputs and that every call is a new take whose changed prompt passes `based_on`. The `model` param is an enum of the registered models.

#### Token effect

About 700 tokens for the definition, fixed while the plugin and at least one model are mounted; the shared arguments of `@dv/project` add up to about 200 tokens.

#### KV Cache effect

The definition sits in the stable tool section of every agent request. Registering or removing a model changes the `model` enum, and the first registered or last removed model adds or removes the tool; each changes the tool list and invalidates the cached prefix from the tool section on.

### Tool results

#### What the model sees

A call returns one text block with the record, its status, the summary `shot "<prompt>" (<n>s, seed <seed>)` (`shot <n> of plan <plan> v<version> "<prompt>" …` when an approved plan scheduled it), the outputs with their URLs, the params, and the report; the last still also arrives as an image block when an attachment service is mounted. A call without enough reference images is refused before any record with a message that tells the agent to ask the user for a reference image: "Model <model> in mode reference renders a shot from 1 to <n> reference images, and this shot has none. Nothing was rendered. …". An unknown model, an unsupported mode, an unknown or ill-typed `extra` parameter, and an input the model does not accept are refused with one sentence that names the allowed values.

#### Token effect

Roughly 200 tokens of text per call, plus the image block of the last still.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Tool definition follows the catalog**: the `model` enum of `dv_shot_render` lists the registered models, so every model registration or removal changes the tool definition and invalidates the cached prefix from the tool section on.
- **GPU estimate**: the GPU estimate is `duration_sec × gpuSecondsPerVideoSecond`, the rate the company plugin is configured with for the model in the mode, not a measured one.
