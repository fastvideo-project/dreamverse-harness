---
description: "DreamVerse 的提供方插件 uniserve，面向 UniServe 服务器上以 FastH3 Omni 8-Step V1 形式提供的 MiniMax H3：把模型 fasth3 的任务 ref2v 条目注册进 dvModels 模型目录，带自己的输入上限、请求校验、参考标签和提示词 skill，并用一个 POST /v1/videos/sync 渲染每个镜头。"
kind: "package-reference"
---

# @dv/uniserve

[English](README.md) | 中文

## 概述

用本包在 UniServe 服务器上用 MiniMax H3 渲染镜头。函数插件 `dv-uniserve` 是 [`@dv/models`](../models/README.zh.md) 模型目录的 provider `uniserve`：它为任务 `ref2v` 注册模型 `fasth3`（FastH3 Omni 8-Step V1，checkpoint `FastVideo/FastVideo-FastH3-Omni-8-Step-V1`），带自己的输入上限、请求检查、参考标签和提示词 skill。[`@dv/shot-render`](../shot-render/README.zh.md) 的工具 `dv_shot_render` 用该条目渲染。

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

在 `@dv/models`、`@dv/asset-pool` 和 `@dv/ffmpeg` 之后挂载本插件，并写明渲染镜头的 UniServe 服务器。DreamVerse bundle 以行 `dv-uniserve` 挂载它，并禁用行 `dv-fastvideo`，所以模型目录里只有一个 `fasth3` 任务 `ref2v` 条目：

```yaml
- id: dv-uniserve
  name: '@dv/uniserve'
  config:
    baseUrl: http://10.244.8.35:8000
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `baseUrl` | 必填 | 提供任务 `ref2va` 的 UniServe 服务器的 HTTP 基础 URL，例如 `http://127.0.0.1:8000` |

