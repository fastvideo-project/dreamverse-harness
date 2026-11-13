---
description: "Configure OpenRouter cloud video and image models for the DreamVerse catalog and chat pickers. Open this page for supported tasks, API credentials, output choices, and cancellation limits."
kind: "package-reference"
---

# @dv/openrouter

English | [中文](README.zh.md)

## Summary

Configure OpenRouter cloud video and image models for the DreamVerse catalog and chat pickers. Open this page for supported tasks, API credentials, output choices, and cancellation limits.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The DreamVerse bundle mounts `dv-openrouter` with no configured models. Use Video & image APIs settings to save a key and enable models. The operator LLM continues to use the existing Models settings and pi-ai OpenRouter adapter.

`models` maps a local alias to an OpenRouter video model ID, and `imageModels` maps a local alias to an OpenRouter image model ID; aliases use lowercase letters, numbers and hyphens. `credentialRef` defaults to `OPENROUTER_API_KEY`; it names the existing credential store. `baseUrl` defaults to `https://openrouter.ai/api/v1/`. `pollIntervalMs` defaults to 5000.

Only configured models appear in the pickers. T2V is available for compatible catalog entries; I2V and FL2V are registered when the catalog advertises their endpoint images. Each image model is registered for T2I, so `image.generate` (`dv_image_generate`) can use it. API models require no local weight download or GPU load.


<a id="understand-the-implementation"></a>
## Understand the implementation

The provider reads `videos/models`, validates discrete durations and endpoint inputs, submits once to `videos`, and polls the returned job ID. It downloads from the canonical authenticated content route and extracts the last frame through the shared ffmpeg service. Returned signed URLs are ignored. A job that ends `failed`, `cancelled` or `expired` fails the render with that status and the job's `error` text, when OpenRouter gives one.

The image provider reads `images/models` and keeps rows whose output modalities include `image` and whose `output_format` choices, when listed, include PNG, JPEG or WebP. An image call takes no `size`: OpenRouter derives pixel sizes per provider, so the entry's schema lists the model's enum choices of `aspect_ratio`, `resolution`, `quality` and `background` as `extra`, and a call with a `size`, an unlisted `extra` key or an unlisted value is refused before submission. The provider submits one `POST images` with `n: 1`, the seed where the catalog lists `seed`, and `output_format: png` where the model offers PNG; it stores `data[0].b64_json` as PNG, converting another raster format with the shared ffmpeg service, and reads the pixel size from the PNG.

Duration-based requests omit unknown pixel dimensions and frame counts. Native FastVideo and UniServe retain their configured frame geometry. Empty configuration makes no provider request; volatile model changes update the existing catalog. A configured alias that is not lowercase letters, digits and hyphens fails the load. If the catalog request or model registration fails at startup, the plugin logs a warning and keeps its catalog route and settings listener; the next catalog discovery or model change retries registration.


<a id="further-exploration"></a>
## Further Exploration

See the [OpenRouter video API guide](https://openrouter.ai/docs/guides/overview/multimodal/video-generation) and the [image generation guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation).

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

The agent sees provider `openrouter`, configured aliases, supported task schemas, exact duration choices, the image models' `extra` choices, and the cloud cancellation limitation. Prompts contain endpoint labels rather than internal asset citation URLs.

#### Token effect

Model metadata appears in catalog tool results; no hidden prompt prefix is added.

#### KV Cache effect

Catalog results append to the conversation. Each cloud video or image request is independent.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- OpenRouter documents no remote video cancellation route. Aborting stops local monitoring; it does not cancel the paid job. Ambiguous submissions are never automatically retried.

- Frame rates and exact pixel geometry are not invented. General reference-media tasks and model passthrough parameters need published per-model limits before they can be enabled.

- Image models generate from text only (T2I). OpenRouter's `input_references` (image editing and reference images) is not passed, because `image.generate` declares no image inputs; SVG and GIF outputs are not offered.

- In-progress provider job IDs are not persisted across harness restarts. Existing background-render ownership remains with the project workflow rather than a second job system.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context</summary>

Contract tests use a fake provider and real media extraction. A paid OpenRouter video or image generation has not been verified in this setup.

</details>
