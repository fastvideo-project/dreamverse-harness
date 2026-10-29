---
description: "DSH web 应用之上的 DreamVerse 外壳：中间区域的首页和项目工作区（画布或时间线）、左侧栏的项目导航，以及右侧面板的 对话 / 轨迹 标签。"
kind: "package-reference"
---

# @dv/ui-shell

[English](README.md) | 中文

## 概述

使用本包把 DSH web 应用变成 DreamVerse。没有打开项目时，中间区域显示首页：对话输入框、模板标签、最近项目和 探索。探索 为其他插件在 `dv.explore` 插槽（由中间区域声明）里注册的每一项显示一个标签，标签名和顺序由该项决定，例如 `@dv/ui-mcp-presets` 的 MCP 标签和 `@dv/ui-skills` 的 技能 标签，并显示选中标签的内容；它默认展开，点 收起 折叠，没有插件注册内容时不显示。打开项目后，它显示项目的一个视图，左侧栏默认收起。视图是其他插件在 `dv.center.view` 插槽（由中间区域声明）里注册的条目，每项是视图切换中的一个标签，标签名和顺序由该项决定：`@dv/ui-canvas` 的 画布 和 `@dv/ui-timeline` 的 时间线。左侧栏显示导航：新建项目、首页、DSH 侧栏页面（插件、MCP、技能，以及其他任何 `sidebar.panellist` 入口）、对话（在首页开始且没有项目持有的对话，最新的在前），以及 项目 → 对话 树。首页 打开本浏览器标签页的空白首页对话，只在这个对话打开时高亮；对话 里的一行在首页打开它的对话，并在该对话打开时高亮。外壳的每次导航都会关闭打开的侧栏页面，所以 首页 能离开插件页或 MCP 页。右侧面板多出 对话 和 轨迹 标签。外壳还注入 DreamVerse 主题：所有 DreamVerse 包使用的 `--dv-*` 变量，以及指向同一套配色的 DSH 别名变量。在文本框以外，Ctrl+Z（macOS 上用 Cmd+Z）把所打开项目往回移一步，Shift+Ctrl+Z（Shift+Cmd+Z）往前移一步；这些按键移动历史列表的当前位置，不写记录。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app`（提供侧栏、会话和 Workspace 服务以及客户端模块加载器）和 `@dv/api`（提供外壳调用的路由）的 profile 里挂载插件。同时挂载 `@dv/ui-asset-pool` 和 `@dv/ui-history`：右侧面板按钮和右侧面板的指南页会打开它们的标签。还要挂载 `@dv/ui-canvas` 和 `@dv/ui-timeline`：它们注册中间区域的 画布 和 时间线 视图。也要挂载 `@dv/ui-media`：它的 `dv.media` 组件工厂绘制项目封面。先构建浏览器 bundle：`pnpm run build` 会写出 `lib/client.js`。

```yaml
- id: dv-ui-shell
  name: '@dv/ui-shell'
