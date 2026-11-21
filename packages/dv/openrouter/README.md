---
description: "Configure OpenRouter cloud video, image and speech models for the DreamVerse catalog and chat pickers. Open this page for supported tasks, API credentials, output choices, and cancellation limits."
kind: "package-reference"
---

# @dv/openrouter

English | [中文](README.zh.md)

## Summary

Configure OpenRouter cloud video, image and speech models for the DreamVerse catalog and chat pickers. Open this page for supported tasks, API credentials, output choices, and cancellation limits.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The DreamVerse bundle mounts `dv-openrouter` with no configured models. Use Video, image & audio APIs settings to save a key and enable models. The operator LLM continues to use the existing Models settings and pi-ai OpenRouter adapter.

`models` maps a local alias to an OpenRouter video model ID, `imageModels` maps a local alias to an OpenRouter image model ID, and `audioModels` maps a local alias to an OpenRouter speech model ID; aliases use lowercase letters, numbers and hyphens. `credentialRef` defaults to `OPENROUTER_API_KEY`; it names the existing credential store. `baseUrl` defaults to `https://openrouter.ai/api/v1/`. `pollIntervalMs` defaults to 5000. `catalogTimeoutSeconds` (integer from 1 to 300, default 10) is the deadline for each catalog or account request to OpenRouter.

Only configured models appear in the pickers. T2V is available for compatible catalog entries; REF2V is registered when the models catalog lists image input for the model, and I2V and FL2V when the video catalog advertises their endpoint images. Each image model is registered for T2I, so `image.generate` (`dv_image_generate`) can use it, and each speech model for T2A, so `audio.generate` (`dv_audio_generate`) can use it. API models require no local weight download or GPU load.


`GET /api/dv/openrouter/account` checks the host's saved key without generating media, and `POST /api/dv/openrouter/account` with the body `{ "key": "<candidate>" }` runs the same check on a candidate key without saving it. Both are the shared [account-status route](../models/README.md#share-the-account-status-route) and answer `status` `missing`, `rejected`, `unavailable` or `connected` with `Cache-Control: no-store`. The check reads `GET /api/v1/key`. A connected response includes the key's `label` when available (a label that contains the key is dropped), `limitRemainingUsd` from the key's `limit_remaining` (null when the key has no limit), and `balanceUsd`. The balance comes from `GET /api/v1/credits`, which only a management key can read, so it is null for other keys and when that request fails. `limitRemainingUsd` and `balanceUsd` are never combined. Invalid key metadata answers `unavailable`.

`GET /api/dv/openrouter/catalog` answers 503 `{ "error": ... }` without a saved key, 401 when OpenRouter refuses the key (HTTP 401 or 403), and 502 for any other failure, the same statuses and fields as the [Reactor catalog route](../reactor/README.md).

<a id="understand-the-implementation"></a>
## Understand the implementation

The provider reads `videos/models` for each model's generation choices and `models?output_modalities=video` for its reference media: the `image`, `video` and `audio` entries of `architecture.input_modalities`, which `videos/models` does not list. When only the second request fails, the models load without reference media and REF2V is not registered. A REF2V call takes one or more reference images and no first or last frame, because OpenRouter ignores `input_references` when `frame_images` is present; it sends each image as an `image_url` part of `input_references`, as a `data:` URL. The provider validates discrete durations and endpoint inputs, submits once to `videos`, and polls the returned job ID. It downloads from the canonical authenticated content route and extracts the last frame through the shared ffmpeg service. Returned signed URLs are ignored. A job that ends `failed`, `cancelled` or `expired` fails the render with that status and the job's `error` text, when OpenRouter gives one.

The image provider reads `images/models` and keeps rows whose output modalities include `image` and whose `output_format` choices, when listed, include PNG, JPEG or WebP. An image call takes no `size`: OpenRouter derives pixel sizes per provider, so the entry's schema lists the model's enum choices of `aspect_ratio`, `resolution`, `quality` and `background` as `extra`, and a call with a `size`, an unlisted `extra` key or an unlisted value is refused before submission. The provider submits one `POST images` with `n: 1`, the seed where the catalog lists `seed`, and `output_format: png` where the model offers PNG; it stores `data[0].b64_json` as PNG, converting another raster format with the shared ffmpeg service, and reads the pixel size from the PNG.

