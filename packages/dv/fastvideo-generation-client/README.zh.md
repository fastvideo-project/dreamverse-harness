---
description: "FastVideo 生成后端 OpenAI 风格视频任务 API 的客户端：每个请求一个视频任务，提交、轮询到完成，并以一个 MP4 下载，错误带类型。"
kind: "package-reference"
---

# @dv/fastvideo-generation-client

[English](README.md) | 中文

## 概述

使用本包通过 OpenAI 风格视频任务 API 访问 FastVideo 生成后端。每个请求是一个任务：客户端提交它，轮询其状态直到完成，然后下载完成的 MP4 和耗时。被拒绝的提交和失败的任务变为带类型的错误，中止请求会立即停止等待。后端在任务之间不保留状态，因此调用方每次请求都要发送所有参考图片。

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

### 服务

- `generateVideo(request)` 以 `POST /v1/videos` 提交一个任务，每秒读取一次 `GET /v1/videos/{id}`，直到任务的 `status` 为 `completed` 或 `failed`，然后读取 `GET /v1/videos/{id}/content`。它以 MP4 字节和耗时完成：`e2e_latency_ms` 为从提交到下载完字节的时间，`generation_ms` 在后端报告任务的 `inference_time_s` 时取自该值。提交时的 HTTP 400 以 `GenerationSegmentError(message, 'invalid_request')` 拒绝，`failed` 的任务以 `GenerationSegmentError(message, 'generation_failed')` 拒绝；200 以外的其他状态以写明路由的 `Error` 拒绝。中止 `request.signal` 会停止轮询，并以 `signal.reason` 拒绝。

### 后端 API

API 归 FastVideo 所有；客户端使用其中三个路由。`POST /v1/videos` 接受 `{"task", "prompt", "size", "num_frames", "seed"?, "image_reference"?}`，并返回带 `id` 且 `status` 为 `queued` 的任务对象：

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

`size` 为 `<frameWidth>x<frameHeight>`。`image_reference` 按顺序列出请求的图片，每张都是由其 MIME 类型和字节构成的 `data:` URL；请求没有图片时客户端省略它，请求没有种子时省略 `seed`。请求问题返回 HTTP 400 和 FastAPI 的 `{"detail": ...}`。`GET /v1/videos/{id}` 返回任务对象，其 `status` 为 `queued`、`in_progress`、`completed` 或 `failed`，失败的任务带 `error.message`，完成的任务带 `inference_time_s`。`GET /v1/videos/{id}/content` 返回已完成任务的 MP4。后端把任务保存在内存中，并且即使客户端停止轮询，也会完成已经开始生成的任务。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

该服务的每次调用都使用 `fetch`。后端只以 0 或 100 报告进度，所以客户端以固定的一秒间隔轮询。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvFastvideoGeneration` 服务：任务请求体、状态轮询与下载 |
| [`src/types.ts`](src/types.ts) | 带图片参考的视频请求与视频输出 |
| [`src/errors.ts`](src/errors.ts) | 任务错误 |

`tests/` 目录让客户端连接一个扮演后端的本地 HTTP 服务器来测试它。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/fastvideo`](../fastvideo/README.zh.md)——注册 FastVideo 模型，并通过本客户端渲染每个镜头。

-----

<a id="model-experience"></a>
## 模型体验

### 视频任务请求

#### 模型看到什么

视频模型收到 `generateVideo` 构建的任务体：保持不变的 `task` 和 `prompt`、`size`、`num_frames`、仅在调用方设置时才发送的 `seed`，以及按调用方顺序以 `data:` URL 给出图片的 `image_reference`。模型按列表顺序为图片编号，调用方的提示词使用模型的编号指称这些图片，例如第一张图片为 `<Picture 1>`。

#### Token 影响

直接文本 token 为零：客户端不向调用方的提示词添加任何文本。

#### KV Cache 影响

每个任务是独立请求：后端在任务之间不保留状态，客户端也不发送任何会话或缓存标识。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只有图片**——后端从 `data:` URL 读取 `image_reference`，拒绝 `data:` 形式的视频和音频，所以客户端只发送参考图片。
- **不能取消已开始的任务**——中止只停止轮询；后端没有停止正在运行的生成的路由，所以 GPU 会完成该任务。
- **没有请求截止时间**——客户端不为任务设置超时；一直处于 `in_progress` 的任务会占用请求，直到调用方中止它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
