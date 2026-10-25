---
description: "Provider plugin fastvideo of DreamVerse for video models on FastVideo servers of the OpenAI-style video job API: registers the configured model fasth3 into the dvModels catalog once per task, ref2v (FastH3 Ref2VA) and t2v (FastH3 8-Step V2), with the input and extra parameter schema, request validation and prompt skill of each entry."
kind: "package-reference"
---

# @dv/fastvideo

English | [中文](README.zh.md)

## Summary

Use this package to render shots with video models on FastVideo video job servers. The function plugin `dv-fastvideo` is the provider `fastvideo` of the [`@dv/models`](../models/README.md) catalog: it registers one catalog entry per model that its `models` config names and per task the config gives a server for, one server per task. It serves `fasth3` (MiniMax H3 as FastH3) for task `ref2v` (FastH3 Ref2VA: a prompt, reference images, and an optional first frame) and task `t2v` (FastH3 8-Step V2: a prompt only). While the DSH skill registry is mounted, it registers the prompt skill of each configured entry.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/models`, `@dv/asset-pool` and `@dv/ffmpeg`, with one server per model and task. The DreamVerse bundle mounts it as row `dv-fastvideo`, with one explicit server per task:

```yaml
- id: dv-fastvideo
  name: '@dv/fastvideo'
  config:
    models:
      fasth3:
        ref2v:
          baseUrl: http://10.244.19.118:8029
          gpuSecondsPerVideoSecond: 4
        t2v:
          baseUrl: http://10.244.16.130:8031
          gpuSecondsPerVideoSecond: 1.5
```

| Field | Default | Meaning |
| --- | --- | --- |
| `models` | required | The models to register, by model name, and for each the tasks to serve it for, by task ID; a model or task left out is not registered |
| `models.<model>.<task>.baseUrl` | required | HTTP base URL of the FastVideo video job server that renders the model for the task, such as `http://127.0.0.1:8029` |
| `models.<model>.<task>.gpuSecondsPerVideoSecond` | required | GPU seconds per rendered video second on that server; the entry of the model and task declares it, for the GPU estimate before a render |

