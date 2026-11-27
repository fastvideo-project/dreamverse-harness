# Agent Note: 浏览器登录流程

Status: implemented

[English](2026-10-26-browser-sign-in-flows.md) | 中文

## Problem

[凭据记录与授权流程](2026-08-13-credential-records-and-authorization-flows.zh.md)为每个 pi-ai 提供方注册了登录流程，但这些流程只能在进程内触达。浏览器用户无法发起 ChatGPT（Codex）订阅登录，因此唯一登录方式就是该订阅登录的 `openai-codex` 在 Web 应用里一直无法使用（[issue #76](https://github.com/fastvideo-project/dreamverse-harness/issues/76)）。界面还需要知道部署方愿意提供哪些流程：一个流程已注册，并不代表该提供方的条款允许第三方应用使用它。

## Decision

`dsh-api-authorization-controller` 是一个可选插件。它发布 `authorization` Remote 命名空间：`list`；`begin` 流，传送通知、提示、提示撤回和最终状态；以及 `answer`、`decline`、`cancel` 和 `signOut`。它的 `flows` 配置是部署方提供的凭据键白名单；不在白名单内的已注册流程不可见，也会被拒绝。没有任何操作返回或记录凭据值：流只携带 `dsh-authorization` 已限定为不含机密的通知，`signOut` 通过凭据 seam 删除记录。插件复用 `llm-pi-ai` 已经注册的 Codex 流程。它不自带 OAuth 客户端，也不自带凭据文件。

插件自己的 patch 只列出 `llm-pi-ai/openai-codex`，默认 Web App profile 不包含这份 patch。Anthropic 的订阅登录仍由 `llm-pi-ai` 注册，但不列入名单，因为 Anthropic 的条款不允许第三方应用使用 Claude 订阅凭据；使用 Claude 模型仍然走 API 密钥路由。要提供其他流程，需在核查该提供方的条款后，在部署的 patch 里修改 `flows`。

`preferredOptions` 按流程指定页面最先显示的 select 选项。patch 为 Codex 偏好 `device_code`，因为 pi-ai 的浏览器方式在 Host 的回环端口 1455 上等待回调，其他机器上的浏览器无法到达；设备码在任何浏览器上都能用。

浏览器入口自行挂载该命名空间，并添加一个固定为键 `llm-pi-ai/openai-codex` 的 OpenAI Codex 设置页。Models 页不变。pi-ai 的 `Provider is not configured` 失败仍是 pi-ai 自己的消息：把它归类为 `MISSING_CREDENTIAL` 就要修改每个部署都会运行的 `llm-pi-ai`。

## Alternatives considered

- **修改 Web profile、共享 Remote 列表和 Models 页。** 这一改动的第一版把页面放在那里。这些文件对每个 Web 用户都会加载，包括从不登录 ChatGPT 的用户。
- **照搬独立 Codex 插件自带的 OAuth 和凭据文件。** 那些插件说明了打包方式：一个可安装的包、自己的 patch、自己的设置页。它们的登录代码重复了 `llm-pi-ai` 已经在跑的流程，第二份凭据文件也不是 Codex 路由读取的那份记录。
- **提供全部已注册流程。** 无需配置，pi-ai 已注册 38 个。但这也会提供部署方未核查条款的订阅登录，首先就是 Claude 的。白名单让每一项提供都成为一行经过审查的配置。
- **默认使用浏览器方式。** 在运行 Host 的机器上，一次点击即可，无需验证码。但所有远程浏览器都会等待一个永远到不了的回调，失败只会以超时的形式出现。
- **把 `credentials/record-updated` 转发给浏览器。** 能让其他窗口在别处登录后刷新。但该事件会暴露浏览器本无理由看到的凭据键，而页面已经在尝试结束、退出登录和重新连接时重新列出；跨窗口的及时性作为限制保留。
- **把登录渲染为 `settings.models.provider-card` 的注册方。** 复用为卡片扩展建的席位。但该席位以 settings 命名空间为键，`llm-pi-ai` 的登录注册方会顶替同键下注册的外部插件。

## Consequences

加载这份 patch 的用户从 Settings → OpenAI Codex 登录 ChatGPT，看到设备页面和验证码，并在同一页退出登录；令牌留在 Host 的凭据存储中，也就是 `llm-pi-ai` 读取的那份存储。进行中的尝试不能在 Host 重启后保留，浏览器方式只有在浏览器与 Host 运行在同一台机器上时才可用。另一个窗口的登录要到本页再次列出时才显示。就绪判断仍把已配置的无密钥路由视为可用，因此未登录的 Codex 路由也可以结束首次运行引导。退出登录后，Codex 对话以 pi-ai 的 `Provider is not configured` 消息失败。`llm-pi-ai` 的 Loader 条目改名后，页面写死的键失效。

## Testing

`authorization-controller` 以真实的 `LocalCredentialProvider` 和 `AuthorizationService` 覆盖每项 Host 操作：列表过滤、通知与提示、拒绝、提示撤回、带与不带错误码的失败、已在运行时的拒绝、传输中止与取消、退出登录、偏好标记以及配置错误。客户端测试覆盖基于脚本化流的登录 store、页面的每种渲染状态，以及设置分区的注册和撤回。带上本包 patch 启动 Web 应用会离开加载画面并显示 OpenAI Codex 设置页。没有已存登录的 Codex 对话以 pi-ai 的 `Provider is not configured` 消息失败。尚未检查真实的令牌刷新。
