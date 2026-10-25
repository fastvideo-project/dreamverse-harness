---
description: "Provider plugin uniserve of DreamVerse for video models on UniServe servers: registers the configured model fasth3 into the dvModels catalog for task ref2v (FastH3 Omni 8-Step V1), with the fasth3 inputs, request validation and prompt skill of @dv/fastvideo, and renders each shot with one POST /v1/videos/sync."
kind: "package-reference"
---

# @dv/uniserve

English | [中文](README.zh.md)

## Summary

Use this package to render shots with video models on UniServe servers. The function plugin `dv-uniserve` is the provider `uniserve` of the [`@dv/models`](../models/README.md) catalog: it registers one catalog entry per model that its `models` config names and per task the config gives a server for, one server per task. It serves `fasth3` (MiniMax H3 as FastH3 Omni 8-Step V1, checkpoint `FastVideo/FastVideo-FastH3-Omni-8-Step-V1`) for task `ref2v`, with the inputs, reference labels, prompt rule and prompt skill that [`@dv/fastvideo`](../fastvideo/README.md) declares for `fasth3`. The tool `dv_shot_render` of [`@dv/shot-render`](../shot-render/README.md) renders with the entries.

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

Mount the plugin after `@dv/models`, `@dv/asset-pool` and `@dv/ffmpeg`, with one server per model and task. The DreamVerse bundle mounts it as row `dv-uniserve`, beside row `dv-fastvideo`, so the catalog holds a `fasth3` entry for task `ref2v` from each provider:

```yaml
- id: dv-uniserve
  name: '@dv/uniserve'
  config:
    models:
      fasth3:
        ref2v:
          baseUrl: http://10.244.8.35:8000
          gpuSecondsPerVideoSecond: 1.3
```

| Field | Default | Meaning |
| --- | --- | --- |
| `models` | required | The models to register, by model name, and for each the tasks to serve it for, by task ID; a model or task left out is not registered |
| `models.<model>.<task>.baseUrl` | required | HTTP base URL of the UniServe server that renders the model for the task, such as `http://127.0.0.1:8000` |
| `models.<model>.<task>.gpuSecondsPerVideoSecond` | required | GPU seconds per rendered video second on that server; the entry of the model and task declares it, for the GPU estimate before a render |

