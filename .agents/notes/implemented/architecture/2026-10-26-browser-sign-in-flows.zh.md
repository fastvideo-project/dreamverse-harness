# Agent Note: 浏览器登录流程

Status: implemented

[English](2026-10-26-browser-sign-in-flows.md) | 中文

## Problem

[凭据记录与授权流程](2026-08-13-credential-records-and-authorization-flows.zh.md)为每个 pi-ai 提供方注册了登录流程，但这些流程只能在进程内触达。浏览器用户无法发起 ChatGPT（Codex）订阅登录，因此唯一登录方式就是该订阅登录的 `openai-codex` 在 Web 应用里一直无法使用（[issue #76](https://github.com/fastvideo-project/dreamverse-harness/issues/76)）。界面还需要知道部署方愿意提供哪些流程：一个流程已注册，并不代表该提供方的条款允许第三方应用使用它。

## Decision

`dsh-api-authorization-controller` 发布 `authorization` Remote 命名空间：`list`；`begin` 流，传送通知、提示、提示撤回和最终状态；以及 `answer`、`decline`、`cancel` 和 `signOut`。它的 `flows` 配置是部署方提供的凭据键白名单；不在白名单内的已注册流程不可见，也会被拒绝。没有任何操作返回或记录凭据值：流只携带 `dsh-authorization` 已限定为不含机密的通知，`signOut` 通过凭据 seam 删除记录。

Web 应用只提供 `llm-pi-ai/openai-codex`。Anthropic 的订阅登录由 `llm-pi-ai` 注册但不提供，因为 Anthropic 的条款不允许第三方应用使用 Claude 订阅凭据；使用 Claude 模型仍然走 API 密钥路由。要提供其他流程，需在核查该提供方的条款后，在部署的 patch 里修改 `flows`。

`preferredOptions` 按流程指定界面最先显示的 select 选项。Web 应用为 Codex 偏好 `device_code`，因为 pi-ai 的浏览器方式在 Host 的回环端口 1455 上等待回调，其他机器上的浏览器无法到达；设备码在任何浏览器上都能用。这个偏好是 Host 配置而不是客户端常量，因此 Models 页不含任何提供方 id。

Models 页通过 `<settingsNs>/<provider>` 把提供方卡片与流程对应起来，这正是 `llm-pi-ai` 在默认 Loader 条目 id 下写入的记录键。登录区块渲染在 `settings.models.provider-card` 席位旁边而不是占用它，因此以 `llm-pi-ai` 为键的外部插件仍能收到每张卡片。

`llm-pi-ai` 把 pi-ai 的 `Provider is not configured` 失败归类为 `MISSING_CREDENTIAL`。没有密钥、也没有已存储登录的路由在发出任何请求之前就产生这条消息，因此 `signOut` 之后 Codex 对话失败时的错误码，与密钥引用为空的路由相同。

## Alternatives considered

- **提供全部已注册流程。** 无需配置，pi-ai 已注册 38 个。但这也会提供部署方未核查条款的订阅登录，首先就是 Claude 的。白名单让每一项提供都成为一行经过审查的配置。
- **默认使用浏览器方式。** 在运行 Host 的机器上，一次点击即可，无需验证码。但所有远程浏览器都会等待一个永远到不了的回调，失败只会以超时的形式出现。
- **把 `credentials/record-updated` 转发给浏览器。** 能让其他窗口在别处登录后刷新。但该事件会暴露浏览器本无理由看到的凭据键，而页面已经在尝试结束、退出登录和重新连接时重新列出；跨窗口的及时性作为限制保留。
- **把登录渲染为 `settings.models.provider-card` 的注册方。** 复用为卡片扩展建的席位。但该席位以 settings 命名空间为键，`llm-pi-ai` 的登录注册方会顶替同键下注册的外部插件。

## Consequences

Web 用户在 `openai-codex` 卡片上登录 ChatGPT，看到设备页面和验证码，并在同一张卡片上退出登录；令牌留在 Host 的凭据存储中。进行中的尝试不能在 Host 重启后保留，浏览器方式只有在浏览器与 Host 运行在同一台机器上时才可用。另一个窗口的登录要到本页再次列出时才显示。就绪判断仍把已配置的无密钥路由视为可用，因此未登录的 Codex 路由也会结束首次运行引导，其对话随后以 `MISSING_CREDENTIAL` 失败。`llm-pi-ai` 的 Loader 条目改名后，卡片与流程的对应关系失效。

## Testing

`authorization-controller` 以真实的 `LocalCredentialProvider` 和 `AuthorizationService` 覆盖每项操作：列表过滤、通知与提示、拒绝、提示撤回、带与不带错误码的失败、已在运行时的拒绝、传输中止与取消、退出登录、偏好标记以及配置错误。`ui-settings-models` 覆盖基于脚本化流的登录 store、区块的每种渲染状态，以及它在对应卡片上的位置。`llm-pi-ai` 覆盖 `MISSING_CREDENTIAL` 的归类。使用真实 ChatGPT 账户、包含令牌刷新的端到端对话尚未录制。
