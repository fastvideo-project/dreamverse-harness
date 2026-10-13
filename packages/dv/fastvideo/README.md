---
description: "Company plugin of DreamVerse for video models on local FastVideo streaming_v2 servers: registers the configured model fasth3 into the dvModels catalog in modes reference (FastH3 Ref2VA) and text (FastH3 8-Step V2), with the prompt skill of each model and mode."
kind: "package-reference"
---

# @dv/fastvideo

English | [中文](README.zh.md)

## Summary

Use this package to render shots with video models on local FastVideo streaming_v2 servers. The function plugin `dv-fastvideo` is a company plugin of the [`@dv/models`](../models/README.md) catalog: it registers each model its `models` config names, in the modes the config gives a server for, one server per mode. It serves `fasth3` (MiniMax H3 as FastH3) in mode `reference` (FastH3 Ref2VA: a prompt, reference images, videos and audio, and an optional first frame) and mode `text` (FastH3 8-Step V2: a prompt only). While the DSH skill registry is mounted, it registers the prompt skill of each configured mode.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/models` and `@dv/asset-pool`, with one server per model and mode. The DreamVerse bundle mounts it as row `dv-fastvideo`, with one explicit server per mode:

```yaml
- id: dv-fastvideo
  name: '@dv/fastvideo'
  config:
    models:
      fasth3:
        reference:
          baseUrl: http://10.244.19.118:8029
          gpuSecondsPerVideoSecond: 4
        text:
          baseUrl: http://10.244.16.130:8031
          gpuSecondsPerVideoSecond: 1.5
```

| Field | Default | Meaning |
| --- | --- | --- |
| `models` | required | The models to register, by model name, and for each the modes to serve it in, by mode name; a model or mode left out is not registered |
| `models.<model>.<mode>.baseUrl` | required | HTTP base URL of the FastVideo streaming_v2 server that renders the model in the mode, such as `http://127.0.0.1:8029` |
| `models.<model>.<mode>.gpuSecondsPerVideoSecond` | required | GPU seconds per rendered video second on that server; the model declares it for the mode, for the GPU estimate before a render |

Loading fails when `models` names a model other than `fasth3`, a mode the model is not served in (`fasth3`: `reference`, `text`), or a model with no mode. While the plugin is mounted, the model list and the `model` param of `dv_shot_render` include `fasth3` with the configured modes. Mount the DSH skill registry (`@deepseek-ai/dsh-skill`) as well so that the agent can load the prompt skills.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The table `SERVED` in `src/index.ts` holds what the plugin can serve: per model its company (`local FastVideo`), its summary, and per mode the accepted inputs, the extra parameter schema, and the prompt skill. `fasth3` accepts in mode `reference` at least one `reference` asset of media type `image`, `video` or `audio` and an optional `first_frame` of media type `image`, and in mode `text` no input; neither mode takes extra parameters. The server of mode `reference` serves FastH3 Ref2VA, and the server of mode `text` serves FastH3 8-Step V2 (`FastVideo/FastVideo-FastH3-8-Step-V2`). For each configured mode the plugin creates one streaming_v2 client of `@dv/fastvideo-generation-client` in an isolated `dvFastvideoGeneration` scope, so the host gains no `dvFastvideoGeneration` service. `facts(mode)` reads `GET /v1/streamv2/capabilities` from that mode's server and reports the server's model ID, aspect ratios, resolutions, frame sizes, duration range, and frame counts. `facts` also reports `inputLimits` from the server's `max_references` and its per-media-type `max_count`. The server counts the first frame among its references, so in mode `reference` the `reference` role gets one fewer than the server's total and one fewer image than the server's image count (one fewer of each media type that `first_frame` accepts), `first_frame` gets at most one asset, and a declared media type that the server does not list gets 0; mode `text` has no input limits. Each configured mode's declaration carries its own `validateGenerationRequest(request)`, which checks the request against that mode's declared inputs and its own server's limits: it refuses an asset in a role the mode does not declare, fewer assets in a role than the role's `min`, an asset whose media type (read with `dvAssetPool.mediaType`) its role does not declare, and more assets in a role, in total or of one media type, than the mode's `inputLimits` allow, with one sentence per problem. `render(mode, request, signal)` reads the media type and bytes of each input asset ID from `dvAssetPool`, sends one `POST /v1/streamv2/generate` to the mode's server with the references in input order and the first frame after them, each as its media type and base64 bytes, asks for the server's last frame, and passes `signal` on to cancel the HTTP request. The plugin writes no reference labels: the model numbers the references itself. The model registers through `ctx.effect`, and each skill through `ctx.skills.register` inside `ctx.inject(['skills'], …)`, so the skills appear when the skill registry mounts and leave when the plugin or the registry is removed.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`, `inject`, `Config`, `apply`, the `SERVED` table, the config check, and the model entry |
| [`skills/fasth3-reference-prompting.md`](skills/fasth3-reference-prompting.md) | The skill body for `fasth3` in mode `reference`: the DreamVerse connection section, then the official MiniMax-H3 full-reference prompt guide copied unchanged |
| [`skills/fasth3-text-prompting.md`](skills/fasth3-text-prompting.md) | The skill body for `fasth3` in mode `text`: the DreamVerse connection section, then the official MiniMax-H3 prompt guide (T2VA / I2VA / FL2VA / L2VA) copied unchanged |
| [`tests/fastvideo.spec.ts`](tests/fastvideo.spec.ts) | A Loader composition with the skill registry, Project, ffmpeg, the asset pool and the catalog against one fake streaming_v2 server per mode; an opt-in test renders against the server named by `DV_FASTVIDEO_TEST_URL` |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/models`](../models/README.md): the model catalog this plugin registers into.
- [`@dv/shot-render`](../shot-render/README.md): the consumer, with the tool `dv_shot_render`.
- [`@dv/fastvideo-generation-client`](../fastvideo-generation-client/README.md): the streaming_v2 client.
- [`dsh-tool-skill`](../../skill/tool-skill/README.md): how the agent sees the skill catalog and loads a skill.

