---
description: "This package is the video model catalog of DreamVerse. Provider plugins register one ModelEntry for each model and task in the dvModels service. Each provider plugin translates a RenderRequest into the request of its backend. The agent reads the catalog with the dv_models_list and dv_models_get tools. Open this page to add a provider, a model, or a server, or to see how the agent chooses a model."
kind: "package-reference"
---

# @dv/models

English | [中文](README.zh.md)

## Summary

Use this package to list the video models that a deployment can render with. A provider plugin, such as [`@dv/fastvideo`](../fastvideo/README.md), registers one entry for each model and task that it serves. A consumer, such as [`@dv/shot-render`](../shot-render/README.md), gets an entry by its key and renders with one request type. The agent reads the entries with two tools and chooses a model for each shot with one skill. To add a provider, add a provider plugin. To add a model, change one provider plugin. To add a server, change the `Config` row of the provider plugin.

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

Mount this package once. Mount one or more provider plugins that register models into this package.

### When to choose it

Mount this package in each composition that renders video shots. [`@dv/shot-render`](../shot-render/README.md) and [`@dv/shot-plan`](../shot-plan/README.md) inject `dvModels`, so they start only when this package is mounted. This package renders nothing. A provider plugin, such as [`@dv/fastvideo`](../fastvideo/README.md), supplies each model.

### Minimal configuration

The DreamVerse bundle [`@dv/bundle`](../../bundle/dv/README.md) mounts this package as row `dv-models`:

```yaml
- id: dv-models
  name: '@dv/models'
```

The plugin has no configuration fields.

<a id="model-keys"></a>
### Model keys

A provider is a video generation system, such as FastVideo, fal, or SGLang. A server is one running backend of a provider. Each entry has a key of four fields. `formatModelKey(key)` writes a key as one string, such as `video/ref2v/fastvideo/fasth3`.

| Field | Meaning | Values in this package |
| --- | --- | --- |
| `modality` | The output that the task produces. `ModalityMap` declares the modality names. | `video` |
| `task` | The generation task. `TaskMap` declares each task name and maps it to the modality that it produces. | `t2v`: a video from the prompt only. `ref2v`: a video from reference media and the prompt, with an optional first frame. |
| `provider` | The name of the provider. The provider plugin sets this name. | Each provider plugin sets its own name, such as `fastvideo`. |
| `model` | The name that the provider gives to the model. | Each provider plugin sets its own names, such as `fasth3`. |

A model that serves two tasks has two entries, one for each task. A plugin adds a modality or a task in its own package through TypeScript declaration merging, for example `declare module '@dv/models' { interface TaskMap { v2v: 'video' } }`. The value of a task name is the modality that the task produces. Two plugins can declare the same name with the same value. TypeScript merges the two declarations. Declarations of the same name with different values do not compile.

### Model entries

A provider plugin implements one `ModelEntry` for each key. A `ModelEntry` has the four key fields and the members in this table:

| Member | Contract |
| --- | --- |
| `description` | The strengths and weaknesses of the model. The agent and the user compare descriptions to choose between similar models. |
| `gpuSecondsPerVideoSecond` | The GPU seconds for one second of rendered video. A consumer multiplies it by the shot duration to estimate the GPU time of a render before the render starts. |
| `facts()` | Resolves with the `RenderModelFacts` that the backend reports. Rejects when the backend cannot be reached. |
| `schema()` | Resolves with a JSON description of the requests that the model accepts: the inputs with their media types and counts, and the parameters in `extra`. The provider plugin defines this JSON. The catalog gives it to the agent unchanged. Rejects when the backend cannot be reached. |
| `validateGenerationRequest(request)` | Resolves with each reason that the model cannot render a `RenderRequest`, one agent-facing sentence for each reason. The reasons include invalid `extra` values. Resolves with an empty list when the model can render the request. Rejects when the backend cannot be reached. |
| `render(request, signal)` | Renders one shot and returns a stream of `RenderStreamEvent` values. Reads each input asset through `dvAssetPool`. Yields one `video_start` event, the `chunk` events, and then one `done` event. Yields exactly one `last_frame` event before `video_start` or after the last `chunk`. Rejects for each backend failure. When `signal` aborts, cancels the render and rejects with the abort reason. |

