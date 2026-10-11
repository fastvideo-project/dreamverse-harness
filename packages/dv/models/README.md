---
description: "Model catalog of DreamVerse: the dvModels service that company plugins register their video models into, each with the generation modes it supports, plus the dv:models prompt section (the model list) and the dv_models_get tool."
kind: "package-reference"
---

# @dv/models

English | [中文](README.zh.md)

## Summary

Use this package to add, replace, or list the video models that render shots. The `dvModels` service is the model catalog: company plugins such as [`@dv/fastvideo`](../fastvideo/README.md) register one entry per model, and consumers such as [`@dv/shot-render`](../shot-render/README.md) and [`@dv/shot-plan`](../shot-plan/README.md) look up the model and generation mode a call names. A model and a mode are separate choices: `MODES` defines each mode once (`reference`, `text`), and each model declares the modes it supports, so N models need N entries. The catalog gives the agent the `dv:models` model list and the tool `dv_models_get`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service before the company plugins and the consumers. The DreamVerse bundle mounts it as row `dv-models`:

```yaml
- id: dv-models
  name: '@dv/models'
```

| Field | Default | Meaning |
| --- | --- | --- |
| `promptSectionOrder` | `4890` | The order of the `dv:models` prompt section among the system prompt sections |

A company plugin injects `dvModels` and calls `register(entry)` inside `ctx.effect`, so disposing the plugin removes its models. A consumer calls the other methods:

| Method | Returns | Semantics |
| --- | --- | --- |
| `register(entry)` | `() => void` | Adds a model; the returned function removes it. Throws when a model with the same `id` is registered, or when the entry declares no mode, a mode outside `MODES`, or an input role its mode does not allow |
| `get(id)` | `ModelEntry \| undefined` | The model registered under `id` |
| `list()` | `ModelEntry[]` | Every registered model, in registration order |
| `onChanged(listener)` | `() => void` | Calls `listener` after each registration and removal; the returned function removes the listener |
| `checkExtra(entry, mode, extra)` | `string[]` | One sentence per problem of a render's `extra` param: a name the model does not take in the mode, or a value of the wrong type; empty when the values are valid |
| `describe(id)` | `Promise<JsonValue>` | The model, its company, its summary, and per mode the accepted inputs with their counts, the duration range, the aspect ratios, the resolutions, and the extra parameter schema, read from the model's `facts(mode)`; throws for an unknown `id` or the backend's error |

A `ModelEntry` has these fields; every company plugin implements `facts` and `render` with the semantics below:

| Field | Semantics |
| --- | --- |
| `id` | The name the agent and the user choose the model by, such as `fasth3`; unique in the catalog |
| `company` | Who serves the model, such as `local FastVideo`, for the model list |
| `summary` | One line that tells the model apart from the others, for the model list |
| `modes` | The supported modes, at least one, each a `ModeDeclaration`: `inputs` (each accepted input role, `reference` or `first_frame`, with `min`, the smallest count a render needs) and `extra` (the parameter schema of the model's own parameters in the mode, empty when it has none) |
| `facts(mode)` | Resolves with the `RenderModelFacts` of the model in the mode; rejects when the backend cannot be reached |
| `render(mode, request, signal?)` | Sends the reference images in order, then the first frame; yields exactly one `last_frame`, one `video_start`, the `chunk` events, then `done`; rejects for any backend failure; aborting `signal` cancels the render and rejects with its reason |

| Type | Fields |
| --- | --- |
| `ModeId` | `reference` or `text` |
| `ModeDefinition` | `description` (one model-facing sentence) and `inputs` (the input roles the mode allows: `reference` and `first_frame` for `reference`, none for `text`) |
| `RenderModelFacts` | `modelId` (the backend's model ID), `aspectRatios` and `resolutions` (the default first), `frameSizes` (`[width, height]` by aspect ratio and then by resolution), `minDurationSec`, `maxDurationSec`, `numFramesByDurationSec`, `maxReferenceImages` (0 in a mode without reference images), `imageLabels` (`Picture 1`, `Picture 2`, …; empty in a mode without images), `gpuSecondsPerVideoSecond` (GPU seconds per rendered video second, for the GPU estimate) |
| `RenderRequest` | `prompt`, `references` (image bytes in input order), `firstFrame` (image bytes or null), `frameWidth`, `frameHeight`, `numFrames`, `seed`, `extra` (the model's own parameters, already checked against its schema) |
| `RenderStreamEvent` | `last_frame` (PNG bytes, before or after the video), `video_start` (the media type of the video), `chunk` (video bytes), `done` (the backend's timings: keys ending in `_ms` are milliseconds, other keys seconds) |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The service keeps the entries in a map by `id` and calls every `onChanged` listener after a registration or a removal. `register` checks each declared mode against `MODES`: the mode must exist and each declared input role must be one the mode allows; the model's own `min` counts and `extra` schema are its own. `checkExtra` refuses unknown names first and then validates the values with `validateArgs` of `dsh-tools`, prefixing each message with `extra`. `describe` reads `facts(mode)` for each declared mode in turn and reports each input role with its `min` and its `max` (`maxReferenceImages` for `reference`, 1 for `first_frame`). While the DSH `systemPrompt` service is mounted, the service registers the `dv:models` section, whose text is rebuilt from `list()` at every request and is empty while no model is registered; while the DSH tool registry is mounted, it registers `dv_models_get`, which returns `describe(model)` as indented JSON. Shot render re-registers `shot.render` on every catalog change, so the `model` param of `dv_shot_render` lists exactly the registered models.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `MODES`, `PROMPT_SECTION`, `Config`, the `dvModels` service with its methods, the `dv:models` section, and `dv_models_get` |
| [`src/types.ts`](src/types.ts) | `ModeId`, `InputRole`, `ModeDefinition`, `ModeInputs`, `ModeDeclaration`, `RenderModelFacts`, `RenderRequest`, `RenderStreamEvent`, `ModelEntry` |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/fastvideo`](../fastvideo/README.md): the company plugin that registers `fasth3` in modes `reference` and `text`.
- [`@dv/shot-render`](../shot-render/README.md): the consumer that renders with the model and mode of each `dv_shot_render` call.
- [`@dv/shot-plan`](../shot-plan/README.md): the consumer that checks the model and mode of every plan shot.
- [`@dv/bundle`](../../bundle/dv/README.md): the rows `dv-models` and `dv-fastvideo`.

-----

<a id="model-experience"></a>
## Model Experience

### Model list prompt section

#### What the model sees

While the `systemPrompt` service is mounted and at least one model is registered, the system prompt carries the `dv:models` section below: the generation modes with their `MODES` descriptions, then one table row per registered model. `<extra parameters>` lists each extra parameter as `<name> (<mode>)`, or `—` when the model has none. While no model is registered, the section is empty.

##### The `dv:models` section

```markdown
## Video models
Every dv_shot_render call names a `model` and a `mode` from this list; a call without them is refused. Modes:
- reference: From reference images (character, location and style versions, or imported images) and the prompt; optionally a first frame, such as the last still of the previous shot.
- text: From the prompt alone; no images.
Call dv_models_get with a model for its limits in each of its modes: durations, aspect ratios, resolutions, reference images, and the extra parameters it takes in `extra`.

| model | company | modes | extra parameters | about |
| --- | --- | --- | --- | --- |
| <model> | <company> | <modes> | <extra parameters> | <summary> |
```

#### Token effect

About 130 tokens for the fixed text, plus about 35 tokens per registered model, on every request while a model is registered.

#### KV Cache effect

The section sits in the system prompt at order `promptSectionOrder` (4890) and stays the same while the registered models stay the same; registering or removing a model changes the section and invalidates the cached prefix from this section on.

### Model limits tool

#### What the model sees

The tool `dv_models_get` with one required argument, `model`, and the description "Read one video model's limits in each of its modes: the inputs it accepts, durations, aspect ratios, resolutions, and the extra parameters it takes in the `extra` param of dv_shot_render." A call returns one text block with the JSON of `describe(model)`: `{model, company, about, modes}`, where each mode holds `inputs` (each role with `min` and `max`), `duration_sec` (`min` and `max`), `aspect_ratios`, `resolutions`, and `extra`. An unknown model fails with `Unknown model "<model>"; models: <registered models>.`, and an unreachable backend fails with the backend's error.

#### Token effect

About 90 tokens for the definition while the tool registry is mounted; a result is roughly 100 tokens per mode of the model.

#### KV Cache effect

The definition is a fixed part of the stable tool section; each result is appended to the conversation after its call, so the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Fixed set of modes**: `ModeId` and `MODES` in this package define every generation mode; a model that needs another mode, such as one that renders from a first and a last frame, needs a new `ModeId` value, its `MODES` entry, and, for a new input role, the matching input of `shot.render` in `@dv/shot-render`.
- **No readiness check**: a model appears in the model list as soon as its company plugin registers it, whether or not its backend can be reached; an unreachable backend shows only when a consumer reads the model's facts, such as a `dv_models_get` or `dv_shot_render` call.
- **One failing mode fails `dv_models_get`**: `describe` reads every mode's facts, so a model whose backend for one mode cannot be reached returns an error instead of the limits of its other modes.