```

Host 半边不注册任何东西。浏览器半边提供客户端服务 `dvCenter`（`@dv/ui-shell/contract` 的 `DvCenter`），并以优先级 -1 注册中间区域、导航和作为品牌名的 DreamVerse 字标以覆盖 DSH 的条目，注册 `dv-chat` 和 `dv-trajectory` 标签类型及其标签主体，以及提供 对话、素材库、历史 和 轨迹 的右侧面板指南页。它还隐藏 DreamVerse 不用的 DSH 界面（欢迎提示、侧栏的品牌图标、新会话按钮、展开侧栏中的页面列表（导航列出这些页面；收起的侧栏保留它们的图标）、输入框统计、上下文用量、Host 斜杠命令），改写几条 DSH 文字，并在浏览器标签页上用 DreamVerse 图标替换 DSH 的图标。工作区顶栏显示会话切换器（项目封面、项目名和对话标题；其菜单提供 首页、新建项目、本项目的对话和 新建会话，以及其他项目）、视图切换（画布 | 时间线）和右侧面板按钮；右侧面板按钮是一个 16 px 图标按钮，标签为 打开右侧面板 / Open the right panel，点击后打开 对话、素材库 和 历史。该按钮只在右侧面板收起时出现（`ctx.sidebarRight.expanded`），位置就是面板展开时它自己收起按钮所在的角落。右侧面板默认宽 448 px，正好放下三个标签和当前标签的关闭按钮，用户拖动边缘后改用拖动的宽度。首页显示标题 今天想拍点什么？、不可用的 从模板开始 标签，以及以封面卡片显示的两个最新项目（全部项目 显示其余项目）。项目卡片和会话切换器通过 `dv.media` 组件工厂绘制封面素材，卡片上用途为 `card`，切换器里为 `thumb`，依据概要发送的素材 ID 和 MIME 类型。发送第一条消息时这些部分即离开页面，所以在 turn 开始前，该消息的气泡已显示在对话中。URL hash 的形式为 `#project=<id>&view=<view>&<field>=<value>&session=<id>`，所以刷新、后退和前进都能恢复位置。`view` 是所显示 `dv.center.view` 条目的 `id`；没有它时中间区域显示 `canvas`，没有条目使用的 id 显示第一个视图。其他每个字段都是打开项目的中间区域字段，例如 `timeline=t2`，即 时间线 视图显示的时间线，所以 `#project=<id>&timeline=t2` 打开画布，之后 时间线 显示时间线 `t2`。

| 手势 | 请求或事件 |
| --- | --- |
| 页面加载，之后每 4 秒 | `GET /api/dv/workspaces`，读取项目、其 Workspace 和会话绑定 |
| 新建项目 | `POST /api/dv/projects`，标题取第一个未被占用的 未命名项目（带编号），然后 `POST /api/dv/workspaces` 关联为它创建的 Workspace；在其中打开一个空白对话 |
| 有项目的首页 | 一次 `GET /api/dv/projects/summary` 得到每张卡片的封面（项目第一条时间线上第一个有素材的片段，否则是项目产出的第一张图片）和最后编辑时间；项目列表变化时重新读取。切换器的封面使用中间区域字段指定的时间线 |
| 打开项目的工作区 | `GET /api/dv/projects/summary?project=<id>`，设置了中间区域字段 `timeline` 时把它作为其他查询字段，得到会话切换器的封面；项目或其中间区域字段每次变化后重新读取。路由从那条时间线取封面 |
| 打开项目（导航行、最近项目卡片或会话切换器） | `GET /api/dv/workspaces/sessions` 读取其存储的对话；主会话移到其最近的非空白对话，否则移到一个空白对话 |
| 项目行上的 ＋、会话切换器里的 新建会话，或 DSH 的新会话 | 在项目的 Workspace 里新建空白对话；在首页上，DSH 的新会话等于 首页 |
| 重命名项目（行菜单） | `POST /api/dv/projects/rename`；项目的 Workspace 同步改名 |
| 删除项目（行菜单，然后确认） | `POST /api/dv/projects/delete`（项目移到回收目录）；关联的 Workspace 被删除，打开中的项目回到 首页 |
| 导航中 对话 的一行 | 首页，主会话为该对话；智能体把该对话绑定到项目后，它离开列表 |
| 重命名或删除对话（行菜单） | DSH 的会话重命名，或停止其活动后归档；没有打开项目时删除打开的对话，会打开本标签页的空白首页对话 |
| 主会话位于某项目的 Workspace 但没有绑定 | `POST /api/dv/workspaces/bind` |
| `ctx.dvCenter.show({ view, target })`，例如选中的历史行（`@dv/ui-history`）或素材预览里的 插入片段（`@dv/ui-timeline`） | 显示 `view` 条目，并把 `target` 作为它的 owner prop `request` 的值交给它，直到它取走该请求；再次 `show`、换到另一个视图或另一个项目会丢掉视图还没取走的请求 |
| 视图的 owner prop `note(fields)`，例如用户在 时间线 视图（`@dv/ui-timeline`）里选的时间线 | 打开项目的中间区域字段改变（null 删除一个字段），URL hash 显示它们；已不再打开的项目的 note 不改变任何东西 |
| `dv:trajectory-focus` `{session, toolCall}` | 主会话移到 `session`，然后打开 轨迹 并滚动到该工具调用 |

