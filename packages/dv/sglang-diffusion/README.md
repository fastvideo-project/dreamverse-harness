---
description: "Provider plugin sglang-diffusion of DreamVerse for image models on local SGLang diffusion servers: registers one dvModels entry per configured model (qwen-image-2.1-turbo) for task t2i, with its size rules, its served-model check and its PNG render."
kind: "package-reference"
---

# @dv/sglang-diffusion

English | [中文](README.zh.md)

## Summary

Use this package to generate images with models on local SGLang diffusion servers. The function plugin `dv-sglang-diffusion` is the provider `sglang-diffusion` of the [`@dv/models`](../models/README.md) catalog: it registers one entry of task `t2i` per model that its `models` config names, one server per model. It serves `qwen-image-2.1-turbo` (Qwen-Image 2.1 Turbo). The tool `dv_image_generate` of [`@dv/image-generate`](../image-generate/README.md) renders with the entries.

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

Mount the plugin after `@dv/models`, with one server per model. The DreamVerse bundle mounts it as row `dv-sglang-diffusion`:

```yaml
- id: dv-sglang-diffusion
  name: '@dv/sglang-diffusion'
  config:
    models:
      qwen-image-2.1-turbo:
        baseUrl: http://127.0.0.1:30010
```

| Field | Default | Meaning |
| --- | --- | --- |
| `models` | required | The models to register, by model name; a model left out is not registered |
| `models.<model>.baseUrl` | required | HTTP base URL of the SGLang diffusion server that serves the model, such as `http://127.0.0.1:30010` |

Loading fails when `models` names a model other than `qwen-image-2.1-turbo`. While the plugin is mounted, the catalog holds the entry `image/t2i/sglang-diffusion/qwen-image-2.1-turbo`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The table `SERVED` in `src/index.ts` holds what no server endpoint lists for each model: the server's model ID (`Qwen/Qwen-Image-2.1-Turbo`), the entry description, the default size, the size multiple (32), the pixel limit (4300800, the area of 2400x1792, the largest preset) and the model card's seven sizes by aspect ratio. The server ignores the `model` field of a request, so `facts()` reads `GET /v1/models` on every call and rejects when the server lists another model; `schema()` calls `facts()` first. `validateGenerationRequest` calls no server: the server answers a size that is not a multiple of 32 with HTTP 500 and no reason, so the entry refuses it first and names the nearest sizes. It refuses a size above the pixel limit, which can fail on the server or in the image attachment of the tool result after the render has run, and names the preset nearest its aspect ratio; it also refuses every `extra` value. `render` sends `POST /v1/images/generations` with the prompt, the size (`defaultSize` for a request without one), the seed, `n: 1`, `response_format: 'b64_json'` and `output_format: 'png'`, because the server's own default format is JPEG for models that set none. It refuses an answer that holds no PNG image, such as JPEG bytes or an empty `data` list, and returns the PNG at the size it sent. An error answer becomes the server's `detail` text, or the body as sent; an abort rejects with the signal's reason.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`, `inject`, `Config`, `apply`, the `SERVED` table, the HTTP calls, and the catalog entry of one model |
| [`tests/sglang-diffusion.spec.ts`](tests/sglang-diffusion.spec.ts) | A Loader composition with Project, the asset pool, the catalog and `@dv/image-generate` against a fake server that answers with the real server's bodies; an opt-in suite runs against the server named by `DV_SGLANG_DIFFUSION_TEST_URL` |

