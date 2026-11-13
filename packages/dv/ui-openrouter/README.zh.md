---
description: "在现有 DreamVerse 设置界面中配置 OpenRouter 视频和图片模型。本页说明凭据保存、目录发现和聊天选择器模型选项。"
kind: "package-reference"
---

# @dv/ui-openrouter

[English](README.md) | 中文

## 概述

在现有 DreamVerse 设置界面中配置 OpenRouter 视频和图片模型。本页说明凭据保存、目录发现和聊天选择器模型选项。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

DreamVerse 套件将此浏览器组件与 `@dv/openrouter` 一同挂载。打开“设置 → 视频和图片 API”，保存密钥、读取目录，再为视频或图片模型选择“添加到聊天”；页面分别列出两个目录，视频选择写入 `models`，图片选择写入 `imageModels`。“为操作员 LLM 启用 OpenRouter”复用现有 pi-ai 适配器和已保存密钥引用；在聊天中选择操作员模型。现有“模型”设置页仍管理其路由。

密钥留空保留已保存凭据。启用或禁用模型通过版本校验设置仅写入别名和模型 ID；密钥使用现有凭据服务。移除模型影响后续选项，不删除已完成的视频或图片。


<a id="understand-the-implementation"></a>
## 理解实现

页面使用现有设置插槽、配置表单、凭据远端、共享输入和按钮组件及本地化服务。目录发现使用同源认证请求；浏览器不会携带已保存密钥直接调用 OpenRouter。


<a id="further-exploration"></a>
## 进一步探索

参阅 [OpenRouter 视频 API 指南](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)和[图片生成指南](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)。

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### 模型看到的内容

浏览器不添加操作员提示词。启用的 API 条目通过 `dv_models_list` 和聊天视频和图片选择器显示；`models.select` 按模态记录对话选择。

#### Token 影响

模型元数据出现在目录工具结果中；不会添加隐藏提示词前缀。

#### KV 缓存影响

目录结果追加到对话。每个云端视频或图片请求相互独立。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 读取目录不等于付费生成，也不能证明账户有余额。真实生成需要有效密钥、可用模型和服务商余额。

- 本页不添加另一套 LLM 适配器，不配置云端 GPU，也不下载模型权重。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文</summary>

协议测试使用模拟服务和真实媒体提取。此环境尚未验证付费 OpenRouter 生成。

</details>
