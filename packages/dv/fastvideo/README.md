---
description: "Provider plugin fastvideo of DreamVerse for video models on local FastVideo servers: registers the configured model fasth3 into the dvModels catalog once per task, ref2v (FastH3 Ref2VA) and t2v (FastH3 8-Step V2), with the input and extra parameter schema, request validation and prompt skill of each entry."
kind: "package-reference"
---

# @dv/fastvideo

English | [中文](README.zh.md)

## Summary

Use this package to render shots with video models on local FastVideo servers. The function plugin `dv-fastvideo` is the provider `fastvideo` of the [`@dv/models`](../models/README.md) catalog: it registers one catalog entry per model that its `models` config names and per task the config gives a server for, one server per task. It serves `fasth3` (MiniMax H3 as FastH3) for task `ref2v` (FastH3 Ref2VA: a prompt, reference images, videos and audio, and an optional first frame) and task `t2v` (FastH3 8-Step V2: a prompt only). While the DSH skill registry is mounted, it registers the prompt skill of each configured entry.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/models`, `@dv/asset-pool` and `@dv/ffmpeg`, with one server per model and task. The DreamVerse bundle declares it as the disabled row `dv-fastvideo`, with one server and its model facts per task, such as:

```yaml
- id: dv-fastvideo
  name: '@dv/fastvideo'
  config:
    models:
      fasth3:
        ref2v:
          baseUrl: http://127.0.0.1:8029
          modelFacts:
            modelId: fasth3
            frameSizes: { '16:9': { 768p: [1344, 768] }, '9:16': { 768p: [768, 1344] }, '1:1': { 768p: [768, 768] } }
            numFramesByDurationSec: { 5: 124, 6: 158, 7: 175, 8: 192, 9: 226, 10: 243, 11: 277, 12: 294, 13: 328, 14: 345, 15: 362 }
            maxReferences: 12
            referenceMediaTypes: { image: { maxCount: 9 }, video: { maxCount: 3 }, audio: { maxCount: 3 } }
```

| Field | Default | Meaning |
| --- | --- | --- |
| `models` | required | The models to register, by model name, and for each the tasks to serve it for, by task ID; a model or task left out is not registered |
| `models.<model>.<task>.baseUrl` | required | HTTP base URL of the FastVideo server that renders the model for the task, such as `http://127.0.0.1:8029` |
| `models.<model>.<task>.modelFacts` | required | The facts of the server's served model, described by the [generation client](../fastvideo-generation-client/README.md#minimal-configuration) |

Loading fails when `models` names a model other than `fasth3`, a task the model is not served for (`fasth3`: `ref2v`, `t2v`), a model with no task, or model facts that are inconsistent. While the plugin is mounted, the catalog holds one entry per configured task with provider `fastvideo` and model `fasth3`, such as `video/ref2v/fastvideo/fasth3`. Mount the DSH skill registry (`@deepseek-ai/dsh-skill`) as well so that the agent can load the prompt skills.

