---
description: "Audio component of DreamVerse: the dvAudioGenerate service declares the audio primitive and task t2a in the model catalog of @dv/models and owns the operation audio.generate, which speaks one prompt as one audio clip with the model the call names by its catalog key, and the agent tool dv_audio_generate."
kind: "package-reference"
---

# @dv/audio-generate

English | [中文](README.zh.md)

## Summary

Use this package to generate speech clips. It declares the generation primitive `audio` and the task `t2a` in the model catalog of [`@dv/models`](../models/README.md), and its one operation, `audio.generate` (tool `dv_audio_generate`), speaks one prompt as one audio clip with the catalog entry named by the required params `modality`, `task`, `provider` and `model`. The clip is the record's one output, with its duration. The operation has no seed, and every call is a new take. The operation exists while the catalog holds a model of task `t2a`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project`, `@dv/models` and `@dv/asset-pool`, and mount a provider plugin that registers a model of task `t2a`, such as [`@dv/sglang-omni`](../sglang-omni/README.md). `audio.generate` is registered while the catalog holds at least one model of task `t2a` (`dvModels.whileServing`). The operation carries the label 生成音频 / Generate audio, and the service labels task `t2a` in the catalog with `dvModels.labelTasks` while it lives: 文字生成音频 / Audio from text.

```yaml
- id: dv-audio-generate
  name: '@dv/audio-generate'
```

The plugin has no configuration.

| Operation | Tool | Inputs and params | Outputs and report |
| --- | --- | --- | --- |
| `audio.generate` | `dv_audio_generate` | no inputs; params `modality`, `task`, `provider` and `model` (required: the key of a catalog entry, as `dv_models_list` lists it), `prompt` (required: the text to speak, in the markup of the model's prompt skill), `extra` (the model's own parameters, as `dv_models_get` lists them) | output `audio`, one `audio/wav` asset named `<record ID, 8 characters>.wav` with its `duration_sec`; report `{model_id, duration_sec}` |

The operation uses the GPU and is not deterministic. The operation has no `seed` param, draws no seed and reports none (`seed: false` in the declaration), because the speech backends take no seed; the same prompt gives a different clip. Workflows call the `GenerationApi` methods of [`@dv/generation`](../generation/README.md) on `dvAudioGenerate`: `render`, `check` and `parseInputs`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The package declares the primitive row `audio` of `PrimitiveTypes` through declaration merging: facts `AudioModelFacts` (`modelId`), request `AudioRequest` (`prompt` and `extra`), result `Promise<GeneratedAudio>` (the bytes, `mime: 'audio/wav'`, and `durationSec`), and no entry fields. It maps task `t2a` to that row in `TaskMap`. `defineGeneration` of `@dv/generation` builds the service from the declaration of `audio.generate`. A call looks up the catalog entry of the named key with `dvModels.resolve`, reads its facts, and builds the request from the trimmed prompt and the `extra` values; an empty prompt is refused with "The prompt is empty; write the text to speak.". The entry's `validateGenerationRequest(request)` judges the prompt markup and `extra` before any record, and again before the entry's `render(request, signal)`. The declaration's `toOutputs` imports the clip through `importOne` with its duration, so the asset pool never probes the clip.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvAudioGenerate`: the primitive row `audio` and task `t2a`, the types `AudioModelFacts`, `AudioRequest` and `GeneratedAudio`, and the declaration of `audio.generate` (request, stored output and summary) |
| [`tests/audio-generate.spec.ts`](tests/audio-generate.spec.ts) | A Loader composition with the tool registry, Project, ffmpeg, the asset pool, the catalog and the service against a fake `t2a` model; it pins the texts that the agent reads and the removal on disposal |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/project`](../project/README.md): operations and agent tools.
- [`@dv/models`](../models/README.md): the model catalog, with `dv_models_list` and `dv_models_get`.
- [`@dv/generation`](../generation/README.md): the helper that builds the service, its checks and its `GenerationApi`.
- [`@dv/sglang-omni`](../sglang-omni/README.md): a provider plugin that registers a `t2a` model and its prompt skill.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

One tool, `dv_audio_generate`, while the catalog holds a model of task `t2a`, in the format `@dv/project` gives every operation tool. The params are `modality`, `task`, `provider`, `model`, `prompt` and `extra`, with no `seed`; the four key params and `extra` keep the descriptions of `@dv/generation`. The `prompt` param reads "The text to speak, in the markup of the prompt skill that dv_models_list names for the model.".

##### Verbatim tool description

```markdown
Generate one audio clip from the prompt with a t2a model from dv_models_list; modality, task, provider and model name it and are required. Before the first call for a model, load the prompt skill that dv_models_list names for it, because the prompt is written in the model's own markup. dv_models_get lists the model's own parameters for extra. The clip is the one output; the result gives its duration. You cannot hear the clip, so ask the user which take to keep. Every call is a new take, and the same prompt gives a different clip. Uses the GPU.
```

#### Token effect

About 550 tokens for the definition, the shared arguments of `@dv/project` included, fixed while the plugin and at least one model of task `t2a` are mounted.

#### KV Cache effect

The definition sits in the stable tool section of every agent request. The first registered or last removed `t2a` model adds or removes the tool, which changes the tool list and invalidates the cached prefix from the tool section on; other registrations leave the definition unchanged.

### Tool results

#### What the model sees

A call returns one text block: `done <record>: audio "<prompt>" (<duration, one decimal>s)`, with the prompt written by `quotePrompt(prompt, 60)` of `@dv/generation`, the line `- audio: <asset ID> (audio/wav) <asset URL>`, the params, and the report `{"model_id":"<the backend's model ID>","duration_sec":<seconds>}`. A call that the model's validation refuses is refused before any record with "Model <modality>/<task>/<provider>/<model> cannot generate this: <problems> Nothing was generated; change the inputs or params, then call again."; an empty prompt is refused with "The prompt is empty; write the text to speak." and the same closing sentence. A failed render fails the record, and the tool error is the model's message.

#### Token effect

About 130 tokens of text per call; a refusal is about 30 to 80 tokens.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The agent cannot hear a clip**: the result carries the duration and no transcript, so the agent cannot judge a take; the tool description tells it to ask the user which take to keep.
