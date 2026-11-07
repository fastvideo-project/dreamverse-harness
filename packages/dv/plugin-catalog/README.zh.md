---
description: "DreamVerse 插件目录：首页提供安装的、经过审核的 npm 插件列表，由 GET /api/dv/plugins/catalog 返回。"
kind: "package-reference"
---

# @dv/plugin-catalog

[English](README.md) | 中文

## 概述

使用本包决定 DreamVerse 提供安装哪些插件。它保存 [`catalog.json`](catalog.json)，即 npm 上经过审核的插件包列表，并在 `GET /api/dv/plugins/catalog` 返回它，供首页 探索 区的 插件 标签使用，该标签由 [`@dv/ui-plugin-catalog`](../ui-plugin-catalog/README.zh.md) 绘制。安装由[插件管理器](../../boot/plugin-manager/README.zh.md)完成：标签请它从 npm registry 安装列出的包并开启其套件。没有本包时，插件 标签没有目录可显示。

## 目录

- [使用本包](#use-this-package)
- [收录一个插件](#list-a-plugin)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

DreamVerse 套件 [`@dv/bundle`](../../bundle/dv/README.zh.md) 挂载本插件；它需要 Connection 服务，由 `dsh-web-app` 提供。

```yaml
- id: dv-plugin-catalog
  name: '@dv/plugin-catalog'
  config:
    sources: []
```

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `sources` | `[]` | 在随包目录之后、每次请求都读取的其他目录：绝对路径，或 https URL（http 只限 `127.0.0.1`、`localhost` 或 `[::1]`）。较早目录已列出的包会被后来的条目替换。两者都不是的来源会让插件在加载时失败。 |
| `sourceTimeoutMs` | `10000` | 一个 URL 来源最多等待的毫秒数。 |

`GET /api/dv/plugins/catalog` 返回 `{ plugins, problems }`：`plugins` 先按文件顺序列出随包目录的条目，再列出各来源新增的条目，每条带有列出它的 `source`；`problems` 为每个无法读取或格式错误的来源给出一个 `{ source, message }`，插件 标签会显示它，Host 会记录日志。随包目录格式错误时插件在加载时失败。

<a id="list-a-plugin"></a>
## 收录一个插件

通过在 [`catalog.json`](catalog.json) 中添加一个条目的 pull request 收录插件：

```json
{
  "package": "@fastvideo/dreamverse-voice-acting",
  "title": { "zh": "配音", "en": "Voice acting" },
  "description": { "zh": "…", "en": "…" },
  "setup": { "zh": "…", "en": "…" },
  "homepage": "https://…"
}
```

`package`、`title` 和 `description` 是必填项，每段文字都需要 `zh` 和 `en`；`setup` 说明安装之外插件还需要什么，例如一个服务器，`homepage` 必须是 https URL。一个包最多出现一次。审核检查该包：

- 以 `@fastvideo` scope 发布在 npm 上，名称以 `dreamverse-` 开头，例如 `@fastvideo/dreamverse-voice-acting`，这样插件管理器运行的 registry 安装能找到它；
- 是一个套件：它的 `package.json` 声明 `dsh.bundle.patch`，用来插入它的插件，这样安装后可以开启它；示例是 `@fastvideo/dreamverse-voice-acting`；
- 把它用到的 DreamVerse 和 DSH 包，例如 `@dv/generation` 或 `@deepseek-ai/cordis`，声明为 `peerDependencies`，由正在运行的 harness 解析，并通过 `publishConfig` 运行构建出的 `lib/`；
- 能在 DreamVerse profile 中安装并加载，且 README 写明了它的设置。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`apply` 检查每个来源的形式，并用 `parseCatalog` 读取随包目录；`parseCatalog` 先用 Schemastery 校验文件，再检查包名、重复项、每段文字的两种语言和主页的协议。路由处理函数调用 `loadCatalog`，它在每次请求时重新读取每个来源，所以编辑过的来源文件或托管的目录无需重启即可显示，而随包目录只在加载时读取一次。路由通过 `ctx.inject(['connection'])` 注册，并随 Connection 服务或插件一起离开。

| 文件 | 内容 |
| --- | --- |
| [`catalog.json`](catalog.json) | 经过审核的目录 |
| [`src/index.ts`](src/index.ts) | 配置、校验、合并和路由 |
| [`src/types.ts`](src/types.ts) | 条目和返回值的类型，由 `@dv/ui-plugin-catalog` 导入 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/ui-plugin-catalog`](../ui-plugin-catalog/README.zh.md) — 显示目录并从中安装的 插件 标签。
- [插件管理器](../../boot/plugin-manager/README.zh.md) — registry、安装、兼容性和脚本审批。
- [打包并安装插件](../../../docs/user/develop/basic/publish.zh.md) — 套件、profile 和 `dsh plugin`。

-----

<a id="model-experience"></a>
## 模型体验

无，因为目录只到达浏览器；安装的插件各自说明其对模型的影响。

#### KV 缓存影响

无直接影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **目录更新需要更新 harness** — 随包目录在加载时从检出读取，所以新收录的插件要在 `git pull` 并重启后出现；`sources` 中的托管目录会立即显示新条目。
- **没有版本要求** — 条目只写包名，不写版本范围或最低 harness 版本；插件管理器安装最新版本，其兼容性检查会拒绝声明了不兼容 DSH peer 的版本。