Pika H3 Flex is registered as `pika-h3-flex` for `t2v`, `i2v`, `l2v`, `fl2v`, and `ref2v`. Endpoint tasks pass native task selectors and ordered first/last image inputs. The configured model facts must reserve enough image slots for both endpoints; Ref2VA uses its reference pipeline. Frame extraction uses the shared `dvFfmpeg` service.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The table `SERVED` in `src/index.ts` maps each model that the plugin can serve to the tasks that its own file declares, such as `FASTH3` in `src/fasth3.ts`: per task the entry's description of the model's strengths and weaknesses, the accepted inputs, the extra parameter schema, the reference labels, and the prompt skill. `fasth3` accepts for task `ref2v` at least one `reference` asset of media type `image`, `video` or `audio` and an optional `first_frame` of media type `image`, and for task `t2v` no input; neither task takes extra parameters. The server of task `ref2v` serves FastH3 Ref2VA, and the server of task `t2v` serves FastH3 8-Step V2 (`FastVideo/FastVideo-FastH3-8-Step-V2`). For each configured task the plugin registers one entry with modality `video`, the task, provider `fastvideo`, and the model name, and creates one client of `@dv/fastvideo-generation-client` in an isolated `dvFastvideoGeneration` scope, so the host gains no `dvFastvideoGeneration` service. `facts()` checks with `GET /v1/model_info` that the server serves the configured `modelFacts.modelId`, and reports the configured model ID, aspect ratios, resolutions, frame sizes, duration range, and frame counts. The input limits come from the configured `maxReferences` and per-media-type `maxCount`. The server counts the first frame among its references, so for task `ref2v` the `reference` input gets one fewer than the server's total and one fewer image than the server's image count (one fewer of each media type that `first_frame` accepts), `first_frame` gets at most one asset, and a declared media type that the server does not list gets 0; task `t2v` has no inputs. `schema()` reports, from the same facts, the duration range (`duration_sec` with `min` and `max`), the `aspect_ratios` and the `resolutions` that the agent needs, each declared input with its `min`, its total `max`, and its media types with each type's `max`, plus the extra parameter schema; for task `ref2v` its `inputs` and `extra` read `{"inputs": {"reference": {"min": 1, "max": 11, "media_types": {"image": {"max": 8}, "video": {"max": 3}, "audio": {"max": 3}}}, "first_frame": {"min": 0, "max": 1, "media_types": {"image": {}}}}, "extra": {}}` against a server with 12 references, 9 images, 3 videos and 3 audio files. `validateGenerationRequest(request)` checks the request against the task's declared inputs and its own server's limits: it refuses an asset in an input the task does not declare, fewer assets in an input than the input's `min`, an asset whose media type (read with `dvAssetPool.mediaType`) its input does not declare, and more assets in an input, in total or of one media type, than the limits allow. It then checks `extra`: names the task does not take are refused in one sentence that lists the task's extra parameters, and the values of known names are checked against their schema with `validateArgs` of `@deepseek-ai/dsh-tools`. A task that declares `modelProblems` also checks the request against the model's own rules: for task `ref2v`, `fasth3` refuses a request with a first frame that the prompt does not cite as `dv:input/first_frame`, because H3 takes an image as the first frame only when the prompt says so, and a request whose references and first frame are all audio, because FastVideo pairs audio references with at least one image or video reference. With `discoverOutputCapabilities: true`, when the task's server publishes them, the request is also refused when the server's `tasks` do not include the native task that the entry sends (the task's `nativeTask`, the configured `task`, or `t2va`, `i2va`, `l2va`, `fl2va` or `ref2va` for the harness task; both sides are compared as the server reads a task, in lowercase with `t2v` as `t2va` and `i2v` as `i2va`), or when its media, frames included, exceed a Ref2VA server's `reference_limits`; `schema()` then also lists the server's tasks as `server_tasks`. Each problem is one sentence. `render(request, signal)` reads the MIME type and bytes of each input asset ID from `dvAssetPool` and sends one `POST /v1/videos/sync` to the task's server with the references in input order and the first frame after them, each as a base64 `data:` URL in the list of its media type. The server answers with the whole MP4; `render` reads its last frame with `dvFfmpeg` and yields `last_frame`, `video_start`, `chunk` and `done`. It passes `signal` on to cancel the HTTP request and rejects with `signal.reason` on abort, also when the abort comes while ffmpeg reads the last frame. Before it sends the prompt, `render` replaces each citation of a reference (`@[<label>](dv:asset/<AssetId>)`, read with `parsePromptCitations` of `@dv/project`) or of the first frame (`dv:input/first_frame`) with the label that the served model gives that medium. The `assignReferenceLabels` of the task in `SERVED` receives the media of the request with their media types and whether each holds sound, in the order the server reads them (`backendOrder` of the generation client: the images, then the videos, then the audio, each in input order with the first frame after the reference images), and returns one label per medium, or null for a medium that the model does not name. `assignFasth3ReferenceLabels` labels the k-th image `<Picture k>`, the k-th video `<Video k>` and each audio file an `<Audio N>`, so the first frame is the image after the reference images. MiniMax H3 also gives a video with sound an `<Audio N>` in the same sequence as the audio files; the server reads every video before every audio file, so each video with sound takes an audio number before every audio file. When the media hold an audio file, `render` reads whether each reference video holds sound with `dvAssetPool.hasAudio`. A citation without a label becomes its own label. Each entry registers through `ctx.effect` and carries the prompt skill of its task as `promptSkill`, with the text of the skill file as `content`. The catalog registers that skill while the entry lives and the skill registry is mounted, so the skill leaves when the plugin or the registry is removed.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`, `inject`, `Config`, `apply`, the `SERVED` table, the config check, and the catalog entry of one model and task |
| [`src/types.ts`](src/types.ts) | `ServedTask`, what one served model accepts for one task, and the input types it uses |
| [`src/reference-labels.ts`](src/reference-labels.ts) | `AssignReferenceLabels`, the type of the function that assigns a model's labels to references, and `modelPrompt`, which replaces each citation of a reference with its label |
| [`src/fasth3.ts`](src/fasth3.ts) | `FASTH3`, the tasks that the plugin serves MiniMax H3 for, and `assignFasth3ReferenceLabels`, which assigns the reference labels of MiniMax H3 |
| [`skills/fasth3-reference-prompting.md`](skills/fasth3-reference-prompting.md) | The skill body for `fasth3` for task `ref2v`: the DreamVerse connection section, then the official MiniMax-H3 full-reference prompt guide copied unchanged |
| [`skills/fasth3-text-prompting.md`](skills/fasth3-text-prompting.md) | The skill body for `fasth3` for task `t2v`: the DreamVerse connection section, then the official MiniMax-H3 prompt guide (T2VA / I2VA / FL2VA / L2VA) copied unchanged |
| [`tests/fastvideo.spec.ts`](tests/fastvideo.spec.ts) | A Loader composition with the skill registry, Project, ffmpeg, the asset pool and the catalog against fake FastVideo HTTP servers; an opt-in test renders against the server named by `DV_FASTVIDEO_TEST_URL`, whose served alias `DV_FASTVIDEO_TEST_MODEL` names |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/models`](../models/README.md): the model catalog this plugin registers into.
- [`@dv/shot-render`](../shot-render/README.md): the consumer, with the tool `dv_shot_render`.
- [`@dv/fastvideo-generation-client`](../fastvideo-generation-client/README.md): the FastVideo `POST /v1/videos/sync` client.
- [`dsh-tool-skill`](../../skill/tool-skill/README.md): how the agent sees the skill catalog and loads a skill.

