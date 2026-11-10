---
description: "FastVideo OpenAI 和 streaming_v2 生成 API 客户端：部署事实、带类型的参考、视频事件与取消。"
kind: "package-reference"
---

# @dv/fastvideo-generation-client

[English](README.md) | 中文

## 概述

使用本包通过 FastVideo 生成视频片段。返回完整 MP4 的服务器选择 OpenAI API；保留默认配置则使用 streaming_v2。两者都提供末帧、视频和耗时事件。请求携带所有参考；取消会关闭 HTTP 请求，但后端可能继续完成已经开始的生成。

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

每个后端用其基础 URL 构造一个客户端。`@dv/fastvideo` 在隔离的 `dvFastvideoGeneration` 作用域中，为每个配置的模型和生成任务各构造一个客户端。

### 最小配置

```yaml
- id: dv-fastvideo-generation-client
  name: '@dv/fastvideo-generation-client'
  config:
    baseUrl: http://127.0.0.1:8029
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `baseUrl` | 必填 | 生成后端的 HTTP 基础 URL |
| `openai` | `null` | 设置下述 OpenAI 部署配置；省略则使用 streaming_v2 |

<a id="openai-api-configuration"></a>
### OpenAI API 配置

对于提供 `GET /v1/model_info` 和 `POST /v1/videos/sync` 的服务器，在 `baseUrl` 同级设置 `openai`。`modelFacts` 填写已经验证的部署限制，`ffmpegPath` 指向已安装的 ffmpeg。`model()` 在缓存事实前检查 `served_model_name` 是否等于 `modelFacts.modelId`。不匹配时失败，避免公布其他模型的信息。

| `openai` 内的字段 | 默认值 | 含义 |
| --- | --- | --- |
| `ffmpegPath` | 必填 | 本地提取末帧的可执行文件；`returnLastFrame` 为 false 时不用 |
| `managed` | `false` | 使用原生模型目录发现、生命周期控制和异步视频任务 |
| `task` | `null` | 请求未指定时使用的原生任务 |
| `displayName` | `null` | harness 模型选择器显示的名称 |
| `pollIntervalMs` | `1000` | 托管任务状态请求之间的毫秒间隔 |
| `modelFacts.modelId` | 必填 | 精确的服务模型别名 |
| `modelFacts.aspectRatios` / `resolutions` | 必填 | 模型目录支持的选项 |
| `modelFacts.minSegmentDurationSec` / `maxSegmentDurationSec` | 必填 | 包含端点的整数秒时长范围 |
| `modelFacts.maxReferences` | 必填 | 包含首帧的参考总数上限 |
| `modelFacts.referenceMediaTypes` | 必填 | 各类型带 `maxCount` 的对象 |
| `modelFacts.frameSizes` | 必填 | 宽高比到分辨率到 `[width, height]` 的映射 |
| `modelFacts.numFramesByDurationSec` | 必填 | 整数秒时长到帧数的映射 |

`generateSegment` 发送 `model`、`prompt`、`width`、`height`、`num_frames` 和可选的 `seed`。它把参考分组为 `image_reference`、`video_reference` 和 `audio_reference`，各 `*_url` 中使用带类型的 data URI。设置每个参考的 `mimeType` 可保留 JPEG、MPEG 音频等格式；省略时使用 `<mediaType>/octet-stream`。其他媒体类型和不匹配的 MIME 在发送 HTTP 前失败。

设置 `managed: true` 时，服务器必须提供原生模型目录。发现请求在 `/v1/model_info` 中指定模型别名和任务；`modelStatus()`、`loadModel()` 和 `unloadModel()` 使用 `/v1/model_state` 以及 `/v1/models/load` 或 `/unload`。生成仅向 `/v1/videos` 提交一次，轮询同一个任务 ID，再读取 `/v1/videos/{id}/content`。因此长时间推理无需一直等待同一个同步响应的头部。取消会请求删除任务；正在执行的 CUDA 调用仍持有生成锁，直到结束。原生服务器在内存中跟踪任务，不提供跨重启的恢复。

响应必须带 `video/*` 内容类型。客户端缓存完整 MP4，可用 ffmpeg 提取末帧 PNG，然后产出与 streaming_v2 相同种类的事件。它把 `X-Inference-Time-S` 映射为 `done.timings.inference_s`。HTTP 400 或 422 变为带 `invalid_request` 的 `GenerationSegmentError`；其他 HTTP 失败保留状态和受限长度的后端消息。Python traceback 仅保留最后的异常行；超过 2,048 字符的消息会截断，完整详情留在服务器日志中。中止会在本地 ffmpeg 退出、临时文件删除后，以调用方的原因拒绝。

### Streaming API 服务

- `model()` 读取 `GET /v1/streamv2/capabilities` 并缓存第一次成功的结果。它补充取自 `frame_sizes` 键的宽高比与分辨率。
- `generateSegment(request)` 发送一个 `POST /v1/streamv2/generate`，并按到达顺序产出 `last_frame`、`video_start`、`chunk` 和 `done` 输出。HTTP 400 和 `error` 事件以 `GenerationSegmentError(message, errorType)` 拒绝，其中 `errorType` 是后端的错误码。在 `done` 之前结束的流以 `Error` 拒绝。离开迭代或中止 `request.signal` 会取消 HTTP 请求；中止以 `signal.reason` 拒绝。

### Streaming 后端 API

API 归 FastVideo 所有；客户端使用其中两个路由。`GET /v1/streamv2/capabilities` 返回模型的事实：

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

`max_references` 计入一个请求中所有媒体类型的每个参考。`reference_media_types` 列出每种接受的媒体类型及其各自的 `max_count`；延续片段的请求图片按 `image` 计数。`num_frames_by_duration_sec` 包含从最小值到最大值的每个整数时长。

`POST /v1/streamv2/generate` 接受 `{"prompt", "references", "width", "height", "num_frames", "seed"?, "return_last_frame"}`，并以 `text/event-stream` 响应，其中每条 `event: <name>` 记录带一行 JSON `data:`，顺序如下：

| 事件 | 数据 |
| --- | --- |
| `last_frame` | `{"data": <base64 PNG of the final decoded frame>}`，仅当 `return_last_frame` 为 true 时发送 |
| `video_start` | `{"mime": str}` |
| `video_chunk` | `{"data": <base64 fMP4 bytes>}`，一个或多个；拼接后是一个 fragmented MP4 |
| `done` | `{"timings": {"generation_ms": float, "e2e_latency_ms": float}}`；响应结束 |
| `error` | `{"code": "invalid_request" \| "generation_failed", "message": str}`；响应结束 |

`references` 是由 `{"media_type": str, "data": <base64 字节>}` 组成的有序列表，由 `SegmentRequest.references` 构建；客户端不检查媒体类型，后端按每个参考的 `media_type` 解码。在生成开始前发现的请求问题返回 HTTP 400 `{"code": "invalid_request", "message": str}`。后端在并发请求之间串行生成，并且即使客户端取消，也会完成已经开始生成的片段。

对于 MiniMax-H3/Pika OpenAI 服务器，`SegmentRequest.task` 可选发送原生 `t2va`、`i2va`、`l2va`、`fl2va` 或 `ref2va` 选择器。提供方负责端点顺序：关键帧管线将前两张图像参考分别作为首尾条件图像。显式 `l2va` 选择器要求后端把单张图像映射为尾帧条件；旧服务器将其映射为首帧或拒绝此选择器。streaming_v2 传输没有原生任务选择器。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

两种传输都使用 `fetch`。OpenAI 传输缓存一个 MP4，仅在本地提取末帧期间持有临时文件。Streaming 传输不使用本地媒体文件。`generateSegment` 逐行解析服务器发送事件流，并在每个事件完整时立即产出对应输出，因此调用方可以在后端仍在生成时转发视频分块。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvFastvideoGeneration` 服务：模型事实与片段请求 |
| [`src/openai.ts`](src/openai.ts) | OpenAI 部署验证、同步 MP4 响应和本地末帧提取 |
| [`src/generation-stream.ts`](src/generation-stream.ts) | 请求体与事件流解析器 |
| [`src/types.ts`](src/types.ts) | 模型事实、带类型参考的片段请求与片段输出 |
| [`src/errors.ts`](src/errors.ts) | 片段错误 |

`tests/` 目录让客户端连接一个扮演后端的本地 HTTP 服务器来测试它。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/fastvideo`](../fastvideo/README.zh.md)——注册 FastVideo 模型，并通过本客户端渲染每个镜头。

-----

<a id="model-experience"></a>
## 模型体验

### 片段生成请求

#### 模型看到什么

对于 streaming_v2，视频模型收到 `generateSegment` 构建的请求体：保持不变的 `prompt`、按调用方顺序由带 base64 字节的 `{media_type, data}` 条目组成的 `references`、`width`、`height`、`num_frames`、仅在调用方设置时才发送的 `seed`，以及 `return_last_frame`。模型按列表顺序为每种媒体类型分别编号，调用方的提示词使用模型的编号指称这些参考，例如第一张图片为 `Picture 1`。 使用 OpenAI 时，模型收到相同的提示词和画面参数、配置的模型别名，以及独立的图片、视频和音频列表。标签必须遵循后端顺序；`@dv/fastvideo` 在替换引用时处理这一点。本客户端不添加任何参考或首帧标签。

#### Token 影响

直接文本 token 为零：客户端不向调用方的提示词添加任何文本。

#### KV Cache 影响

每个片段是独立请求：后端在请求之间不保留状态，客户端也不发送任何会话或缓存标识。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **模型事实从不刷新**——`model()` 在插件生命周期内保留第一次成功的能力结果。若后端以另一个模型重启，harness 会一直保留旧事实，直到插件重新加载。
- **显式 OpenAI 限制**：该 API 没有能力端点。操作者必须让配置的事实与部署的权重及采样设置一致。
- **OpenAI 完整响应输出**：没有逐步预览；完整 MP4 保留在内存中，请求末帧需要本地 ffmpeg。
- **没有请求截止时间**——客户端不为能力或生成请求设置超时。停止发送事件的后端会一直占用请求，直到调用方中止它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
