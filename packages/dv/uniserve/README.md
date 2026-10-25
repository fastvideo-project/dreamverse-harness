---
description: "Provider plugin uniserve of DreamVerse for MiniMax H3 served as FastH3 Omni 8-Step V1 on a UniServe server: registers the dvModels entry of model fasth3 for task ref2v, with its own input limits, request validation, reference labels and prompt skill, and renders each shot with one POST /v1/videos/sync."
kind: "package-reference"
---

# @dv/uniserve

English | [中文](README.zh.md)

## Summary

Use this package to render shots with MiniMax H3 on a UniServe server. The function plugin `dv-uniserve` is the provider `uniserve` of the [`@dv/models`](../models/README.md) catalog: it registers model `fasth3` (FastH3 Omni 8-Step V1, checkpoint `FastVideo/FastVideo-FastH3-Omni-8-Step-V1`) for task `ref2v`, with its own input limits, request checks, reference labels and prompt skill. The tool `dv_shot_render` of [`@dv/shot-render`](../shot-render/README.md) renders with the entry.

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

Mount the plugin after `@dv/models`, `@dv/asset-pool` and `@dv/ffmpeg`, with the UniServe server that renders the shots. The DreamVerse bundle mounts it as row `dv-uniserve` and disables row `dv-fastvideo`, so the catalog holds one `fasth3` entry for task `ref2v`:

```yaml
- id: dv-uniserve
  name: '@dv/uniserve'
  config:
    baseUrl: http://10.244.8.35:8000
```

| Field | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | required | HTTP base URL of the UniServe server that serves task `ref2va`, such as `http://127.0.0.1:8000` |