Run the opt-in suite, which renders three images, with `DV_SGLANG_DIFFUSION_TEST_URL=http://127.0.0.1:30010 DV_SGLANG_OMNI_TEST_URL=http://127.0.0.1:8000 pnpm exec vitest run packages/dv/sglang-diffusion/tests`; its misrouted case points the entry at the speech server of `DV_SGLANG_OMNI_TEST_URL` and runs only when that variable is set.

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/models`](../models/README.md): the model catalog this plugin registers into.
- [`@dv/image-generate`](../image-generate/README.md): the consumer, with the tool `dv_image_generate`, and the image request and result types.
- [`@dv/generation`](../generation/README.md): the refusal texts around the problems and rejections of this package.

-----

<a id="model-experience"></a>
## Model Experience

### Catalog entry and refusals

#### What the model sees

The `dv_models_list` results of `@dv/models` list the entry with its key (modality `image`, task `t2i`, provider `sglang-diffusion`, model `qwen-image-2.1-turbo`) and the description below, without a prompt skill. `dv_models_get` adds the schema below. The problems of `validateGenerationRequest` follow `Model image/t2i/sglang-diffusion/qwen-image-2.1-turbo cannot generate this: ` in a refusal of `dv_image_generate`; `<down>` rounds both sides down to a multiple of 32 and `<up>` rounds both up, each side at least 32, and the second form applies when the two are equal; `<preset>` is the size listed by aspect ratio whose width over height is nearest to that of `<W>x<H>`. A rejection of `facts()` or `schema()` follows `Model image/t2i/sglang-diffusion/qwen-image-2.1-turbo is unavailable: ` in a refusal, and `dv_models_get` shows it alone as its error. A render failure fails the record and the tool call with its message.

##### Entry description

```markdown
Qwen-Image 2.1 Turbo: a text-to-image model that renders legible text inside the image, such as posters, labels and interface layouts. The same seed, size and prompt give the same image.
```

##### Schema

```markdown
{"size":{"default":"1024x1024","rule":"width and height are positive multiples of 32, and width times height is at most 4300800","by_aspect_ratio":{"1:1":"2048x2048","4:3":"2400x1792","3:4":"1792x2400","3:2":"2528x1696","2:3":"1696x2528","16:9":"2752x1536","9:16":"1536x2752"}},"extra":{}}
```

##### Request problems

```markdown
Width and height must each be a multiple of 32, and <W>x<H> is not; the nearest sizes are <down> and <up>.
Width and height must each be a multiple of 32, and <W>x<H> is not; the nearest size is <size>.
The model renders at most 4300800 pixels, and <W>x<H> has <pixels>; the preset nearest its aspect ratio is <preset> (<ratio>).
This model takes no extra parameter; omit extra.
```

##### Server rejections

```markdown
The server at <baseUrl> serves <served IDs, comma-separated>, not Qwen/Qwen-Image-2.1-Turbo; the dv-sglang-diffusion config points this model at the wrong server.
The server at <baseUrl> cannot be reached.
The server at <baseUrl> answered GET /v1/models with HTTP <status>: <server text>
The server at <baseUrl> answered POST /v1/images/generations with HTTP <status>: <server text>
The server at <baseUrl> answered POST /v1/images/generations without a PNG image.
```

#### Token effect

About 50 tokens for the entry in a `dv_models_list` result, and about 130 tokens for the schema in a `dv_models_get` result. Each problem sentence costs about 20 to 40 tokens in a refusal.

#### KV Cache effect

The entry reaches the model only through tool results, which are appended to the session. Mounting or removing the plugin registers or removes the only `t2i` entry of the bundle, which adds or removes the tool `dv_image_generate`; see the [`@dv/image-generate` Model Experience](../image-generate/README.md#model-experience).

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Served models are fixed in code**: `SERVED` in `src/index.ts` lists the models the plugin can serve; another diffusion model needs an entry there, not only a config change.
- **The served-model check reads the start-up name**: `POST /update_weights_from_disk` changes the weights of a running server, and `GET /v1/models` keeps the name it started with, so `facts()` does not see that change.
- **Three model-list reads per agent call**: `facts()` reads `GET /v1/models` on every call, and an agent call of `dv_image_generate` calls it three times: in the check of `prepareToolCall`, in the check before the record, and before the render.
- **The first call at a size is slower**: the server warms up per image size, so the first call at each size, and the first call after the server sits idle, takes longer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
