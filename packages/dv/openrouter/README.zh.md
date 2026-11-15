---
description: "为 DreamVerse 目录和聊天选择器配置 OpenRouter 云端视频、图片和语音模型。本页说明支持的任务、API 凭据、输出选项和取消限制。"
kind: "package-reference"
---

# @dv/openrouter

[English](README.md) | 中文

## 概述

为 DreamVerse 目录和聊天选择器配置 OpenRouter 云端视频、图片和语音模型。本页说明支持的任务、API 凭据、输出选项和取消限制。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

DreamVerse 套件默认挂载 `dv-openrouter`，不配置任何模型。在“视频、图片和音频 API”设置中保存密钥并启用模型。操作员 LLM 继续使用现有“模型”设置和 pi-ai OpenRouter 适配器。

`models` 将本地别名映射到 OpenRouter 视频模型 ID，`imageModels` 将本地别名映射到 OpenRouter 图片模型 ID，`audioModels` 将本地别名映射到 OpenRouter 语音模型 ID；别名使用小写字母、数字和连字符。`credentialRef` 默认为 `OPENROUTER_API_KEY`，引用现有凭据存储。`baseUrl` 默认为 `https://openrouter.ai/api/v1/`。`pollIntervalMs` 默认为 5000。`referenceHosting` 默认为 `none`，只提供图片参考；设为 `cloudflare-quick-tunnel` 时，还通过临时 Cloudflare 快速隧道提供音频和视频参考：运行 `cloudflaredPath` 指定的程序（默认 `cloudflared`），并最多等待 `tunnelStartTimeoutMs`（默认 60000）毫秒，直到隧道可以提供文件。

选择器仅显示已配置模型。兼容目录条目提供 T2V；模型接受提供方能够发送的参考媒体时注册 REF2V；目录声明相应端点图像时注册 I2V 和 FL2V。每个图片模型注册为 T2I，因此 `image.generate`（`dv_image_generate`）可以使用它；每个语音模型注册为 T2A，因此 `audio.generate`（`dv_audio_generate`）可以使用它。API 模型不需要下载本地权重或加载 GPU。


<a id="understand-the-implementation"></a>
## 理解实现

提供方从 `videos/models` 读取每个模型的生成选项，从 `models?output_modalities=video` 读取其参考媒体：`architecture.input_modalities` 中的 `image`、`video` 和 `audio` 项，`videos/models` 不列出这些。仅第二个请求失败时，模型照常加载但没有参考媒体，也不注册 REF2V。提供方校验离散时长和端点输入，向 `videos` 提交一次并轮询返回的任务 ID。REF2V 调用接受一个或多个该模型支持的媒体类型的参考，不接受首帧或尾帧，因为存在 `frame_images` 时 OpenRouter 会忽略 `input_references`；每个参考作为 `input_references` 中的 `image_url`、`video_url` 或 `audio_url` 项发送。图片以 `data:` URL 发送。OpenRouter 只接受公开 HTTPS 链接形式的音频和视频，因此 `referenceHosting: none` 时会在提交前拒绝它们；`cloudflare-quick-tunnel` 时，渲染从一个回环 HTTP 服务器以 32 个字符的随机路径提供这些文件，启动指向该服务器的 `cloudflared tunnel --url`，等到 `trycloudflare.com` 的权威域名服务器发布隧道域名、且隧道地址能提供第一个文件后发送隧道 URL（先问权威服务器，可避免缓存解析器把该域名发布前的查询失败按区域 60 秒的否定缓存时间保留下来），并在任务结束时停止隧道和服务器，因为提供商可能在提交后才下载文件。其他视频任务拒绝参考。它从规范认证内容路由下载视频，并通过共享 ffmpeg 服务提取尾帧。返回的签名 URL 不会被使用。任务以 `failed`、`cancelled` 或 `expired` 结束时，渲染失败并带上该状态以及 OpenRouter 给出的任务 `error` 文本。

