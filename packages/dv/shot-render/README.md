---
description: "Shot render component of DreamVerse: the dvShotRender service, the Consumer of the model catalog of @dv/models, with the operation shot.render that renders one take of a shot with the model the call names by its catalog key, and the agent tool dv_shot_render."
kind: "package-reference"
---

# @dv/shot-render

English | [中文](README.zh.md)

## Summary

Use this package to render shots. It is the Consumer of the model catalog of [`@dv/models`](../models/README.md): its one operation, `shot.render` (tool `dv_shot_render`), renders one take of a shot with the catalog entry named by the required params `modality`, `task`, `provider` and `model`. Task `ref2v` renders from a prompt, reference media and an optional first frame; task `t2v` from the prompt alone. The model's own parameters go in the `extra` param. The operation exists while the catalog serves its tasks. Every take's outputs are the video and its last still.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project` and `@dv/models`, and mount a provider plugin that registers models into the catalog, such as [`@dv/fastvideo`](../fastvideo/README.md). `shot.render` is registered while the catalog holds at least one model of task `t2v`, `ref2v`, `i2v`, `l2v` or `fl2v` (`dvModels.whileServing`). The operation carries the label 渲染镜头 / Render shot, and the service labels its tasks in the catalog with `dvModels.labelTasks` while it lives: `t2v` 文字生成 / From text, `ref2v` 参考图生成 / From references, `fl2v` 首尾帧生成 / From first and last frames.

```yaml
- id: dv-shot-render
  name: '@dv/shot-render'
```

The plugin has no configuration.

| Operation | Tool | Inputs and params | Outputs and report |
| --- | --- | --- | --- |
| `shot.render` | `dv_shot_render` | inputs `reference` (assets of any media type the model declares for the role, or character, location and style versions `<id>@<n>`, in prompt order) , `first_frame` (one image) and `last_frame` (one image), each only when the model accepts it; params `modality`, `task`, `provider` and `model` (required: the key of a catalog entry, as `dv_models_list` lists it), `prompt` (required), `duration_sec`, `aspect_ratio`, `resolution`, `seed`, `extra` (the model's own parameters, as `dv_models_get` lists them); tool-only `continue_from` (a render record whose output `#1` becomes `first_frame`) | outputs `video`, `last_still`; report `{seed, model_id, aspect_ratio, resolution, duration_sec, frame_width, frame_height, num_frames, modality, task, provider, model, timings}`, plus `expanded_prompt` when element expansion changed the prompt |

The operation uses the GPU and is not deterministic. Omitted params take the model's first aspect ratio and resolution and its shortest duration; a seed is drawn when the call names none. A call that `based_on` an earlier render is a new take of that shot, whatever model each take used. Workflows call the `GenerationApi` methods of [`@dv/generation`](../generation/README.md) on `dvShotRender`: `render`, `check` and `parseInputs`.

Task `i2v` requires one `first_frame`; task `l2v` requires one `last_frame`. Neither accepts the other endpoint or references. Task `fl2v` requires exactly one `first_frame` and one `last_frame`, and accepts no `reference` inputs. Each frame is stored with its own role in the record and passed separately in `RenderRequest`, regardless of input order. Providers validate image media and translate the roles to native endpoint conditioning. `continue_from` may supply the first frame; the last frame remains explicit.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`defineGeneration` of `@dv/generation` builds the service from the declaration of `shot.render`. A render looks up the catalog entry of the named key among tasks `t2v`, `ref2v`, `i2v`, `l2v` and `fl2v` with `dvModels.resolve`, reads its facts with `facts()`, and builds the render request: the prompt, the asset IDs of the reference input in input order, the asset IDs of the first and last frames, the frame size and frame count resolved from the params, the seed, and the `extra` values. It passes every input to the request and leaves the judgment to the model: the entry's `validateGenerationRequest(request)` runs again before the request goes to the entry's `render(request, signal)`, because an output of a record that had not finished when the precondition ran is an asset now. Every citation in the prompt (`@[<label>](dv:asset/<AssetId>)`) must name an asset of the reference input, and a citation of an input by its role (`dv:input/<role>`, such as `dv:input/first_frame`) needs an input of that role; a citation of anything else is refused, and a reference asset that the prompt does not cite is sent as usual. A citation of a character, location or style version in the reference input (`dv:character/<id>`, `dv:location/<id>` or `dv:style/<id>`, without a version) is expanded before the check into its label and the citations of its reference assets, such as `Mia (@[Mia · 1](dv:asset/a1) @[Mia · 2](dv:asset/a2))`; the record's `prompt` param keeps the prompt as written. The model reads each asset's bytes and media type from the asset pool, and its plugin replaces each citation with the label that the model reads. The declaration's `toOutputs` writes the stream into a scratch file and imports the video and the PNG last still through `context.importAsset`. While the optional live stream service of `@video-harness/stream` is mounted, the video chunks also go to its `openSegment` as they arrive, with the record's `started_by.slot` as the segment index, else 0.