-----

Pika H3 Flex is registered as `pika-h3-flex` for `t2v`, `i2v`, `l2v`, `fl2v`, and `ref2v`. Endpoint tasks pass native task selectors and ordered first/last image inputs. The configured model facts must reserve enough image slots for both endpoints; Ref2VA uses its reference pipeline. Frame extraction uses the shared `dvFfmpeg` service.

Open-H3-Regenerate-2K is registered as `open-h3-regenerate-2k` for `v2v`: one draft video in, the same clip regenerated at 2560x1440 out, rendered by a FastVideo server running the 2K pipeline (often a second GPU or a second DGX Spark beside the one that drafts). The draft is the one `reference` input and is sent as a video reference; the prompt is the draft's own prompt and cites nothing. Its model facts configure a single `1440p` frame size, the model's own durations and frame counts (`numFramesByDurationSec`), and one video reference.

<a id="model-experience"></a>
## Model Experience

### Prompt skill for task ref2v

#### What the model sees

While the skill registry is mounted and `fasth3` is configured for task `ref2v`, the skill catalog that `dsh-tool-skill` renders lists the catalog entry below. When the agent calls the `skill` tool with `fasth3-reference-prompting`, the tool result carries `skills/fasth3-reference-prompting.md`: a DreamVerse connection section for a shot with model `fasth3` for task `ref2v` (one DreamVerse shot is one target video; the six rewrite sections form the `prompt`; the model's per-type numbering `<Picture N>`, `<Video N>` and `<Audio N>` over the images, then the videos, then the audio files, each in reference order; reference images, videos and audio files cited as `@[<label>](dv:asset/<AssetId>)`, which the plugin replaces with their `<Picture N>`, `<Video N>` or `<Audio N>`; with an extra `<Audio N>` for each video with sound and the first frame cited as `@[first frame](dv:input/first_frame)`, which the plugin replaces with the next `<Picture N>`; reference videos and audio used up to the shot's length; at least one reference; at most 8 images plus the first frame, 3 videos, 3 audio files and 11 references; `duration_sec` from 5 to 15), followed by the official MiniMax-H3 full-reference prompt guide `VIDEO_PROMPT_WRITING_GUIDE_ref_en.md` copied unchanged. Users cannot invoke the skill with `/fasth3-reference-prompting`; only the agent loads it. The catalog reports `hosting: self-hosted`.

##### Catalog entry

```markdown
- `fasth3-reference-prompting`: Model limits and prompt rules for model fasth3 for task ref2v: reference images, videos and audio, how the prompt names them, and how a shot continues the previous one.
```

#### Token effect

About 40 tokens in the catalog while the entry and the skill registry are mounted, and about 6,300 tokens each time the agent loads the skill.

#### KV Cache effect

