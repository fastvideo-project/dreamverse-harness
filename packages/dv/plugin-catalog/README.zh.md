---
description: "DreamVerse 插件目录：首页提供安装的、经过审核的 npm 插件列表，由 GET /api/dv/plugins/catalog 返回。"
kind: "package-reference"
---

# @dv/plugin-catalog

[English](README.md) | 中文

## 概述

使用本包决定 DreamVerse 提供安装哪些插件。它保存 [`catalog.json`](catalog.json)，即 npm 上经过审核的插件包列表，并在 `GET /api/dv/plugins/catalog` 返回它，供左侧导航的 插件市场 页面使用，该页面由 [`@dv/ui-plugin-catalog`](../ui-plugin-catalog/README.zh.md) 绘制。安装由[插件管理器](../../boot/plugin-manager/README.zh.md)完成：页面请它从 npm registry 安装列出的包并开启其套件。没有本包时，插件市场 页面没有目录可显示。

## 目录

- [使用本包](#use-this-package)
- [编写并收录一个插件](#list-a-plugin)
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
| `sources` | `[]` | 在随包目录之后、每次请求都读取的其他目录：绝对路径，或 https URL（http 只限 `127.0.0.1`、`localhost` 或 `[::1]`）。较早目录已列出的包会被后来的条目替换。两者都不是的来源会让插件在加载时失败。以重定向回应的 URL 来源会被报告为问题，不列出任何条目。 |
| `sourceTimeoutMs` | `10000` | 一个 URL 来源最多等待的毫秒数。 |

`GET /api/dv/plugins/catalog` 返回 `{ plugins, problems }`：`plugins` 先按文件顺序列出随包目录的条目，再列出各来源新增的条目，每条带有列出它的 `source`；`problems` 为每个无法读取或格式错误的来源给出一个 `{ source, message }`，插件市场 页面会显示它，Host 会记录日志。随包目录格式错误时插件在加载时失败。

<a id="list-a-plugin"></a>
## 编写并收录一个插件

DreamVerse 插件以一个 npm 套件包的形式到达用户，由 插件市场 页面安装；`@fastvideo/dreamverse-voice-acting` 及其四个插件包是完整示例。

1. **在 fork 中开发。** 在本仓库的 fork 里把插件的包放在 `packages/dv/<name>/` 下，这样它依赖的 `@dv/*` 和 `@deepseek-ai/*` 包会连同类型和测试从工作区解析；[`packages/dv/COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md) 说明每个包的文件。
2. **做成套件。** 由一个包在 `dependencies` 中列出插件的各个包，并声明 `dsh.bundle.patch`，即插入它们插件条目的 `cordis.patch.yml`，这样安装后会开启它们；需要配置的条目，例如服务器地址，以 `disabled: true` 发布，并由 README 说明要设置什么。[打包并安装插件](../../../docs/user/develop/basic/publish.zh.md) 介绍套件的一般用法。
3. **把 harness 声明为 peer。** 代码导入的每个 `@dv/*` 和 `@deepseek-ai/*` 包都是 `peerDependency`，由正在运行的 harness 解析；`publishConfig` 让发布的包指向构建出的 `lib/`。
4. **命名并发布。** 以你自己的 scope 或用户名在 npm 上发布，包名以 `dreamverse-` 开头，例如 `@alice/dreamverse-subtitles`；`@fastvideo` scope 存放 DreamVerse 团队的插件。先运行 `pnpm run build`，再运行 `pnpm --filter "<your packages>" publish --access public`。
5. **试装。** 用 `dsh plugin --profile video-harness add <package>@<version>` 把发布的版本装进 DreamVerse profile 并使用它。
6. **提交 pull request**，在 [`catalog.json`](catalog.json) 中添加一个条目：

```json
{
  "package": "@alice/dreamverse-subtitles",
  "version": "1.0.0",
  "title": { "zh": "…", "en": "…" },
  "description": { "zh": "…", "en": "…" },
  "setup": { "zh": "…", "en": "…" },
  "homepage": "https://github.com/alice/dreamverse-subtitles"
}
```

`package`、`version`、`title` 和 `description` 是必填项，每段文字都需要 `zh` 和 `en`。`version` 是一个确切的已发布版本，例如 `1.0.0`，不能是范围或标签：安装 只请求这个版本，所以之后的发布只有经过另一个修改它的 pull request 才会到达用户。`setup` 说明安装之外插件还需要什么，例如一个服务器，`homepage` 必须是 https URL。一个包最多出现一次。安装的插件在 harness 内运行，拥有它对机器和用户文件的访问权限，所以审核会阅读代码并检查：

- 该包在 npm 上有这个版本，且名称符合第 4 步；
- `homepage` 链接到这个版本的公开源码，发布的 `lib/` 由它构建；
- 该包是一个通过 `dsh.bundle.patch` 插入其插件的套件，并把 harness 的包声明为 peer；
- 它能在 DreamVerse profile 中安装并加载，且 README 写明了它的设置和对模型的影响。

发布新版本时，先发布它，再提交修改 `version` 的 pull request；已安装版本与目录不同的卡片会说明这一点。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`apply` 检查每个来源的形式，并用 `parseCatalog` 读取随包目录；`parseCatalog` 先用 Schemastery 校验文件，再检查包名、确切版本、重复项、每段文字的两种语言和主页的协议。路由处理函数调用 `loadCatalog`，它在每次请求时重新读取每个来源，所以编辑过的来源文件或托管的目录无需重启即可显示，而随包目录只在加载时读取一次。路由通过 `ctx.inject(['connection'])` 注册，并随 Connection 服务或插件一起离开。

| 文件 | 内容 |
| --- | --- |
| [`catalog.json`](catalog.json) | 经过审核的目录 |
| [`src/index.ts`](src/index.ts) | 配置、校验、合并和路由 |
| [`src/types.ts`](src/types.ts) | 条目和返回值的类型，由 `@dv/ui-plugin-catalog` 导入 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/ui-plugin-catalog`](../ui-plugin-catalog/README.zh.md) — 显示目录并从中安装的 插件市场 页面。
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
- **标签页内不能升级** — 条目固定一个版本，安装 请求这个版本，但标签页不会把已安装的插件升级到目录中更新的版本；卡片会注明差异，移除后重新安装并重启即可升级。
- **没有最低 harness 版本** — 条目不说明插件需要哪些 harness 版本；插件管理器的兼容性检查会拒绝声明了不兼容 DSH peer 的版本。
