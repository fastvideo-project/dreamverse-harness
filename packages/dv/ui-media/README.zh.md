---
description: "DreamVerse 浏览器中的媒体绘制：按用途（thumb、card、player、loop）通过素材 MIME 顶层类型的 dv.media.view 条目或文件卡片绘制单个素材的 dv.media 组件工厂、媒体类型注册表 dvMedia，以及带 dv.media.preview.action 按钮的素材预览。"
kind: "package-reference"
---

# @dv/ui-media

[English](README.md) | 中文

## 概述

使用本包让 DreamVerse 的每个视图用同一种方式绘制素材并打开它的预览。视图按用途（缩略图、卡片主体、播放器或静音循环）向 `dv.media` 组件工厂请求一个素材，由插件为该素材 MIME 顶层类型注册的媒体视图绘制它；没有视图的素材画成文件卡片，显示名称和 MIME 类型。`dvMedia.preview` 以完整尺寸打开素材，显示它的尺寸、时长和大小，以及其他插件的按钮。本包不写出任何媒体类型。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app` 的 profile 里挂载插件；`@dv/bundle` 用下面这一行挂载它。浏览器半边注入 `@deepseek-ai/dsh-client-ui-layout`（它声明容纳预览的根 `shell.overlay` 列表）和 `@deepseek-ai/dsh-client-ui-renderer`。`bundle` 脚本（`tsdown`）写出浏览器 bundle `lib/client.js`，由 `./client` 导出提供。

```yaml
- id: dv-ui-media
  name: '@dv/ui-media'