### Render requests and render streams

`RenderRequest` is the one request type for all providers. A consumer builds it in the same way for each model. Each provider plugin translates it into the request format of its backend. The `GenerateOptions` type of [`dsh-llm`](../../llm/llm/README.md) has the same role for language models.

| `RenderRequest` field | Meaning |
| --- | --- |
| `prompt` | The text prompt. |
| `references` | The reference assets as asset IDs, in input order. The list is empty for a task without references. |
| `firstFrame` | The asset ID of the image that the video starts from, or `null`. |
| `frameWidth`, `frameHeight` | The frame size in pixels. A consumer takes it from `frameSizes` in the facts. |
| `numFrames` | The frame count. A consumer takes it from `numFramesByDurationSec` in the facts. |
| `seed` | The random seed. |
| `extra` | The values of the model's own parameters. `schema()` describes them, and `validateGenerationRequest` checks them. |

`references` and `firstFrame` carry the `reference` and `first_frame` inputs of `dv_shot_render`.

| `RenderModelFacts` field | Meaning |
| --- | --- |
| `modelId` | The model ID of the backend. The record report of a render keeps it as `model_id`. |
| `aspectRatios` | The aspect ratios that the model renders. The default comes first. |
| `resolutions` | The resolutions that the model renders. The default comes first. |
| `frameSizes` | The `[width, height]` in pixels, by aspect ratio and then by resolution. |
| `minDurationSec`, `maxDurationSec` | The shortest and the longest shot, in whole seconds. |
| `numFramesByDurationSec` | The frame count for each whole-second duration from the minimum to the maximum. |

| `RenderStreamEvent` kind | Meaning |
| --- | --- |
| `last_frame` | `png`: the last frame of the video as PNG bytes. The event comes before `video_start` or after the last `chunk`. |
| `video_start` | `mime`: the media type of the video. |
| `chunk` | `bytes`: the next part of the video bytes. |
| `done` | `timings`: the backend's timings. Keys that end in `_ms` are milliseconds. Other keys are seconds. |

### The `dvModels` service

A provider plugin calls `register`. A consumer calls the other methods.

| Method | Returns | Semantics |
| --- | --- | --- |
| `register(entry)` | `() => void` | Adds an entry. The returned function removes the entry. A second call of that function does nothing. Throws when an entry with the same key exists. Call `register` inside `ctx.effect`, so that disposal of the provider plugin removes its entries. |
| `get(key)` | `ModelEntry \| undefined` | The entry with the key, or `undefined`. |
| `list(filter?)` | `ModelEntry[]` | The entries that match each given field of `modality`, `task` and `provider`, in registration order. An absent field matches all entries. |
| `onChanged(listener)` | `() => void` | Calls `listener` after each registration and each removal. The returned function removes the listener. |

The service also registers the tools `dv_models_list` and `dv_models_get` and the skill `video-model-selection` for the agent. It adds nothing to the system prompt.

### What a provider plugin owns

A provider plugin connects one provider to the catalog. [`@dv/fastvideo`](../fastvideo/README.md) is the example to follow. The provider plugin owns these parts:

- The provider name and the protocol of the backend.
- The deployment values in its `Config`, such as the server URL and the GPU rate of each model and task.
- All members of each entry that it registers.
- The translation of a `RenderRequest` into a backend request. The plugin reads the bytes and the media type of each asset from `dvAssetPool`. The plugin sends them in the format of the backend.
- Optional prompt skills for its models.

This package owns the key, the entry contract, the request and stream types, the `dvModels` service, the two tools, and the selection skill. It contains no data about a specific model.

<a id="add-a-provider-or-a-model"></a>
### Add a provider or a model

