---
description: "DreamVerse 的 profile 层：模型目录及其 FastVideo 模型、各组件、对话引用、API、界面插件、video-directing skill 以及模型路由，叠在 dsh-base 加 dsh-web-app 或 dsh-headless 之上。"
kind: "package-bundle"
---

# @dv/bundle

[English](README.md) | 中文

DreamVerse 预设还会扫描 `$DSH_HOME/dreamverse-skills`（默认 `~/.dsh/dreamverse-skills`），这是技能页面和 `@dv/api` 管理的持久上传目录。预设保持 `includeDefaultRoots: false`，并在内置 `video-directing` 目录前列出此目录。

## 概要

用这个 bundle 把 DreamVerse 作为一个 `dsh` profile 运行。它插入模型目录 `@dv/models`、提供方插件 `@dv/fastvideo` 和 `@dv/uniserve`（`fasth3`）、`@dv/sglang-diffusion`（`qwen-image-2.1-turbo`，生成任务 `t2i`）与 `@dv/sglang-omni`（`fish-audio-drama-3`，生成任务 `t2a`）、DreamVerse 各组件及 `@dv/ffmpeg`、故事工作流 `@dv/workflow-story`、对话引用、API 和 `@dv/ui-*` 界面插件；为两处 `skill-filesystem` 行提供 `video-directing` skill；把 `deepseek-local` 路由到集群 SGLang 服务器；并从环境变量选择智能体模型。`scripts/video-harness/setup-profile.sh` 把它叠在 `dsh-base` 加 `dsh-web-app` 上成为 profile `video-harness`，叠在 `dsh-base` 加 `dsh-headless` 上成为 `video-harness-headless`；`scripts/video-harness/launch.sh web|headless` 从源码运行二者之一。

## 目录

