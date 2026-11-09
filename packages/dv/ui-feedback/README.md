---
description: "DreamVerse Feedback button above Settings in the left sidebar: a dialog that sends a problem, suggestion or question, with the build and the open project, to the feedback sheet."
kind: "package-reference"
---

# @dv/ui-feedback

English | [中文](README.zh.md)

## Summary

Use this package to let DreamVerse users send feedback without leaving the app. It registers 反馈 / Feedback in the `sidebar.footer.action` slot, which the left sidebar draws above Settings. The button opens a dialog with the questions of the DeepSeek Harness user feedback form; 发送 / Send posts the answers to the route of [`@dv/feedback`](../feedback/README.md) with the build and where the browser is, and a toast thanks the person once the feedback sheet stored it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app`, together with the `dv-feedback` row of `@dv/feedback`. Build the browser bundle first: `pnpm run build` writes `lib/client.js`. In [`@dv/bundle`](../../bundle/dv/README.md), both rows follow `DV_FEEDBACK_URL`:

```yaml
- id: dv-ui-feedback
  name: '@dv/ui-feedback'
  disabled: !!js '!process.env.DV_FEEDBACK_URL'
```

The Host half registers nothing. In the wide sidebar the row shows the paper plane icon and 反馈 / Feedback; on the rail it shows the icon alone, labeled for screen readers.

The dialog, titled DreamVerse 用户反馈 / DreamVerse User Feedback, copies the questions of the DeepSeek Harness form, with DreamVerse in place of Harness. The form's hint on the screenshot question points to the `/feedback` command, which DreamVerse hides; the dialog says instead that the project and chat session IDs are attached automatically, and its words 会话日志 / conversation logs link to the log download of the chat session in the URL hash: the document-relative `api/session.export?sessionId=<id>&includeDescendants=true` route of `@deepseek-ai/dsh-session-log-export`, saved as `dsh-session-<id>.zip`. The person attaches the downloaded ZIP like any other file. Without a chat session the words are plain text. 发送 / Send is enabled once every required question, marked `*`, has an answer.

| Question | Answer |
| --- | --- |
| * 你想反馈什么？ / What would you like to share? | One of 遇到问题 / Report a problem (chosen when the dialog opens), 功能建议 / Suggest a feature, 使用咨询 / Ask a question, 其他 / Other |
| * 反馈涉及哪些方面？ / Which areas does your feedback relate to? | At least one of 回答与任务完成效果 / Response and task quality, 文件与生成产物 / Files and generated content, 工具、插件与扩展 / Tools, plugins and extensions, 页面显示与操作 / Interface and interactions, 速度与稳定性 / Speed and stability, DreamVerse 安装、登录与配置 / DreamVerse setup, sign-in and settings, 安全与隐私 / Safety and privacy, 其他 / 不确定 / Other / Not sure |
| * 请描述你的问题或建议 / Please describe your issue, suggestion, or question | Free text that is not blank |
| * 添加截图或会话日志 / Upload screenshots or session log | At least one file, pasted into the dialog, dropped on 粘贴或拖拽文件到这里 / Paste or drag files here, or chosen with 上传本地文件 / Upload local files; each listed file has a remove button |
| 联系邮箱（选填） / Email address (Optional) | An email address, or blank |

Besides the answers, a submission carries the open project, the view and the chat session from the URL hash that `@dv/ui-shell` writes, the interface language, the physical screen resolution, the user agent, and the build's `DSH_CLIENT_VERSION` and `DSH_CLIENT_COMMIT_HASH`; the dialog says so at its end. Files travel as base64 in the JSON body, and the host's `maxAttachments` and `maxAttachmentBytes` bound them. It never carries chat content or the URL's query string, which can hold the access token.

| Outcome | What the person sees |
| --- | --- |
| The route answers 200 | The dialog closes, the draft clears, and the toast 已收到你的反馈，谢谢！ / Thanks, your feedback was sent. appears |
| The route answers an error | The dialog stays open with the draft and its files and shows 反馈没有发出去：<reason> / Feedback was not sent: <reason> |
| The person closes the dialog | The draft stays for the next opening; closing is ignored while a send is running |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` registers `FeedbackAction` in `sidebar.footer.action` (id `dv-feedback`) inside an effect, so unloading the plugin removes the row. `FeedbackAction` keeps the open state, the draft, the sending state and the failure in React state and renders the DSH `Modal`, `Button` and `Toast` primitives; the kind and area labels are complete records of the `FeedbackKind` and `FeedbackArea` unions of `@dv/feedback/types`, so a new kind or area is a compile error here until it has a label. `submissionOf` reads the open project through `getCurrentProject` of `@dv/ui-kit`, and `sendFeedback` posts to `/api/dv/feedback` and throws `DvApiError` with the route's `error` text.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The Host half, which registers nothing |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | The type of the CSS Module imports |
| [`src/client/index.ts`](src/client/index.ts) | Registration of the row in `sidebar.footer.action` |
| [`src/client/FeedbackAction.tsx`](src/client/FeedbackAction.tsx) | The row, the dialog, the toast, and their Chinese and English copy |
| [`src/client/FeedbackAction.module.css`](src/client/FeedbackAction.module.css) | Styles of the row, which match the Settings row, and of the dialog |
| [`src/client/submission.ts`](src/client/submission.ts) | The submission body, the base64 reading of the files, and the request to the route |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/feedback`](../feedback/README.md) — the route, its checks, and how to create the feedback sheet.
- [`@dv/ui-shell`](../ui-shell/README.md) — the open project and the URL hash this package reads.

-----

<a id="model-experience"></a>
## Model Experience

None, as the dialog sends feedback to a sheet outside the harness and adds no model request or Session event.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Limits found late** — the dialog does not know the host's file limits, so a file that is too large or one too many is reported only after 发送 / Send, as the route's 400 reason.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin owns one slot registration, released with the plugin fiber; the spec checks that disposing the plugin removes the entry, so no second authority exists to check at runtime.
