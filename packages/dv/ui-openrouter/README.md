---
description: "Set up OpenRouter video, image and speech models in the existing DreamVerse Settings shell. Use this page for credential storage, catalog discovery, and chat-picker model choices."
kind: "package-reference"
---

# @dv/ui-openrouter

English | [中文](README.zh.md)

## Summary

Set up OpenRouter video, image and speech models in the existing DreamVerse Settings shell. Use this page for credential storage, catalog discovery, and chat-picker model choices.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

In **Settings → Models**, choose **Manage OpenRouter** under **Your connections**, or pick OpenRouter in **Add a connection**, to save its key. OpenRouter checks the key before it is stored, and **Remove key** deletes it. The **Model catalog** table turns video, image, and audio models on in the picker through the existing `models`, `imageModels`, and `audioModels` fields. **Also use for chat LLMs** reuses the pi-ai adapter and the saved credential reference, and removing the key turns that route off first. A rejected key shows as Key rejected and a missing key as Not connected.

A blank key keeps the saved credential. Model enable/disable writes only aliases and model IDs through revision-fenced settings; keys use the existing credential service. Removing a model affects future choices and does not remove completed videos, images or audio. A configured model that its catalog no longer offers appears in its list as unavailable with a Remove action, and the page shows the registration error that the catalog route answers.


<a id="understand-the-implementation"></a>
## Understand the implementation

The page uses the existing settings slot, config form, credential remote, shared input/button primitives, and locale service. Discovery is a same-origin authenticated request; the browser never calls OpenRouter with a saved key.


<a id="further-exploration"></a>
## Further Exploration

See the [OpenRouter video API guide](https://openrouter.ai/docs/guides/overview/multimodal/video-generation), the [image generation guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) and the [text-to-speech guide](https://openrouter.ai/docs/features/multimodal/tts).

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

The browser contributes no operator prompt. Enabled API entries appear through `dv_models_list` and the chat video, image and audio pickers; `models.select` records the conversation choice per modality.

#### Token effect

Model metadata appears in catalog tool results; no hidden prompt prefix is added.

#### KV Cache effect

Catalog results append to the conversation. Each cloud video, image or speech request is independent.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Catalog discovery is not a paid generation or proof that an account has credit. Real generation requires a valid key, available model, and provider credit.

- This page does not add another LLM adapter, provision cloud GPUs, or download model weights.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context</summary>

Contract tests use a fake provider and real media extraction. A paid OpenRouter generation has not been verified in this setup.

</details>
