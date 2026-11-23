---
description: "DreamVerse 技能页：左侧导航里的 技能 入口，列出创作者可以用 /名称 启动的技能，使用 按钮会把 /名称 放进对话输入框。"
kind: "package-reference"
---

# @dv/ui-skills

[English](README.md) | 中文

## 概述

使用本包把 DreamVerse 的技能，也就是智能体照着执行的成文流程，展示给创作者。本包在左侧导航的 首页 下面加入 技能 / Skills；页面列出创作者可以用 `/名称` 启动的所有技能，每个技能一张卡片。使用 / Use 关闭页面，并把 `/名称` 放进对话输入框。只供智能体自己使用的技能（例如 `fasth3-text-prompting`）声明用户不能调用，所以页面不列出它们。

输入框底部的技能按钮和左侧导航的技能入口都会打开技能页面。技能页面默认打开**我的 Skills**，并提供独立的**可用技能**列表和名称、描述搜索。支持上传带 YAML `name`、`description` 元数据和非空指令的 Markdown 文件，或包含一个 `SKILL.md` 及同目录资源的 ZIP 包。技能保存在服务器的 `$DSH_HOME/dreamverse-skills`（默认 `~/.dsh/dreamverse-skills`），重启后仍保留，创建首个对话前也可上传。点击使用会填入 `/name`。与已保存或宿主已注册技能重名的上传会被拒绝，不覆盖已有技能。技能库属于当前 Harness 实例，不是独立账号库或浏览器本地缓存。 文件选择按钮和未选择文件提示跟随页面语言，已选择的文件名保持原样显示。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app`（提供侧边栏、主栏、`skills` Remote 和客户端模块加载器）和 `@dv/ui-shell`（它的导航在 首页 下面列出 `sidebar.panellist` 入口）的 profile 里挂载插件。先构建浏览器 bundle：`pnpm run build` 会写出 `lib/client.js`。

```yaml
- id: dv-ui-skills
  name: '@dv/ui-skills'
```

Host 端不注册任何东西。浏览器端在 `main` 槽位以面板 id `skills` 注册页面，在 `sidebar.panellist` 以顺序 2 注册导航入口，排在 插件 / Plugins 之后，并在 `conversation.input.left` 注册输入框的技能按钮。每个 DreamVerse 对话都使用同一个 DreamVerse 智能体预设，所以页面通过对话当前显示的会话读取列表；没有这个会话时，使用列表中最新的会话。

| 操作 | 请求或事件 |
| --- | --- |
| 打开 技能 / Skills | 用对话的会话调用 `skills/list` Remote；每次打开页面都重新读取 |
| 卡片上的 使用 / Use | 先把 `/名称 ` 写入打开技能页的输入框所属会话的持久草稿（从侧边栏打开时使用右侧面板会话），再关闭页面并聚焦输入框；会话输入接口尚未就绪时，回退到 `dv:compose` `{text: '/名称', refs: []}` |
| 读取失败后的 重试 / Retry | 再次调用 `skills/list` |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`apply` 构造注入的 `list` 和 `use` 操作，并通过 `ctx.effect` 注册页面、入口和输入框按钮，所以卸载插件会移除这三者。`SkillsPage` 渲染 `SkillList`，它保存一个读取状态（`loading`、`ready`、`failed`），并按名称排序技能。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 不做任何事的 Host 入口 |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | CSS Module 导入的类型 |
| [`src/client/index.ts`](src/client/index.ts) | 注册、读取列表所用会话的选择，以及 使用 操作 |
| [`src/client/SkillsPage.tsx`](src/client/SkillsPage.tsx) | 页面、它的卡片和导航图标 |
| [`src/client/SkillsPage.module.css`](src/client/SkillsPage.module.css) | 页面和标签的样式 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/bundle`](../../bundle/dv/README.zh.md) — 挂载本包的 DreamVerse profile。
- [`@dv/ui-shell`](../ui-shell/README.zh.md) — 列出侧边栏页面的导航。
- [`@dv/ui-composer`](../ui-composer/README.zh.md) — `dv:compose` 预填。
- [`@deepseek-ai/dsh-tool-skill`](../../skill/tool-skill/README.zh.md) — `/名称` 调用和模型的技能列表。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `dsh-tool-skill`；使用 只填写输入框，用户发送消息后，`dsh-tool-skill` 注入所点名的技能，技能才到达模型。

#### KV Cache 影响

无；页面不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **英文说明** — 卡片按技能文件原样显示 `description`；技能文件只有一份说明，模型也读它，所以页面没有这些技能的中文说明。
- **可用技能列表需要会话** — 可用技能通过按会话寻址的 Remote 读取；我的 Skills 和上传不依赖会话。附带资源按原样保存；上传脚本不会添加工具或执行脚本。
