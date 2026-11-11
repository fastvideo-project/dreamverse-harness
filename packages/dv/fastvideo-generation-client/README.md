---
description: "Client for the FastVideo POST /v1/videos/sync API: configured model facts, typed references, whole-MP4 segments and cancellation."
kind: "package-reference"
---

# @dv/fastvideo-generation-client

English | [中文](README.zh.md)

## Summary

Use this package to generate a video segment with FastVideo. The client checks the served model with `GET /v1/model_info`, sends one `POST /v1/videos/sync` per segment with every reference inline, and returns the whole MP4 with the backend timings. Cancellation closes the HTTP request, although the backend may finish an already running generation.

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

Construct one client per backend with the backend's base URL and the `modelFacts` of its served model. `@dv/fastvideo` builds one client per configured model and task in an isolated `dvFastvideoGeneration` scope.

<a id="minimal-configuration"></a>
### Minimal configuration

```yaml
- id: dv-fastvideo-generation-client
  name: '@dv/fastvideo-generation-client'
  config:
    baseUrl: http://127.0.0.1:8029
    modelFacts:
      modelId: fasth3
      frameSizes: { '16:9': { 480p: [832, 480] } }
      numFramesByDurationSec: { 5: 124 }
      maxReferences: 12
      referenceMediaTypes: { image: { maxCount: 9 }, video: { maxCount: 3 }, audio: { maxCount: 3 } }
```

FastVideo serves no capabilities route, so the operator writes the facts of the served model. The client derives `aspectRatios` and `resolutions` from the keys of `frameSizes`, and `minDurationSec` and `maxDurationSec` from the keys of `numFramesByDurationSec`.

| Field | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | required | HTTP base URL of the generation backend |
| `modelFacts.modelId` | required | Exact served model alias; `model()` compares it with `served_model_name` |
| `modelFacts.frameSizes` | required | Aspect ratio to resolution to `[width, height]`; every aspect ratio lists the same resolutions |
| `modelFacts.numFramesByDurationSec` | required | Whole-second duration to frame count, for every duration from the shortest to the longest, growing with the duration |
| `modelFacts.maxReferences` | required | Total reference limit, including a first frame |
| `modelFacts.referenceMediaTypes` | required | `image`, `video` or `audio` to `{maxCount}`, each at most `maxReferences`; a type left out is not accepted |

Constructing the client throws an `Error` that names the inconsistency of facts that break these rules, so a plugin that builds the client fails at load.

### Service

- `facts` holds the derived facts from construction on, without a request; `model()` returns the same facts once the backend confirms the served alias.
- `model()` sends `GET /v1/model_info` and returns the derived facts after the first answer whose `served_model_name` equals `modelFacts.modelId`. A status other than 200 throws an `Error` that names the route and the status; a body that is not JSON throws an `Error` that names the route; a missing or different `served_model_name` throws an `Error` that names both aliases.
- `generateSegment(request)` sends one `POST /v1/videos/sync` and resolves `{video, mime, timings}` with the whole MP4. The request has no client-side headers timeout, because the backend sends its headers only after the whole video is generated. The body keeps the global dispatcher's body timeout, because the backend sends the body from the finished MP4 file. Aborting `request.signal` cancels the HTTP request and rejects with `signal.reason`.

### Backend API

FastVideo owns the API; the client uses two routes. `GET /v1/model_info` answers `{"model_path", "served_model_name", "lora"}`. `POST /v1/videos/sync` takes `model`, `prompt`, `width`, `height`, `num_frames`, optional `seed`, and the lists `image_reference`, `video_reference` and `audio_reference`, each of `{"<type>_url": "data:<mime>;base64,..."}`. The Ref2VA pipeline reads the images, then the videos, then the audio, each list in its own order; `REFERENCE_FIELDS` records that order, and `backendOrder(items, mediaTypeOf)` returns items in it. A reference's media type is the top-level type of its `mimeType`; another type rejects with `GenerationSegmentError` before HTTP.

The answer must have a `video/*` content type; another content type rejects with an `Error` that carries the body text. `renderTimings` of `@dv/models` reads the timings: `X-Inference-Time-S` becomes `timings.inference_s`, and each stage of the JSON object in `X-Stage-Durations` becomes `timings.<stage>_s`; an `X-Stage-Durations` that is not JSON adds no stage timing, and the video is kept. HTTP 400 becomes `GenerationSegmentError`; other HTTP failures keep the status and a bounded backend message. The message is `error.message` of an `application/json` body, else the body text. A Python traceback becomes its final exception line; a message longer than 2,048 characters is truncated, with full details left in the server logs.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Both routes use undici's `fetch`. The generation request passes the installed global dispatcher, composed to turn off the headers timeout of that one request, so it keeps the process proxy policy and connection pool. The client holds one MP4 in memory and writes no local files.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The `dvFastvideoGeneration` service: the served-model check, the request body, the response checks and the timings |
| [`src/model-facts.ts`](src/model-facts.ts) | The configured facts, their Loader validation and the derived `ModelFacts` |
| [`src/references.ts`](src/references.ts) | The reference field of each media type, in the backend's reading order |
| [`src/types.ts`](src/types.ts) | Model facts, the segment request with its references, and the segment video |
| [`src/errors.ts`](src/errors.ts) | The segment error |

The `tests/` directory runs the client against a local HTTP server that plays the backend.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/fastvideo`](../fastvideo/README.md) — registers the FastVideo models and renders each shot through this client.

-----

<a id="model-experience"></a>
## Model Experience

### Segment generation request

#### What the model sees

The video model receives the request body that `generateSegment` builds: `prompt` unchanged, the configured served alias, `width`, `height`, `num_frames`, `seed` only when the caller sets one, and one list per media type with the caller's order kept within each type. The model numbers the references in the order it reads them: the images, then the videos, then the audio. The caller's prompt names them with that numbering, such as `Picture 1` for the first image; `@dv/fastvideo` assigns its labels in `backendOrder`. No reference or first-frame label is added by this client.

#### Token effect

Zero direct text tokens: the client adds no text to the caller's prompt.

#### KV Cache effect

Independent request per segment: the backend keeps no state between requests, and the client sends no session or cache identifier.

The optional `task` field selects a native FastVideo task, such as `fl2va`; when omitted, the server uses its default task.

### Native catalog controls

Set `managed: true` only for a backend implementing `/v1/model_state`, `/v1/models/load`, and `/v1/models/unload`. `loadModel`, `unloadModel`, and `modelStatus` call those routes without generating. `task` distinguishes reference and keyframe pipelines that share one model alias; `displayName` names the chat choice. The provider exposes these controls only for managed entries.

Managed entries and entries with `asyncJobs: true` submit one `/v1/videos` job, poll its ID at `pollIntervalMs` (default 1000), and retrieve its canonical content route. Polling never resubmits generation. Aborting deletes that job; native CUDA work can remain busy until its current call finishes. Ordinary fixed servers retain the merged `/v1/videos/sync` transport and shared ffmpeg extraction.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Model facts never refresh** — `model()` checks the served alias once for the plugin's lifetime. A backend that restarts with another model keeps the configured facts in the harness until the plugin reloads.
- **Configured model facts** — FastVideo serves no capabilities route. The operator must keep the configured facts consistent with the deployed weights and sampling setup.
- **Whole-response output** — there is no progressive preview; the complete MP4 is held in memory.
- **No default request deadline** — calls accept an optional abort signal. The default native transport disables the response-header timeout for long generation and model-loading requests; callers own the operation deadline.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
