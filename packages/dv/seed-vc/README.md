---
description: "Provider plugin seed-vc of DreamVerse: registers Seed-VC v1 on a local Seed-VC server as the dvModels entry seed-vc-v1 of task a2a, whose voices are the allowed voices of its config, each with the target clip that the plugin sends to the server."
kind: "package-reference"
---

# @fastvideo/dreamverse-seed-vc

English | [中文](README.zh.md)

## Summary

Use this package to convert recordings with [Seed-VC](https://github.com/Plachtaa/seed-vc) v1, a zero-shot voice conversion model, served on a GPU machine by the Seed-VC server that [`@fastvideo/dreamverse-voice-acting`](../voice-acting/README.md) ships. It registers one entry of the model catalog of [`@dv/models`](../models/README.md): modality `audio`, task `a2a`, provider `seed-vc`, model `seed-vc-v1`, which the operation `voice.convert` of [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.md) runs. The config's `voices` are the whitelist: the entry converts only to a voice listed there. A voice names a target clip file, or only its speaker's name, and then the server builds the clip from that speaker's VoxCeleb1 clips; the server keeps no voice list.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin with `@dv/models`, `@dv/asset-pool` and `@fastvideo/dreamverse-voice-convert`. The [`@fastvideo/dreamverse-voice-acting`](../voice-acting/README.md) bundle inserts it switched off; the profile patch switches it on with the server URL and the allowed voices:

```yaml
- id: dv-seed-vc
  disabled: false
  config:
    baseUrl: http://gpu-host:8010
    voices:
      narrator:
        label: The Narrator
        target: /data/voices/narrator.wav
        note: Recorded by the narrator, who allowed its use for this project.
      sam-reed:
        label: Sam Reed
        note: Sam Reed allowed the use of their voice for this project.
```

| Config field | Meaning |
| --- | --- |
| `baseUrl` | HTTP base URL of the Seed-VC server |
| `voices.<key>.label` | The name that the voice picker and `dv_models_get` show |
| `voices.<key>.target` | Absolute path of a WAV clip of the voice: clean speech of one speaker, 10 to 25 seconds; the server uses the first 25 seconds. Without it, the server builds the clip from the VoxCeleb1 clips of the speaker named `speaker` |
| `voices.<key>.speaker` | The speaker's name in VoxCeleb1, for a voice without `target`; default `label` |
| `voices.<key>.note` | Who allowed the voice to be used, and for what; the plugin does not read it |
| `diffusionSteps` | Refinement steps of a conversion whose `extra` sets none, 1 to 200; default 50 |
| `targetSeconds` | Seconds of speech in a target clip that the server builds, 4 to 25; default 16 |

The plugin fails at load when `voices` is empty or a configured target clip is missing or empty. A voice without `target` is built on its first conversion, which takes about two minutes, and the server caches the clip; a name that VoxCeleb1 does not hold fails that conversion. List only voices that their speakers allowed you to use.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

At load the plugin reads every configured target clip into a `data:` URI and registers the entry. For a voice without `target`, the first conversion posts `{name, seconds}` to `POST /v1/voices/build`; the plugin keeps the answer for later conversions and forgets a failed build, so the next conversion asks again. The server finds the speaker by name in `vox1_meta.csv`, reads only that speaker's clips from the dataset's remote zip, joins the cleanest clips of the interview that holds the cleanest one, and caches the clip in its voice cache folder. `facts()` and `schema()` call `GET /health` and check that the server reports the model `seed-vc-v1-whisper-small-wavenet`. `schema()` answers `{voices: [{key, label}], extra}`, with `diffusion_steps` (an integer, 1 to 200, `diffusionSteps` when omitted) as the one `extra` parameter. `validateGenerationRequest` refuses a voice outside the config, a `reference` input whose media type is not audio, an unknown `extra` name and an invalid `extra` value. `render` reads the recording from `dvAssetPool`, posts `{diffusion_steps, source, target, seed}` to `POST /v1/convert`, with the configured `diffusionSteps` unless `extra` sets `diffusion_steps`, and returns the WAV body with the duration of the `x-duration-sec` header. The server runs Seed-VC's own `inference.py` conversion on the loaded model, one request at a time, and seeds `random`, NumPy and torch with the request's seed, so a seed repeats a take.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The config, the server calls, the voice whitelist and the entry |
| [`tests/seed-vc.spec.ts`](tests/seed-vc.spec.ts) | A Loader composition with the Voice component against a fake Seed-VC server: the entry and its schema, a conversion, the refusals, the server errors, an aborted conversion and the load failures |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.md): the operation `voice.convert` that runs this entry.
- [`@dv/models`](../models/README.md): the model catalog, with `dv_models_list` and `dv_models_get`.
- [`@dv/sglang-omni`](../sglang-omni/README.md): the provider plugin of the same form for speech from text.

-----

<a id="model-experience"></a>
## Model Experience

### Catalog entries and refusals

#### What the model sees

The `dv_models_list` results of `@dv/models` list the entry with its key (modality `audio`, task `a2a`, provider `seed-vc`, model `seed-vc-v1`) and the description "Seed-VC v1: speaks a speech recording again in another voice, keeping its words, timing and intonation; voices: <key> (<label>), …". `dv_models_get` adds the voices and the `extra` schema. The refusals of `dv_voice_convert` carry the validation sentences below after "Model audio/a2a/seed-vc/seed-vc-v1 cannot generate this: ". A `facts()` or `schema()` rejection reads `The server at <baseUrl> serves <model>, not seed-vc-v1-whisper-small-wavenet; the dv-seed-vc baseUrl points at the wrong server.`, `The server at <baseUrl> cannot be reached.`, or `The server at <baseUrl> answered GET /health with HTTP <status>: <server text>`. A failed conversion reads `The server at <baseUrl> answered POST /v1/convert with HTTP <status>: <server text>`, `The server at <baseUrl> answered POST /v1/convert without a positive x-duration-sec.`, or `The server at <baseUrl> cannot be reached.`; the server text is the `error` of an `application/json` body, else the body as sent.

##### Validation sentences

```markdown
This model has no voice "<voice>"; its voices are <keys, comma-separated>.
The reference input <asset> is not audio; give one recording of the spoken line.
This model takes no extra parameter <names, comma-separated>; it takes diffusion_steps.
extra."diffusion_steps" must be an integer.
```

#### Token effect

About 60 tokens for the entry in a `dv_models_list` result, plus about 10 per voice, and about 90 tokens for a `dv_models_get` result. Each refusal sentence is about 15 to 30 tokens.

#### KV Cache effect

The entry reaches the model only through tool results, which are appended to the session; mounting or removing the plugin changes the tool list only through `dv_voice_convert` of `@fastvideo/dreamverse-voice-convert`.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Target clips are read once**: the plugin reads each configured target clip at load, and keeps a built clip for its lifetime, so a changed clip takes effect after the plugin restarts.
- **Built voices come from VoxCeleb1 only**: a name-only voice must be a VoxCeleb1 speaker, whose interview audio is 16 kHz and calm; a voice from other recordings needs a `target` file.
- **One conversion at a time**: the server converts one request at a time; concurrent takes wait for each other.
