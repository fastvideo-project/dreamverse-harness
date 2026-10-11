---
description: "DreamVerse 技能页：左侧导航里的 技能 入口，列出创作者可以用 /名称 启动的技能，使用 按钮会把 /名称 放进对话输入框；首页 探索 分区的 技能 标签显示同样的卡片。"
kind: "package-reference"
---

# @dv/ui-skills

[English](README.md) | 中文

## 概述

使用本包把 DreamVerse 的技能，也就是智能体照着执行的成文流程，展示给创作者。本包在左侧导航的 首页 下面加入 技能 / Skills；页面列出创作者可以用 `/名称` 启动的所有技能，每个技能一张卡片；首页的 探索 / Explore 分区在 技能 / Skills 标签里显示同样的卡片。使用 / Use 关闭页面，并把 `/名称` 放进对话输入框。只供智能体自己使用的技能（例如 `fasth3-text-prompting`）声明用户不能调用，所以页面不列出它们。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app`（提供侧边栏、主栏、`skills` Remote 和客户端模块加载器）和 `@dv/ui-shell`（它的导航在 首页 下面列出 `sidebar.panellist` 入口，它的首页声明 `dv.explore` 插槽）的 profile 里挂载插件。先构建浏览器 bundle：`pnpm run build` 会写出 `lib/client.js`。

```yaml
- id: dv-ui-skills
  name: '@dv/ui-skills'
```

Host 端不注册任何东西。浏览器端在 `main` 槽位以面板 id `skills` 注册页面，在 `sidebar.panellist` 以顺序 2 注册导航入口，排在 插件 / Plugins 之后，并在 `dv.explore` 以 id `skills`、顺序 1 注册 探索 标签，排在 MCP 之后。页面和标签共用同一个列表读取和 使用 操作。每个 DreamVerse 对话都使用同一个 DreamVerse 智能体预设，所以页面通过对话当前显示的会话读取列表；没有这个会话时，使用列表中最新的会话。

| 操作 | 请求或事件 |
| --- | --- |
| 打开 技能 / Skills，或 探索 的 技能 标签 | 用对话的会话调用 `skills/list` Remote；每次打开页面或标签都重新读取 |
| 卡片上的 使用 / Use | 布局的主栏回到中间区域，然后 `dv:compose` `{text: '/名称', refs: []}` 预填对话输入框 |
| 在 探索 的 技能 标签点 使用 / Use | 右侧面板槽位里那个会话（首页输入框编辑的就是它）的草稿通过会话输入接口变成 `/名称 `；不发 `dv:compose`，所以右侧面板保持关闭 |
| 读取失败后的 重试 / Retry | 再次调用 `skills/list` |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`apply` 构造注入的 `list` 和 `use` 操作，并通过 `ctx.effect` 注册页面、入口和标签，所以卸载插件会移除这三者。`SkillsPage` 和 `SkillsShelf`（标签）共用 `SkillList`，它保存一个读取状态（`loading`、`ready`、`failed`），并按名称排序技能。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 不做任何事的 Host 入口 |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | CSS Module 导入的类型 |
| [`src/client/index.ts`](src/client/index.ts) | 注册、读取列表所用会话的选择，以及 使用 操作 |
| [`src/client/SkillsPage.tsx`](src/client/SkillsPage.tsx) | 页面、探索 标签、它们的卡片和导航图标 |
| [`src/client/SkillsPage.module.css`](src/client/SkillsPage.module.css) | 页面和标签的样式 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/bundle`](../../bundle/dv/README.zh.md) — 挂载本包的 DreamVerse profile。
- [`@dv/ui-shell`](../ui-shell/README.zh.md) — 列出侧边栏页面的导航，以及 探索 分区。
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
- **没有会话就没有列表** — `skills` Remote 按会话寻址；还没有任何会话时，页面显示空列表提示。