-----

<a id="model-experience"></a>
## Model Experience

### Prompt skill for mode reference

#### What the model sees

While the skill registry is mounted and `fasth3` is configured in mode `reference`, the skill catalog that `dsh-tool-skill` renders lists the catalog entry below. When the agent calls the `skill` tool with `fasth3-reference-prompting`, the tool result carries `skills/fasth3-reference-prompting.md`: a DreamVerse connection section for `dv_shot_render` with `model: fasth3, mode: reference` and for plan shots with the same model and mode (one DreamVerse shot is one target video; the six rewrite sections form the `prompt`; the model's per-type numbering `<Picture N>`, `<Video N>` and `<Audio N>` in reference order, with an extra `<Audio N>` for each video with sound and the first frame as the next `<Picture N>`; reference videos and audio used up to the shot's length; at least one reference; at most 8 images plus the first frame, 3 videos, 3 audio files and 11 references; `duration_sec` from 5 to 15), followed by the official MiniMax-H3 full-reference prompt guide `VIDEO_PROMPT_WRITING_GUIDE_ref_en.md` copied unchanged. Users cannot invoke the skill with `/fasth3-reference-prompting`; only the agent loads it.

##### Catalog entry

```markdown
- `fasth3-reference-prompting`: Model limits and prompt rules for dv_shot_render with model fasth3 in mode reference: reference images, videos and audio, how the prompt names them, and how a shot continues the previous one.
```

#### Token effect

About 40 tokens in the catalog while the mode and the skill registry are mounted, and about 6,300 tokens each time the agent loads the skill.

#### KV Cache effect

Mounting or removing the plugin changes the skill list, and `dsh-tool-skill` appends a replacement catalog; a loaded skill body is appended as a tool result. Both leave the cached prefix before them intact.

### Prompt skill for mode text

#### What the model sees

While the skill registry is mounted and `fasth3` is configured in mode `text`, the skill catalog lists the catalog entry below. When the agent calls the `skill` tool with `fasth3-text-prompting`, the tool result carries `skills/fasth3-text-prompting.md`: a DreamVerse connection section for `dv_shot_render` with `model: fasth3, mode: text` and for plan shots with the same model and mode (use the guide's T2VA mode, so the prompt begins directly with the three fields `integrated_multimodal_description`, `overall_soundscape` and `non_diegetic_music`; one DreamVerse shot is one target video; describe everything in words, and use mode `reference` for a face that must stay the same; `duration_sec` from 5 to 15), followed by the official MiniMax-H3 prompt guide `VIDEO_PROMPT_WRITING_GUIDE_base_en.md` copied unchanged. Users cannot invoke the skill with `/fasth3-text-prompting`; only the agent loads it.

##### Catalog entry

```markdown
- `fasth3-text-prompting`: Model limits and prompt rules for dv_shot_render with model fasth3 in mode text: the three prompt fields, shot changes, camera motion, speakers and dialogue, sound and music.
```

#### Token effect

About 40 tokens in the catalog while the mode and the skill registry are mounted, and about 4,200 tokens each time the agent loads the skill.

#### KV Cache effect

Mounting or removing the plugin changes the skill list, and `dsh-tool-skill` appends a replacement catalog; a loaded skill body is appended as a tool result. Both leave the cached prefix before them intact.

### Model list row and render facts

#### What the model sees

The `dv:models` section of `@dv/models` lists `fasth3` with company `local FastVideo`, the configured modes, no extra parameters, and the summary "MiniMax H3 (FastH3); video with sound, dialogue and music written in the prompt". The facts this plugin reads from the servers appear in `dv_models_get` results and in the results and refusals of `dv_shot_render`: the server's model ID (`model_id`), the frame size and frame count, the allowed aspect ratios, resolutions and durations, the reference count limits per media type in mode `reference`, and the GPU estimate from `gpuSecondsPerVideoSecond`.

#### Token effect

About 35 tokens for the model's row in the model list. A `dv_shot_render` refusal of a request that `validateGenerationRequest` rejects carries this package's problem sentences, about 15 to 25 tokens each, such as "Its reference input needs at least 1 of type image, video, audio; this shot has 0."; the rest of the results and refusals come from `@dv/models` and `@dv/shot-render`.

#### KV Cache effect

Mounting or removing the plugin registers or removes `fasth3`, which changes the `dv:models` section and the `model` param of `dv_shot_render`; the cached prefix is invalidated from the first of those two changes on.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Fixed limits in the skills**: `skills/fasth3-reference-prompting.md` states 5 to 15 seconds and the reference count limits, and `skills/fasth3-text-prompting.md` states 5 to 15 seconds, while `facts` reads the limits from the servers; a server with other limits makes a skill disagree with `dv_models_get` and the refusals of `dv_shot_render`.
- **Reference aspect ratio**: `facts` drops the server's `max_reference_aspect_ratio` because `RenderModelFacts` has no field for it, so Shot render sends reference assets to the server without an aspect ratio check.
- **Mode text keeps no identity**: in mode `text` the model sees only the prompt, so a subject keeps its look only as far as the same words describe it, and no shot starts from an earlier shot's last still; a face that must stay the same, or a shot that continues another, needs mode `reference`.
- **Served models are fixed in code**: `SERVED` in `src/index.ts` lists the models and modes the plugin can serve; another FastVideo model, or `fasth3` in another mode, needs an entry there and its prompt skill, not only a config change.