图片提供方读取 `images/models`，保留输出模态包含 `image`、且列出 `output_format` 选项时其中包含 PNG、JPEG 或 WebP 的条目。图片调用不接受 `size`：OpenRouter 按服务商推导像素尺寸，因此条目的 schema 把模型的 `aspect_ratio`、`resolution`、`quality` 和 `background` 枚举选项列为 `extra`；带 `size`、未列出的 `extra` 键或未列出取值的调用在提交前被拒绝。提供方以 `n: 1` 提交一次 `POST images`，目录列出 `seed` 时带上种子，模型提供 PNG 时带上 `output_format: png`；它把 `data[0].b64_json` 存为 PNG，其他光栅格式通过共享 ffmpeg 服务转换，并从 PNG 读取像素尺寸。

语音提供方读取 `models?output_modalities=speech`，保留输出模态包含 `speech`、且列出 `endpoints` 时其中包含 `/api/v1/audio/speech` 的条目，并读取 `supported_voices` 中的声音。语音调用的提示词是要朗读的纯文本。其 `extra` 接受 `voice` 和 `instructions`：目录列出声音时 `voice` 必填且必须是其中之一；未列出时可省略，由服务商使用默认声音。其他 `extra` 键在提交前被拒绝。提供方提交一次 `POST audio/speech`：`google/` 和 `heygen/` 模型在 OpenRouter 上只提供 PCM，用 `response_format: pcm`，其他模型用 `mp3`（MiniMax 只提供 MP3），并通过共享 ffmpeg 服务把回答转换为 WAV 片段，原始 `audio/pcm` 按 24 kHz 单声道 16 位读取；片段时长由 ffprobe 读取。

基于时长的请求省略未知像素尺寸和帧数。原生 FastVideo 和 UniServe 保留其配置的帧几何。空配置不请求服务商；实时模型配置变更更新现有目录。


<a id="further-exploration"></a>
## 进一步探索

参阅 [OpenRouter 视频 API 指南](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)、[图片生成指南](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)和[文字转语音指南](https://openrouter.ai/docs/features/multimodal/tts)。

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### 模型看到的内容

智能体看到提供方 `openrouter`、已配置别名、支持的任务模式、精确时长选项、图片模型的 `extra` 选项、语音模型的声音以及云端取消限制。提示词使用端点标签，而非内部素材引用 URL。

#### Token 影响

模型元数据出现在目录工具结果中；不会添加隐藏提示词前缀。

#### KV 缓存影响

目录结果追加到对话。每个云端视频、图片或语音请求相互独立。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- OpenRouter 未记录远端视频取消路由。中止仅停止本地监控，不取消付费任务。提交状态不明确时不会自动重试。

- 不会臆造帧率或精确像素尺寸。模型透传参数需先有公开的逐模型限制，才能启用。

- 任务结束前，任何拿到随机 URL 的人都能通过快速隧道下载该次渲染的音频和视频参考。Cloudflare 说明快速隧道用于测试，不保证可用性，并限制新建隧道的频率；隧道无法启动时，渲染在提交前失败。

- REF2V 不设参考数量或大小上限，因为 OpenRouter 没有公开逐模型的限制；参考过多或过大时，要到提交之后才会被提供商拒绝。`input_modalities` 只列出模型接受的媒体，不说明用法；OpenRouter 说明不支持音频和视频参考的提供商会忽略这些参考。提示词只能按标签引用参考；OpenRouter 没有说明把提示词中的词与某个参考对应起来的语法。

- 图片模型只从文字生成（T2I）。不传 OpenRouter 的 `input_references`（图片编辑和参考图），因为 `image.generate` 不声明图片输入；不提供 SVG 和 GIF 输出。

- 语音模型只从文字朗读（T2A）。不传声音克隆和声音设计（`input_references`）、`speed` 以及逐服务商透传选项。OpenRouter 只把原始 PCM 记录为 16 位小端序，因此服务商若以 24 kHz 以外的采样率回答 PCM，播放速度会出错；除只提供 PCM 的 Gemini 和 HeyGen 外，提供方请求自带采样率的 MP3。只提供 PCM 的厂商列表按 OpenRouter 的 TTS 指南固定，因为模型 API 不列出输出格式。没有音乐模型；只有把提示词当作描述来读的模型（如 Seed Audio）才能生成音效。

- 进行中的服务商任务 ID 不跨 Harness 重启持久化。后台渲染仍由现有项目工作流拥有，不另建任务系统。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文</summary>

协议测试使用模拟服务和真实媒体提取。此环境尚未验证付费 OpenRouter 视频、图片或语音生成。

</details>