While the plugin is mounted, the catalog holds the entry `video/ref2v/uniserve/fasth3`. Start the server with a `-reference` deployment of UniServe, which serves task `ref2va`; the [UniServe serving guide](https://github.com/hao-ai-lab/uniserve/blob/main/docs/minimax_h3/minimax_h3.md#deployments) lists them. Mount the DSH skill registry (`@deepseek-ai/dsh-skill`) as well so that the agent can load the prompt skill.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`apply` registers one entry with `ctx.effect`. `facts()` reads `GET /v1/capabilities` once, on the first call that succeeds, and rejects when the server does not list task `ref2va`. It reports the served model name as the model ID, the server's aspect ratios, one resolution per short edge named `<edge>p` (such as `768p`), the frame size of each pair, and the whole-second durations from the server's `min_seconds` to its `max_seconds` with UniServe's frame count of each: `duration × fps` rounded up to the next `min_frames + n × clip_frames`, so 5 seconds have 124 frames. The rules of the model are in `src/fasth3-omni.ts`. The `reference` input needs at least one image, video or audio file. UniServe counts the first frame as one more reference image, so the `reference` input takes one asset less than `max_references` in total and one image less than `max_images`, and up to `max_videos` videos and `max_audios` audio files. The optional `first_frame` input takes one image, which the prompt must cite. The entry takes no `extra` parameter. `render(request, signal)` sends one `POST /v1/videos/sync` with the served model name, task `ref2va`, one condition of role `reference` per asset (the references in input order and then the first frame, each with its media type and a `data:` URI of its MIME type and bytes from `dvAssetPool`), the `target` whose short edge and aspect ratio name the requested frame size and whose `duration_seconds` is the duration of the requested frame count, and the seed. The prompt gets one counter per media type in the order that the server receives the media: the n-th image is `<Picture n>`, the n-th video `<Video n>` and the n-th audio file `<Audio n>`, and the soundtrack of a video with sound takes the next audio number before the video. Each citation of a reference or of the first frame becomes the label of its medium; any other citation becomes its own label. `signal` cancels the HTTP request. The server answers with the whole MP4. The entry writes it to a temporary directory, reads its last frame as a PNG with `dvFfmpeg`, removes the directory, and yields `last_frame`, `video_start` with the answer's media type, one `chunk` with the MP4 and `done`. The timings of `done` are `inference_s` from the `x-inference-time-s` header and one `<stage>_s` per stage of the `x-stage-durations` header; a value that is not a finite number is left out. An error answer becomes `error.message` of its JSON body, or the body as sent.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`, `inject`, `Config`, `apply`, the capabilities and render calls, and the catalog entry |
| [`src/fasth3-omni.ts`](src/fasth3-omni.ts) | The entry description, the input limits, `schema()`, the problems of a request, and the prompt with the model's labels |
| [`skills/fasth3-uniserve-prompting.md`](skills/fasth3-uniserve-prompting.md) | The prompt skill `fasth3-uniserve-prompting` |
| [`tests/uniserve.spec.ts`](tests/uniserve.spec.ts) | A Loader composition with the skill registry, Project, ffmpeg, the asset pool and the catalog against a fake UniServe server that answers with a running server's capabilities, an MP4 and its timing headers; an opt-in test renders against the server named by `DV_UNISERVE_TEST_URL` |

Run the opt-in test, which renders one five-second shot, with `DV_UNISERVE_TEST_URL=http://10.244.8.35:8000 pnpm exec vitest run packages/dv/uniserve/tests`.

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/models`](../models/README.md): the model catalog this plugin registers into.
- [`@dv/shot-render`](../shot-render/README.md): the consumer, with the tool `dv_shot_render`.
- [UniServe serving guide](https://github.com/hao-ai-lab/uniserve/blob/main/docs/minimax_h3/minimax_h3.md): the server, its deployments and the `/v1/videos` API.

-----

<a id="model-experience"></a>
## Model Experience

### Catalog entry and refusals

#### What the model sees

The `dv_models_list` results of `@dv/models` list the entry with its key (modality `video`, task `ref2v`, provider `uniserve`, model `fasth3`), the description below and the prompt skill `fasth3-uniserve-prompting`. The skill maps the official MiniMax-H3 full-reference guide to a DreamVerse shot and tells the agent to read the reference limits and durations from `dv_models_get`. `dv_models_get` adds the schema below, read from a server with 12 references, 9 images, 3 videos and 3 audio files. A rejection of `facts()` or `schema()` follows `Model video/ref2v/uniserve/fasth3 is unavailable: ` in a refusal, and a render failure fails the record and the tool call with its message.

##### Entry description

```markdown
MiniMax H3 served as FastH3 Omni 8-Step V1 on UniServe: video with sound, dialogue and music written in the prompt, from reference images, videos and audio and an optional first frame. Keeps a face, place or style the same across shots through the references, and continues a shot from the previous shot's last still. Needs at least one reference.
```

##### Schema

```markdown
{"duration_sec":{"min":4,"max":15},"aspect_ratios":["16:9","9:16"],"resolutions":["768p","480p"],"inputs":{"reference":{"min":1,"max":11,"media_types":{"image":{"max":8},"video":{"max":3},"audio":{"max":3}}},"first_frame":{"min":0,"max":1,"media_types":{"image":{}}}},"extra":{}}
```

##### Request problems

```markdown
Its reference input needs at least 1 of type image, video, audio; this shot has 0.
Its reference input takes at most <max> assets; this shot has <count>.
Its reference input takes assets of type image, video, audio; asset <asset> is of type <type>.
Its reference input takes at most <max> of type <type>; this shot has <count>.
Its first_frame input takes assets of type image; asset <asset> is of type <type>.
Its prompt does not cite the first frame; write "@[首帧](dv:input/first_frame) is the first frame of [Shot 1]".
fasth3 has no extra parameter `<name>` for task ref2v; its extra parameters: none.
```

##### Server rejections

```markdown
The server at <baseUrl> serves task <served tasks, comma-separated, or none>, not ref2va; the dv-uniserve baseUrl names the wrong server.
The server at <baseUrl> cannot be reached.
The server at <baseUrl> answered GET /v1/capabilities with HTTP <status>: <server text>
The server at <baseUrl> answered POST /v1/videos/sync with HTTP <status>: <server text>
```

#### Token effect

About 65 tokens for the entry in a `dv_models_list` result, and about 100 tokens for the schema in a `dv_models_get` result. Each problem sentence costs about 15 to 25 tokens in a refusal. The skill `fasth3-uniserve-prompting` adds one name and description line to the skill list; its body of about 7,000 tokens enters the session only when the agent loads it.

#### KV Cache effect

The entry reaches the model only through tool results, which are appended to the session. Mounting or removing the plugin adds or removes the skill `fasth3-uniserve-prompting` in the skill list of the system prompt, which changes the cached prefix of later requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The video arrives whole**: `POST /v1/videos/sync` answers only after the server has encoded the whole MP4, so the live stream of `dv_shot_render` receives the video in one chunk at the end of the render.
- **The first frame is a cited reference**: the entry sends the first frame as the image after the reference images and does not use UniServe's keyframe conditions (`role: keyframe`, `frame_index: 0`).
- **One model and one task**: the plugin serves only `fasth3` for task `ref2v`; another UniServe model or task needs its own rules and entry in code, not only a config change.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
