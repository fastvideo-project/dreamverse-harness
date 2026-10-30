---
description: "DreamVerse 文本节点的浏览器半边：认领 textnode.write 和 textnode.edit 记录的画布节点类型，显示开头几行和版本的卡片，Markdown 中引用显示为标签、以 base_version 保存下一个版本的编辑器，文本节点的 @ 提及类型，以及文本节点记录的历史行。"
kind: "package-reference"
---

# @dv/ui-text-node

[English](README.md) | 中文

## 概述

用这个包在画布上显示和编辑 [`@dv/text-node`](../text-node/README.zh.md) 的文本节点。文本节点的每个版本是一个画布节点；标题栏显示标题和 `v<version>`，卡片以纯文本显示开头几行，并显示 `v3 · 1,240 chars` 这样的页脚。编辑器显示 Markdown，每个引用显示为一个标签，保存 / Save 用 `textnode.write` 和草稿的 `base_version` 写入下一个版本。本包还在 `@` 菜单中列出文本节点，并在历史中为每条 `textnode.` 记录写出路径和版本。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠加了 `dsh-web-app`、`@dv/api`、`@dv/text-node`、`@dv/ui-canvas`、`@dv/ui-media` 和 `@dv/ui-composer` 的配置中挂载本插件。先构建浏览器包：`pnpm run build` 写出 `lib/client.js`。

```yaml
- id: dv-ui-text-node
  name: '@dv/ui-text-node'
```

| 描述符 | 注册表 | 值 |
| --- | --- | --- |
| `textNodeType` | `dvCanvas.nodeTypes` | `id: '@dv/ui-text-node'`、`type: 'textnode'`、标签 `文本` / `Text`、颜色 `var(--dv-node-5)`、第 0 列；它认领操作 `textnode.write` 和 `textnode.edit`，所以每条记录是一个节点：标题是报告的 `title`（否则是路径），附注 `v<version>`，`bodyHeight` 为 106 |
| `TextCard` | `dv.canvas.card` 插槽 | 键 `textnode`；版本 Markdown 的开头几行，从 `/dv/assets/<asset>` 读取，每个素材只读一次，以纯文本显示，每个引用显示为其标签，以及含版本和正文码位数的页脚 |
| `TextEditor` | `dv.canvas.editor.claimed` 插槽 | 键 `textnode`；页脚，以及与卡片相同地从版本素材读取、渲染为 Markdown 的正文，其每个引用是 `@dv/ui-composer` 的 `@` 源 `dv-project` 的标签；在最新版本上，编辑 / Edit 打开带同样标签和 `@` 选择器的 `conversation.prompt` 编辑器，其菜单在编辑器下方打开，在较早版本上，打开第 N 版 / Open version N 打开最新版本 |
| `textMentionKind` | `dvMentions.kinds` | `id: '@dv/ui-text-node'`、`kind: 'textnode'`、顺序 4、分组 `文本` / `Texts`；每个文本节点一项：URI `dv:textnode/<path>`，标签为标题，描述为第一行的前 40 个字符 |
| `textHistoryRow` | `dvHistory.rows` | `match: 'textnode.'`；主题是 ` <path> v<version>`，否则是 ` <path>` |

-----

<a id="understand-the-implementation"></a>
## 理解实现

文本节点版本是被认领的节点，所以画布从记录画出它的边，本包不需要代码：`@dv/text-node` 为版本所依据的每个文本节点写一个 `source` 输入 `{record, output}`，它从该来源版本画一条边；第一个版本之后每个版本的 `based_on` 从上一个版本画出谱系边。过期标记来自内核对该记录的过期标记。保存通过本包自己的 `DvClient` 调用 `POST /api/dv/operation`，带 `textnode.write`、参数 `path`、`body` 和 `base_version`、最新版本的 `source` 输入（每个都移到其文本节点的最新版本），以及 `based_on` 最新版本的记录；保存成功后关闭编辑器。当最新版本 N 晚于草稿的版本 M 时，编辑器保留草稿，显示 `有人先保存了第 N 版。你的草稿基于第 M 版。` / `Someone saved version N first. Your draft is based on version M.`，保存按钮显示 `保存为 vN 之后的新版本` / `Save on top of vN`，它以 `base_version` N 保存。其他拒绝以及返回 `failed` 或 `cancelled` 的记录显示其错误，并保留草稿。

编辑器和标签复用 `@dv/ui-composer` 的入口：`@dv/ui-composer/mention` 的 `MENTION_SOURCE`，`@dv/ui-composer/reference-model` 的 `editorContent`、`resolveAtom` 和 `faceOf`，以及 `@dv/ui-composer/reference-face` 的标签外观 `ReferenceFace`。阅读模式用 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`（DSH 对话的渲染器）渲染 Markdown，并用 `MarkdownDelegateProvider` 通过 Factory `dv.text.reference` 绘制每个引用链接；本包注册该 Factory，其组件为 `ReferenceFace`。每个标签携带它的外观，外观按画布状态和 `dvCanvas` 的版本类型解析，所以标签显示被引用条目的最新版本。编辑模式下编辑器传入为 null 的 `faceContext`，所以每个标签读取已打开项目的状态，与对话标签相同。

每个界面文本都来自 `dv-text-node` 词典，`apply` 通过 `@deepseek-ai/dsh-client-locale` 的 `ctx.locale` 注册它。保存的 `intent` 由智能体读取，为英文。

| 文件 | 内容 |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | 节点类型、提及类型、历史行和 `apply` |
| [`src/client/TextCard.tsx`](src/client/TextCard.tsx) | 卡片正文、Markdown 读取和页脚 |
| [`src/client/TextEditor.tsx`](src/client/TextEditor.tsx) | 编辑器及其保存 |
| [`src/client/texts.ts`](src/client/texts.ts) | `textnode` 切片和记录读取函数 |
| [`src/client/locales.ts`](src/client/locales.ts) | 基于 `locales/en.json` 和 `locales/zh.json` 的 `dv-text-node` 词典命名空间 |
| [`src/index.ts`](src/index.ts) | 空的宿主半边 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/text-node`](../text-node/README.zh.md)：操作和 `source` 输入。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md)：被认领的节点、边和编辑器插槽。
- [`@dv/ui-composer`](../ui-composer/README.zh.md)：`@` 源和标签外观。

-----

<a id="model-experience"></a>
## 模型体验

### 文本节点记录

#### 模型看到什么

模型看不到本包的任何文本。保存写入一条 `surface: canvas` 的 `textnode.write` 记录，它通过 `@dv/project` 的项目块和 `@dv/text-node` 的 `texts` 摘要到达模型。

#### Token 影响

本包没有影响；每个保存的版本增加 `@dv/text-node` 为一个版本记录的 token。

#### KV Cache 影响

与任何画布写入相同，保存从下一次智能体请求起改变项目块。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **每个版本一个节点**：与每条被认领的记录相同，每个版本是它自己的画布节点，并以谱系边连接上一个版本。
- **画布上没有来源选择器**：画布保存保留最新版本的来源，每个来源取其最新版本；只有智能体写入会设置 `from`。