The speech provider reads `models?output_modalities=speech` and keeps rows whose output modalities include `speech` and whose `endpoints`, when listed, include `/api/v1/audio/speech`, with the voices in `supported_voices`. A speech call's prompt is the plain text to speak. Its `extra` takes `voice` and `instructions`: when the catalog lists voices, `voice` is required and must be one of them; otherwise it is optional and the provider uses its default. Any other `extra` key is refused before submission. The provider submits one `POST audio/speech` with `response_format: pcm` for `google/` and `heygen/` models, which OpenRouter serves only as PCM, and `mp3` for the others (MiniMax serves only MP3), and converts the answer to a WAV clip with the shared ffmpeg service, reading raw `audio/pcm` as 24 kHz mono 16-bit; the clip's duration comes from ffprobe.

Duration-based requests omit unknown pixel dimensions and frame counts. Native FastVideo and UniServe retain their configured frame geometry. Empty configuration makes no provider request; volatile model changes update the existing catalog. A configured alias that is not lowercase letters, digits and hyphens fails the load. If the catalog request or model registration fails at startup, the plugin logs a warning and keeps its catalog route and settings listener; the next catalog discovery or model change retries registration. A configured model id that its catalog does not offer is skipped while the other configured models register; the catalog route still answers the catalogs and names each skipped id in its `error` field, which the settings page shows beside the catalogs; the settings page also lists each skipped id as an unavailable row with its Remove action, and the next catalog discovery or model change retries the skipped ids.


<a id="further-exploration"></a>
## Further Exploration

See the [OpenRouter video API guide](https://openrouter.ai/docs/guides/overview/multimodal/video-generation), the [image generation guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) and the [text-to-speech guide](https://openrouter.ai/docs/features/multimodal/tts).

- [OpenRouter maintenance guide](../../../docs/cookbook/providers/openrouter.md)
- [Contribute a DreamVerse provider](../../../docs/cookbook/adding-a-dreamverse-provider.md)

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

The agent sees provider `openrouter`, configured aliases, supported task schemas, exact duration choices, the image models' `extra` choices, the speech models' voices, the cloud cancellation limitation, and that video models take no audio or video references. While a video model is configured and the skill registry is mounted, the skill catalog lists the prompt skill `openrouter-video-prompting` with the description `Prompt rules for OpenRouter cloud video models, tasks t2v, ref2v, i2v and fl2v. OpenRouter video models take no audio or video references for now.`, so the agent knows the limit without listing models; loading the skill returns [`skills/openrouter-video-prompting.md`](skills/openrouter-video-prompting.md). Prompts contain endpoint labels rather than internal asset citation URLs. The catalog reports `hosting: managed`.

#### Token effect

Model metadata appears in catalog tool results. The prompt skill's catalog entry costs about 55 tokens in every request while a video model is configured; the loaded skill is about 350 tokens.

#### KV Cache effect

Catalog results append to the conversation. Configuring the first video model or removing the last one adds or removes the skill's catalog entry and changes the cached prefix from the skill catalog on. Each cloud video, image or speech request is independent.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- OpenRouter documents no remote video cancellation route. Aborting stops local monitoring; it does not cancel the paid job. Ambiguous submissions are never automatically retried.

- Frame rates and exact pixel geometry are not invented. Model passthrough parameters need published per-model limits before they can be enabled.

- Video models take image references only: each video entry's description and the `openrouter-video-prompting` skill tell the agent that audio and video references do not work, and a request with an audio or video reference is refused before submission, even for a model whose catalog row lists audio or video input. OpenRouter's videos API takes image references as `data:` URLs but audio and video references only as public HTTPS links, which a local harness cannot serve without a public host.

- Image models generate from text only (T2I). OpenRouter's `input_references` (image editing and reference images) is not passed, because `image.generate` declares no image inputs; SVG and GIF outputs are not offered.

- Speech models speak text only (T2A). Voice cloning and voice design (`input_references`), `speed`, and per-provider passthrough options are not passed. OpenRouter documents raw PCM only as 16-bit little-endian, so a provider that answers PCM at a rate other than 24 kHz plays at the wrong speed; the provider asks for MP3, which carries its own rate, from every vendor except the PCM-only Gemini and HeyGen. The PCM-only vendor list is fixed from OpenRouter's TTS guide, because the models API names no output formats. There is no music model; sound effects are possible only with a model that reads the prompt as a description, such as Seed Audio.

- In-progress provider job IDs are not persisted across harness restarts. Existing background-render ownership remains with the project workflow rather than a second job system.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context</summary>

Contract tests use a fake provider and real media extraction. A paid OpenRouter video, image or speech generation has not been verified in this setup.

</details>
