---
description: "FastVideo POST /v1/videos/sync API 客户端：配置的模型事实、带类型的参考、完整 MP4 片段与取消。"
kind: "package-reference"
---

# @dv/fastvideo-generation-client

[English](README.md) | 中文

## 概述

使用本包通过 FastVideo 生成视频片段。客户端用 `GET /v1/model_info` 检查服务的模型，每个片段发送一个内联所有参考的 `POST /v1/videos/sync`，并返回完整 MP4 和后端耗时。取消会关闭 HTTP 请求，但后端可能继续完成已经开始的生成。

原生服务器可以在 `GET /v1/model_info` 中发布 `video_output_capabilities`。设置 `discoverOutputCapabilities: true` 后，客户端会验证这些元数据并发现输出尺寸和整数时长，同时保留配置的模型 ID 和参考素材限制。服务器提供配置中的第一个宽高比和第一个分辨率时，它们仍排在最前，因此仍是默认渲染几何；否则使用服务器的顺序。旧服务器不发布元数据时仍使用配置；无效元数据会明确报错。发现功能默认关闭，在明确开启前保留配置的输出选项。

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

每个后端用其基础 URL 和其所服务模型的 `modelFacts` 构造一个客户端。`@dv/fastvideo` 在隔离的 `dvFastvideoGeneration` 作用域中，为每个配置的模型和生成任务各构造一个客户端。

<a id="minimal-configuration"></a>
### 最小配置

```yaml
- id: dv-fastvideo-generation-client
  name: '@dv/fastvideo-generation-client'
  config:
    baseUrl: http://127.0.0.1:8029
    modelFacts:
      modelId: fasth3
      frameSizes: { '16:9': { 480p: [832, 480] } }
      numFramesByDurationSec: { 5: 124 }
      maxReferences: 12
      referenceMediaTypes: { image: { maxCount: 9 }, video: { maxCount: 3 }, audio: { maxCount: 3 } }
```

FastVideo 不提供能力路由，因此操作者写出所服务模型的事实。客户端从 `frameSizes` 的键推导 `aspectRatios` 和 `resolutions`，从 `numFramesByDurationSec` 的键推导 `minDurationSec` 和 `maxDurationSec`。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `baseUrl` | 必填 | 生成后端的 HTTP 基础 URL |
| `task` | `null` | `generateSegment` 作为请求的 `task` 发送的原生 FastVideo 任务选择器，如 `fl2va`；`null` 时不发送 `task` |
| `modelFacts.modelId` | 必填 | 精确的服务模型别名；`model()` 将它与 `served_model_name` 比较 |
| `modelFacts.frameSizes` | 必填 | 宽高比到分辨率到 `[width, height]` 的映射；每个宽高比列出相同的分辨率 |
| `modelFacts.numFramesByDurationSec` | 必填 | 整数秒时长到帧数的映射，覆盖从最短到最长的每个时长，帧数随时长增长 |
| `modelFacts.maxReferences` | 必填 | 包含首帧的参考总数上限 |
| `modelFacts.referenceMediaTypes` | 必填 | `image`、`video` 或 `audio` 到 `{maxCount}` 的映射，每项不超过 `maxReferences`；未列出的类型不被接受 |

事实违反这些规则时，构造客户端会抛出指明不一致之处的 `Error`，因此构造客户端的插件在加载时失败。

### 服务

- `facts` 从构造起持有推导出的事实，不发送请求；`model()` 在后端确认所服务的别名后返回同一组事实。
- `model()` 发送 `GET /v1/model_info`，在第一次 `served_model_name` 等于 `modelFacts.modelId` 的回答之后返回推导出的事实。状态不是 200 时抛出指明路由和状态的 `Error`；响应体不是 JSON 时抛出指明路由的 `Error`；`served_model_name` 缺失或不同时抛出指明两个别名的 `Error`。
- `generateSegment(request)` 发送一个 `POST /v1/videos/sync`，以完整 MP4 解析为 `{video, mime, timings}`。该请求没有客户端的响应头超时，因为后端在整个视频生成后才发送响应头。响应体保留全局 dispatcher 的响应体超时，因为后端从已完成的 MP4 文件发送响应体。中止 `request.signal` 会取消 HTTP 请求，并以 `signal.reason` 拒绝。

### 后端 API

