---
description: "叠加在 @dv/bundle 之上的 DreamVerse Creator 配置层：DreamVerse Creator 预设、列出 DreamVerse 与 DreamVerse Creator 的预设选择器，以及对检出目录中 packages/dv 的实时重载。"
kind: "package-bundle"
---

# @dv/bundle-creator

[English](README.md) | 中文

## 概述

用这个 bundle 在 DreamVerse 对话中编辑 DreamVerse 插件。`scripts/video-harness/setup-profile.sh` 把它叠加在 [`@dv/bundle`](../dv/README.zh.md) 之上，组成 profile `video-harness-creator`；`scripts/video-harness/launch.sh creator` 从源码运行这个 profile。使用 DreamVerse Creator 预设的对话拥有 DreamVerse 的人设、视频工具和技能，以及 [Creator 模式](../../../docs/user/develop/practice/dynamic-cordis.zh.md)的工具：文件、shell、Cordis 检查、Plugin Manager 和插件开发技能。保存 `packages/dv` 下某个 DreamVerse 插件的修改后，正在运行的服务器和打开的页面无需重启即可得到这项修改。

## 目录

- [使用这个包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用这个包

先构建一次检出目录，再启动 creator 模式。它使用与 `launch.sh web` 相同的环境变量和参数：

```sh
pnpm run build
scripts/video-harness/launch.sh creator --trusted-host <public host>   # chat page on DV_PORT (default 8092)
```

这个命令启动两个进程：`video-harness-creator` 服务器和浏览器 bundle 监视进程 `pnpm run dev:web --skip-build --no-serve`。其中一个进程退出，或者你按下 Ctrl+C 时，命令会停止两个进程。

新对话使用 DreamVerse 预设。要使用 DreamVerse Creator，打开 Settings → Agent presets 并选择 DreamVerse Creator；此后新建的对话会使用它。然后请智能体做一项修改，例如“把 packages/dv/ui-canvas 的空画布文字改成……”。智能体在检出目录中编辑源码，修改无需加载页面就出现在打开的页面中。

`video-harness-creator` profile 有自己的 profile patch，所以预设选择和其他 Settings 修改不会改变 `launch.sh web`。两个 profile 使用同一个 `DSH_HOME`、同一批项目和会话。DreamVerse Creator 对话无法在 `launch.sh web` 中继续，因为那个 profile 没有 `dreamverse-creator` 预设。

<a id="understand-the-implementation"></a>
## 理解实现

[`cordis.patch.yml`](cordis.patch.yml) 修改下层 bundle 的行，不插入新行：

- 打开 `@dv/bundle` 中默认关闭的 `preset-dreamverse-creator`。关闭 `dsh-web-app` 的四个预设，所以选择器列出 DreamVerse 和 DreamVerse Creator。
- `agent-preset-registry` 保持 DreamVerse 为默认预设，并打开选择器。这一层位于 profile patch 之下，所以写入这个 profile 的 patch 的 Settings 修改会被接受。
- `hmr` 监视这个 profile 链接的检出目录中的 `packages/dv`。它每 500 ms 轮询一次，与 `pnpm run dev:web` 的间隔相同，因为网络挂载不传递 inotify 事件。它跳过 `lib`，那里存放监视进程写出的浏览器 bundle。

主机 HMR 在同一个服务器进程中替换 `packages/dv` 下被修改的主机模块以及导入它的插件。浏览器 bundle 监视进程重新构建被修改的浏览器插件的 `lib/client.js`，Web 服务器把重新构建的 bundle 发送到打开的页面。[`tests/creator.spec.ts`](tests/creator.spec.ts) 检查预设列表、选择器策略、profile 的 bundle，以及从 profile 目录求值时的 `hmr` 行。

<a id="further-exploration"></a>
## 延伸阅读

- [`@dv/bundle`](../dv/README.zh.md)，它提供 DreamVerse Creator 预设
- [通过提示词配置持久插件](../../../docs/user/develop/practice/dynamic-cordis.zh.md)
- [`@deepseek-ai/dsh-hmr`](../../boot/hmr/README.zh.md)
- [DreamVerse 各包](../../../docs/subsystems/video-harness.zh.md)

<a id="model-experience"></a>
## 模型体验

间接影响，通过 `@dv/bundle` 的 DreamVerse Creator 预设，它提供 DreamVerse Creator 对话发送的人设、工具和技能。

#### KV Cache 影响

自身没有。主机 HMR 重载一个提供工具或提示词文本的插件后，后续请求的前缀可能改变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 智能体只有在对话的项目目录中写入时不需要批准。写入检出目录和每条 shell 命令都需要批准。读取不受限制：智能体可以读取服务器用户能读取的所有文件，包括含有密钥的环境文件。网页抓取不需要批准，所以读取的文件可能被发送到机器之外。
- 对 `packages/dv` 下已加载模块的写入一经批准，约一秒内就会作为代码在服务器进程中运行，不受 shell 沙箱限制。批准这类写入时，要像批准一条 shell 命令一样谨慎。
- 页面的每个用户都可以选择 DreamVerse Creator。只为你信任、愿意给予服务器 shell 权限的人启动 creator 模式。
- 主机 HMR 只覆盖 `packages/dv` 下的模块。修改 bundle 的 `cordis.patch.yml` 或 `SKILL.md` 文件后，需要通过 Plugin Manager 重载插件或重启才能生效。
- 主机 HMR 的监视失败时不报告错误；这时修改需要重启才能生效。
- DreamVerse 编辑器不显示预设选择器；只能在 Settings → Agent presets 中选择 DreamVerse Creator。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

无。

</details>
