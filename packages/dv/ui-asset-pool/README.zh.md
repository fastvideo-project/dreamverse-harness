---
description: "DreamVerse 素材库面板：在右侧栏标签里列出项目的图片和视频，可导入、拖入画布或时间线、打开素材预览；画布的素材节点；以及图片、视频和音频媒体类型及其视图。"
kind: "package-reference"
---

# @dv/ui-asset-pool

[English](README.md) | 中文

## 概述

使用本包让 web 应用在对话旁边多一个 素材库 面板。`AssetsPanel` 把所打开项目的每个图片和视频列出一次，分为图片、视频和从生成中截取的帧：当前状态中的每个素材，加上项目的任何记录导入的每个素材，包括被丢弃的记录，所以撤销会隐藏当前位置之后的步骤生成的素材，但从不隐藏导入的素材。你可以把图片和视频拖到面板上导入，把缩略图拖进画布或时间线，并点击缩略图打开 `dvMedia.preview` 的素材预览（`@dv/ui-media`）。本包还向 `dvMedia` 提供图片、视频和音频媒体类型及其视图。右侧栏的 `dv-asset-pool` 标签类型显示 shell 所打开项目的面板。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app`（提供右侧栏和客户端模块加载器）和 `@dv/api`（提供面板调用的路由）的 profile 里挂载插件。先构建浏览器 bundle：`pnpm run build` 会写出 `lib/client.js`。

```yaml
- id: dv-ui-asset-pool
  name: '@dv/ui-asset-pool'
