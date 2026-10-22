---
description: "Image component of DreamVerse: declares the image primitive and task t2i in the model catalog of @dv/models, and the operation image.generate (tool dv_image_generate) generates one image from a prompt with the model that the call names by its key."
kind: "package-reference"
---

# @dv/image-generate

English | [中文](README.zh.md)

## Summary

Use this package to let the agent and workflows generate images from text. It declares the generation primitive `image` and the task `t2i` in the model catalog `@dv/models`, and builds the `dvImageGenerate` service with `defineGeneration` of `@dv/generation`. While the catalog holds an entry of task `t2i`, the service registers the operation `image.generate`, which `dvProject` turns into the agent tool `dv_image_generate`. Each call renders one PNG with the entry that the call's model key names, and the image is the one output of a new record. Provider plugins, such as [`@dv/sglang-diffusion`](../sglang-diffusion/README.md), register the `t2i` entries.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project` and `@dv/models`. The plugin has no configuration fields. The operation exists only while a provider plugin has registered an entry of task `t2i`. The interface shows its labels 生成图片 / Generate image and, for the task, 文字生成图片 / Image from text.

```yaml
- id: dv-image-generate
  name: '@dv/image-generate'
```

| Operation | Tool | Inputs and params | Outputs and report |
| --- | --- | --- | --- |
| `image.generate` | `dv_image_generate` | no inputs; the model key, `prompt`, `size` (`WIDTHxHEIGHT` in pixels, optional), `seed` (optional) and `extra` | output `image` (PNG with its width and height); report `{seed, model_id, size}` |

An entry of task `t2i` implements `ModelEntry<'t2i'>` with these types, which this package exports and declares in `PrimitiveTypes`:

| Type | Fields |
| --- | --- |
| `ImageModelFacts` | `modelId`: the backend's model ID |
| `ImageRequest` | `prompt`; `size`: an `ImageSize`, or null when the call names none; `seed`; `extra` |
| `GeneratedImage` | `bytes`, `mime: 'image/png'`, `width`, `height`, `gpuSeconds`: the GPU time that the backend reported |
| entry fields | `gpuSecondsPerMegapixel`: the rate of the GPU estimate; `defaultSize`: the size that the entry renders for a request whose `size` is null |

`render(request)` of the entry returns a promise of one `GeneratedImage`. The service also implements `GenerationApi` of `@dv/generation` for workflows.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The declaration's `toRequest` trims the prompt, refuses an empty prompt, and parses `size` into an `ImageSize`; a call without `size` gives the request `size: null`, so the entry decides the default. The kernel draws the seed when the call names none. The declaration's `toOutputs` imports the PNG through `importOne` with its width and height, named `<record ID, 8 characters>.png`, records the reported `gpuSeconds` as the cost, and reports `model_id` and the rendered `size`; the kernel adds `seed`. The GPU estimate is `gpuSecondsPerMegapixel` of the entry times the megapixels of the call's size, or of the entry's `defaultSize` when the call names none; with 0.6, a 1024x1024 call estimates 0.63 GPU seconds and a 1792x2400 call 2.58. The summary of a record is `image "<prompt, first 60 characters>" (<size>, seed <seed>)`.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The `image` row of `PrimitiveTypes`, task `t2i`, the request and result types, and `dvImageGenerate` |
| [`tests/image-generate.spec.ts`](tests/image-generate.spec.ts) | The operation, the tool texts, the record, the refusals and the estimate in a Loader composition with a fake `t2i` entry |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/generation`](../generation/README.md): `defineGeneration`, the shared params, the refusals and the confirmation text.
- [`@dv/models`](../models/README.md): the model catalog, the keys and `dv_models_get`.
- [`@dv/project`](../project/README.md): records, agent tools and the GPU budget.
- [`@dv/sglang-diffusion`](../sglang-diffusion/README.md): the provider plugin of the `t2i` model `qwen-image-2.1-turbo`.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

The tool `dv_image_generate`, while the catalog holds an entry of task `t2i`, with the description below. Its params are the shared params of `@dv/generation` (`modality`, `task`, `provider`, `model`, `prompt`, `seed`, `extra`) with `size` before `seed`, then the shared arguments of `@dv/project` without `inputs`, because the operation has no input role.

##### Tool description

```markdown
Generate one image from the prompt with a t2i model from dv_models_list; modality, task, provider and model name it and are required. dv_models_get lists the sizes the model takes and its own parameters for extra. The image is the one output, and you see it in the result. Every call is a new take; a changed prompt for the same image passes based_on. Uses the GPU.
```

##### Param size

```markdown
The image size as WIDTHxHEIGHT in pixels, such as 1024x768. It must meet the size rule that dv_models_get gives; every size it lists by aspect ratio meets it. Omitted, the model's default size.
```

#### Token effect

About 450 tokens for the definition, fixed while a `t2i` entry is registered.

#### KV Cache effect

The definition sits in the stable tool section of every agent request; registering the first `t2i` entry or removing the last one, or mounting or removing the plugin, changes the tool list and invalidates the cached prefix from the tool section on.

### Tool results

#### What the model sees

A call returns the text block below, then the image as an image block when an attachment service is mounted. A refused call writes no record and fails the tool call with the reason and the closing sentence of `@dv/generation`; the reasons of this package are below, and the model's validation reports its own problems. A call that passes the turn's GPU budget without `user_requested` is refused with the summary `Generate image with <provider>/<model>: "<prompt, first 80 characters>"` and the rounded estimate. A render failure fails the record and the tool call with the provider's message.

##### Success result

```markdown
done <record>: image "<prompt, first 60 characters>" (<width>x<height>, seed <seed>)
- image: <asset ID> (image/png) <asset URL>
params: <params JSON>
report: {"seed":<seed>,"model_id":"<backend model ID>","size":"<width>x<height>"}
```

##### Refusal reasons

```markdown
The prompt is empty; describe the image to generate.
size must be WIDTHxHEIGHT in pixels with positive integers, such as 1024x768; got <value as JSON>.
```

#### Token effect

About 120 tokens of text per call, plus the image at the model's cost of one image of that size.

#### KV Cache effect

The result is appended to the conversation after the call; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Text to image only**: the operation has no input role, so it does not edit an image or take a reference image.
- **One image per call**: each call renders one image and writes one record; several takes need several calls.
- **The estimate is a rate**: the GPU estimate is linear in the pixel count, and the first call at a new size, or after the server sits idle, costs more; the record keeps the GPU time that the backend reported.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