插件挂载期间，模型目录里有条目 `video/ref2v/uniserve/fasth3`。用 UniServe 的 `-reference` 部署启动服务器，它提供任务 `ref2va`；[UniServe 服务指南](https://github.com/hao-ai-lab/uniserve/blob/main/docs/minimax_h3/minimax_h3.md#deployments)列出了这些部署。同时挂载 DSH skill 注册表（`@deepseek-ai/dsh-skill`），agent 才能加载提示词 skill。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`apply` 用 `ctx.effect` 注册一个条目。`facts()` 只读一次 `GET /v1/capabilities`（第一次成功的调用），服务器未列出任务 `ref2va` 时拒绝。它把所服务的模型名报告为模型 ID，并报告服务器的宽高比、每个短边一个名为 `<edge>p` 的分辨率（例如 `768p`）、每对组合的画面尺寸，以及从服务器 `min_seconds` 到 `max_seconds` 的整秒时长和 UniServe 对每个时长的帧数：`duration × fps` 向上取到下一个 `min_frames + n × clip_frames`，所以 5 秒是 124 帧。模型的规则在 `src/fasth3-omni.ts` 中。`reference` 输入至少需要一张图片、一个视频或一个音频文件。UniServe 把首帧算作多一张参考图片，所以 `reference` 输入总数比 `max_references` 少一个、图片比 `max_images` 少一张，视频最多 `max_videos` 个，音频文件最多 `max_audios` 个。可选的 `first_frame` 输入接受一张图片，提示词必须引用它。条目不接受 `extra` 参数。`render(request, signal)` 发送一个 `POST /v1/videos/sync`，带所服务的模型名、任务 `ref2va`、每个资产一个角色为 `reference` 的条件（参考按输入顺序在前，首帧在后，每个都带媒体类型和由 `dvAssetPool` 中的 MIME 类型与字节组成的 `data:` URI）、短边和宽高比对应所请求画面尺寸且 `duration_seconds` 为所请求帧数对应时长的 `target`，以及种子。提示词按服务器接收媒体的顺序为每种媒体类型各用一个计数器：第 n 张图片是 `<Picture n>`，第 n 个视频是 `<Video n>`，第 n 个音频文件是 `<Audio n>`，带声音的视频的音轨在该视频之前占用下一个音频编号。每个对参考或首帧的引用变成其媒体的标签；其他引用变成引用自身的标签。`signal` 取消 HTTP 请求。服务器以完整的 MP4 应答。条目把它写入临时目录，用 `dvFfmpeg` 读取其最后一帧为 PNG，删除该目录，然后依次产出 `last_frame`、带应答媒体类型的 `video_start`、一个装着该 MP4 的 `chunk` 和 `done`。`done` 的耗时是来自 `x-inference-time-s` 头的 `inference_s`，以及 `x-stage-durations` 头中每个阶段的 `<stage>_s`；不是有限数的值被略去。错误应答变成其 JSON 正文的 `error.message`，否则是原样的正文。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`、`inject`、`Config`、`apply`、capabilities 和渲染调用，以及目录条目 |
| [`src/fasth3-omni.ts`](src/fasth3-omni.ts) | 条目描述、输入上限、`schema()`、请求的问题，以及带模型标签的提示词 |
| [`skills/fasth3-uniserve-prompting.md`](skills/fasth3-uniserve-prompting.md) | 提示词 skill `fasth3-uniserve-prompting` |
| [`tests/uniserve.spec.ts`](tests/uniserve.spec.ts) | 用 Loader 组装 skill 注册表、Project、ffmpeg、资产池和模型目录，对接一台假的 UniServe 服务器，它以运行中服务器的 capabilities、一个 MP4 及其耗时头应答；一个可选测试对 `DV_UNISERVE_TEST_URL` 指定的服务器做真实渲染 |

用 `DV_UNISERVE_TEST_URL=http://10.244.8.35:8000 pnpm exec vitest run packages/dv/uniserve/tests` 运行可选测试，它渲染一个 5 秒镜头。

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/models`](../models/README.zh.md)：本插件注册进的模型目录。
- [`@dv/shot-render`](../shot-render/README.zh.md)：使用方，提供工具 `dv_shot_render`。
- [UniServe 服务指南](https://github.com/hao-ai-lab/uniserve/blob/main/docs/minimax_h3/minimax_h3.md)：服务器、它的部署和 `/v1/videos` API。

-----

<a id="model-experience"></a>
## 模型体验

### 模型目录条目和拒绝

#### 模型看到什么

`@dv/models` 的 `dv_models_list` 结果列出该条目的键（模态 `video`、任务 `ref2v`、provider `uniserve`、模型 `fasth3`）、下面的描述和提示词 skill `fasth3-uniserve-prompting`。该 skill 把 MiniMax-H3 官方全参考指南对应到一个 DreamVerse 镜头，并让 agent 从 `dv_models_get` 读取参考上限和时长。`dv_models_get` 再加上下面的 schema，它读自一台支持 12 个参考、9 张图片、3 个视频和 3 个音频文件的服务器。`facts()` 或 `schema()` 的拒绝在拒绝消息中跟在 `Model video/ref2v/uniserve/fasth3 is unavailable: ` 之后，渲染失败则以其消息让记录和工具调用失败。

##### Entry description

```markdown
MiniMax H3 served as FastH3 Omni 8-Step V1 on UniServe: video with sound, dialogue and music written in the prompt, from reference images, videos and audio and an optional first frame. Keeps a face, place or style the same across shots through the references, and continues a shot from the previous shot's last still. Needs at least one reference.
```

##### Schema

```markdown
{"duration_sec":{"min":4,"max":15},"aspect_ratios":["16:9","9:16"],"resolutions":["768p","480p"],"inputs":{"reference":{"min":1,"max":11,"media_types":{"image":{"max":8},"video":{"max":3},"audio":{"max":3}}},"first_frame":{"min":0,"max":1,"media_types":{"image":{}}}},"extra":{}}
```

##### Request problems

```markdown
Its reference input needs at least 1 of type image, video, audio; this shot has 0.
Its reference input takes at most <max> assets; this shot has <count>.
Its reference input takes assets of type image, video, audio; asset <asset> is of type <type>.
Its reference input takes at most <max> of type <type>; this shot has <count>.
Its first_frame input takes assets of type image; asset <asset> is of type <type>.
Its prompt does not cite the first frame; write "@[首帧](dv:input/first_frame) is the first frame of [Shot 1]".
fasth3 has no extra parameter `<name>` for task ref2v; its extra parameters: none.
```

##### Server rejections

```markdown
The server at <baseUrl> serves task <served tasks, comma-separated, or none>, not ref2va; the dv-uniserve baseUrl names the wrong server.
The server at <baseUrl> cannot be reached.
The server at <baseUrl> answered GET /v1/capabilities with HTTP <status>: <server text>
The server at <baseUrl> answered POST /v1/videos/sync with HTTP <status>: <server text>
```

#### Token 影响

条目在 `dv_models_list` 结果中约 65 个 token，schema 在 `dv_models_get` 结果中约 100 个 token。每个问题句在拒绝消息中约 15 到 25 个 token。skill `fasth3-uniserve-prompting` 在 skill 列表中加一行名称和描述；约 7,000 个 token 的正文只在 agent 加载它时进入会话。

#### KV Cache 影响

条目只经由工具结果到达模型，而工具结果追加在会话末尾。挂载或移除本插件会在系统提示词的 skill 列表中加入或移除 skill `fasth3-uniserve-prompting`，这会改变之后请求的缓存前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **视频整段到达**：`POST /v1/videos/sync` 要等服务器编码完整个 MP4 才应答，所以 `dv_shot_render` 的实时流在渲染结束时以一个分块收到视频。
- **首帧是被引用的参考**：条目把首帧作为参考图片之后的那张图片发送，不使用 UniServe 的关键帧条件（`role: keyframe`、`frame_index: 0`）。
- **一个模型和一个任务**：本插件只为任务 `ref2v` 提供 `fasth3`；另一个 UniServe 模型或任务需要在代码中有自己的规则和条目，仅改配置不够。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
