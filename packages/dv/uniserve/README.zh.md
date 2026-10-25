---
description: "DreamVerse 的提供方插件 uniserve，面向 UniServe 服务器上的视频模型：把配置的模型 fasth3 以任务 ref2v（FastH3 Omni 8-Step V1）注册进 dvModels 模型目录，沿用 @dv/fastvideo 为 fasth3 声明的输入、请求校验和提示词 skill，并用一个 POST /v1/videos/sync 渲染每个镜头。"
kind: "package-reference"
---

# @dv/uniserve

[English](README.md) | 中文

## 概述

用本包在 UniServe 服务器上用视频模型渲染镜头。函数插件 `dv-uniserve` 是 [`@dv/models`](../models/README.zh.md) 模型目录的 provider `uniserve`：它为 `models` 配置列出的每个模型、以及配置为其提供了服务器的每个任务注册一个目录条目，每个任务一台服务器。它为任务 `ref2v` 提供 `fasth3`（以 FastH3 Omni 8-Step V1 形式提供的 MiniMax H3，checkpoint `FastVideo/FastVideo-FastH3-Omni-8-Step-V1`），所用的输入、参考标签、提示词规则和提示词 skill 都是 [`@dv/fastvideo`](../fastvideo/README.zh.md) 为 `fasth3` 声明的。[`@dv/shot-render`](../shot-render/README.zh.md) 的工具 `dv_shot_render` 用这些条目渲染。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/models`、`@dv/asset-pool` 和 `@dv/ffmpeg` 之后挂载本插件，每个模型和任务一台服务器。DreamVerse bundle 以行 `dv-uniserve` 挂载它，与行 `dv-fastvideo` 并列，所以模型目录里有两个提供方各自的 `fasth3` 任务 `ref2v` 条目：

```yaml
- id: dv-uniserve
  name: '@dv/uniserve'
  config:
    models:
      fasth3:
        ref2v:
          baseUrl: http://10.244.8.35:8000
          gpuSecondsPerVideoSecond: 1.3
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `models` | 必填 | 要注册的模型（按模型名），以及每个模型要提供的任务（按任务 ID）；未列出的模型或任务不注册 |
| `models.<model>.<task>.baseUrl` | 必填 | 为该任务渲染该模型的 UniServe 服务器的 HTTP 基础 URL，例如 `http://127.0.0.1:8000` |
| `models.<model>.<task>.gpuSecondsPerVideoSecond` | 必填 | 该服务器上每渲染一秒视频的 GPU 秒数；该模型与任务的条目声明它，用于渲染前的 GPU 估算 |

