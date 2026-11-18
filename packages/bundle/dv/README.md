---
description: "The DreamVerse profile layer: the model catalog and its FastVideo models, the components, the chat references, the API, the interface plugins, the video-directing skill, and the model routes, stacked on dsh-base and dsh-web-app or dsh-headless."
kind: "package-bundle"
---

# @dv/bundle

English | [中文](README.zh.md)

## Summary

Use this bundle to run DreamVerse as a `dsh` profile. It inserts the model catalog `@dv/models`, the provider plugins `@dv/fastvideo` and `@dv/uniserve` (`fasth3`), `@dv/sglang-diffusion` (`qwen-image-2.1-turbo`, task `t2i`) and `@dv/sglang-omni` (`fish-audio-drama-3`, task `t2a`), the DreamVerse components with `@dv/ffmpeg`, the story workflow `@dv/workflow-story`, the chat references, the API and the `@dv/ui-*` interface plugins; ships the `video-directing` skill for both `skill-filesystem` rows; routes `deepseek-local` to the cluster's SGLang server; and selects the agent model from the environment. `scripts/video-harness/setup-profile.sh` stacks it on `dsh-base` plus `dsh-web-app` as profile `video-harness` and on `dsh-base` plus `dsh-headless` as `video-harness-headless`; `scripts/video-harness/launch.sh web|headless` runs either from source.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

```sh
scripts/video-harness/launch.sh web --trusted-host <public host>   # chat page on DV_PORT (default 8092)
scripts/video-harness/launch.sh headless "给我一个这个人跳舞的视频" --session-id demo   # one task, printed result
```

Environment the patch reads: `DV_PROJECTS_FOLDER` (the DreamVerse folder that holds the folders of new chats and projects; unset, `@dv/project` uses `<Documents>/deepseek-harness/DreamVerse` and fails to start on a host without a Documents folder), `DV_FFMPEG`, `DV_FFPROBE`, `DV_PUBLIC_URL` (origin for asset links in chat cards), `DV_AGENT_PROVIDER` and `DV_AGENT_MODEL` (default `deepseek-local` / `deepseek-v4.1`; fallback `groq` / `qwen/qwen3.8-27b`), `DV_AGENT_REASONING` (default `low`), `DV_DEEPSEEK_BASE_URL` (the OpenAI-compatible SGLang endpoint; the launch script defaults it to `http://10.244.6.153:30000/v1`), `DV_DEEPSEEK_API_KEY` (the launch script exports `none` for the keyless server, because pi-ai's OpenAI route insists on a bearer token), `DV_AGENT_VISION` (`0` makes `inspect.image` report that images are unsupported instead of calling the model), and the fallback key `GROQ_API_KEY`, which the launch script sources from `DV_ENV_FILE`.

The chat composer exposes the operator model and reasoning-effort picker from [`ui-model-selection`](../../client/ui-model-selection/README.md). `agent-default-model` sets the initial route; a session selection applies to its next request without changing an in-flight request. This control selects the operator LLM. Generation models remain selected separately through the DreamVerse model catalog.

<a id="understand-the-implementation"></a>
## Understand the implementation

[`cordis.patch.yml`](cordis.patch.yml) has one `insert` list for the DreamVerse rows and three overrides. The `dv-models` row mounts the model catalog without configuration; the `dv-fastvideo` row names one FastVideo server per task of `fasth3`, `ref2v` on `http://127.0.0.1:8029` with the FastH3 Ref2VA model facts and `t2v` on `http://127.0.0.1:8031` with the FastH3 T2VA model facts, which share the canvas sizes and frame counts of Ref2VA and take no reference. The `dv-fastvideo` row is `disabled: true`, so a default deployment does not mount it and has no `fasth3` entry for task `t2v`; a deployment sets `disabled: false` on that row in its profile patch and replaces the URLs and model facts with its servers' own to mount it. The `dv-uniserve` row after it serves `fasth3` for task `ref2v` on the UniServe server `http://10.244.8.35:8000`, so the catalog lists `video/ref2v/uniserve/fasth3`. The `dv-sglang-diffusion` row serves `qwen-image-2.1-turbo` on `http://127.0.0.1:30010`, a server on the same machine, and the `dv-image-generate` row after it mounts the tool `dv_image_generate`. The `dv-sglang-omni` row serves `fish-audio-drama-3` for task `t2a` on `http://127.0.0.1:8000`, and the `dv-audio-generate` row adds `dv_audio_generate` while that model is registered. A deployment with other servers replaces these rows' config in its profile patch. The overrides are: `skill-filesystem` (the skills directory, which holds `video-directing`; `video-model-selection`, the prompt skills of the video models, `character`, `location`, `style` and `timeline-editing` are registered by their own plugins through `ctx.skills`, and `@dv/workflow-story` serves the workflow skills of `packages/dv/workflow-story/skills/`), `llm-pi-ai` (the hand-declared `deepseek-local` route: `openai-completions` at `DV_DEEPSEEK_BASE_URL` with one model `deepseek-v4.1` declared as text and image input, and `compat.supportsDeveloperRole: false`, so pi-ai sends the system prompt as role `system`, which SGLang keeps also in a request without tools; plus the Groq route), and `agent-default-model` (provider, model, and reasoning effort from the environment). No web server row is included: the web profile takes its page from `dsh-web-app`, and `dvAssetPool` registers `/dv/assets` on that server. [`tests/composition.spec.ts`](tests/composition.spec.ts) boots the rows of the patch through the Loader, with their `!!js` configuration and `disabled` flags and with fakes in place of the video model backends and without a call to the image or speech server, and turns a model tool call into a record. [`tests/skills.spec.ts`](tests/skills.spec.ts) boots the same rows with the skill registry. For each workflow skill of `packages/dv/workflow-story/skills/`, it checks that the bundle registers every tool the skill names, and it compares the catalog line and the loaded body with `tests/expected/skills/<name>.txt`.

<a id="further-exploration"></a>
## Further Exploration

- [DreamVerse packages](../../../docs/subsystems/video-harness.md)
- [`@dv/models`](../../dv/models/README.md)
- [`@dv/fastvideo`](../../dv/fastvideo/README.md)
- [`@dv/uniserve`](../../dv/uniserve/README.md)
- [`@dv/sglang-diffusion`](../../dv/sglang-diffusion/README.md)
- [`@dv/image-generate`](../../dv/image-generate/README.md)
- [`@dv/sglang-omni`](../../dv/sglang-omni/README.md)
- [`@dv/audio-generate`](../../dv/audio-generate/README.md)
- [`@dv/chat-references`](../../dv/chat-references/README.md)
- [`@dv/api`](../../dv/api/README.md)

<a id="model-experience"></a>
## Model Experience

Indirectly, through the tools, the `dv:project` prompt section and the project state and update messages of `@dv/project`, the mention context of `@dv/chat-references`, and the skills the bundle mounts; the bundle itself adds no model-visible text.

#### KV Cache effect

None of its own; the mounted plugins describe theirs.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The ffmpeg default path is this host's native build; other machines must set `DV_FFMPEG`.
- The `deepseek-local` route's image support is declared, not verified by the harness; set `DV_AGENT_VISION=0` for a text-only server, otherwise `read_image` fails at run time.
- The SGLang server accepts any `model` string, so the catalog id `deepseek-v4.1` is sent as-is; its `/v1/models` listing names `deepseek-ai/DeepSeek-V4.1-Flash`.
