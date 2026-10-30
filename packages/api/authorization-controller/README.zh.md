---
description: "浏览器配置页面通过经过认证的 Remote 运行部署所提供的登录流程。通知和提问会经过网络传输；token 不会。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-authorization-controller

[English](README.md) | 中文

## 概述

浏览器配置页面通过经过认证的 Remote 运行部署所提供的登录流程。通知和提问会经过网络传输；token 不会。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

挂载 `AuthorizationController` 时提供 `flows`，即浏览器可以访问其流程的凭证键（`<scope>/<id>`）。格式错误的键在加载时失败。已注册但不在 `flows` 中的流程只在 Host 内可用。`preferredOptions` 把可用键映射到浏览器优先展示的单选提问选项；包含该选项的单选提问带有 `preferred`，不在 `flows` 中的键在加载时失败。本包的 patch 只列出 `llm-pi-ai/openai-codex`，并优先选择 `device_code`，因为浏览器登录要等 Host 本机回环上的回调。默认 Web App profile 不包含这份 patch：用 `--patch` 传入，或用 `dsh plugin add` 安装本包。浏览器入口自行挂载 `authorization` 命名空间，并添加 OpenAI Codex 设置页。

`authorization` 命名空间提供 `list`、`begin`、`answer`、`decline`、`cancel` 和 `signOut`。`list` 返回当前已注册的可用流程，包括其方法、是否有正在进行的尝试，以及是否已存储凭证。`begin` 依次流式发送 `notice`、`prompt` 和 `prompt-withdrawn` 帧，最后发送一个 `settled` 帧，状态为 `authorized` 或 `cancelled`；尝试失败时流以 `authorization/failed` 结束。`answer` 和 `decline` 使用提问帧中的 id 指定提问。关闭流或调用 `cancel` 会撤回尝试。`signOut` 撤回正在进行的尝试并删除已存储的凭证。

不在 `flows` 中或没有已注册流程的键返回 `authorization/not-offered`；过期的提问 id 返回 `authorization/no-prompt`。已有尝试进行时再次调用 `begin` 返回 `authorization/failed`，代码为 `ALREADY_IN_FLIGHT`。

<a id="understand-the-implementation"></a>
## 理解实现

控制器把每次 `ctx.authorization` 尝试转换为一个 Remote 流。未回答的提问按正在进行的尝试保存在内存中，尝试结束时被拒绝。流程自己撤回的提问会发送 `prompt-withdrawn`，并以非拒绝错误结束，流程因此继续运行。控制器除正在进行的尝试外不保存状态，因此不发布 invariant。

<a id="further-exploration"></a>
## 深入探索

[凭证子系统](../../../docs/subsystems/credentials.zh.md)定义授权流程和凭证存储；[llm-pi-ai](../../llm/llm-pi-ai/README.zh.md)注册本控制器提供的模型服务商流程。

<a id="model-experience"></a>
## 模型体验

无，因为登录只存储影响 HTTP 认证的凭证，不进入模型提示、Session 日志或工具结果。

#### KV Cache effect

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 正在进行的尝试不会在 Host 退出后保留；重新连接的浏览器不能恢复丢失的尝试，需要取消后重新开始。
- 浏览器跳转方法在 Host 的本机回环地址上监听，因此远程托管的 Web App 只能完成设备码方法。

<a id="dev-note"></a>
### 开发备注

[浏览器登录决策](../../../.agents/notes/implemented/architecture/2026-10-26-browser-sign-in-flows.zh.md)记录可用流程列表和设备码默认选项。
