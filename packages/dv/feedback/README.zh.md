---
description: "DreamVerse 的反馈：一个需要认证的路由，检查侧栏反馈窗口提交的内容，并把它作为一行发送到配置好的表格。"
kind: "package-reference"
---

# @dv/feedback

[English](README.md) | 中文

## 概述

使用本包把 DreamVerse 用户的反馈收集到一张与 GitHub issue 列表分开的表格里。它注册 `POST /api/dv/feedback`，检查 [`@dv/ui-feedback`](../ui-feedback/README.zh.md) 反馈窗口提交的内容，连同收到的时间作为一行 JSON 发给一个 Google Apps Script 网页应用，由它把附件存到 Google Drive，并把这一行追加到 Google 表格。重复的反馈仍是各自的一行；由人阅读表格，为每个真实问题开一个 issue。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

[`@dv/bundle`](../../bundle/dv/README.zh.md) 的 `dv-feedback` 行从 `DV_FEEDBACK_URL` 读取接收地址；没有这个变量时，这一行和 `dv-ui-feedback` 行都关闭，DreamVerse 不显示反馈按钮。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `endpoint` | 必填 | 网页应用的 HTTPS 地址；存好一行后它回复 `{"ok": true}` |
| `timeoutMs` | `30000` | 等待网页应用回复的毫秒数，包括重定向 |
| `maxDescriptionChars` | `5000` | 描述最多的字符数 |
| `maxAttachments` | `5` | 一次提交最多附带的文件数 |
| `maxAttachmentBytes` | `5242880`（5 MiB） | 每个附件最多的字节数 |

创建接收地址：

1. 新建一张 Google 表格，在第一行写上列名 `time`、`kind`、`areas`、`description`、`attachments`、`email`、`project`、`session`、`view`、`locale`、`screen`、`user_agent`、`version`、`commit`。
2. 打开 扩展程序 → Apps Script，用下面的脚本替换原有代码并保存。每次提交，脚本都在 Drive 文件夹 `DreamVerse feedback`（第一次提交时自动创建）下新建一个以提交时间和类型命名的文件夹，例如 `2026-11-08T05:10:21.034Z problem`，把附件存进去，并把这个文件夹的链接写进 `attachments` 列。
3. 选择 部署 → 新建部署 → 网页应用，"执行身份"选"我"，"谁可以访问"选"任何人"，并允许 Google 要求的 Drive 和表格访问权限。复制以 `/exec` 结尾的网页应用地址。
4. 用 `DV_FEEDBACK_URL=<该地址>` 启动 DreamVerse，例如 `DV_FEEDBACK_URL=https://script.google.com/macros/s/<id>/exec scripts/video-harness/launch.sh web`。

```js
function doPost(e) {
  const row = JSON.parse(e.postData.contents)
  const roots = DriveApp.getFoldersByName('DreamVerse feedback')
  const root = roots.hasNext() ? roots.next() : DriveApp.createFolder('DreamVerse feedback')
  const folder = root.createFolder(row.time + ' ' + row.kind)
  row.attachments.forEach(file => folder.createFile(
    Utilities.newBlob(Utilities.base64Decode(file.data), file.type || 'application/octet-stream', file.name)))
  SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].appendRow([row.time, row.kind, row.areas.join(', '),
    row.description, folder.getUrl(), row.email || '', row.project, row.session, row.view, row.locale, row.screen,
    row.user_agent, row.version, row.commit])
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON)
}
```

脚本以部署它的账号运行，所以提交反馈的人不需要 Google 账号；把表格和文件夹共享给阅读反馈的人即可。拿到这个地址的任何人都能追加行，所以不要把它发到聊天里或写进提交。

| 请求 | 回复 |
| --- | --- |
| 各字段都通过检查的提交 | 网页应用回复 `{"ok": true}` 后，回复 200 `{"ok": true}` |
| 正文不是 JSON、`kind` 或方面未知、没有方面或同一方面出现两次、描述为空或超过 `maxDescriptionChars` 个字符、没有附件或超过 `maxAttachments` 个、附件没有名字或数据不是不超过 `maxAttachmentBytes` 字节的 base64、邮箱不是 `@` 两边都有内容的地址，或上下文字段不是字符串（或在允许处不是 null） | 400 `{"error"}`，说明是哪个字段；不发送任何内容 |
| 网页应用出错、超时，或没有用成功状态回复 `{"ok": true}` | 502 `{"error"}`；回复里从不包含接收地址 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

`apply` 用 `ctx.inject` 等待可选的 `connection` 服务，并在该作用域的 effect 中注册 Fetch 路由，所以只有挂载了 Connection 时路由才存在，卸载插件会移除它。`parseSubmission` 在这个线路边界检查 [`FeedbackSubmission`](src/types.ts) 的每个字段，`sendRow` 用 `redirect: 'follow'` 发送这一行：Apps Script 对 POST 的回复是一个指向脚本输出的重定向。出错的 Apps Script 会用状态 200 回复一个 HTML 错误页，所以只有 JSON 确认 `{"ok": true}` 才算存好。本插件不往项目、会话日志或 GitHub 写任何内容，接收地址只留在主机上。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 配置、路由、提交检查，以及发给网页应用的请求 |
| [`src/types.ts`](src/types.ts) | 提交和行的类型，`@dv/ui-feedback` 以类型方式导入 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`@dv/ui-feedback`](../ui-feedback/README.zh.md)——向本路由发送反馈的按钮和窗口。
- [`@dv/bundle`](../../bundle/dv/README.zh.md)——`dv-feedback` 行和 `DV_FEEDBACK_URL`。

-----

<a id="model-experience"></a>
## 模型体验

无，因为反馈发到 harness 之外的表格，不增加模型请求或 Session 事件。

#### KV Cache 影响

无直接影响。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **不自动附带会话日志**：每次提交都带有会话编号，但日志留在运行该会话的主机上；想分享日志的人要把它作为文件附上。
- **不合并重复**：每次提交都是单独的一行；合并重复的反馈由阅读表格的人来做。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。插件只持有一个 Fetch 路由注册，随插件 fiber 释放；规格测试验证卸载插件会移除该路由，因此不存在需要在运行时检查的第二权威来源。
