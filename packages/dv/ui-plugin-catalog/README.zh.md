---
description: "DreamVerse 左侧导航的 插件市场 页面：经过审核的插件目录，通过插件管理器安装、开启和移除。"
kind: "package-reference"
---

# @dv/ui-plugin-catalog

[English](README.md) | 中文

## 概述

使用本包让人安装 DreamVerse 插件。它注册左侧导航的 插件市场 入口和它打开的页面，页面列出 [`@dv/plugin-catalog`](../plugin-catalog/README.zh.md) 经过审核的目录：每个插件一张卡片，写明它的描述、安装之外还需要什么，以及它在 profile 中的状态。安装、开启 和 移除 调用[插件管理器](../../boot/plugin-manager/README.zh.md)，由它从 npm registry 安装包。没有本包时，导航里没有 插件市场 入口，插件要通过 DSH 的 插件 页面或 `dsh plugin` 安装。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠加了 `dsh-web-app` 的 profile 中、在 `@dv/plugin-catalog` 旁边挂载本插件；[`@dv/bundle`](../../bundle/dv/README.zh.md) 会挂载两者。先构建浏览器端产物：`pnpm run build` 会写出 `lib/client.js`。

```yaml
- id: dv-ui-plugin-catalog
  name: '@dv/ui-plugin-catalog'
```

Host 半边不注册任何东西。浏览器端在 `main` 槽位以面板 id `marketplace` 注册页面，在 `sidebar.panellist` 以顺序 0.5 注册导航入口，位于 插件 / Plugins（顺序 0）和 MCP（顺序 1）之间；`@dv/ui-shell` 把它和其他侧栏页面一起列出。页面的介绍行链接到 DSH 的 插件 页面，已安装的插件在那里管理。卡片的状态按包名取自 `pluginManager.listBundles()`：未安装、已安装 · 已开启、已安装 · 已关闭，或对有加载错误、其层被 profile 跳过的 bundle 显示 已安装 · 未加载；每次 `plugin-manager/changed` 事件后都会重新读取列表。卡片显示包名和目录中的版本，已安装版本与之不同时会注明。没有插件管理器的 profile 会列出目录，并说明这里无法安装插件。

| 手势 | 请求 |
| --- | --- |
| 安装 | `pluginManager.installBundle(<package>@<version>, { enabled: true, requestId })`，使用目录条目的确切版本，从插件管理器配置的 registry 安装。卡片显示 安装中…，然后显示 已安装并开启。；profile 在下次启动时才应用变更时显示 已安装。重启 harness 后生效。 |
| 对已安装但关闭的插件点 开启 | `pluginManager.setBundleEnabled(<package>, true)`。卡片显示 已开启。；profile 在下次启动时才应用变更时显示 已开启。重启 harness 后生效。 |
| 移除，然后 确认移除 | `pluginManager.removeBundle(<package>)`；取消 会保留插件。只对 `listBundles()` 标为 `removable` 的 bundle 提供 |

失败的请求会在卡片下显示原因：插件管理器的错误码，或 pnpm 失败类型及 pnpm 日志路径。因包脚本未获允许而被 pnpm 阻止的安装会列出这些包，并提供 允许这些脚本并重试 / Allow these scripts and retry：它允许这些包的脚本，再次安装同一个 `<package>@<version>`；插件管理器会在 pnpm 运行前为该 profile 保存这项授权。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`followCatalog` 每次挂载时读取一次 `GET /api/dv/plugins/catalog`，通过 `ctx.inject(['remote', 'remote.pluginManager'])` 绑定插件管理器调用，所以按钮只在其 Remote 挂载时出现，并通过 `layout` 服务选中 DSH 的 插件 页面，供介绍行的链接使用。每个包同一时间只运行一个请求；`outcomeOf` 把插件管理器的 `ChangeResult` 变成卡片下的那一行。目录类型来自 `@dv/plugin-catalog/types`，插槽类型来自 `@deepseek-ai/dsh-client-ui-layout` 和 `@deepseek-ai/dsh-client-ui-sidebar`，全部只导入类型。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Host 半边，不注册任何东西 |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | CSS Module 导入的类型 |
| [`src/client/index.ts`](src/client/index.ts) | 在 `main` 中注册 插件市场 页面，在 `sidebar.panellist` 中注册它的导航入口 |
| [`src/client/catalog.ts`](src/client/catalog.ts) | 目录请求、profile 的套件，以及插件管理器请求和结果 |
| [`src/client/CatalogPage.tsx`](src/client/CatalogPage.tsx) | 页面、导航图标、卡片及其中英文文案 |
| [`src/client/CatalogPage.module.css`](src/client/CatalogPage.module.css) | 页面和卡片的样式 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/plugin-catalog`](../plugin-catalog/README.zh.md) — 目录、它的来源，以及插件如何被收录。
- [插件管理器](../../boot/plugin-manager/README.zh.md) — registry、安装、兼容性和脚本审批。
- [`@dv/ui-shell`](../ui-shell/README.zh.md) — 列出侧栏页面的左侧导航。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这个页面只安装、开启和移除套件；安装的插件各自说明其对模型的影响。

#### KV 缓存影响

无直接影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有安装进度细节** — 卡片在插件管理器答复前一直显示 安装中…；pnpm 输出和正在询问的 registry 只在 DSH 的 插件 页面显示。
- **不能取消** — 安装会一直运行到插件管理器结束它；DSH 的 插件 页面可以取消安装。