```

Host 半边不注册任何东西。浏览器半边注册 `dv-asset-pool` 标签类型（侧栏指南页以"素材库"提供的页面）和以自身 id `@dv/ui-asset-pool` 为键的标签主体。其他标签在前面时，该标签保持挂载。它填充 `@dv/ui-canvas/contract` 声明的三个键控插槽：以键 `assets` 在 `dv.canvas.picker` 填入 `AssetsPanel`，即画布素材选择窗口里的面板，点击缩略图调用选择窗口的 `onOpen` 并选中素材；以键 `asset` 在 `dv.canvas.card` 填入 `AssetCard`，它通过 `dv.media` 组件工厂以用途 `card` 绘制素材，填满节点的画框：素材节点是媒体节点，它的 `sizing` 是 `@dv/ui-kit/frame.ts` 的 `mediaSizing`，没有固定栏，所以图片随画框缩放：尺寸已知的图片或视频不加底色，画框按素材宽高比，宽高比限制在 3:4 到 16:9 之间，其他素材在 16:9 画框里的 `CARD_SURFACE` 上；以键 `asset` 在 `dv.canvas.editor` 填入 `AssetEditor`，它在 `@dv/ui-kit` 的 `playerBox(asset, 360)` 给定大小的框里以用途 `player` 绘制素材。只要画布服务 `dvCanvas` 存在，它就在 `dvCanvas.nodeTypes` 注册节点类型 `asset`（`assetNodeType`）。画布自己的 从画布移除 / Remove from canvas 像移除其他节点一样把素材节点移出画布，素材仍留在素材库里。该节点类型绘制 [`@dv/canvas`](../canvas/README.zh.md) 节点列表中 kind 为 `asset` 的节点：由 `asset.place` 产生的节点显示其放置的素材（`node.asset`），由带 `place: true` 的 `asset.import` 产生的节点显示导入的素材；标题均为素材名称并带其时长。只要 `@dv/ui-media` 的媒体服务 `dvMedia` 存在，它就在 `dvMedia.types` 中注册媒体类型 `image`、`video` 和 `audio`，每个类型与其视图（`ImageView`、`VideoView`、`AudioView`）在同一步里注册为同一个键上的 `dv.media.view` 条目，所以没注册成功的类型不留下视图；浏览器无法解码的图片、视频或音频播放器调用 `unsupported()`，由文件卡片代替它。每个素材都通过 `asset.import` 进入项目，所以这些媒体类型归本包所有。

| 手势 | 请求或事件 |
| --- | --- |
| 打开面板、项目的任何变化 | 对项目的当前状态调用 `GET /api/dv/state`，每个 `/dv/events` 事件都重新拉取 |
| 把图片或视频拖到拖放区，点击它或按 Enter、Space 选择文件 | 每个图片或视频文件一次 `POST /api/dv/assets/import`，带 `surface=asset_pool` 和标签所在的对话；`asset.import` 记录是项目当前位置之后的一步。拖放区不导入其他文件，对每个这样的文件显示 「<name>」不是图片或视频，没有导入。 |
| 拖动缩略图 | 以 `application/x-dv-asset` 携带素材 ID 的拖动；画布把素材的节点移到放下的位置，时间线在放下的位置插入片段 |
| 在标签里点击缩略图 | 以项目、该素材和该缩略图调用 `dvMedia.preview`：`@dv/ui-media` 的素材预览，带 `dv.media.preview.action` 按钮，例如 `@dv/ui-timeline` 的 插入片段 和 `@dv/ui-composer` 的 让智能体使用；`dvMedia` 不存在时什么也不打开 |
| 在画布素材选择窗口里点击缩略图 | 选择窗口的 `onOpen` 在选择窗口中切换该素材的选中状态；不打开预览 |

每个缩略图通过 `dv.media` 组件工厂以用途 `thumb` 绘制其素材，放在方形格子中央、比例与素材相同的框里，所以竖版图片或 16:9 视频帧完整显示；尺寸未知的素材填满格子。缩略图和媒体视图从 `GET /dv/assets/<AssetId>` 加载素材文件。

面板把状态在 `assets` 里列出的每个图片和视频（当前状态中的每个素材，加上项目的任何记录导入的每个素材，包括被丢弃的记录；见[历史规则](../../../docs/subsystems/video-harness.zh.md#history-rules)）列出一次，分为三组，每组最新在前：图片（`image/*`）、视频（`video/*`）和 从生成中截取的帧（`made_by` 为 `shot.render` 的图片，例如版本的末帧静帧）。其他媒体类型的素材不列出。角色、场景或风格用到的图片仍列在 图片 一组，`asset.grab_still` 的静帧也列在 图片 一组。没有素材的组不显示，没有素材的项目显示「还没有素材。在上方导入，或在对话里生成。」被撤销移出当前状态的导入素材，拖动、插入和预览都和其他素材一样，所以插入它会写一条普通的 `timeline.clip_insert` 记录，作为当前位置之后的一步。

每个媒体视图填满绘制该 `dv.media` 实例的界面所给的外框。图片在用途 `thumb` 和 `card` 下按 cover 方式裁切填满，延迟加载并在主线程外解码，在 `player` 和 `loop` 下填满界面确定大小的外框并以 contain 方式显示在其中，并通过 `onSize` 报告加载后的尺寸。视频在 `thumb` 和 `card` 下静音、内联显示第一帧，对辅助技术隐藏，界面设置 `playBadge` 时带播放标记；在 `player` 下带控件和声音播放，在 `loop` 下带控件、静音并循环播放，开始播放前显示它的 `poster`；在 `player` 和 `loop` 下报告加载后的尺寸。音频素材在 `thumb` 下显示装饰性的音符字形；在 `card` 下显示整个素材的波形（`@dv/ui-kit/waveform.ts`）和播放／暂停按钮，音频解码期间、素材没有音频或时长为 0 时不显示波形；音源加载失败会结束播放状态；在 `player` 和 `loop` 下显示音频播放器。`image` 类型的 `poster` 是图片本身，`video` 类型的 `poster` 是生成该视频的记录的一个图片输出（导入的视频没有）；`@dv/ui-composer` 的 `@` 菜单把这些静帧画成图标。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`assetLibrary` 把状态中的素材分为图片和视频，每个素材只出现一次；生产记录（`created_by`）同时输出了视频的图片（例如渲染镜头的最后一帧）归入 `extracted`。状态已经带上每个素材在本项目中的导入名字和时间（`ProjectAsset`），因为素材库保存的是任意项目中相同字节第一次导入时的名字和时间。`AssetsPanel` 把 API 客户端 `client` 和回调 `preview` 作为必需属性。没有 `onOpen` 属性时，点击缩略图以该缩略图调用 `preview`，插件把 `preview` 绑定到 `dvMedia.preview`；有该属性时，点击改为调用 `onOpen`，画布把它传给 `dv.canvas.picker` 条目。插槽条目在其插槽声明期间注册，注册表条目在其服务存在期间注册，它们都随插件一起移除。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Host 半边，不注册任何东西 |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | CSS Module 导入的类型 |
| [`src/client/index.ts`](src/client/index.ts) | 标签类型、标签主体、画布选择窗口、卡片和编辑器条目、节点类型及其动作，以及媒体类型及其视图的注册 |
| [`src/client/definition.ts`](src/client/definition.ts) | 标签类型 |
| [`src/client/AssetsPanel.tsx`](src/client/AssetsPanel.tsx) | 面板、拖放区、按组分的缩略图网格和标签主体 |
| [`src/client/AssetsPanel.module.css`](src/client/AssetsPanel.module.css) | 面板的样式 |
| [`src/client/media.tsx`](src/client/media.tsx) | 图片、视频和音频媒体类型及其 `dv.media.view` 条目 |
| [`src/client/library.ts`](src/client/library.ts) | 把项目的素材按媒体类型分组，并单列渲染静帧 |
| [`src/client/canvas.tsx`](src/client/canvas.tsx) | `asset` 节点类型及其卡片和编辑器主体 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/api`](../api/README.zh.md) — 状态路由和素材导入路由。
- [`@dv/asset-pool`](../asset-pool/README.zh.md) — 保存并提供素材文件的素材库。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md) — 画布、其素材选择窗口，以及节点类型和动作的注册表。
- [`@dv/ui-kit`](../ui-kit/README.zh.md) — API 客户端、wire 类型、素材拖动类型和波形。
- [`@dv/ui-media`](../ui-media/README.zh.md) — `dv.media` 组件工厂、媒体类型注册表和素材预览。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；素材库面板导入写下的 `asset.import` 记录只经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；面板不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **项目每次变化都拉取整个状态** — 项目的每次变化都会重新拉取整个状态，包括素材列表；没有增量的素材路由。