Mounting or removing the plugin changes the skill list, and `dsh-tool-skill` appends a replacement catalog; a loaded skill body is appended as a tool result. Both leave the cached prefix before them intact.

### Prompt skill for task t2v

#### What the model sees

While the skill registry is mounted and `fasth3` is configured for task `t2v`, the skill catalog lists the catalog entry below. When the agent calls the `skill` tool with `fasth3-text-prompting`, the tool result carries `skills/fasth3-text-prompting.md`: a DreamVerse connection section for a shot with model `fasth3` for task `t2v` (use the guide's T2VA mode, so the prompt begins directly with the three fields `integrated_multimodal_description`, `overall_soundscape` and `non_diegetic_music`; one DreamVerse shot is one target video; describe everything in words, and use task `ref2v` for a face that must stay the same; `duration_sec` from 5 to 15), followed by the official MiniMax-H3 prompt guide `VIDEO_PROMPT_WRITING_GUIDE_base_en.md` copied unchanged. Users cannot invoke the skill with `/fasth3-text-prompting`; only the agent loads it.

##### Catalog entry

```markdown
- `fasth3-text-prompting`: Model limits and prompt rules for model fasth3 for task t2v: the three prompt fields, shot changes, camera motion, speakers and dialogue, sound and music.
```

#### Token effect

About 40 tokens in the catalog while the entry and the skill registry are mounted, and about 4,200 tokens each time the agent loads the skill.

#### KV Cache effect

Mounting or removing the plugin changes the skill list, and `dsh-tool-skill` appends a replacement catalog; a loaded skill body is appended as a tool result. Both leave the cached prefix before them intact.

### Catalog entries and render facts

#### What the model sees

The `dv_models_list` results of `@dv/models` list each configured entry with its key (modality `video`, task, provider `fastvideo`, model `fasth3`) and its description: for task `ref2v`, "MiniMax H3 served as FastH3 Ref2VA: video with sound, dialogue and music written in the prompt, from reference images, videos and audio and an optional first frame. Keeps a face, place or style the same across shots through the references, and continues a shot from the previous shot's last still. Needs at least one reference."; for task `t2v`, "MiniMax H3 served as FastH3 8-Step V2: video with sound, dialogue and music written in the prompt, from the prompt alone. A subject keeps its look only as far as the same words describe it, and no shot starts from an earlier shot's last still; a face that must stay the same needs fasth3 for task ref2v.". The schema that this plugin builds from the configured facts of each server appears in `dv_models_get` results: the allowed durations, aspect ratios and resolutions, and for task `ref2v` the input counts per media type. The configured facts of each server appear in the results and refusals of `dv_shot_render`: the server's model ID (`model_id`), the frame size and frame count, the allowed aspect ratios, resolutions and durations.

#### Token effect

About 60 tokens for each entry's description in a `dv_models_list` result, and about 80 tokens for the `ref2v` schema in a `dv_models_get` result. A `dv_shot_render` refusal of a request that `validateGenerationRequest` rejects carries this package's problem sentences, about 15 to 25 tokens each, such as "Its reference input needs at least 1 of type image, video, audio; this shot has 0." or "fasth3 has no extra parameter `cfg` for task ref2v; its extra parameters: none."; the rest of the results and refusals come from `@dv/models` and `@dv/shot-render`.

#### KV Cache effect

The entries reach the model only through tool results, which are appended to the session, so mounting or removing the plugin leaves the cached prefix intact apart from the skill catalog change described above.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Fixed limits in the skills**: `skills/fasth3-reference-prompting.md` states 5 to 15 seconds and the reference count limits, and `skills/fasth3-text-prompting.md` states 5 to 15 seconds, while `facts` and `schema` read the configured limits; a server configured with other limits makes a skill disagree with `dv_models_get` and the refusals of `dv_shot_render`.
- **Reference aspect ratio**: the model facts have no reference aspect ratio limit because `RenderModelFacts` has no field for it, so Shot render sends reference assets to the server without an aspect ratio check.
- **Task t2v keeps no identity**: for task `t2v` the model sees only the prompt, so a subject keeps its look only as far as the same words describe it, and no shot starts from an earlier shot's last still; a face that must stay the same, or a shot that continues another, needs task `ref2v`.
- **Served models are fixed in code**: `SERVED` in `src/index.ts` lists the models and tasks the plugin can serve; another FastVideo model, or `fasth3` for another task, needs an entry there and its prompt skill, not only a config change.
