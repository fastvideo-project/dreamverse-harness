---
description: "Client for the FastVideo generation backend's OpenAI-style video job API: one video job per request, submitted, polled until it completes, and downloaded as one MP4, with typed errors."
kind: "package-reference"
---

# @dv/fastvideo-generation-client

English | [中文](README.zh.md)

## Summary

Use this package to reach a FastVideo generation backend through its OpenAI-style video job API. Each request is one job: the client submits it, polls its status until it completes, and downloads the finished MP4 with the timings. A refused submission and a failed job become typed errors, and aborting a request stops the wait at once. The backend keeps no state between jobs, so callers send every reference image with each request.

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

- `generateVideo(request)` submits one job with `POST /v1/videos`, reads `GET /v1/videos/{id}` once per second until the job's `status` is `completed` or `failed`, and then reads `GET /v1/videos/{id}/content`. It resolves with the MP4 bytes and the timings `e2e_latency_ms`, from submission to downloaded bytes, and `generation_ms`, from the job's `inference_time_s` when the backend reports it. HTTP 400 at submission rejects with `GenerationSegmentError(message, 'invalid_request')` and a `failed` job with `GenerationSegmentError(message, 'generation_failed')`; any other status than 200 rejects with `Error` naming the route. Aborting `request.signal` stops polling and rejects with `signal.reason`.

### Backend API

FastVideo owns the API; the client uses three routes. `POST /v1/videos` takes `{"task", "prompt", "size", "num_frames", "seed"?, "image_reference"?}` and answers the job object with its `id` and `status` `queued`:

```json
{
  "task": "ref2va",
  "prompt": "<Picture 1> smiles",
  "size": "1344x768",
  "num_frames": 124,
  "seed": 7,
  "image_reference": [{"image_url": "data:image/png;base64,..."}]
}
```

`size` is `<frameWidth>x<frameHeight>`. `image_reference` lists the request's images in order, each as a `data:` URL of its MIME type and bytes; the client leaves it out when the request has no image and leaves `seed` out when the request has none. A request problem answers HTTP 400 with FastAPI's `{"detail": ...}`. `GET /v1/videos/{id}` answers the job object, whose `status` is `queued`, `in_progress`, `completed` or `failed`, with `error.message` for a failed job and `inference_time_s` for a completed one. `GET /v1/videos/{id}/content` answers the MP4 of a completed job. The backend keeps jobs in memory and finishes a job whose generation has started, even after the client stops polling.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service uses `fetch` for every call. The backend reports progress only as 0 or 100, so the client polls at a fixed one-second interval.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The `dvFastvideoGeneration` service: the job request body, the status polls, and the download |
| [`src/types.ts`](src/types.ts) | The video request with its image references, and the video output |
| [`src/errors.ts`](src/errors.ts) | The job error |

The `tests/` directory runs the client against a local HTTP server that plays the backend.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/fastvideo`](../fastvideo/README.md) — registers the FastVideo models and renders each shot through this client.

-----

<a id="model-experience"></a>
## Model Experience

### Video job request

#### What the model sees

The video model receives the job body that `generateVideo` builds: `task` and `prompt` unchanged, `size`, `num_frames`, `seed` only when the caller sets one, and `image_reference` with the images as `data:` URLs in the caller's order. The model numbers the images in list order, and the caller's prompt names them with the model's numbering, such as `<Picture 1>` for the first image.

#### Token effect

Zero direct text tokens: the client adds no text to the caller's prompt.

#### KV Cache effect

Independent request per job: the backend keeps no state between jobs, and the client sends no session or cache identifier.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Images only** — the backend reads `image_reference` from `data:` URLs and refuses `data:` videos and audio, so the client sends image references only.
- **No cancellation of a started job** — aborting stops polling; the backend has no route that stops a running generation, so the GPU finishes the job.
- **No request deadline** — the client sets no timeout on the job; a job that stays `in_progress` holds the request until the caller aborts it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
