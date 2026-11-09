---
description: "DreamVerse 的文本节点组件：dvTextNode 服务，项目中以相对路径 TextPath 寻址、带编号版本的 Markdown 文档，操作 textnode.write、textnode.edit 和 textnode.read 及其智能体工具，base_version 守卫，文本节点之间的来源链接，text-node 技能，以及 textnode 状态切片。"
kind: "package-reference"
---

# @dv/text-node

[English](README.md) | 中文

## 概述

用这个包把一段视频的规划文本保存在项目中，例如剧本、故事节拍、广告规格或评审笔记。一个文本节点是一份 Markdown 文档，位于调用方选择的路径（例如 `beats.md`），带有编号的版本，在新的轮次和新的对话中保留。智能体用 `dv_textnode_write` 写入，用 `dv_textnode_edit` 修改几行，用 `dv_textnode_read` 读取；`base_version` 不是最新版本时写入被拒绝。界面把这些工具显示为 写入文本 / Write text、修改文本 / Edit text 和 读取文本 / Read text。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project` 之后挂载本插件；素材库为每个版本存储一个 `text/markdown` 文件。归约函数维护 `textnode` 切片：每个文本节点的每个版本。挂载 DSH 技能注册表时，本插件还注册 `text-node` 技能，它告诉智能体何时写入、何时修改，以及每次写入都传 `base_version`。[`@dv/canvas`](../canvas/README.zh.md) 的 `dvCanvasNodes` 加载期间，本插件把 `textnode.write` 注册为第 0 列 `text` 节点的 maker，所以一个路径的第一次写入产生它的画布节点。

```yaml
- id: dv-text-node
  name: '@dv/text-node'
```

本插件没有配置字段。

| 操作 | 工具 | 参数 | 输出和报告 | 确认 |
| --- | --- | --- | --- | --- |
| `textnode.write` | `dv_textnode_write` | `path`、`body`（完整的 Markdown 文本）、`title?`、`base_version`；工具参数 `from?` | `text`（`text/markdown`）；报告 `{path, version, title, chars}` | `never` |
| `textnode.edit` | `dv_textnode_edit` | `path`、`edits`（每项含 `old_text` 和 `new_text`）、`base_version` | `text`（`text/markdown`）；报告 `{path, version, title, chars}` | `never` |
| `textnode.read` | `dv_textnode_read` | `path`、`section?`（一个标题的文本）、`version?` | 无记录；报告 `{path, version, title, chars, section?, text}` | `never` |

`TextPath` 是不含空白字符、`@`、`#` 或 `..`，不以 `/` 开头，且斜杠之间没有空段或 `.` 段的相对路径；每个操作都在写任何记录之前拒绝其他路径。本插件不注册引用类型，所以文本节点不能作为其他操作的 `inputs` 引用；智能体在 `texts` 摘要中找到文本节点。版本从 1 开始编号。`base_version` 是必填参数：调用方最后读取的版本，新路径为 `0`。`base_version` 不是最新版本的写入或修改会被拒绝，拒绝消息告诉智能体重新读取该文本节点。同一路径的另一次写入或修改仍在等待或运行时，写入或修改会被拒绝，拒绝消息告诉智能体用 `dv_proj_wait` 等待。一个版本的标题是这次写入的 `title`，否则是上一个标题，否则是正文的第一个标题，否则是路径。切片 `components.textnode` 是 `{texts: Record<TextPath, TextVersion[]>}`，最早的版本在前；`TextVersion` 是 `{version, title, body, asset, created_by}`，其路径是它的键。浏览器从 `@dv/text-node/types` 读取这些类型。

写入可以在工具参数 `from` 中列出它所依据的文本节点，例如剧本所依据的节拍。每个路径成为一个 `source` 输入 `{record, output: 0}`，指向写出该文本节点最新版本的记录，所以当来源的新版本取代那条记录时，内核把这次写入标记为过期，画布从每个来源画一条边。每个路径只计一次；同时传入 `from` 和 `inputs` 会被拒绝，首次写入仍在等待或运行的来源也会被拒绝，拒绝消息告诉智能体等待。不带 `from` 的写入或修改保留上一个版本的 `source` 输入，所以之后的修改保留链接和过期标记；`from: []` 去掉它们。版本 1 之后的每次写入都 `based_on` 上一个版本的记录。画布上的人工写入自己发送 `source` 输入，因为只有智能体调用会运行 `prepareToolCall`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`textnode.write` 和 `textnode.edit` 用同一个纯函数 `nextText` 计算下一个标题和正文，归约函数也用它，所以被拒绝的修改与被归约的修改一致。在写入记录之前，对每个调用方，它们拒绝错误的路径、缺失或过期的 `base_version`、该路径另一次写入尚未结束时的写入，以及（对 `textnode.edit`）空的 `edits` 列表和每个 `old_text` 为空或在前面的修改留下的文本中出现次数不恰好为一次的修改。每次调用通过 `context.importAsset` 导入正文，并取代上一个版本的记录，所以内核的过期规则会标记每条以上一个素材为输入的记录。没有 `based_on` 的调用以该记录为 `based_on`（`OperationSpec.basedOn`），所以一个路径的每个版本都加入同一个画布节点。对运行器而言，这两个操作都不是确定性的：修改依赖上一个正文，所以运行器从不复用更早的输出。`textnode.read` 是读取：它不写记录，并用从 1 开始的行号和一个制表符为每行编号。一节从它的标题开始，到下一个同级或更高级的标题为止；围栏代码块中的行从不算作标题。项目锁使版本检查串行进行，所以 `execute` 和归约函数从同一个上一版本开始，算出同一个正文。

