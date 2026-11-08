---
description: "Voice component of DreamVerse: the dvVoiceConvert service declares the voice primitive and task a2a in the model catalog of @dv/models and owns the operation voice.convert, which speaks one speech recording again in an allowed voice with the model the call names by its catalog key, and the agent tool dv_voice_convert."
kind: "package-reference"
---

# @fastvideo/dreamverse-voice-convert

English | [中文](README.zh.md)

## Summary

Use this package to let the user voice a character: the user records a line, and `voice.convert` (tool `dv_voice_convert`) speaks the recording again in one voice of an `a2a` model, keeping its words, timing and intonation. It declares the generation primitive `voice` and the task `a2a` in the model catalog of [`@dv/models`](../models/README.md). The converted clip is the record's one output, with its duration, and a shot reuses it unchanged as its dialogue track. The operation exists while the catalog holds a model of task `a2a`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project`, `@dv/models` and `@dv/asset-pool`, and mount a provider plugin that registers a model of task `a2a`, such as [`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.md). `voice.convert` is registered while the catalog holds at least one model of task `a2a` (`dvModels.whileServing`). The operation carries the label 转换音色 / Convert voice, and the service labels task `a2a` with `dvModels.labelTasks` while it lives: 音色转换 / Voice conversion. The DreamVerse bundle does not mount it; a profile patch inserts it with its provider.

```yaml
- id: dv-voice-convert
  name: '@fastvideo/dreamverse-voice-convert'
```

The plugin has no configuration.

| Operation | Tool | Inputs and params | Outputs and report |
| --- | --- | --- | --- |
| `voice.convert` | `dv_voice_convert` | input `reference` (required: one audio recording); params `modality`, `task`, `provider` and `model` (required: the key of a catalog entry), `prompt` (required: the words the recording speaks; the model does not read them), `voice` (required: the key of one voice that `dv_models_get` lists), `seed`, `extra` (the model's own parameters) | output `audio`, one `audio/wav` asset named `<record ID, 8 characters>.wav` with its `duration_sec`; report `{seed, model_id, voice, duration_sec}` |

The operation uses the GPU, runs in the background like every generation, and is not deterministic. A call without `seed` draws one and reports it; the same seed repeats a take. Workflows call the `GenerationApi` methods of [`@dv/generation`](../generation/README.md) on `dvVoiceConvert`: `render`, `check` and `parseInputs`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The package declares the primitive row `voice` of `PrimitiveTypes` through declaration merging: facts `VoiceModelFacts` (`modelId`), request `VoiceRequest` (`speech`, the recording's asset or null while its producer runs; `voice`; `seed`; `extra`), result `Promise<ConvertedVoice>` (the bytes, `mime: 'audio/wav'` and `durationSec`), and no entry fields. It maps task `a2a` to that row in `TaskMap`. `defineGeneration` of `@dv/generation` builds the service. The request takes the trimmed `voice` and the one asset of role `reference`; an empty voice is refused with "The voice is empty; name one voice that dv_models_get lists for the model.", and a call without exactly one recording with "voice.convert takes exactly one speech recording in inputs.reference.". The input role is `reference` because the composer of a take editor sends every cited asset in that role. The entry's `validateGenerationRequest(request)` judges the voice, the recording and `extra` before any record and again before `render(request, signal)`. `toOutputs` imports the clip through `importOne` with its duration.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvVoiceConvert`: the primitive row `voice` and task `a2a`, the types `VoiceModelFacts`, `VoiceRequest` and `ConvertedVoice`, and the declaration of `voice.convert` (request, stored output and summary) |
| [`tests/voice-convert.spec.ts`](tests/voice-convert.spec.ts) | A Loader composition with the tool registry, Project, ffmpeg, the asset pool, the catalog and the service against a fake `a2a` model; it pins the texts that the agent reads and the removal on disposal |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.md): the provider plugin that registers Seed-VC v1 for task `a2a` with its allowed voices.
- [`@fastvideo/dreamverse-ui-voice-convert`](../ui-voice-convert/README.md): the Voice tab that records a line and converts it, and the voice takes on the canvas.
- [`@fastvideo/dreamverse-workflow-voice`](../workflow-voice/README.md): the voice-acting skill that turns a converted take into a shot's soundtrack.
- [`@dv/generation`](../generation/README.md): the helper that builds the service, its checks and its `GenerationApi`.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

One tool, `dv_voice_convert`, while the catalog holds a model of task `a2a`, in the format `@dv/project` gives every operation tool. The params are `modality`, `task`, `provider`, `model`, `prompt`, `voice`, `seed` and `extra`, and the input role `reference`. The `prompt` param reads "The words the recording speaks, as plain text. The model does not read them; they title the take and are the dialogue text of a shot that uses it."; `voice` reads "The key of one voice that dv_models_get lists for the model.".

##### Verbatim tool description

```markdown
Speak one speech recording again in an allowed voice with an a2a model from dv_models_list; modality, task, provider and model name it and are required. dv_models_get lists the model's voices; voice names one of them. The converted clip keeps the recording's words, timing and intonation, so use it as the dialogue track of a shot, reused unchanged. The clip is the one output; the result gives its duration. You cannot hear the clip, so ask the user which take to keep. Every call is a new take; the same seed repeats one. Uses the GPU.
```

#### Token effect

About 600 tokens for the definition, the shared arguments of `@dv/project` included, fixed while the plugin and at least one model of task `a2a` are mounted.

#### KV Cache effect

The definition sits in the stable tool section of every agent request. The first registered or last removed `a2a` model adds or removes the tool, which changes the tool list and invalidates the cached prefix from the tool section on.

### Tool results

#### What the model sees

A call returns the operation tool text of `@dv/project`: `done <record>: voice <voice> "<prompt>" (<duration, one decimal>s)`, the line `- audio: <asset ID> (audio/wav) <asset URL>`, the params, and the report `{"seed":<seed>,"model_id":"<the backend's model ID>","voice":"<voice>","duration_sec":<seconds>}`; a call that waits for its recording's producer is `pending` and a DreamVerse notice reports it. A refused call names its problems and ends with "Nothing was generated; change the inputs or params, then call again."; a failed conversion fails the record with the model's message.

#### Token effect

About 140 tokens of text per call; a refusal is about 30 to 80 tokens.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The agent cannot hear a take**: the result carries the duration and the words the caller wrote, so the agent cannot judge a take; the tool description tells it to ask the user which take to keep.
- **One recording per call**: a line longer than the voice model's window, or a dialogue of two speakers, is converted as separate recordings; no operation cuts or joins audio.
