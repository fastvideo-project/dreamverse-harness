---
description: "Client for FastVideo OpenAI and streaming_v2 generation APIs: deployment facts, typed references, video events and cancellation."
kind: "package-reference"
---

# @dv/fastvideo-generation-client

English | [中文](README.zh.md)

## Summary

Use this package to generate a video segment with FastVideo. Select the OpenAI API for a server that returns a whole MP4, or leave the configuration at its default for streaming_v2. Both expose last-frame, video and timing events. Requests carry all references; cancellation closes the HTTP request, although the backend may finish an already running generation.

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

Construct one client per backend with the backend's base URL. `@dv/fastvideo` builds one client per configured model and task in an isolated `dvFastvideoGeneration` scope.

### Minimal configuration

```yaml
- id: dv-fastvideo-generation-client
  name: '@dv/fastvideo-generation-client'
  config:
    baseUrl: http://127.0.0.1:8029
```

| Field | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | required | HTTP base URL of the generation backend |
| `openai` | `null` | Set the OpenAI deployment configuration below; omit it for streaming_v2 |

<a id="openai-api-configuration"></a>
### OpenAI API configuration

Set `openai` beside `baseUrl` for a server with `GET /v1/model_info` and `POST /v1/videos/sync`. Supply `modelFacts` with the verified limits of that deployment and `ffmpegPath` with an installed ffmpeg executable. `model()` checks that `served_model_name` matches `modelFacts.modelId` before caching these facts. A mismatch fails rather than advertising a different model.

| Field in `openai` | Default | Meaning |
| --- | --- | --- |
| `ffmpegPath` | required | Executable for local last-frame extraction; unused when `returnLastFrame` is false |
| `managed` | `false` | Use native model-catalog discovery, lifecycle controls and asynchronous video jobs |
| `task` | `null` | Native task used when the request does not supply one |
| `displayName` | `null` | Name shown by the harness model selector |
| `pollIntervalMs` | `1000` | Interval between managed job-state requests |
| `modelFacts.modelId` | required | Exact served model alias |
| `modelFacts.aspectRatios` / `resolutions` | required | Supported catalog choices |
| `modelFacts.minSegmentDurationSec` / `maxSegmentDurationSec` | required | Inclusive whole-second duration range |
| `modelFacts.maxReferences` | required | Total reference limit, including a first frame |
| `modelFacts.referenceMediaTypes` | required | Per-type objects with `maxCount` |
| `modelFacts.frameSizes` | required | Aspect ratio to resolution to `[width, height]` |
| `modelFacts.numFramesByDurationSec` | required | Whole-second duration to frame count |

`generateSegment` sends `model`, `prompt`, `width`, `height`, `num_frames` and optional `seed`. It groups references into `image_reference`, `video_reference` and `audio_reference`, with typed data URIs in each `*_url`. Set each reference's `mimeType` to preserve formats such as JPEG or MPEG audio; an omitted MIME uses `<mediaType>/octet-stream`. Other media types and mismatched MIME types fail before HTTP.

With `managed: true`, the server must expose a native model catalog. Discovery queries `/v1/model_info` with the model alias and task; `modelStatus()`, `loadModel()` and `unloadModel()` use `/v1/model_state` and `/v1/models/load` or `/unload`. Generation submits once to `/v1/videos`, polls that job ID, then retrieves `/v1/videos/{id}/content`. Long inference therefore does not leave one synchronous response waiting for headers. Cancellation requests deletion of the job; an active CUDA call still holds the generation lock until it settles. Job tracking is in memory on the native server, not restart-persistent recovery.

The response must have a `video/*` content type. The client buffers the complete MP4, optionally extracts a last-frame PNG with ffmpeg, and then yields the same event kinds as streaming_v2. It maps `X-Inference-Time-S` to `done.timings.inference_s`. HTTP 400 or 422 becomes `GenerationSegmentError` with `invalid_request`; other HTTP failures retain the status and a bounded backend message. Python tracebacks become their final exception line; messages longer than 2,048 characters are truncated, with full details left in the server logs. Aborting rejects with the caller's reason after any local ffmpeg process exits and temporary files are removed.

### Streaming API service

- `model()` reads `GET /v1/streamv2/capabilities` and caches the first successful result. It adds aspect ratios and resolutions from the `frame_sizes` keys.
- `generateSegment(request)` sends one `POST /v1/streamv2/generate` and yields `last_frame`, `video_start`, `chunk`, and `done` outputs in arrival order. HTTP 400 and an `error` event reject with `GenerationSegmentError(message, errorType)`, where `errorType` is the backend's error code. A stream that ends before `done` rejects with `Error`. Leaving the iteration or aborting `request.signal` cancels the HTTP request; an abort rejects with `signal.reason`.