工作区用 owner props `projectId`（打开的项目）、`session`（对话；只有主会话属于打开的项目时才传，否则为 null）、`request`、`fields` 和 `note` 渲染所显示的视图；在此之前视图的编辑不带对话。`request` 是有两个字段的 `CenterRequest`。`value` 是该视图最近一次 `dvCenter.show` 的目标，`take()` 把请求标为已处理，所以视图不会再得到它，重新挂载后也一样。没有请求时该 prop 为 null。`fields` 是打开项目的中间区域字段（`CenterFields`），每个视图都读取它，打开另一个项目时外壳清空它。中间区域字段也收窄打开项目的概要，所以切换器的封面跟随 `timeline` 字段指定的时间线。打开的项目每次变化都以 `dv:current-project` 发布给其他 DreamVerse bundle。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`CenterPanel` 在项目关联和 DSH 的会话、Workspace 列表就绪后恢复 URL 位置，并等到 DSH 自己在启动时恢复上次会话（或 4 秒内没有）之后，因为 DSH 迟到的恢复会替换外壳打开的会话。此后，主会话自己移到另一个项目时（例如智能体把首页对话绑定到它创建的项目），中间区域跟随该项目。项目的对话是其 Workspace 的会话、绑定到它的会话，以及服务器在其目录下存储的会话；绑定到其他项目的会话属于那个项目。每个浏览器标签页在 `sessionStorage` 里为每个 Workspace 保留自己的空白对话，因为 DSH 的 `openWorkspace` 会复用任何空白会话，两个标签页会共用一个对话。首页 Workspace（存放项目创建之前开始的对话的目录，标题为 DreamVerse）替代 DSH 首次使用时的默认 Workspace。左侧栏的折叠状态从 DSH 应用框架的 `data-sidebar-collapsed` 属性读取，通过 `ctx.layout.toggleSidebar()` 改变。框架要等 React 渲染了切换之后才更新该属性，所以外壳记住自己上一次切换要求的折叠状态，直到属性显示出来；这样恢复之后紧接着的收起（从首页打开项目）会再切换一次，而不是读取过时的属性。只有工作区收起了左侧栏、并且用户之后没有在 DSH 的侧栏条上折叠或展开它时，首页才会重新展开它。右侧面板 448 px 的默认宽度通过布局 store 的私有 `setRightbar` 动作设置，因为 `ctx.layout` 没有宽度设置；每次页面加载只设置一次，所以布局插件重新加载时保留用户拖动的宽度，布局服务缺少该动作时在控制台输出警告。关闭 轨迹 会重新挂载 对话 标签的对话，因为 轨迹 中隐藏的输入框在卸载时解除了会话输入编辑器的绑定。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Host 半边，不注册任何东西 |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | CSS Module 导入的类型 |
| [`src/client/contract/index.ts`](src/client/contract/index.ts) | `@dv/ui-shell/contract`：`DvCenter`、`CenterTarget`、`CenterRequest`、`CenterFields`，以及 `dv.explore` 和 `dv.center.view` 插槽 |
| [`src/client/index.ts`](src/client/index.ts) | `dvCenter`、注册、新会话和首次使用默认 Workspace 的覆盖、关联轮询，以及 `dv:trajectory-focus` 监听 |
| [`src/client/actions.ts`](src/client/actions.ts) | `ShellActions`：新建、打开、重命名和删除项目与对话，首页，以及右侧面板标签 |
| [`src/client/store.ts`](src/client/store.ts) | 共享状态（打开的项目、视图、中间区域字段、所显示视图的请求、主会话、关联）、`dvCenter.show` 和视图的 `note`、URL hash 同步，以及会话 → 项目查找 |
| [`src/client/Center.tsx`](src/client/Center.tsx) | 中间区域：URL 恢复、首页、模板标签、最近项目、工作区顶栏、所显示的中间区域视图及其请求和中间区域字段，以及后退、前进和 hash 修改的监听 |
| [`src/client/SessionSwitcher.tsx`](src/client/SessionSwitcher.tsx) | 工作区顶栏的会话切换按钮和菜单 |
| [`src/client/cover.tsx`](src/client/cover.tsx) | 从 `/api/dv/projects/summary` 读取的项目封面和最后编辑时间；通过 `dv.media` 绘制的封面素材 |
| [`src/client/sessions.ts`](src/client/sessions.ts) | 一个项目的对话，导航和会话切换器共用；以及导航 对话 区列出的首页对话 |
| [`src/client/sidebar.ts`](src/client/sidebar.ts) | DSH 左侧栏的折叠状态，以及外壳的收起和恢复 |
| [`src/client/right-panel.ts`](src/client/right-panel.ts) | 右侧面板 448 px 的默认宽度 |
| [`src/client/theme.ts`](src/client/theme.ts) | DreamVerse 主题样式表：`--dv-*` 变量（其中有每个画布节点类型各取一个位置的节点色板 `--dv-node-1` 到 `--dv-node-8`，以及波形颜色）和 DSH 别名映射 |
| [`src/client/icons.tsx`](src/client/icons.tsx) | 外壳的 16 px 线条图标 |
| [`src/client/Navigator.tsx`](src/client/Navigator.tsx) | 左侧导航和品牌名 |
| [`src/client/panels.ts`](src/client/panels.ts) | DSH 侧栏页面入口，为导航镜像一份 |
| [`src/client/slot-tabs.ts`](src/client/slot-tabs.ts) | 从 `dv.explore` 和 `dv.center.view` 条目同步的 探索 标签和视图切换标签 |
| [`src/client/tabs.tsx`](src/client/tabs.tsx) | 对话 和 轨迹 的标签类型与主体 |
| [`src/client/undo-keys.ts`](src/client/undo-keys.ts) | `historyKey` 和 `listenHistoryKeys`：窗口监听，Ctrl+Z（Cmd+Z）时调用 `/api/dv/undo`，Shift+Ctrl+Z（Shift+Cmd+Z）时调用 `/api/dv/redo` |
| [`src/client/chrome.tsx`](src/client/chrome.tsx) | 隐藏和改写的 DSH 界面、右侧面板指南页，以及随界面语言变化的标签标题 |
| [`src/client/logo.ts`](src/client/logo.ts) | DreamVerse logo 的 SVG 路径数据：侧边栏字标和浏览器标签页图标 |
| [`src/client/InlineRename.tsx`](src/client/InlineRename.tsx) | 行内标题输入框和 ⋯ 行菜单 |
| [`src/client/shell.module.css`](src/client/shell.module.css) | 中间区域、导航和标签的样式 |
| [`src/client/chrome.module.css`](src/client/chrome.module.css) | 右侧面板指南页的样式 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/api`](../api/README.zh.md) — 项目、Workspace、绑定和操作的路由。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md) — 画布，注册为中间区域的 画布 视图。
- [`@dv/ui-timeline`](../ui-timeline/README.zh.md) — 时间线编辑器，注册为中间区域的 时间线 视图；它插入 插入片段 的片段。
- [`@dv/ui-history`](../ui-history/README.zh.md) — 历史标签（它的行通过 `dvCenter.show` 移动中间区域）和 `dv:trajectory-focus` 链接。
- [`@dv/ui-kit`](../ui-kit/README.zh.md) — API 客户端、wire 类型、窗口事件和当前项目。
- [`@dv/ui-media`](../ui-media/README.zh.md) — 绘制项目封面的 `dv.media` 组件工厂。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；外壳保存的会话绑定只经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；外壳不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **隐藏 DSH 界面依赖 DSH 内部实现** — 外壳按 CSS Module 类名后缀和无障碍标签找到要隐藏的控件，通过私有字段改写 DSH 词典条目、Host 命令获取函数和右侧面板的宽度偏好，从框架属性读取左侧栏的折叠状态，并替换服务上的 `uiWorkspace.startSession` 和 `workspaces.initializeDefault`；DSH 改动其中任何一项，被隐藏的界面会重新出现，或覆盖失效而不报错；只有缺少 `setRightbar` 动作时会在控制台输出警告。
- **关联轮询** — 智能体创建的项目和绑定最多 4 秒后才出现在导航里。