Loading fails when `models` names a model other than `fasth3`, a task the model is not served for (`fasth3`: `ref2v`, `t2v`), or a model with no task. While the plugin is mounted, the catalog holds one entry per configured task with provider `fastvideo` and model `fasth3`, such as `video/ref2v/fastvideo/fasth3`. Mount the DSH skill registry (`@deepseek-ai/dsh-skill`) as well so that the agent can load the prompt skills.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The table `SERVED` in `src/index.ts` maps each model that the plugin can serve to the tasks that its own file declares, such as `FASTH3` in `src/fasth3.ts`: per task the entry's description of the model's strengths and weaknesses, the job API task name, the model's facts, the accepted inputs, the extra parameter schema, the reference labels, and the prompt skill. `fasth3` accepts for task `ref2v` at least one `reference` asset of media type `image` and an optional `first_frame` of media type `image`, and for task `t2v` no input; neither task takes extra parameters. The job API reads reference images from `data:` URLs and refuses `data:` videos and audio, so `fasth3` takes no reference video or audio. The server of task `ref2v` serves FastH3 Ref2VA with job task `ref2va`, and the server of task `t2v` serves FastH3 8-Step V2 (`FastVideo/FastVideo-FastH3-8-Step-V2`) with job task `t2va`. For each configured task the plugin registers one entry with modality `video`, the task, provider `fastvideo`, and the model name, and creates one video job client of `@dv/fastvideo-generation-client` in an isolated `dvFastvideoGeneration` scope, so the host gains no `dvFastvideoGeneration` service. The job API reports no model facts, so `facts()` reports the facts of the served task in `SERVED`: for `fasth3`, model ID `fasth3-ref2va` or `fasth3-t2va`, aspect ratio `16:9`, resolution `720p` at 1344x768, 5 to 15 seconds, and the 24 fps frame count of each whole duration on the 17n+5 grid, such as 124 frames for 5 seconds. The input limits come from the task's `maxReferences`, 9 for `fasth3`. The model counts the first frame among its references, so for task `ref2v` the `reference` input gets one fewer than the total and `first_frame` gets at most one asset; task `t2v` has no inputs. `schema()` reports, from the same facts, the duration range (`duration_sec` with `min` and `max`), the `aspect_ratios` and the `resolutions` that the agent needs, each declared input with its `min`, its `max`, and its media types, plus the extra parameter schema; for task `ref2v` its `inputs` and `extra` read `{"inputs": {"reference": {"min": 1, "max": 8, "media_types": {"image": {}}}, "first_frame": {"min": 0, "max": 1, "media_types": {"image": {}}}}, "extra": {}}`. `validateGenerationRequest(request)` checks the request against the task's declared inputs and limits: it refuses an asset in an input the task does not declare, fewer assets in an input than the input's `min`, an asset whose media type (read with `dvAssetPool.mediaType`) its input does not declare, and more assets in an input than the limits allow. It then checks `extra`: names the task does not take are refused in one sentence that lists the task's extra parameters, and the values of known names are checked against their schema with `validateArgs` of `@deepseek-ai/dsh-tools`. A task that declares `promptProblems` also checks the prompt against the model's own prompt rules: `fasth3` refuses a request with a first frame that the prompt does not cite as `dv:input/first_frame`, because H3 takes an image as the first frame only when the prompt says so. Each problem is one sentence. `render(request, signal)` reads the MIME type and bytes of each input asset ID from `dvAssetPool` and submits one job to the task's server with the task's job task name, the frame size and count, the seed, and the references in input order with the first frame after them, each as an image `data:` URL. It waits until the job completes and passes `signal` on to stop waiting; the server finishes a job that has started. It then yields `video_start` with MIME type `video/mp4`, the whole MP4 as one `chunk`, the last frame that `dvFfmpeg` decodes from the MP4 as `last_frame`, and `done` with the client's timings. Before it sends the prompt, `render` replaces each citation of a reference (`@[<label>](dv:asset/<AssetId>)`, read with `parsePromptCitations` of `@dv/project`) or of the first frame (`dv:input/first_frame`) with the label that the served model gives that medium. The `assignReferenceLabels` of the task in `SERVED` receives the media of the request with their media types, in the order the server receives them, the references in input order and then the first frame, and returns one label per medium, or null for a medium that the model does not name. `assignFasth3ReferenceLabels` labels the k-th image `<Picture k>`, so the first frame is the image after the reference images. A citation without a label becomes its own label. Each entry registers through `ctx.effect` and carries the prompt skill of its task as `promptSkill`, with the text of the skill file as `content`. The catalog registers that skill while the entry lives and the skill registry is mounted, so the skill leaves when the plugin or the registry is removed.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`, `inject`, `Config`, `apply`, the `SERVED` table, the config check, and the catalog entry of one model and task |
| [`src/types.ts`](src/types.ts) | `ServedTask`, what one served model accepts for one task, `ServedFacts`, its facts, and the input types it uses |
| [`src/reference-labels.ts`](src/reference-labels.ts) | `AssignReferenceLabels`, the type of the function that assigns a model's labels to references, and `modelPrompt`, which replaces each citation of a reference with its label |
| [`src/fasth3.ts`](src/fasth3.ts) | `FASTH3`, the tasks that the plugin serves MiniMax H3 for with their facts, and `assignFasth3ReferenceLabels`, which assigns the reference labels of MiniMax H3 |
| [`skills/fasth3-reference-prompting.md`](skills/fasth3-reference-prompting.md) | The skill body for `fasth3` for task `ref2v`: the DreamVerse connection section, then the official MiniMax-H3 full-reference prompt guide copied unchanged |
| [`skills/fasth3-text-prompting.md`](skills/fasth3-text-prompting.md) | The skill body for `fasth3` for task `t2v`: the DreamVerse connection section, then the official MiniMax-H3 prompt guide (T2VA / I2VA / FL2VA / L2VA) copied unchanged |
| [`tests/fastvideo.spec.ts`](tests/fastvideo.spec.ts) | A Loader composition with the skill registry, Project, ffmpeg, the asset pool and the catalog against one fake video job server per task; an opt-in test renders against the server named by `DV_FASTVIDEO_TEST_URL` |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/models`](../models/README.md): the model catalog this plugin registers into.
- [`@dv/shot-render`](../shot-render/README.md): the consumer, with the tool `dv_shot_render`.
- [`@dv/fastvideo-generation-client`](../fastvideo-generation-client/README.md): the video job client.
- [`dsh-tool-skill`](../../skill/tool-skill/README.md): how the agent sees the skill catalog and loads a skill.

-----

<a id="model-experience"></a>
## Model Experience

### Prompt skill for task ref2v

#### What the model sees

While the skill registry is mounted and `fasth3` is configured for task `ref2v`, the skill catalog that `dsh-tool-skill` renders lists the catalog entry below. When the agent calls the `skill` tool with `fasth3-reference-prompting`, the tool result carries `skills/fasth3-reference-prompting.md`: a DreamVerse connection section for a shot with model `fasth3` for task `ref2v` (one DreamVerse shot is one target video; the six rewrite sections form the `prompt`; reference images only, numbered `<Picture N>` in reference order; reference images cited as `@[<label>](dv:asset/<AssetId>)`, which the plugin replaces with their `<Picture N>`, and the first frame cited as `@[首帧](dv:input/first_frame)`, which the plugin replaces with the next `<Picture N>`; the guide's `<Video N>` and `<Audio N>` left unused; at least one reference image; at most 8 images plus the first frame; `duration_sec` from 5 to 15), followed by the official MiniMax-H3 full-reference prompt guide `VIDEO_PROMPT_WRITING_GUIDE_ref_en.md` copied unchanged. Users cannot invoke the skill with `/fasth3-reference-prompting`; only the agent loads it.

##### Catalog entry

```markdown
- `fasth3-reference-prompting`: Model limits and prompt rules for model fasth3 for task ref2v: reference images, how the prompt names them, and how a shot continues the previous one.
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