Loading fails when `models` names a model other than `fasth3`, a task the model is not served for (`fasth3`: `ref2v`), or a model with no task. While the plugin is mounted, the catalog holds the entry `video/ref2v/uniserve/fasth3`. Start the server with a `-reference` deployment of UniServe, which serves task `ref2va`; the [UniServe serving guide](https://github.com/hao-ai-lab/uniserve/blob/main/docs/minimax_h3/minimax_h3.md#deployments) lists them. Mount the DSH skill registry (`@deepseek-ai/dsh-skill`) as well so that the agent can load the prompt skill.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`apply` checks the config and registers the entries with `registerServedModels` of `@dv/fastvideo/served-task`. The table `SERVED` in `src/index.ts` maps `fasth3` for task `ref2v` to `FASTH3_REF2V` of `@dv/fastvideo/fasth3`, with its own description, and to UniServe's task `ref2va`. `facts()` reads `GET /v1/capabilities` once per entry, on the first call that succeeds, and rejects when the server does not list task `ref2va`. It reports the served model name as the model ID, the server's aspect ratios, one resolution per short edge named `<edge>p` (such as `768p`), the frame size of each pair, and the whole-second durations from the server's `min_seconds` to its `max_seconds` with UniServe's frame count of each: `duration × fps` rounded up to the next `min_frames + n × clip_frames`, so 5 seconds have 124 frames. The input limits come from the `ref2va` conditions of the capabilities: `max_references` across media types and `max_images`, `max_videos` and `max_audios` per media type. `schema()` and `validateGenerationRequest` are those of `@dv/fastvideo` for `fasth3`, through `servedTaskSchema` and `servedTaskProblems` of `@dv/fastvideo/served-task`: the first frame takes one reference and one image of the server's limits, and a request with a first frame that the prompt does not cite is refused. `render(request, signal)` sends one `POST /v1/videos/sync` with the served model name, task `ref2va`, the prompt with each citation of a reference replaced by its `fasth3` label (`modelPrompt` of `@dv/fastvideo/reference-labels`), one condition of role `reference` per asset, the references in input order and then the first frame, each with its media type and a `data:` URI of its MIME type and bytes from `dvAssetPool`, the `target` whose short edge and aspect ratio name the requested frame size and whose `duration_seconds` is the duration of the requested frame count, and the seed. `signal` cancels the HTTP request. The server answers with the whole MP4. The entry writes it to a temporary directory, reads its last frame as a PNG with `dvFfmpeg`, removes the directory, and yields `last_frame`, `video_start` with the answer's media type, one `chunk` with the MP4 and `done`. The timings of `done` are `inference_s` from the `x-inference-time-s` header and one `<stage>_s` per stage of the `x-stage-durations` header; a value that is not a finite number is left out. An error answer becomes `error.message` of its JSON body, or the body as sent.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`, `inject`, `Config`, `apply`, the `SERVED` table, the capabilities and render calls, and the catalog entry of one model and task |
| [`tests/uniserve.spec.ts`](tests/uniserve.spec.ts) | A Loader composition with the skill registry, Project, ffmpeg, the asset pool and the catalog against a fake UniServe server that answers with a running server's capabilities, an MP4 and its timing headers; an opt-in test renders against the server named by `DV_UNISERVE_TEST_URL` |

Run the opt-in test, which renders one five-second shot, with `DV_UNISERVE_TEST_URL=http://10.244.8.35:8000 pnpm exec vitest run packages/dv/uniserve/tests`.

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/models`](../models/README.md): the model catalog this plugin registers into.
- [`@dv/shot-render`](../shot-render/README.md): the consumer, with the tool `dv_shot_render`.
- [`@dv/fastvideo`](../fastvideo/README.md): the `fasth3` inputs, labels, request checks and prompt skill that this plugin reuses.
- [UniServe serving guide](https://github.com/hao-ai-lab/uniserve/blob/main/docs/minimax_h3/minimax_h3.md): the server, its deployments and the `/v1/videos` API.

-----

<a id="model-experience"></a>
## Model Experience

### Catalog entry and refusals

#### What the model sees

The `dv_models_list` results of `@dv/models` list the entry with its key (modality `video`, task `ref2v`, provider `uniserve`, model `fasth3`), the description below and the prompt skill `fasth3-reference-prompting`, the skill of the [`@dv/fastvideo` Model Experience](../fastvideo/README.md#model-experience). `dv_models_get` adds the schema below, read from a server with 12 references, 9 images, 3 videos and 3 audio files. The problem sentences of `validateGenerationRequest` are those of `@dv/fastvideo` for `fasth3`, such as "Its reference input needs at least 1 of type image, video, audio; this shot has 0.". A rejection of `facts()` or `schema()` follows `Model video/ref2v/uniserve/fasth3 is unavailable: ` in a refusal, and a render failure fails the record and the tool call with its message.

##### Entry description

```markdown
MiniMax H3 served as FastH3 Omni 8-Step V1 on UniServe: video with sound, dialogue and music written in the prompt, from reference images, videos and audio and an optional first frame. Keeps a face, place or style the same across shots through the references, and continues a shot from the previous shot's last still. Needs at least one reference.
```

##### Schema

```markdown
{"duration_sec":{"min":4,"max":15},"aspect_ratios":["16:9","9:16"],"resolutions":["768p","480p"],"inputs":{"reference":{"min":1,"max":11,"media_types":{"image":{"max":8},"video":{"max":3},"audio":{"max":3}}},"first_frame":{"min":0,"max":1,"media_types":{"image":{}}}},"extra":{}}
```

##### Server rejections

```markdown
The server at <baseUrl> serves task <served tasks, comma-separated, or none>, not ref2va; the dv-uniserve config points model "fasth3" for task "ref2v" at the wrong server.
The server at <baseUrl> cannot be reached.
The server at <baseUrl> answered GET /v1/capabilities with HTTP <status>: <server text>
The server at <baseUrl> answered POST /v1/videos/sync with HTTP <status>: <server text>
```

#### Token effect

About 65 tokens for the entry in a `dv_models_list` result, and about 100 tokens for the schema in a `dv_models_get` result. Each problem sentence costs about 15 to 25 tokens in a refusal.

#### KV Cache effect

The entry reaches the model only through tool results, which are appended to the session. Mounting or removing the plugin beside `@dv/fastvideo` leaves the skill catalog unchanged, because both entries carry the same prompt skill; without `@dv/fastvideo`, mounting or removing it changes the skill list as the [`@dv/fastvideo` KV Cache effect](../fastvideo/README.md#model-experience) describes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One prompt skill for two providers**: the entries of `dv-fastvideo` and `dv-uniserve` for `fasth3` and task `ref2v` carry the same skill name, and the skill registry keeps the first registration and ignores the second with a warning. Removing the plugin whose entry registered first removes the skill while the other entry stays in the catalog.
- **The video arrives whole**: `POST /v1/videos/sync` answers only after the server has encoded the whole MP4, so the live stream of `dv_shot_render` receives the video in one chunk at the end of the render.
- **The first frame is a cited reference**: the entry sends the first frame as the image after the reference images, as `@dv/fastvideo` does, and does not use UniServe's keyframe conditions (`role: keyframe`, `frame_index: 0`).
- **Fixed limits in the skill**: the shared skill states 5 to 15 seconds and the reference count limits of a FastVideo server, while `facts` and `schema` read 4 to 15 seconds and the limits from the UniServe server.
- **Served models are fixed in code**: `SERVED` in `src/index.ts` lists the models and tasks the plugin can serve; another UniServe model, or `fasth3` for task `t2v`, needs an entry there, not only a config change.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