```

Host 半边（`src/index.ts`）是一个什么都不做的 `apply`，所以 Loader 行加载插件，所有工作都由浏览器半边完成。浏览器半边提供客户端服务 `dvMedia`，注册 `dv.media` 组件工厂，并把预览注册为 `shell.overlay` 的条目 `dv.media.preview`。媒体视图来自其他插件：`@dv/ui-asset-pool` 注册 `image`、`video` 和 `audio` 媒体类型以及它们的 `dv.media.view` 条目。

### 媒体契约

契约是只含类型的模块 [`src/client/contract/index.ts`](src/client/contract/index.ts)，以 `@dv/ui-media/contract` 导入。它把 `dvMedia` 合并进 cordis 的 `Context`，把插槽 `dv.media.view` 和 `dv.media.preview.action` 合并进 `SlotMap`，把组件工厂 `dv.media` 合并进 `SlotFactoryMap`。

| 符号 | 种类 | 含义 |
| --- | --- | --- |
| `MediaPurpose` | 类型 | 视图请求的形式：`'thumb'`（小方块）、`'card'`（卡片主体）、`'player'`（全宽可播放形式）或 `'loop'`（静音开始并循环的全宽可播放形式，例如编辑器中的版本） |
| `MediaAsset` | 类型 | 视图绘制的素材事实：`id` 和 `mime`，以及界面知道时的 `name`、`width`、`height` 和 `duration_sec`，例如概要只按 ID 和 MIME 类型指定的项目封面 |
| `MediaOwner` | 类型 | `dv.media` 实例的属性，也是每个 `dv.media.view` 条目的所有者属性：`asset`（一个 `MediaAsset`）、`purpose`、可选的 `poster`（可播放形式在播放前显示的静帧的素材 ID，例如版本的图片输出），以及可选的 `onSize({ width, height })`（为存储尺寸未知的素材接收已加载媒体的像素尺寸） |
| `MediaType` | 类型 | `dvMedia.types` 中的一个媒体类型：`id`（媒体类型，例如 `'audio'`，也是其 `dv.media.view` 条目的键）、`icon`（没有静帧处使用的图标组件，属性与 DSH 图标相同，例如 `@` 菜单），以及可选的 `poster(asset, state)`（在只能用 `<img>` 绘制的地方代表该素材的静帧的素材 ID，或 null） |
| `DvMedia` | 服务 | `ctx.dvMedia`：`types` 是 `@dv/ui-kit/registries.ts` 的 `Registry<MediaType>`，以 `id` 为键，所以同一 `id` 的第二个类型会抛错；`preview(projectId, asset, opener)` 打开某个项目的素材的预览 |
| `PreviewActionOwner` | 类型 | 一个预览按钮的所有者属性：`projectId`（所预览素材的项目）、`asset`、`buttonClass`（预览按钮的类名，操作按钮用它，外观、悬停和焦点与 关闭 / Close 一致）和 `close()` |
| `dv.media` | 组件工厂 | 根作用域；属性为 `MediaOwner`；一个键控子插槽 `dv.media.view`。视图用 `renderFactorySlot('dv.media', { asset, purpose })` 绘制一个实例，不需要自己声明插槽；外框归视图所有，媒体视图填满它 |
| `MediaViewOwner` | 类型 | 每个 `dv.media.view` 条目的所有者属性：`MediaOwner` 和 `unsupported()`，浏览器无法绘制该素材时视图调用它，例如无法解码的图片格式；组件工厂随后绘制文件卡片 |
| `dv.media.view` | 键控插槽，根 | 一种媒体类型的视图，以 `MediaType.id` 为键；后备是文件卡片 |
| `dv.media.preview.action` | 列表插槽，根 | 预览中 关闭 / Close 旁边的按钮；每个条目自己决定是否为该素材显示 |

媒体插件在 `dvMedia` 存在时注册它的类型，在 `dv.media` 声明 `dv.media.view` 后注册它的视图，`@dv/ui-asset-pool` 就是这样做的：

```ts
ctx.inject(['dvMedia'], (scope) => {
  scope.effect(() => scope.dvMedia.types.register(imageType), 'my-plugin: media type image')
})
ctx.effect(() => ctx.slots.inject('dv.media.view', () => ctx.slots.register({ name: 'dv.media.view', key: 'image' }, ImageView)), 'my-plugin: image view')
```

组件工厂按 `@dv/ui-kit/media-type.ts` 的 `mediaTypeOf(asset.mime)` 为视图选键：小写、去掉空格和参数的顶层类型。文件卡片显示素材的名称和 MIME 类型；用途为 `thumb` 时，以及界面不知道素材名称时，只显示 MIME 类型，名称作为提示文字。`@dv/ui-composer` 的 `@` 菜单读取 `MediaType.icon` 和 `MediaType.poster`。

### 打开素材预览

用素材的项目和用户点击的元素调用 `dvMedia.preview(projectId, asset, opener)`；`@dv/ui-canvas` 的参考标签和条目编辑器（`EntryEditorHost.preview`）、`@dv/ui-asset-pool` 的素材库面板和 `@dv/ui-composer` 的对话媒体会调用它。预览是以素材命名的模态对话框。它通过 `dv.media` 以用途 `player` 绘制素材，下面一行是素材名称、它的信息、`dv.media.preview.action` 条目和 关闭 / Close。信息是尺寸（例如 `1920×1080`）、保留一位小数的时长（例如 `4.0 秒` 或 `4.0 s`），以及小于 1 MiB 时以 KB、否则以 MB 表示的大小（例如 `2.5 MB`），用 ` · ` 连接。没有存储尺寸的素材，信息显示媒体视图通过 `onSize` 报告的尺寸，只对该素材有效。有存储尺寸的素材，预览在媒体加载前就按这些尺寸确定媒体框的大小（`@dv/ui-kit/zoom.ts` 的 `mediaBox`），所以对话框从 `opener` 放大出来时已是最终大小。再次调用 `preview` 会替换正在显示的素材，DreamVerse 外壳打开的项目改变（`dv:current-project`）时预览关闭。关闭 / Close、点击对话框外部和 Escape 关闭预览；预览在捕获阶段接收 Escape，所以下面的画布或编辑器收不到这个按键。预览打开时焦点在 关闭 / Close 上；预览关闭时，若 `opener` 仍在页面上，焦点回到它。对话框打开时从 `opener` 放大出来，关闭时缩回其中（`@dv/ui-kit/zoom.ts` 的 `useZoomPresence`）。`@dv/ui-composer` 向 `dv.media.preview.action` 添加条目 `dv.composer.use-asset`（让智能体使用 / Ask the agent to use it），`@dv/ui-timeline` 添加 `dv.timeline.insert`（插入片段 / Insert clip）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`apply` 在自己的顶层创建 `types` 注册表，因为其他插件从各自的 fiber 向其中注册。一个打开请求（素材和序号）保存在一个 observable 中，浮层条目通过注入的 `hooks.preview` 读取它；opener 元素不是 JSON 数据，所以留在 `apply` 闭包里、不放进 observable，浮层条目通过注入的 `openerOf` 读取它。`MediaView` 以 `asset.mime` 中 `/` 之前的部分为 `dv.media.view` 的键，只在实例设置了 `poster` 和 `onSize` 时才传递它们。组件工厂和浮层条目经 `ctx.effect` 注册，所以销毁插件会移除它们、`dvMedia` 和每个已绘制的实例。

`tests/media.client.spec.tsx` 在 `@deepseek-ai/dsh-client-test-runtime` 的 `SlotTestRuntime`（真实的插槽运行时）下挂载插件，并带一个测试图片视图和一个测试预览按钮。它检查：同一 `id` 的第二个媒体类型会抛错；实例通过其 MIME 顶层类型的视图绘制，并带视图请求的用途和静帧；没有视图的类型画成文件卡片；预览显示用途为 `player` 的媒体、信息、按钮和已加载媒体的尺寸；关闭 / Close、背景和 Escape 在下面的监听器收到按键之前关闭预览。一个用例从会话作用域的 `tool.call.toolview` 条目通过唯一的根作用域组件工厂绘制图片；最后一个用例销毁插件，并检查组件工厂、`dvMedia`、浮层条目和已绘制的媒体都已移除。

| 文件 | 内容 |
| --- | --- |
| [`src/client/contract/index.ts`](src/client/contract/index.ts) | 媒体契约 |
| [`src/client/index.ts`](src/client/index.ts) | `dvMedia`、组件工厂注册和浮层条目 |
| [`src/client/MediaView.tsx`](src/client/MediaView.tsx) | 组件工厂定义和文件卡片 |
| [`src/client/MediaPreview.tsx`](src/client/MediaPreview.tsx) | 素材预览 |
| [`src/client/media.module.css`](src/client/media.module.css) | 文件卡片和预览样式 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/ui-asset-pool`](../ui-asset-pool/README.zh.md) 注册图片、视频和音频视图。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md) 通过 `dv.media` 绘制节点媒体，并从编辑器打开预览。
- [`@dv/ui-kit`](../ui-kit/README.zh.md) 拥有 `Registry`、wire 类型 `Asset` 和缩放过渡。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只在浏览器中绘制素材和打开素材预览，不写任何记录。

#### KV Cache 影响

无；本包不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **预览通过 `useText` 读取文案。** `MediaPreview` 用 `@dv/ui-kit/locale.ts` 的 `useText`（跟随 `<html lang>`）选择 关闭 / Close 和 秒 / s 单位，而不是通过 locale 命名空间和插槽的 `t`。
- **每个 MIME 顶层类型只有一个视图。** `dv.media.view` 以 `asset.mime` 的媒体类型（`/` 之前的部分）为键，所以 `image/png` 和 `image/svg+xml` 共用一个视图，插件不能为子类型单独提供视图。
- **媒体类型和它的视图是两次注册。** 注册 `MediaType` 不会添加视图，`dv.media.view` 条目没有 `MediaType` 也能绘制；本包不检查两者是否一致。注册方在同一步里以同一个键安装两者，如 `@dv/ui-asset-pool` 所做。
- **只有评审让本包不写出媒体类型。** `scripts/dv-architecture.ts` 把本包列为 UI 核心，其规则 R5 只检查插件名词。针对某一种媒体类型的规则属于注册该视图的插件。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
