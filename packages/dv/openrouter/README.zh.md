---
description: "为 DreamVerse 目录和聊天选择器配置 OpenRouter 云端视频模型。本页说明支持的任务、API 凭据、输出选项和取消限制。"
kind: "package-reference"
---

# @dv/openrouter

[English](README.md) | 中文

## 概述

为 DreamVerse 目录和聊天选择器配置 OpenRouter 云端视频模型。本页说明支持的任务、API 凭据、输出选项和取消限制。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

DreamVerse 套件默认挂载 `dv-openrouter`，不配置任何模型。在“视频 API”设置中保存密钥并启用模型。操作员 LLM 继续使用现有“模型”设置和 pi-ai OpenRouter 适配器。

`models` 将本地别名映射到 OpenRouter 视频模型 ID。`credentialRef` 默认为 `OPENROUTER_API_KEY`，引用现有凭据存储。`baseUrl` 默认为 `https://openrouter.ai/api/v1/`。`pollIntervalMs` 默认为 5000。

选择器仅显示已配置模型。兼容目录条目提供 T2V；目录声明相应端点图像时注册 I2V 和 FL2V。API 模型不需要下载本地权重或加载 GPU。


<a id="understand-the-implementation"></a>
## 理解实现

提供方读取 `videos/models`，校验离散时长和端点输入，向 `videos` 提交一次并轮询返回的任务 ID。它从规范认证内容路由下载视频，并通过共享 ffmpeg 服务提取尾帧。返回的签名 URL 不会被使用。

基于时长的请求省略未知像素尺寸和帧数。原生 FastVideo 和 UniServe 保留其配置的帧几何。空配置不请求服务商；实时模型配置变更更新现有目录。


<a id="further-exploration"></a>
## 进一步探索

参阅 [OpenRouter 视频 API 指南](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)。

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### 模型看到的内容

智能体看到提供方 `openrouter`、已配置别名、支持的任务模式、精确时长选项以及云端取消限制。提示词使用端点标签，而非内部素材引用 URL。

#### Token 影响

模型元数据出现在目录工具结果中；不会添加隐藏提示词前缀。

#### KV 缓存影响

目录结果追加到对话。每个云端视频请求相互独立。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- OpenRouter 未记录远端视频取消路由。中止仅停止本地监控，不取消付费任务。提交状态不明确时不会自动重试。

- 不会臆造帧率或精确像素尺寸。通用参考媒体任务和模型透传参数需先有公开的逐模型限制，才能启用。

- 进行中的服务商任务 ID 不跨 Harness 重启持久化。后台渲染仍由现有项目工作流拥有，不另建任务系统。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文</summary>

协议测试使用模拟服务和真实媒体提取。此环境尚未验证付费 OpenRouter 生成。

</details>