None of these changes edits `@dv/models`:

| Change | Edit |
| --- | --- |
| Add a provider | Add one provider plugin package. |
| Add a model | Change one provider plugin. |
| Add a server | Change the `Config` row of the provider plugin in the composition. |

**No compatibility code.** `@dv/models` has one key format and one entry type. It contains no aliases, adapters, or fallback code for other catalog formats.

The repository skill [`dv-add-model-provider`](../../../.agents/skills/dv-add-model-provider/SKILL.md) gives the procedures and the checks.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service keeps the entries in a `Map` by the formatted key. `register` refuses a key that the map contains. Each registration and each removal calls every `onChanged` listener after the map changes. The function that `register` returns removes the entry only while the map holds that same entry.

While the DSH tool registry (`tools`) is mounted, the service registers `dv_models_list` and `dv_models_get` as effects. `dv_models_list` filters the entries with its arguments and returns the key and the description of each entry. `dv_models_get` finds the entry with all four key fields and reads `facts()` and `schema()` at the same time. From the facts, `dv_models_get` returns only the duration range, the aspect ratios, and the resolutions. `@dv/shot-render` uses the other facts to build the request.

While the DSH skill registry (`skills`) is mounted, the service registers the runtime skill `video-model-selection` from `skills/video-model-selection.md`. The agent can load the skill. Users cannot call it from the composer.