API 归 FastVideo 所有；客户端使用其中两个路由。`GET /v1/model_info` 返回 `{"model_path", "served_model_name", "lora"}`。`POST /v1/videos/sync` 接受 `model`、可选的 `task`、`prompt`、`width`、`height`、`num_frames`、可选的 `seed`，以及列表 `image_reference`、`video_reference` 和 `audio_reference`，每项为 `{"<type>_url": "data:<mime>;base64,..."}`。Ref2VA 流水线先读图片，再读视频，最后读音频，每个列表按其自身顺序；`REFERENCE_FIELDS` 记录这一顺序，`backendOrder(items, mediaTypeOf)` 按该顺序返回各项。参考的媒体类型是其 `mimeType` 的顶层类型；其他类型在发送 HTTP 前以 `GenerationSegmentError` 拒绝。

回答必须带 `video/*` 内容类型；其他内容类型以携带响应体文本的 `Error` 拒绝。`@dv/models` 的 `renderTimings` 读取耗时：`X-Inference-Time-S` 变为 `timings.inference_s`，`X-Stage-Durations` 中 JSON 对象的每个阶段变为 `timings.<stage>_s`；不是 JSON 的 `X-Stage-Durations` 不添加阶段耗时，视频仍保留。HTTP 400 变为 `GenerationSegmentError`；其他 HTTP 失败保留状态和受限长度的后端消息。消息取 `application/json` 响应体的 `error.message`，否则取响应体文本。Python traceback 仅保留最后的异常行；超过 2,048 字符的消息会截断，完整详情留在服务器日志中。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

两个路由都使用 undici 的 `fetch`。生成请求传入已安装的全局 dispatcher，并将其组合为仅关闭该请求的响应头超时，因此保留进程的代理策略和连接池。客户端在内存中持有一个 MP4，不写本地文件。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvFastvideoGeneration` 服务：服务模型检查、请求体、响应检查与耗时 |
| [`src/model-facts.ts`](src/model-facts.ts) | 配置的事实、其 Loader 校验与推导出的 `ModelFacts` |
| [`src/references.ts`](src/references.ts) | 每种媒体类型的参考字段，按后端读取顺序排列 |
| [`src/types.ts`](src/types.ts) | 模型事实、带参考的片段请求与片段视频 |
| [`src/errors.ts`](src/errors.ts) | 片段错误 |

`tests/` 目录让客户端连接一个扮演后端的本地 HTTP 服务器来测试它。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/fastvideo`](../fastvideo/README.zh.md)——注册 FastVideo 模型，并通过本客户端渲染每个镜头。

-----

可选 `task` 字段选择原生 FastVideo 任务（如 `fl2va`）；省略时使用服务端默认任务。

### 原生模型目录控制

仅当后端实现 `/v1/model_state`、`/v1/models/load` 和 `/v1/models/unload` 时启用 `managed: true`。`loadModel`、`unloadModel` 和 `modelStatus` 调用这些路由，不会生成视频。`task` 区分共用模型别名的参考与关键帧管线；`displayName` 命名聊天选项。提供方仅为受管理条目暴露这些控制。

受管理条目或启用 `asyncJobs: true` 的条目提交一个 `/v1/videos` 任务，以 `pollIntervalMs`（默认 1000）轮询其 ID，再读取规范内容路由。轮询不会重新提交生成。中止会删除该任务；原生 CUDA 工作可能忙碌到当前调用结束。普通固定服务保留已合并的 `/v1/videos/sync` 传输与共享 ffmpeg 提取。

<a id="model-experience"></a>
## 模型体验

### 片段生成请求

#### 模型看到什么

视频模型收到 `generateSegment` 构建的请求体：保持不变的 `prompt`、配置的服务模型别名、`width`、`height`、`num_frames`、仅在调用方设置时才发送的 `seed`，以及每种媒体类型一个列表，每种类型内保持调用方顺序。模型按读取顺序为参考编号：先图片，再视频，最后音频。调用方的提示词使用该编号指称这些参考，例如第一张图片为 `Picture 1`；`@dv/fastvideo` 按 `backendOrder` 分配标签。本客户端不添加任何参考或首帧标签。

#### Token 影响

直接文本 token 为零：客户端不向调用方的提示词添加任何文本。

#### KV Cache 影响

每个片段是独立请求：后端在请求之间不保留状态，客户端也不发送任何会话或缓存标识。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **模型事实从不刷新**——`model()` 在插件生命周期内只检查一次服务别名。若后端以另一个模型重启，harness 会一直保留配置的事实，直到插件重新加载。
- **配置的模型事实**——FastVideo 不提供能力路由。操作者必须让配置的事实与部署的权重及采样设置一致。
- **完整响应输出**——没有逐步预览；完整 MP4 保留在内存中。
- **无默认请求期限** — 调用接受可选中止信号。默认原生传输关闭长时间生成及模型加载请求的响应头超时；调用者负责操作期限。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