Before any record is written, for every caller, the `precondition` of `shot.render` refuses a call whose key names no catalog entry (naming the key as `modality/task/provider/model` and telling the agent to call `dv_models_list`), whose prompt is missing or whose params lie outside the model's facts, with more than one input of either frame role, or whose render request, `extra` values included, the entry's `validateGenerationRequest` refuses. The precondition resolves each input to assets: an asset is itself, a record output is that output of a finished record (read through `dvProject.getRecord`), and a character, location or style version stands for the assets `dvProject.assetsOf` returns for it. It builds the same render request as the render, with a seed of its own when the call names none, and passes it to the entry's `validateGenerationRequest`. A call whose input is an output of a record that has not finished is validated, `extra` values included, again before the render. A refusal gives the reason and ends with "Nothing was generated; change the inputs or params, then call again."; when the entry's `facts()` or `validateGenerationRequest` rejects, the reason reads "Model <modality>/<task>/<provider>/<model> is unavailable: <message>" and the refusal ends with "Nothing was generated; no change to the call helps while the model is unavailable."; the model's problems read "Model <modality>/<task>/<provider>/<model> cannot generate this: <problems>". Before an agent call, `prepareToolCall` turns `continue_from` into the `first_frame` input `{record, output: 1}` and runs the same precondition, whose call to the model's `validateGenerationRequest` decides whether the model takes that first frame.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvShotRender`: the declaration of `shot.render` (render request, stored outputs and summary) |
| [`src/render.ts`](src/render.ts) | `shotGeometry` |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/project`](../project/README.md): operations and agent tools.
- [`@dv/asset-pool`](../asset-pool/README.md): the reference assets and the imported outputs.
- [`@dv/models`](../models/README.md): the model catalog this package consumes, with `dv_models_list` and `dv_models_get`.
- [`@dv/generation`](../generation/README.md): the helper that builds the service, its checks and its `GenerationApi`.
- [`@dv/fastvideo`](../fastvideo/README.md): a provider plugin that registers models and their prompt skills.
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md): the layout this package follows.

-----

Cloud APIs may publish discrete durations without frame counts or exact pixel dimensions. Shot render validates their duration choices and forwards seconds, aspect ratio, and resolution; unknown geometry stays absent from requests, asset hints, and reports. Native frame-based requests keep their existing fields.

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

One tool, `dv_shot_render`, while the catalog holds a model of task `t2v`, `ref2v`, `i2v`, `l2v` or `fl2v`, in the format `@dv/project` gives every operation tool, with the hint "Uses the GPU.". The description says that `modality`, `task`, `provider` and `model` name a model from `dv_models_list` and are required, that task `ref2v` renders from reference media (`c1@1`), which the prompt cites as `@[<label>](dv:asset/<asset ID>)` and whose accepted inputs, media types and counts `dv_models_get` lists, that `continue_from` starts from the last still of an earlier shot when the model takes a first frame, and that the model's own parameters go in `extra` (see `dv_models_get`); it names the two outputs and that every call is a new take whose changed prompt passes `based_on`. The four key params are strings whose descriptions point to `dv_models_list`. The `reference` input is typed `any`, and the `prompt` param says to follow the prompt skill that `dv_models_list` names for the model, if any.

#### Token effect

About 630 tokens for the definition, fixed while the plugin and at least one model of task `t2v`, `ref2v`, `i2v`, `l2v` or `fl2v` are mounted; the shared arguments of `@dv/project` add up to about 200 tokens.

#### KV Cache effect

The definition sits in the stable tool section of every agent request. The first registered or last removed model adds or removes the tool, which changes the tool list and invalidates the cached prefix from the tool section on; other registrations leave the definition unchanged.

### Tool results

#### What the model sees

A call returns one text block with the record, its status, the summary `shot "<prompt>" (<n>s, seed <seed>)` (`shot <n> "<prompt>" …` when a record started it at slot `<n>`), the outputs with their URLs, the params, and the report; the last still also arrives as an image block when an attachment service is mounted. A call whose render request the model refuses is refused before any record with the model's problems and what to change: "Model <modality>/<task>/<provider>/<model> cannot generate this: <problems> Nothing was generated; change the inputs or params, then call again." A key that names no catalog entry is refused with the key and the instruction to call `dv_models_list`; `extra` values the model does not take are among the problems its validation reports; a missing prompt and params outside the model's facts are refused with one sentence that names the allowed values. Each refusal ends with the sentence "Nothing was generated; change the inputs or params, then call again.", except the refusal of an unavailable model, which ends with "Nothing was generated; no change to the call helps while the model is unavailable."

#### Token effect

Roughly 200 tokens of text per call, plus the image block of the last still.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Videos are not shown to the model**: see the [`@dv/inspector` limitation](../inspector/README.md#known-limitations-and-deferred-work).
