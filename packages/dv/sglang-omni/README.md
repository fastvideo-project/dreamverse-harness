---
description: "Provider plugin sglang-omni of DreamVerse for speech models on local SGLang-Omni servers: registers the configured model fish-audio-drama-3 (Fish Audio Drama 3) into the dvModels catalog for task t2a, with its speaker and extra parameter schema, request validation, served-model check and prompt skill."
kind: "package-reference"
---

# @dv/sglang-omni

English | [中文](README.zh.md)

## Summary

Use this package to speak clips with speech models on local SGLang-Omni servers. The function plugin `dv-sglang-omni` is the provider `sglang-omni` of the [`@dv/models`](../models/README.md) catalog: it registers one catalog entry of task `t2a` per model that its `models` config names. It serves `fish-audio-drama-3` (Fish Audio Drama 3, served as `fishaudio/drama-3`). While the DSH skill registry is mounted, the catalog registers the entry's prompt skill `fish-audio-drama-3-prompting`. The tool that speaks a clip is `dv_audio_generate` of [`@dv/audio-generate`](../audio-generate/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/models`, with one server per model. The DreamVerse bundle mounts it as row `dv-sglang-omni`:

```yaml
- id: dv-sglang-omni
  name: '@dv/sglang-omni'
  config:
    models:
      fish-audio-drama-3:
        baseUrl: http://127.0.0.1:8000
        gpuSecondsPerCall: 3
```

| Field | Default | Meaning |
| --- | --- | --- |
| `models` | required | The models to register, by model name; a model left out is not registered |
| `models.<model>.baseUrl` | required | HTTP base URL of the SGLang-Omni server that serves the model, such as `http://127.0.0.1:8000` |
| `models.<model>.gpuSecondsPerCall` | required | GPU seconds of one clip on that server; the entry declares it for the GPU estimate before a call runs |

