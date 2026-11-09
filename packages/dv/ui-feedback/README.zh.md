---
description: "DreamVerse 左侧栏 Settings 上方的反馈按钮：一个窗口，把问题、建议或提问连同版本和打开的项目发送到反馈表格。"
kind: "package-reference"
---

# @dv/ui-feedback

[English](README.md) | 中文

## 概述

使用本包让 DreamVerse 用户不离开应用就能发送反馈。它在 `sidebar.footer.action` 插槽里注册 反馈 按钮，左侧栏把它画在 设置 上方。按钮打开一个窗口，问题照搬 DeepSeek Harness 的用户反馈表单；点 发送 后，它把回答连同版本和浏览器所在的位置发到 [`@dv/feedback`](../feedback/README.zh.md) 的路由，反馈表格存好后弹出提示表示感谢。

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

在叠加了 `dsh-web-app` 的 profile 中挂载本插件，同时挂载 `@dv/feedback` 的 `dv-feedback` 行。先构建浏览器包：`pnpm run build` 会写出 `lib/client.js`。在 [`@dv/bundle`](../../bundle/dv/README.zh.md) 中，两行都跟随 `DV_FEEDBACK_URL`：

```yaml
- id: dv-ui-feedback
  name: '@dv/ui-feedback'
  disabled: !!js '!process.env.DV_FEEDBACK_URL'
```

Host 一半不注册任何内容。侧栏展开时，这一行显示纸飞机图标和 反馈；侧栏收起时只显示图标，并为读屏软件提供标签。

窗口标题是 DreamVerse 用户反馈，问题照搬 DeepSeek Harness 表单，只把 Harness 换成 DreamVerse。表单在截图问题的提示里让用户使用 `/feedback` 命令，而 DreamVerse 隐藏了这个命令；窗口改为说明项目和对话的编号会自动附上，并把提示里的 会话日志 做成链接，下载 URL hash 中那段对话的日志：`@deepseek-ai/dsh-session-log-export` 的文档相对路由 `api/session.export?sessionId=<id>&includeDescendants=true`，保存为 `dsh-session-<id>.zip`。用户像附上其他文件一样附上下载的 ZIP。没有对话时，这几个字是普通文字。所有带 `*` 的必答题都有回答后，发送 按钮才可用。

| 问题 | 回答 |
| --- | --- |
| * 你想反馈什么？ | 遇到问题（打开窗口时默认选中）、功能建议、使用咨询、其他，四选一 |
| * 反馈涉及哪些方面？ | 回答与任务完成效果、文件与生成产物、工具、插件与扩展、页面显示与操作、速度与稳定性、DreamVerse 安装、登录与配置、安全与隐私、其他 / 不确定，至少选一项 |
| * 请描述你的问题或建议 | 不为空的自由文本 |
| * 添加截图或会话日志 | 至少一个文件：粘贴到窗口里、拖到 粘贴或拖拽文件到这里，或用 上传本地文件 选择；列出的每个文件都有移除按钮 |
| 联系邮箱（选填） | 邮箱地址，或留空 |

除了回答，一次提交还附带打开的项目、`@dv/ui-shell` 写在 URL hash 里的视图和对话、界面语言、屏幕的物理分辨率、浏览器的 user agent，以及构建时的 `DSH_CLIENT_VERSION` 和 `DSH_CLIENT_COMMIT_HASH`；窗口在末尾写明了这一点。文件以 base64 放在 JSON 正文里，数量和大小受主机的 `maxAttachments` 和 `maxAttachmentBytes` 限制。它从不附带对话内容，也不读取可能包含访问令牌的 URL 查询字符串。

| 结果 | 用户看到的 |
| --- | --- |
| 路由回复 200 | 窗口关闭，草稿清空，弹出提示 已收到你的反馈，谢谢！ |
| 路由回复错误 | 窗口保持打开、草稿和文件保留，并显示 反馈没有发出去：<原因> |
| 用户关闭窗口 | 草稿保留到下次打开；发送进行中时关闭无效 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`apply` 在 effect 中把 `FeedbackAction` 注册到 `sidebar.footer.action`（id 为 `dv-feedback`），所以卸载插件会移除这一行。`FeedbackAction` 用 React 状态保存打开状态、草稿、发送状态和失败原因，并渲染 DSH 的 `Modal`、`Button` 和 `Toast` 基础组件；反馈类型和方面的标签是 `@dv/feedback/types` 中 `FeedbackKind` 和 `FeedbackArea` 联合类型的完整记录，所以新增的类型或方面在这里有标签之前会编译失败。`submissionOf` 通过 `@dv/ui-kit` 的 `getCurrentProject` 读取打开的项目，`sendFeedback` 向 `/api/dv/feedback` 发送请求，出错时抛出带路由 `error` 文本的 `DvApiError`。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Host 一半，不注册任何内容 |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | CSS Module 导入的类型 |
| [`src/client/index.ts`](src/client/index.ts) | 把这一行注册到 `sidebar.footer.action` |
| [`src/client/FeedbackAction.tsx`](src/client/FeedbackAction.tsx) | 按钮行、窗口、提示，以及它们的中英文文案 |
| [`src/client/FeedbackAction.module.css`](src/client/FeedbackAction.module.css) | 按钮行（与 设置 行一致）和窗口的样式 |
| [`src/client/submission.ts`](src/client/submission.ts) | 提交内容、文件的 base64 读取，以及发往路由的请求 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/feedback`](../feedback/README.zh.md)——路由、它的检查，以及如何创建反馈表格。
- [`@dv/ui-shell`](../ui-shell/README.zh.md)——本包读取的打开项目和 URL hash。

-----

<a id="model-experience"></a>
## 模型体验

无，因为窗口把反馈发到 harness 之外的表格，不增加模型请求或 Session 事件。

#### KV Cache 影响

无直接影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **限制在发送后才提示**：窗口不知道主机的文件限制，所以文件太大或太多，要到点 发送 后才会以路由的 400 原因显示。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。插件只持有一个 slot 注册，随插件 fiber 释放；规格测试验证释放插件会移除该条目，因此不存在需要在运行时检查的第二权威来源。
