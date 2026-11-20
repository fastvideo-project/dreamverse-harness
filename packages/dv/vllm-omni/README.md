---
description: "Provider plugin vllm-omni of DreamVerse for image and speech models on local vLLM-Omni servers: registers one dvModels entry per configured model, qwen-image-2.1-turbo for task t2i and qwen3-tts-customvoice for task t2a, with its schema, request validation, served-model check and render."
kind: "package-reference"
---

# @dv/vllm-omni

English | [中文](README.zh.md)

## Summary

Use this package to generate images and speech with models on local [vLLM-Omni](https://github.com/vllm-project/vllm-omni) servers. The function plugin `dv-vllm-omni` is the provider `vllm-omni` of the [`@dv/models`](../models/README.md) catalog: it registers one catalog entry per model that its `models` config names, one server per model, because each vLLM-Omni server serves one model. It serves `qwen-image-2.1-turbo` (Qwen-Image 2.1 Turbo) for task `t2i` and `qwen3-tts-customvoice` (Qwen3-TTS 1.7B CustomVoice) for task `t2a`. The tool `dv_image_generate` of [`@dv/image-generate`](../image-generate/README.md) renders with the image entry, and the tool `dv_audio_generate` of [`@dv/audio-generate`](../audio-generate/README.md) speaks with the speech entry.

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

Start one vLLM-Omni server per model, then mount the plugin after `@dv/models`. The servers below were tested with vLLM-Omni `cf457a688f` on vLLM 0.34.0:

```sh
vllm serve Qwen/Qwen-Image-2.1-Turbo --omni --port 8091
vllm serve Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice --omni --port 8092 --trust-remote-code --enforce-eager \
  --deploy-config vllm_omni/deploy/qwen3_tts.yaml
```

The DreamVerse bundle declares the plugin as the disabled row `dv-vllm-omni`; a deployment sets `disabled: false` in its profile patch and replaces the URLs with its servers' own:

```yaml
- id: dv-vllm-omni
  name: '@dv/vllm-omni'
  disabled: true
  config:
    models:
      qwen-image-2.1-turbo:
        baseUrl: http://127.0.0.1:8091
      qwen3-tts-customvoice:
        baseUrl: http://127.0.0.1:8092
```

| Field | Default | Meaning |
| --- | --- | --- |
| `models` | required | The models to register, by model name; a model left out is not registered |
| `models.<model>.baseUrl` | required | HTTP base URL of the vLLM-Omni server that serves the model, such as `http://127.0.0.1:8091` |

Loading fails when `models` names a model other than `qwen-image-2.1-turbo` and `qwen3-tts-customvoice`. While the plugin is mounted, the catalog holds one entry per configured model: `image/t2i/vllm-omni/qwen-image-2.1-turbo` and `audio/t2a/vllm-omni/qwen3-tts-customvoice`. Mount `@dv/image-generate` and `@dv/audio-generate` so that the agent can render with them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/http.ts` sends every request. It reads the text of an error answer from the OpenAI body `{"error": {"message": ...}}` that vLLM-Omni sends, else quotes the body as sent; a server that cannot be reached becomes `The server at <baseUrl> cannot be reached.`, and an abort rejects with the signal's reason. `facts()` and `schema()` of each entry read `GET /v1/models` on every call and reject when the server does not list the model's ID, because the config can point a model at the server of another model. Each render sends the model's ID as `model`; vLLM-Omni answers another ID with HTTP 400.

The table `IMAGES` in `src/image.ts` holds what no vLLM-Omni endpoint lists for each image model: the server's model ID (`Qwen/Qwen-Image-2.1-Turbo`), the entry description, the default size 1024x1024, the size grid (32 pixels) and the model card's seven sizes by aspect ratio, whose largest area, 4300800 pixels (2400x1792), is the pixel limit. vLLM-Omni rounds a side off the grid down without an error (1000x1000 renders 992x992), so `validateGenerationRequest` calls no server and refuses such a size with the nearest grid sizes that are within the pixel limit, or, when neither is, with the size of the nearest aspect ratio. It refuses a size above the pixel limit with the size of the nearest aspect ratio, and it refuses every `extra` value: the server sets `true_cfg_scale` to 1 for this model, so a negative prompt has no effect, and the request leaves the step count to the model's default. `render` sends `POST /v1/images/generations` with the model ID, the prompt, the size (the default size for a request without one), the seed, `n: 1`, `response_format: 'b64_json'` and `output_format: 'png'`. It fails an answer that holds no PNG image, and an answer whose `size` differs from the size it sent.

The table `SPEECHES` in `src/speech.ts` holds the speech model's ID (`Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`), the entry description and the `extra` parameters: `voice`, `language` (one of the eleven values of the vLLM-Omni speech API), `instructions` and `speed`. `schema()` adds the preset voices that `GET /v1/audio/voices` lists; it leaves out the uploaded voices that the server also lists, because an uploaded voice is a voice-cloning input that only a Base checkpoint speaks. `validateGenerationRequest` returns one sentence for the `extra` names that the model does not take, one per `extra` value that fails its schema (checked with `validateArgs` of `@deepseek-ai/dsh-tools`), one for a `speed` outside 0.25 to 4 and one for `instructions` over 500 characters, both of which the server answers with HTTP 400, and one for a `voice` that is not one of those preset voices, compared in lowercase as the server compares it; only a request with a `voice` reads the server. `render` sends `POST /v1/audio/speech` with the `extra` values, the model ID, `input` (the prompt) and `response_format: 'wav'`. It fails a clip whose `x-audio-truncated` header is `true`, which tells the agent to split the text; a body that does not start with `RIFF`; and a clip whose `x-audio-duration-seconds` header is missing or not a positive number. The clip's duration is that header.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`, `inject`, `Config` and `apply`, which builds the entry of each configured model |
| [`src/http.ts`](src/http.ts) | The HTTP calls, the error text and the served-model check |
| [`src/image.ts`](src/image.ts) | The `IMAGES` table, the size checks and the image entry |
| [`src/speech.ts`](src/speech.ts) | The `SPEECHES` table, the voice and `extra` checks and the speech entry |
| [`tests/fixture.ts`](tests/fixture.ts) | The Loader composition of the specs, and a fake vLLM-Omni server that answers with the bodies and headers of running servers |
| [`tests/vllm-omni.spec.ts`](tests/vllm-omni.spec.ts) | Registration, disposal, config, facts and schema, every refusal, both renders and their failures, against the fake server |
| [`tests/real-server.spec.ts`](tests/real-server.spec.ts) | An opt-in spec against the servers named by `DV_VLLM_OMNI_IMAGE_URL` and `DV_VLLM_OMNI_SPEECH_URL` |

Run the opt-in spec, which renders three images and one clip, with `DV_VLLM_OMNI_IMAGE_URL=http://127.0.0.1:8091 DV_VLLM_OMNI_SPEECH_URL=http://127.0.0.1:8092 pnpm exec vitest run packages/dv/vllm-omni/tests`; its misrouted case points the speech entry at the image server and runs only when both variables are set.

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/models`](../models/README.md): the model catalog this plugin registers into.
- [`@dv/image-generate`](../image-generate/README.md): the consumer of the image entry, with the tool `dv_image_generate`.
- [`@dv/audio-generate`](../audio-generate/README.md): the consumer of the speech entry, with the tool `dv_audio_generate`.
- [`@dv/sglang-diffusion`](../sglang-diffusion/README.md): the provider of the same image model on an SGLang diffusion server.

-----

<a id="model-experience"></a>
## Model Experience

### Catalog entries and refusals

#### What the model sees

The `dv_models_list` results of `@dv/models` list each entry with its key and description, without a prompt skill: modality `image`, task `t2i`, provider `vllm-omni`, model `qwen-image-2.1-turbo`, and modality `audio`, task `t2a`, provider `vllm-omni`, model `qwen3-tts-customvoice`, with the descriptions below. `dv_models_get` adds the schema below; the speech schema lists the voices that the server returns and the four `extra` parameters with their types, descriptions and, for `language`, its values. The problems of `validateGenerationRequest` follow `Model <key> cannot generate this: ` in a refusal of `dv_image_generate` or `dv_audio_generate`. A rejection of `facts()` or `schema()` follows `Model <key> is unavailable: ` in a refusal, and `dv_models_get` shows it alone as its error. A render failure fails the record and the tool call with its message. In the size problem, `<down>` rounds both sides down to a multiple of 32 and `<up>` rounds both up, each side at least 32; the sentence leaves out a size above the pixel limit and names one size when the two are equal. When both sizes are above the limit, the sentence names the size of the nearest aspect ratio instead, or is left out when the requested size is also above the limit, because the pixel-limit sentence then names that size. The catalog reports `hosting: self-hosted`.

##### Entry descriptions

```markdown
Qwen-Image 2.1 Turbo: a fast text-to-image model that renders legible text inside the image, such as posters, labels and interface layouts. The same seed, size and prompt give the same image.
Qwen3-TTS 1.7B CustomVoice: speech from text in ten languages with a choice of preset voices, and a style instruction such as "speak slowly and sadly". One voice per clip; it makes no sound effects or music.
```

##### Image schema

```markdown
{"size":{"default":"1024x1024","rule":"width and height are multiples of 32, and width times height is at most 4300800","by_aspect_ratio":{"1:1":"2048x2048","4:3":"2400x1792","3:4":"1792x2400","3:2":"2528x1696","2:3":"1696x2528","16:9":"2752x1536","9:16":"1536x2752"}},"extra":{}}
```

##### Request problems

```markdown
Width and height must be multiples of 32; use <down> or <up> instead of <W>x<H>.
<W>x<H> has <pixels> pixels, above the limit of 4300800; the largest size of aspect ratio <ratio> is <preset>.
This model takes no extra parameter; omit extra.
This model takes no extra parameter <names, comma-separated>; it takes voice, language, instructions, speed.
extra."<name>" must be a string.
extra."speed" must be a number.
extra."speed" must be from 0.25 to 4.
extra."instructions" must be at most 500 characters.
extra."language" must be one of ["Auto","Chinese","English","Japanese","Korean","German","French","Russian","Portuguese","Spanish","Italian"].
The server has no voice "<voice>"; it has <voices, comma-separated>.
```

##### Server rejections and render failures

```markdown
The server at <baseUrl> serves <served IDs, comma-separated>, not <model ID>; the dv-vllm-omni config points this model at the wrong server.
The server at <baseUrl> cannot be reached.
The server at <baseUrl> answered <method> <route> with HTTP <status>: <server text>
The server at <baseUrl> answered POST /v1/images/generations without a PNG image.
The server at <baseUrl> answered POST /v1/images/generations with an image of size <size>, not <W>x<H>.
The server stopped the clip at its token budget before the text ended; split the text into shorter clips.
The server at <baseUrl> answered POST /v1/audio/speech with a body that is not a WAV file.
The server at <baseUrl> answered POST /v1/audio/speech with x-audio-duration-seconds <value as JSON>, not a positive number of seconds.
```

#### Token effect

About 50 tokens for each entry in a `dv_models_list` result, about 130 tokens for the image schema and about 230 tokens for the speech schema in a `dv_models_get` result. Each problem sentence costs about 15 to 50 tokens in a refusal.

#### KV Cache effect

The entries reach the model only through tool results, which are appended to the session. Mounting or removing the plugin registers or removes a `t2i` and a `t2a` entry, which can add or remove the tools `dv_image_generate` and `dv_audio_generate` when no other provider serves those tasks; see the Model Experience sections of [`@dv/image-generate`](../image-generate/README.md#model-experience) and [`@dv/audio-generate`](../audio-generate/README.md#model-experience).

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Served models are fixed in code**: `IMAGES` and `SPEECHES` list the models the plugin can serve; another vLLM-Omni model needs an entry there, not only a config change.
- **No voice cloning**: the speech entry exposes the preset voices of the CustomVoice model; reference audio, uploaded voices and the Base and VoiceDesign tasks of Qwen3-TTS are not exposed.
- **Instruction limit fixed in code**: the entry refuses `instructions` over 500 characters, the default limit of vLLM-Omni; a server started with another limit can accept longer instructions that the entry refuses, or refuse shorter ones with HTTP 400.
- **Truncation reported by the model**: the entry fails a clip only when the server sends `x-audio-truncated: true`; a model that sends no such header can return a clip that stops before the text ends.
- **The first call after a server start is slow**: the first speech request compiles kernels on the server and took about 106 seconds on a GB200, against about 1.5 seconds later.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