Loading fails when `models` names a model other than `fish-audio-drama-3`. While the plugin is mounted, the catalog holds one entry per configured model, such as `audio/t2a/sglang-omni/fish-audio-drama-3`. Mount `@dv/audio-generate` so that the agent can speak clips, and the DSH skill registry (`@deepseek-ai/dsh-skill`) so that the agent can load the prompt skill.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The table `SERVED` in `src/index.ts` maps each model that the plugin can serve to its server model ID, its catalog description, its speaker numbers, its extra parameter schema and its prompt skill file. `fish-audio-drama-3` speaks only speaker 0 on this server, and its one extra parameter is `speed`, a number. One value, `speakers`, feeds both the `speakers` list of `schema()` and the speaker refusal. The server ignores the `model` field of a request, so `facts()` and `schema()` read `GET /v1/models` on every call and reject when the server does not list `fishaudio/drama-3`, answers with an HTTP error, or cannot be reached; nothing caches the answer. `facts()` reports the server's model ID. `schema()` reports `{"speakers": [0], "extra": {"speed": {"type": "number", "description": "Speaking rate; 1 is normal."}}}`. `validateGenerationRequest(request)` reads no server and returns one sentence per check that holds, in this order: the speaker tags (`<|speaker:N|>`, well-formed or not) that the server does not speak, each listed once in order of first appearance; a prompt with no text besides its speaker tags, which the server would answer with HTTP 200 and a near-silent clip; the `extra` names the model does not take; and each `extra` value that fails its schema, checked with `validateArgs` of `@deepseek-ai/dsh-tools`. `render(request, signal)` sends one `POST /v1/audio/speech` with the `extra` values, `input` (the prompt) and `response_format: 'wav'`, and passes `signal` on to cancel the HTTP request. It fails a clip whose `x-finish-reason` header is not `stop`. The server sends `length` when it cut the clip at its length limit, and that failure tells the agent to split the text; a missing header, such as one that a proxy drops, or another value gets a message that quotes the value. It reads the duration from the WAV header: the size of the `data` chunk divided by the byte rate of the `fmt ` chunk, with other chunks skipped by their sizes; a body that holds no complete `data` chunk after a `fmt ` chunk of at least 16 bytes fails, and so does a clip of no samples. It records the wall time of the request as the GPU seconds. Each entry registers through `ctx.effect` and carries the prompt skill as `promptSkill`, with the text of the skill file as `content`.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`, `inject`, `Config`, `apply`, the `SERVED` table, the served-model check, the request validation, the WAV duration, and the catalog entry of one model |
| [`skills/fish-audio-drama-3-prompting.md`](skills/fish-audio-drama-3-prompting.md) | The skill body for `fish-audio-drama-3` for task `t2a`: speaker tags, sound events, languages, clip length, voices, an example and the sources |
| [`tests/fixture.ts`](tests/fixture.ts) | The Loader composition of both specs, and a fake SGLang-Omni server that answers with the bodies and headers of a running server |
| [`tests/sglang-omni.spec.ts`](tests/sglang-omni.spec.ts) | Registration, disposal, config, facts and schema, every refusal, the render and its failures, against the fake server |
| [`tests/real-server.spec.ts`](tests/real-server.spec.ts) | An opt-in spec against the server named by `DV_SGLANG_OMNI_TEST_URL`; its misrouted case runs when `DV_SGLANG_DIFFUSION_TEST_URL` names a running SGLang diffusion server |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/models`](../models/README.md): the model catalog this plugin registers into.
- [`@dv/audio-generate`](../audio-generate/README.md): the consumer, with the tool `dv_audio_generate`.
- [`dsh-tool-skill`](../../skill/tool-skill/README.md): how the agent sees the skill catalog and loads a skill.

-----

<a id="model-experience"></a>
## Model Experience

### Prompt skill for task t2a

#### What the model sees

While the skill registry is mounted and `fish-audio-drama-3` is configured, the skill catalog that `dsh-tool-skill` renders lists the catalog entry below. When the agent calls the `skill` tool with `fish-audio-drama-3-prompting`, the tool result carries `skills/fish-audio-drama-3-prompting.md`: speaker tags limited to the numbers that `dv_models_get` lists under `speakers`, with one clip per character when only 0 is listed; bracketed sound events such as `[laughs]`; the 83 languages of the model card; at most about 95 seconds of speech per clip; the voice that the model picks per clip; one example prompt; and the model card and cookbook sources. Users cannot invoke the skill with `/fish-audio-drama-3-prompting`; only the agent loads it.

##### Catalog entry

```markdown
- `fish-audio-drama-3-prompting`: Prompt markup of model fish-audio-drama-3 for task t2a: speaker tags, sound events, clip length, and voices.
```

#### Token effect

About 30 tokens in the catalog while the entry and the skill registry are mounted, and about 370 tokens each time the agent loads the skill.

#### KV Cache effect

Mounting or removing the plugin changes the skill list, and `dsh-tool-skill` appends a replacement catalog; a loaded skill body is appended as a tool result. Both leave the cached prefix before them intact.

### Catalog entries and refusals

#### What the model sees

The `dv_models_list` results of `@dv/models` list the entry with its key (modality `audio`, task `t2a`, provider `sglang-omni`, model `fish-audio-drama-3`), the prompt skill name, and the description "Fish Audio Drama 3: expressive speech from text in many languages, with sound events such as laughs and sighs written into the text.". `dv_models_get` adds the speakers and the `extra` schema that `schema()` reports. The refusals of `dv_audio_generate` carry the validation sentences below after "Model audio/t2a/sglang-omni/fish-audio-drama-3 cannot generate this: ". A `facts()` or `schema()` rejection reads `The server at <baseUrl> serves <served IDs>, not fishaudio/drama-3; the dv-sglang-omni config points this model at the wrong server.`, `The server at <baseUrl> cannot be reached.`, or `The server at <baseUrl> answered GET /v1/models with HTTP <status>: <server text>`. A failed render reads `The server stopped the clip at its length limit before the text ended; split the text into shorter clips.`, `The server at <baseUrl> answered POST /v1/audio/speech with HTTP <status>: <server text>`, `The server at <baseUrl> answered POST /v1/audio/speech with x-finish-reason <value as JSON>, not "stop", so the clip may not hold the whole text.`, `The server at <baseUrl> answered POST /v1/audio/speech with a body that is not a WAV file.`, `The server at <baseUrl> answered POST /v1/audio/speech with an empty WAV clip.`, or `The server at <baseUrl> cannot be reached.`; the server text is the `error.message` of an `application/json` body, else its `detail`, else the body as sent.

##### Validation sentences

```markdown
This server speaks only <allowed tags>, and the prompt has <refused tags>. Write one clip per character, each with <allowed tags> or no speaker tag.
The prompt has no text to speak besides its speaker tags; write the words to speak after the tag.
This model takes no extra parameter <names, comma-separated>; it takes speed.
extra."speed" must be a number.
```

#### Token effect

About 70 tokens for the entry in a `dv_models_list` result and about 85 tokens for a `dv_models_get` result. Each refusal sentence is about 15 to 40 tokens.

#### KV Cache effect

The entry reaches the model only through tool results, which are appended to the session, so mounting or removing the plugin leaves the cached prefix intact apart from the skill catalog change described above.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One speaker per clip**: the server speaks only speaker 0, so a dialogue takes one clip per line, and the model picks the voice of each clip, so one character can sound different in two clips.
- **Fixed length in the skill**: the skill states about 95 seconds per clip, from the server's default token cap; a server with a lower cap cuts clips earlier, and those clips fail with the length-limit message.
- **Served models are fixed in code**: `SERVED` in `src/index.ts` lists the models the plugin can serve; another SGLang-Omni model needs an entry there and its prompt skill, not only a config change.
- **No voice selection**: `extra` takes only `speed`; the server's `voice` field and its uploaded voices are not exposed.