### Streaming backend API

FastVideo owns the API; the client uses two routes. `GET /v1/streamv2/capabilities` answers the model's facts:

```json
{
  "model_id": "h3-ref2va",
  "name": "H3 Ref2AV",
  "min_segment_duration_sec": 5,
  "max_segment_duration_sec": 15,
  "max_references": 12,
  "reference_media_types": {
    "image": {"max_count": 9},
    "video": {"max_count": 3},
    "audio": {"max_count": 3}
  },
  "max_reference_aspect_ratio": 4.0,
  "frame_sizes": {"16:9": {"720p": [1344, 768]}},
  "num_frames_by_duration_sec": {"5": 124, "6": 158, "15": 362}
}
```

`max_references` counts every reference of a request across media types. `reference_media_types` lists each accepted media type with its own `max_count`; a request image that continues a segment counts as an `image`. `num_frames_by_duration_sec` holds every whole duration from the minimum to the maximum.

`POST /v1/streamv2/generate` takes `{"prompt", "references", "width", "height", "num_frames", "seed"?, "return_last_frame"}` and answers a `text/event-stream` of `event: <name>` records with one-line JSON `data:`, in this order:

| Event | Data |
| --- | --- |
| `last_frame` | `{"data": <base64 PNG of the final decoded frame>}`, only when `return_last_frame` is true |
| `video_start` | `{"mime": str}` |
| `video_chunk` | `{"data": <base64 fMP4 bytes>}`, one or more; their concatenation is one fragmented MP4 |
| `done` | `{"timings": {"generation_ms": float, "e2e_latency_ms": float}}`; the response ends |
| `error` | `{"code": "invalid_request" \| "generation_failed", "message": str}`; the response ends |

`references` is an ordered list of `{"media_type": str, "data": <base64 bytes>}`, built from `SegmentRequest.references`; the client does not check the media types, and the backend decodes each reference by its `media_type`. A request problem found before generation starts answers HTTP 400 `{"code": "invalid_request", "message": str}`. The backend serializes generation across concurrent requests and finishes a segment whose generation has started, even after the client cancels.

For MiniMax-H3/Pika OpenAI servers, `SegmentRequest.task` optionally sends the native `t2va`, `i2va`, `l2va`, `fl2va` or `ref2va` selector. The provider owns endpoint ordering: the first two image references become first and last conditioning images on the keyframe pipeline. An explicit `l2va` selector requires a backend that maps a sole image to last-frame conditioning; older servers map it to the first frame or reject the selector. The streaming_v2 transport has no native task selector.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Both transports use `fetch`. The OpenAI transport buffers one MP4 and owns temporary files only during local last-frame extraction. The streaming transport uses no local media files. `generateSegment` parses the server-sent event stream line by line and yields each output as soon as its event is complete, so a caller can forward video chunks while the backend still generates.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The `dvFastvideoGeneration` service: model facts and the segment request |
| [`src/openai.ts`](src/openai.ts) | OpenAI deployment validation, synchronous MP4 response and local last-frame extraction |
| [`src/generation-stream.ts`](src/generation-stream.ts) | The request body and the event-stream parser |
| [`src/types.ts`](src/types.ts) | Model facts, the segment request with its typed references, and the segment outputs |
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

For streaming_v2, the video model receives the request body that `generateSegment` builds: `prompt` unchanged, `references` as `{media_type, data}` entries with base64 bytes in the caller's order, `width`, `height`, `num_frames`, `seed` only when the caller sets one, and `return_last_frame`. The model numbers the references per media type in list order, and the caller's prompt names them with the model's numbering, such as `Picture 1` for the first image. With OpenAI, the model receives the same prompt and geometry, a configured served alias, and separate image, video and audio lists. Labels must follow that backend order; `@dv/fastvideo` handles this when replacing citations. No reference or first-frame label is added by this client.

#### Token effect

Zero direct text tokens: the client adds no text to the caller's prompt.

#### KV Cache effect

Independent request per segment: the backend keeps no state between requests, and the client sends no session or cache identifier.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Model facts never refresh** — `model()` keeps the first successful capabilities result for the plugin's lifetime. A backend that restarts with another model keeps the old facts in the harness until the plugin reloads.
- **Explicit OpenAI limits**: this API exposes no capabilities endpoint. The operator must keep configured facts consistent with the deployed weights and sampling setup.
- **Whole-response OpenAI output**: there is no progressive preview; the complete MP4 is held in memory, and requesting its last frame requires local ffmpeg.
- **No request deadline** — the client sets no timeout on the capabilities or generation requests. A backend that stops sending events holds the request until the caller aborts it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