- [使用这个包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用这个包

```sh
scripts/video-harness/launch.sh web --trusted-host <public host>   # chat page on DV_PORT (default 8092)
scripts/video-harness/launch.sh headless "给我一个这个人跳舞的视频" --session-id demo   # one task, printed result
```

patch 读取的环境变量：`DV_PROJECTS_FOLDER`（存放新对话和新项目文件夹的 DreamVerse 文件夹；未设置时 `@dv/project` 使用 `<Documents>/deepseek-harness/DreamVerse`，在没有文档文件夹的主机上启动失败）、`DV_FFMPEG`、`DV_FFPROBE`、`DV_PUBLIC_URL`（聊天卡片里素材链接的来源）、`DV_AGENT_PROVIDER` 与 `DV_AGENT_MODEL`（默认 `deepseek-local` / `deepseek-v4.1`；备选 `groq` / `qwen/qwen3.8-27b`）、`DV_AGENT_REASONING`（默认 `low`）、`DV_DEEPSEEK_BASE_URL`（OpenAI 兼容的 SGLang 端点；启动脚本默认为 `http://10.244.6.153:30000/v1`）、`DV_DEEPSEEK_API_KEY`（服务器无需密钥，但 pi-ai 的 OpenAI 路由坚持要一个 bearer token，启动脚本导出 `none`）、`DV_AGENT_VISION`（`0` 让 `inspect.image` 报告不支持图片而不调用模型），以及启动脚本从 `DV_ENV_FILE` 读入的备选密钥 `GROQ_API_KEY`。

聊天输入框显示 [`ui-model-selection`](../../client/ui-model-selection/README.zh.md) 提供的操作智能体模型和推理强度选择器。`agent-default-model` 设置初始路由；会话中的选择从下一次请求生效，不改变正在执行的请求。该控件选择操作智能体使用的大语言模型。生成模型仍通过 DreamVerse 模型目录单独选择。

<a id="understand-the-implementation"></a>
## 理解实现

`dv-minimax-skills` 与 `dv-ui-minimax-skills` 两行挂载 [`@dv/minimax-skills`](../../dv/minimax-skills/README.zh.md)（九个 MiniMax H3 技能及其引用读取和预览 GIF）与 [`@dv/ui-minimax-skills`](../../dv/ui-minimax-skills/README.zh.md)（对应的首页模板卡片）。

[`cordis.patch.yml`](cordis.patch.yml) 有一个 `insert` 列表放 DreamVerse 的行，和三处覆盖。`dv-models` 行不带配置地挂载模型目录；`dv-fastvideo` 行为 `fasth3` 的每个生成任务写明一个 FastVideo 服务器：生成任务 `ref2v` 在 `http://127.0.0.1:8029` 上，带 FastH3 Ref2VA 模型事实；生成任务 `t2v` 在 `http://127.0.0.1:8031` 上，带 FastH3 T2VA 模型事实，其画面尺寸和帧数与 Ref2VA 相同，且不接受参考。`dv-fastvideo` 行为 `disabled: true`，所以默认部署不挂载它，也没有生成任务 `t2v` 的 `fasth3` 条目；部署在自己的 profile patch 里把该行设为 `disabled: false`，并把 URL 和模型事实换成自己服务器的，即可挂载它。其后的 `dv-uniserve` 行在 UniServe 服务器 `http://10.244.8.35:8000` 上为生成任务 `ref2v` 提供 `fasth3`，所以模型目录列出 `video/ref2v/uniserve/fasth3`。`dv-sglang-diffusion` 行在同一台机器的服务器 `http://127.0.0.1:30010` 上服务 `qwen-image-2.1-turbo`；其后的 `dv-image-generate` 行挂载工具 `dv_image_generate`。`dv-sglang-omni` 行在 `http://127.0.0.1:8000` 上为任务 `t2a` 提供 `fish-audio-drama-3`；该模型注册期间，`dv-audio-generate` 行加上 `dv_audio_generate`。使用其他服务器的部署在自己的 profile patch 里替换这些行的配置。三处覆盖是：`skill-filesystem`（skill 目录，其中是 `video-directing`；`video-model-selection`、视频模型的 prompt skill、`character`、`location`、`style` 和 `timeline-editing` 由各自的插件通过 `ctx.skills` 注册，`@dv/workflow-story` 提供 `packages/dv/workflow-story/skills/` 中的工作流 skill）、`llm-pi-ai`（手工声明的 `deepseek-local` 路由：`DV_DEEPSEEK_BASE_URL` 上的 `openai-completions`，唯一模型 `deepseek-v4.1` 声明为文本加图片输入，并设 `compat.supportsDeveloperRole: false`，使 pi-ai 以 `system` 角色发送系统提示词，SGLang 在不带工具的请求中也保留它；另有 Groq 路由）、`agent-default-model`（来自环境变量的 provider、model 和推理强度）。不包含 web server 行：web profile 的页面来自 `dsh-web-app`，`dvAssetPool` 在那个服务器上注册 `/dv/assets`。[`tests/composition.spec.ts`](tests/composition.spec.ts) 经 Loader 启动补丁里的行（带它们的 `!!js` 配置和 `disabled` 标志，视频模型后端换成假实现，且不调用图片或语音服务器），并把一次模型工具调用变成一条记录。[`tests/skills.spec.ts`](tests/skills.spec.ts) 带上 skill 注册表启动同样的行。对 `packages/dv/workflow-story/skills/` 中的每个工作流 skill，它检查 bundle 注册了该 skill 提到的每个工具，并把目录行和加载的正文与 `tests/expected/skills/<name>.txt` 比较。

<a id="further-exploration"></a>
## 延伸阅读

- [DreamVerse 各包](../../../docs/subsystems/video-harness.zh.md)
- [`@dv/models`](../../dv/models/README.zh.md)
- [`@dv/fastvideo`](../../dv/fastvideo/README.zh.md)
- [`@dv/uniserve`](../../dv/uniserve/README.zh.md)
- [`@dv/sglang-diffusion`](../../dv/sglang-diffusion/README.zh.md)
- [`@dv/image-generate`](../../dv/image-generate/README.zh.md)
- [`@dv/sglang-omni`](../../dv/sglang-omni/README.zh.md)
- [`@dv/audio-generate`](../../dv/audio-generate/README.zh.md)
- [`@dv/chat-references`](../../dv/chat-references/README.zh.md)
- [`@dv/api`](../../dv/api/README.zh.md)

<a id="model-experience"></a>
## 模型体验

间接地，通过 bundle 挂载的工具、`@dv/project` 的 `dv:project` 提示词段落、项目状态消息和项目更新消息、`@dv/chat-references` 的提及上下文和 skill；bundle 本身不添加模型可见的文本。

#### KV Cache 影响

本身没有；挂载的插件各自说明。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- ffmpeg 的默认路径是本机的原生构建；其他机器必须设置 `DV_FFMPEG`。
- `deepseek-local` 路由的图片支持只是声明，harness 不做验证；纯文本服务器要设 `DV_AGENT_VISION=0`，否则 `read_image` 在运行时失败。
- SGLang 服务器接受任意 `model` 字符串，所以目录 id `deepseek-v4.1` 原样发送；它的 `/v1/models` 列表里的名字是 `deepseek-ai/DeepSeek-V4.1-Flash`。