The `dv_models_list` results of `@dv/models` list each configured entry with its key (modality `video`, task, provider `fastvideo`, model `fasth3`) and its description: for task `ref2v`, "MiniMax H3 served as FastH3 Ref2VA: video with sound, dialogue and music written in the prompt, from reference images and an optional first frame. Keeps a face, place or style the same across shots through the references, and continues a shot from the previous shot's last still. Needs at least one reference image."; for task `t2v`, "MiniMax H3 served as FastH3 8-Step V2: video with sound, dialogue and music written in the prompt, from the prompt alone. A subject keeps its look only as far as the same words describe it, and no shot starts from an earlier shot's last still; a face that must stay the same needs fasth3 for task ref2v.". The schema that this plugin derives from its facts appears in `dv_models_get` results: the allowed durations, aspect ratios and resolutions, and for task `ref2v` the input counts and media types. The facts of the served task appear in the results and refusals of `dv_shot_render`: the server's model ID (`model_id`), the frame size and frame count, the allowed aspect ratios, resolutions and durations, and the GPU estimate from `gpuSecondsPerVideoSecond`.

#### Token effect

About 60 tokens for each entry's description in a `dv_models_list` result, and about 80 tokens for the `ref2v` schema in a `dv_models_get` result. A `dv_shot_render` refusal of a request that `validateGenerationRequest` rejects carries this package's problem sentences, about 15 to 25 tokens each, such as "Its reference input needs at least 1 of type image; this shot has 0." or "fasth3 has no extra parameter `cfg` for task ref2v; its extra parameters: none."; the rest of the results and refusals come from `@dv/models` and `@dv/shot-render`.

#### KV Cache effect

The entries reach the model only through tool results, which are appended to the session, so mounting or removing the plugin leaves the cached prefix intact apart from the skill catalog change described above.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Facts fixed in code**: the job API reports no model facts, so `facts` and `schema` report the table in `src/fasth3.ts`; a server launched with other frame sizes or durations disagrees with `dv_models_get` and the refusals of `dv_shot_render` until the table changes, and the skills state the same 5 to 15 seconds and reference limit.
- **No reference videos or audio**: the job API reads videos and audio only from a server path or an `http` URL, so `fasth3` for task `ref2v` takes reference images only.
- **Reference aspect ratio**: `RenderModelFacts` has no field for a reference aspect ratio, so Shot render sends reference assets to the server without an aspect ratio check.
- **A stopped render keeps its GPU job**: aborting `render` stops the wait, and the server finishes the job that it has started.
- **Task t2v keeps no identity**: for task `t2v` the model sees only the prompt, so a subject keeps its look only as far as the same words describe it, and no shot starts from an earlier shot's last still; a face that must stay the same, or a shot that continues another, needs task `ref2v`.
- **Served models are fixed in code**: `SERVED` in `src/index.ts` lists the models and tasks the plugin can serve; another FastVideo model, or `fasth3` for another task, needs an entry there and its prompt skill, not only a config change.