归约函数忽略不是 `done` 的记录和其他操作的记录。智能体摘要把每个文本节点列出一次，形式为 `{path, title, version, chars, asset}`：最新版本，不含正文。`chars` 计算 Unicode 码位数。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvTextNode`：三个操作、`base_version` 检查、来源链接和 `text-node` 技能 |
| [`src/reducer.ts`](src/reducer.ts) | `textnode` 归约函数、`nextText` 和智能体摘要 |
| [`src/text.ts`](src/text.ts) | 路径解析、字面修改、标题小节和行号 |
| [`src/types.ts`](src/types.ts) | `TextPath`、`TextEdit`、`TextVersion`、`TextState` |
| [`skills/text-node/SKILL.md`](skills/text-node/SKILL.md) | `text-node` 技能 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/project`](../project/README.zh.md)：操作、记录、过期标记、归约函数和智能体工具。
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md)：每个组件遵循的布局。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

三个工具 `dv_textnode_write`、`dv_textnode_edit` 和 `dv_textnode_read`，采用 `@dv/project` 给每个操作工具的格式；`dv_textnode_read` 以读取说明结尾，不接受 `supersedes` 或 `based_on`。打包测试 `packages/bundle/dv/tests/expected/tools/text-node.json` 固定完整定义。描述如下：

##### dv_textnode_write description

```markdown
Write the whole Markdown text of a text node as its next version; a new path starts at version 1. A text node holds planning text such as a script, story beats or an ad spec. base_version is the version you read, so you never overwrite a version you have not read; 0 for a new path. For a small change to a long text, call dv_textnode_edit instead.
```

##### dv_textnode_edit description

```markdown
Change a text node by literal replacements and write the result as its next version. The edits apply in order; each old_text must occur exactly once in the text, so copy it from dv_textnode_read without the line numbers and add neighboring lines when it repeats. When any edit does not apply, nothing is written. base_version is the version you read.
```

##### dv_textnode_read description

```markdown
Read a text node with line numbers: the whole text, or one section (a heading and its lines up to the next heading of the same or a higher level). The newest version unless you pass version. dv_proj_state lists the text nodes under texts. A read that writes no record.
```

#### Token 影响

三个定义约 1,800 个 token（7,061 个字符的 JSON，按每 4 个字符一个 token 估算），挂载本插件期间固定不变。项目摘要在 `texts` 下为每个文本节点增加约 20 个 token。

#### KV Cache 影响

这些定义位于每个智能体请求的稳定工具段中；挂载或移除本插件会改变工具列表，并使从工具段开始的缓存前缀失效。`texts` 列表属于 `dv:project` 提示词段，所以改变版本、标题或长度的写入会从下一个请求起改变该段。

### 工具结果

#### 模型看到什么

`dv_textnode_write` 调用返回一个文本块，例如 `done <record>: wrote beats.md v2`，含 `text/markdown` 输出、参数和报告 `{"path":"beats.md","version":2,"title":"Beats","chars":812}`；`dv_textnode_edit` 调用返回 `edited beats.md v3`。`dv_textnode_read` 调用返回 `done: dv_textnode_read answered` 和含 `text` 的报告，每个文本行一行，形式为 `<number>\t<line>`。过期的 `base_version` 被拒绝，消息为 `Text node beats.md is at version 3, not base_version 2: it changed since you read it. Call dv_textnode_read on beats.md again, then make your change on version 3.`；不适用的修改被拒绝，消息为 `dv_textnode_edit wrote nothing.` 加上每个失败修改的一句说明。

#### Token 影响

写入结果重复调用的参数，所以会再带一次完整正文；修改结果只带它的修改。读取结果带一次文本，加上行号。

#### KV Cache 影响

每个结果在其调用之后追加到对话中；缓存前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **重复标题**：多个标题文本相同时，`section` 读取第一个。
- **对话提及不展开**：本插件不注册引用类型，所以 `@dv/chat-references` 把 `@` 菜单中的 `dv:textnode/<path>` 提及描述为未知提及类型；智能体从 URI 读取路径。
- **写入结果重复正文**：每个操作工具的结果都重复其参数，所以较长的 `dv_textnode_write` 正文会两次到达模型。
- **镜头提示词不引用文本节点**：`shot.render` 拒绝不是素材或本次调用输入的引用，所以文本节点只能通过智能体读取它之后写出的提示词到达镜头。