`models` 列出 `fasth3` 以外的模型、该模型不提供的任务（`fasth3`：`ref2v`）或没有任务的模型时，加载失败。插件挂载期间，模型目录里有条目 `video/ref2v/uniserve/fasth3`。用 UniServe 的 `-reference` 部署启动服务器，它提供任务 `ref2va`；[UniServe 服务指南](https://github.com/hao-ai-lab/uniserve/blob/main/docs/minimax_h3/minimax_h3.md#deployments)列出了这些部署。同时挂载 DSH skill 注册表（`@deepseek-ai/dsh-skill`），agent 才能加载提示词 skill。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`apply` 用 `@dv/fastvideo/served-task` 的 `registerServedModels` 检查配置并注册条目。`src/index.ts` 中的表 `SERVED` 把任务 `ref2v` 下的 `fasth3` 映射到 `@dv/fastvideo/fasth3` 的 `FASTH3_REF2V`（带自己的描述）和 UniServe 的任务 `ref2va`。`facts()` 每个条目只读一次 `GET /v1/capabilities`（第一次成功的调用），服务器未列出任务 `ref2va` 时拒绝。它把所服务的模型名报告为模型 ID，并报告服务器的宽高比、每个短边一个名为 `<edge>p` 的分辨率（例如 `768p`）、每对组合的画面尺寸，以及从服务器 `min_seconds` 到 `max_seconds` 的整秒时长和 UniServe 对每个时长的帧数：`duration × fps` 向上取到下一个 `min_frames + n × clip_frames`，所以 5 秒是 124 帧。输入上限来自 capabilities 的 `ref2va` 条件：跨媒体类型的 `max_references`，以及每种媒体类型的 `max_images`、`max_videos` 和 `max_audios`。`schema()` 和 `validateGenerationRequest` 与 `@dv/fastvideo` 对 `fasth3` 的相同，经由 `@dv/fastvideo/served-task` 的 `servedTaskSchema` 和 `servedTaskProblems`：首帧占服务器上限中的一个参考和一张图片，带首帧但提示词没有引用首帧的请求被拒绝。`render(request, signal)` 发送一个 `POST /v1/videos/sync`，带所服务的模型名、任务 `ref2va`、每个参考引用都换成其 `fasth3` 标签的提示词（`@dv/fastvideo/reference-labels` 的 `modelPrompt`）、每个资产一个角色为 `reference` 的条件（参考按输入顺序在前，首帧在后，每个都带媒体类型和由 `dvAssetPool` 中的 MIME 类型与字节组成的 `data:` URI）、短边和宽高比对应所请求画面尺寸且 `duration_seconds` 为所请求帧数对应时长的 `target`，以及种子。`signal` 取消 HTTP 请求。服务器以完整的 MP4 应答。条目把它写入临时目录，用 `dvFfmpeg` 读取其最后一帧为 PNG，删除该目录，然后依次产出 `last_frame`、带应答媒体类型的 `video_start`、一个装着该 MP4 的 `chunk` 和 `done`。`done` 的耗时是来自 `x-inference-time-s` 头的 `inference_s`，以及 `x-stage-durations` 头中每个阶段的 `<stage>_s`；不是有限数的值被略去。错误应答变成其 JSON 正文的 `error.message`，否则是原样的正文。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`、`inject`、`Config`、`apply`、表 `SERVED`、capabilities 和渲染调用，以及单个模型与任务的目录条目 |
| [`tests/uniserve.spec.ts`](tests/uniserve.spec.ts) | 用 Loader 组装 skill 注册表、Project、ffmpeg、资产池和模型目录，对接一台假的 UniServe 服务器，它以运行中服务器的 capabilities、一个 MP4 及其耗时头应答；一个可选测试对 `DV_UNISERVE_TEST_URL` 指定的服务器做真实渲染 |

用 `DV_UNISERVE_TEST_URL=http://10.244.8.35:8000 pnpm exec vitest run packages/dv/uniserve/tests` 运行可选测试，它渲染一个 5 秒镜头。

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/models`](../models/README.zh.md)：本插件注册进的模型目录。
- [`@dv/shot-render`](../shot-render/README.zh.md)：使用方，提供工具 `dv_shot_render`。
- [`@dv/fastvideo`](../fastvideo/README.zh.md)：本插件沿用的 `fasth3` 输入、标签、请求检查和提示词 skill。
- [UniServe 服务指南](https://github.com/hao-ai-lab/uniserve/blob/main/docs/minimax_h3/minimax_h3.md)：服务器、它的部署和 `/v1/videos` API。

-----

<a id="model-experience"></a>
## 模型体验

### 模型目录条目和拒绝

#### 模型看到什么

`@dv/models` 的 `dv_models_list` 结果列出该条目的键（模态 `video`、任务 `ref2v`、provider `uniserve`、模型 `fasth3`）、下面的描述和提示词 skill `fasth3-reference-prompting`，即 [`@dv/fastvideo` 模型体验](../fastvideo/README.zh.md#model-experience)中的 skill。`dv_models_get` 再加上下面的 schema，它读自一台支持 12 个参考、9 张图片、3 个视频和 3 个音频文件的服务器。`validateGenerationRequest` 的问题句与 `@dv/fastvideo` 对 `fasth3` 的相同，例如 "Its reference input needs at least 1 of type image, video, audio; this shot has 0."。`facts()` 或 `schema()` 的拒绝在拒绝消息中跟在 `Model video/ref2v/uniserve/fasth3 is unavailable: ` 之后，渲染失败则以其消息让记录和工具调用失败。

##### Entry description

```markdown
MiniMax H3 served as FastH3 Omni 8-Step V1 on UniServe: video with sound, dialogue and music written in the prompt, from reference images, videos and audio and an optional first frame. Keeps a face, place or style the same across shots through the references, and continues a shot from the previous shot's last still. Needs at least one reference.
```

##### Schema

```markdown
{"duration_sec":{"min":4,"max":15},"aspect_ratios":["16:9","9:16"],"resolutions":["768p","480p"],"inputs":{"reference":{"min":1,"max":11,"media_types":{"image":{"max":8},"video":{"max":3},"audio":{"max":3}}},"first_frame":{"min":0,"max":1,"media_types":{"image":{}}}},"extra":{}}
```

##### Server rejections

```markdown
The server at <baseUrl> serves task <served tasks, comma-separated, or none>, not ref2va; the dv-uniserve config points model "fasth3" for task "ref2v" at the wrong server.
The server at <baseUrl> cannot be reached.
The server at <baseUrl> answered GET /v1/capabilities with HTTP <status>: <server text>
The server at <baseUrl> answered POST /v1/videos/sync with HTTP <status>: <server text>
```

#### Token 影响

条目在 `dv_models_list` 结果中约 65 个 token，schema 在 `dv_models_get` 结果中约 100 个 token。每个问题句在拒绝消息中约 15 到 25 个 token。

#### KV Cache 影响

条目只经由工具结果到达模型，而工具结果追加在会话末尾。与 `@dv/fastvideo` 并列时，挂载或移除本插件不改变 skill 目录，因为两个条目携带同一个提示词 skill；没有 `@dv/fastvideo` 时，挂载或移除本插件按 [`@dv/fastvideo` KV Cache 影响](../fastvideo/README.zh.md#model-experience)所述改变 skill 列表。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **两个提供方共用一个提示词 skill**：`dv-fastvideo` 和 `dv-uniserve` 为 `fasth3` 任务 `ref2v` 注册的条目携带同名 skill，skill 注册表保留第一次注册，并以一条警告忽略第二次。移除先注册的那个插件会移除该 skill，而另一个条目仍留在模型目录中。
- **视频整段到达**：`POST /v1/videos/sync` 要等服务器编码完整个 MP4 才应答，所以 `dv_shot_render` 的实时流在渲染结束时以一个分块收到视频。
- **首帧是被引用的参考**：条目像 `@dv/fastvideo` 一样把首帧作为参考图片之后的那张图片发送，不使用 UniServe 的关键帧条件（`role: keyframe`、`frame_index: 0`）。
- **skill 中写死的上限**：共用的 skill 写的是 FastVideo 服务器的 5 到 15 秒和参考数量上限，而 `facts` 和 `schema` 从 UniServe 服务器读出 4 到 15 秒及其上限。
- **所服务的模型写在代码里**：`src/index.ts` 中的 `SERVED` 列出本插件能提供的模型和任务；另一个 UniServe 模型，或任务 `t2v` 下的 `fasth3`，需要在那里加一项，仅改配置不够。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
