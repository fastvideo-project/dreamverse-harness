---
description: "Configure OpenRouter cloud video models for the DreamVerse catalog and chat picker. Open this page for supported tasks, API credentials, output choices, and cancellation limits."
kind: "package-reference"
---

# @dv/openrouter

English | [中文](README.zh.md)

## Summary

Configure OpenRouter cloud video models for the DreamVerse catalog and chat picker. Open this page for supported tasks, API credentials, output choices, and cancellation limits.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The DreamVerse bundle mounts `dv-openrouter` with no configured models. Use Video APIs settings to save a key and enable models. The operator LLM continues to use the existing Models settings and pi-ai OpenRouter adapter.

`models` maps a local alias to an OpenRouter video model ID. `credentialRef` defaults to `OPENROUTER_API_KEY`; it names the existing credential store. `baseUrl` defaults to `https://openrouter.ai/api/v1/`. `pollIntervalMs` defaults to 5000.

Only configured models appear in the picker. T2V is available for compatible catalog entries; I2V and FL2V are registered when the catalog advertises their endpoint images. API models require no local weight download or GPU load.


<a id="understand-the-implementation"></a>
## Understand the implementation

The provider reads `videos/models`, validates discrete durations and endpoint inputs, submits once to `videos`, and polls the returned job ID. It downloads from the canonical authenticated content route and extracts the last frame through the shared ffmpeg service. Returned signed URLs are ignored.

Duration-based requests omit unknown pixel dimensions and frame counts. Native FastVideo and UniServe retain their configured frame geometry. Empty configuration makes no provider request; volatile model changes update the existing catalog.


<a id="further-exploration"></a>
## Further Exploration

See the [OpenRouter video API guide](https://openrouter.ai/docs/guides/overview/multimodal/video-generation).

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

The agent sees provider `openrouter`, configured aliases, supported task schemas, exact duration choices, and the cloud cancellation limitation. Prompts contain endpoint labels rather than internal asset citation URLs.

#### Token effect

Model metadata appears in catalog tool results; no hidden prompt prefix is added.

#### KV Cache effect

Catalog results append to the conversation. Each cloud video request is independent.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- OpenRouter documents no remote video cancellation route. Aborting stops local monitoring; it does not cancel the paid job. Ambiguous submissions are never automatically retried.

- Frame rates and exact pixel geometry are not invented. General reference-media tasks and model passthrough parameters need published per-model limits before they can be enabled.

- In-progress provider job IDs are not persisted across harness restarts. Existing background-render ownership remains with the project workflow rather than a second job system.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context</summary>

Contract tests use a fake provider and real media extraction. A paid OpenRouter generation has not been verified in this setup.

</details>