[`@dv/shot-render`](../shot-render/README.md) gets the entry that a `dv_shot_render` call names. It builds a `RenderRequest` from the facts of the entry. It checks the request with `validateGenerationRequest`, and then renders the request. [`@dv/shot-plan`](../shot-plan/README.md) refuses a plan shot whose key names no entry.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `Config`, `formatModelKey`, the `DvModels` service, and the two tools |
| [`src/types.ts`](src/types.ts) | `ModalityMap`, `TaskMap`, `ModelKey`, `RenderModelFacts`, `RenderRequest`, `RenderStreamEvent`, `ModelEntry`, `ModelFilter` |
| [`skills/video-model-selection.md`](skills/video-model-selection.md) | The model selection skill |
| [`tests/models.spec.ts`](tests/models.spec.ts) | The catalog, the tools, the skill, and the system prompt in a Loader composition |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/fastvideo`](../fastvideo/README.md): the provider plugin to use as the example.
- [`dv-add-model-provider`](../../../.agents/skills/dv-add-model-provider/SKILL.md): the procedures to add a provider, a model, or a server.
- [`@dv/shot-render`](../shot-render/README.md): the consumer that renders a shot with an entry.
- [`@dv/shot-plan`](../shot-plan/README.md): the consumer that checks the model key of each plan shot.
- [`@dv/bundle`](../../bundle/dv/README.md): the rows `dv-models` and `dv-fastvideo`.

-----

<a id="model-experience"></a>
## Model Experience

### `dv_models_list` tool definition and results

#### What the model sees

While the DSH tool registry is mounted, the agent sees the tool `dv_models_list` with the description below. The tool has three optional string arguments: `modality`, `task` and `provider`. The generated tool catalog does not list DreamVerse tools, so this section quotes the description and the argument descriptions. A call returns one text block with indented JSON: an array of `modality`, `task`, `provider`, `model` and `description` for each matching entry. This package adds nothing to the system prompt. The agent reads the catalog only through the two tools and the `video-model-selection` skill.

##### dv_models_list description

```markdown
List the video models you can render with, each with its key (modality, task, provider, model) and its description. To choose the model of a shot, follow the video-model-selection skill.
```

##### dv_models_list argument descriptions

```markdown
- modality: Only models of this modality, such as video.
- task: Only models for this task: t2v (prompt only) or ref2v (reference media and prompt).
- provider: Only models of this provider.
```

#### Token effect

About 120 tokens for the definition, in every request while the tool registry is mounted. A result costs about 30 tokens for each entry, plus the tokens of the entry's description.

#### KV Cache effect

The definition is fixed text in the stable tool section. Registration or removal of entries does not change the definition. Mounting or removing this package changes the tool list and invalidates the cached prefix from the tool section on. The conversation gets each result after its call. The cached prefix before the result does not change.

### `dv_models_get` tool definition and results

#### What the model sees

While the DSH tool registry is mounted, the agent sees the tool `dv_models_get` with the description below. The tool has four required string arguments: `modality`, `task`, `provider` and `model`. A call returns one text block with indented JSON: the four key fields, `description`, `facts`, and the `schema` JSON of the provider. `facts` holds `duration_sec` with `min` and `max`, `aspect_ratios`, and `resolutions`. A key that names no entry fails the call with `No video model has the key <modality>/<task>/<provider>/<model>; call dv_models_list for the models you can use.` A backend that cannot be reached fails the call with the error of the backend.

##### dv_models_get description

```markdown
Read one video model by its key from dv_models_list: its description; its facts (durations, aspect ratios and resolutions); and its schema (the inputs it accepts with their media types and counts, and the parameters it takes in `extra`).
```

##### dv_models_get argument descriptions

```markdown
- modality: The modality of the model, as dv_models_list lists it.
- task: The task of the model, as dv_models_list lists it.
- provider: The provider of the model, as dv_models_list lists it.
- model: The model name, as dv_models_list lists it.
```

#### Token effect

About 170 tokens for the definition, in every request while the tool registry is mounted. The size of a result depends on the description and the schema of the model. A result for `fasth3` in task `ref2v` is about 300 tokens.

#### KV Cache effect

The definition is fixed text in the stable tool section. Registration or removal of entries does not change the definition. Mounting or removing this package changes the tool list and invalidates the cached prefix from the tool section on. The conversation gets each result after its call. The cached prefix before the result does not change.

### `video-model-selection` skill

#### What the model sees

While the DSH skill registry is mounted, the skill catalog that `dsh-tool-skill` renders lists the skill catalog line below. When the agent calls the `skill` tool with `video-model-selection`, the tool result carries `skills/video-model-selection.md`. That file is a nine-step procedure for each shot of a plan. The agent gets the candidates for the task of the shot with `dv_models_list` and `dv_models_get`. The agent removes each candidate that cannot render the duration, aspect ratio, resolution, references, or first frame of the shot. Users cannot invoke the skill with `/video-model-selection`.

##### Skill catalog line

```markdown
- `video-model-selection`: How to choose the video model for each shot of a plan: the task of the shot, the candidates from dv_models_list and dv_models_get, and when to ask the user.
```

#### Token effect

About 40 tokens in the catalog while the skill registry is mounted. About 400 tokens each time the agent loads the skill.

#### KV Cache effect

Mounting or removing this package changes the skill list. Then `dsh-tool-skill` appends a replacement catalog. A loaded skill body comes after its call as a tool result. The cached prefix before the catalog and before the skill body does not change.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits apply to the catalog, its two tools, and its selection skill.

- **Agent-facing text names only two tasks** — the `task` argument of `dv_models_list` and step 1 of `video-model-selection` name only `t2v` and `ref2v`. A plugin can add a task through declaration merging. That task appears in `dv_models_list` results. The agent gets no instruction about when to choose that task.
- **No readiness check** — an entry appears in `dv_models_list` when its provider plugin registers it. At that time, the backend of the entry can be unreachable. A backend failure shows only when `dv_models_get` or a render reads the entry.
- **Key fields can contain `/`** — `register` compares keys in the format of `formatModelKey`. `register` does not refuse a `/` in a field. Provider `a/b` with model `c` and provider `a` with model `b/c` have the same formatted key, so the second registration fails. Provider plugins must use names without `/`.
- **`schema()` has no fixed JSON format** — each provider plugin defines its own JSON. `@dv/models` does not check the JSON. Only the agent reads it; no consumer code parses it. The `validateGenerationRequest` member of each entry is the only enforced check of inputs and `extra` values.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
