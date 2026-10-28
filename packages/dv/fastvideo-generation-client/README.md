---
description: "Client for the FastVideo streaming_v2 generation backend: served-model facts and one streamed segment request with its server-sent events and errors."
kind: "package-reference"
---

# @dv/fastvideo-generation-client

English | [中文](README.zh.md)

## Summary

Use this package to reach a FastVideo generation backend. It reads the served model's facts (durations, frame sizes, reference limits per media type) and streams one segment per request: the last frame, then the fragmented MP4 in chunks, then the timings. Backend errors become typed errors, and aborting a request cancels it at once. The backend keeps no state between requests, so callers send every reference with each request.

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

### Service

- `model()` reads `GET /v1/streamv2/capabilities` and caches the first successful result. It adds aspect ratios and resolutions from the `frame_sizes` keys.
- `generateSegment(request)` sends one `POST /v1/streamv2/generate` and yields `last_frame`, `video_start`, `chunk`, and `done` outputs in arrival order. HTTP 400 and an `error` event reject with `GenerationSegmentError(message, errorType)`, where `errorType` is the backend's error code. A stream that ends before `done` rejects with `Error`. Leaving the iteration or aborting `request.signal` cancels the HTTP request; an abort rejects with `signal.reason`.

### Backend API

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

`lora` reports the community adapters the server allows a request to select: `supported`, `runtime_switching`, `base_strength`, and each adapter's `id`, `default_strength`, `min_strength` and `max_strength` with its optional `description`, `license` and `source_url`. A server without an adapter list reports `{"supported": false, "adapters": []}`.

`max_references` counts every reference of a request across media types. `reference_media_types` lists each accepted media type with its own `max_count`; a request image that continues a segment counts as an `image`. `num_frames_by_duration_sec` holds every whole duration from the minimum to the maximum.

`POST /v1/streamv2/generate` takes `{"prompt", "references", "width", "height", "num_frames", "seed"?, "return_last_frame", "lora"?}` and answers a `text/event-stream` of `event: <name>` records with one-line JSON `data:`, in this order:

| Event | Data |
| --- | --- |
| `last_frame` | `{"data": <base64 PNG of the final decoded frame>}`, only when `return_last_frame` is true |
| `video_start` | `{"mime": str}` |
| `video_chunk` | `{"data": <base64 fMP4 bytes>}`, one or more; their concatenation is one fragmented MP4 |
| `done` | `{"timings": {"generation_ms": float, "e2e_latency_ms": float}}`; the response ends |
| `error` | `{"code": "invalid_request" \| "generation_failed", "message": str}`; the response ends |

`references` is an ordered list of `{"media_type": str, "data": <base64 bytes>}`, built from `SegmentRequest.references`; the client does not check the media types, and the backend decodes each reference by its `media_type`. A request problem found before generation starts answers HTTP 400 `{"code": "invalid_request", "message": str}`. The backend serializes generation across concurrent requests and finishes a segment whose generation has started, even after the client cancels.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service uses `fetch` for every call. `generateSegment` parses the server-sent event stream line by line and yields each output as soon as its event is complete, so a caller can forward video chunks while the backend still generates.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The `dvFastvideoGeneration` service: model facts and the segment request |
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

The video model receives the request body that `generateSegment` builds: `prompt` unchanged, `references` as `{media_type, data}` entries with base64 bytes in the caller's order, `width`, `height`, `num_frames`, `seed` only when the caller sets one, `return_last_frame`, and `lora` only when the caller selects an adapter. The model numbers the references per media type in list order, and the caller's prompt names them with the model's numbering, such as `Picture 1` for the first image.

#### Token effect

Zero direct text tokens: the client adds no text to the caller's prompt.

#### KV Cache effect

Independent request per segment: the backend keeps no state between requests, and the client sends no session or cache identifier.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Model facts never refresh** — `model()` keeps the first successful capabilities result for the plugin's lifetime. A backend that restarts with another model keeps the old facts in the harness until the plugin reloads.
- **No request deadline** — the client sets no timeout on the capabilities or generation requests. A backend that stops sending events holds the request until the caller aborts it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
