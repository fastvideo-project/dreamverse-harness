---
description: "作为右侧栏标签和中央视图的 DreamVerse 时间线编辑器：项目的每条时间线在一条轨道上，移动、裁剪、拆分、插入、移除手势变成 `timeline.*` 记录。"
kind: "package-reference"
---

# @dv/ui-timeline

[English](README.md) | 中文

## 概述

使用本包让 web 应用在对话旁边多一个时间线编辑器。编辑器为每条时间线显示一个标签，一个跨片段连续播放所选时间线的预览，以及一条视频轨道：每个片段的宽度就是它播放的时长，过期时有标记。你可以在轨道上移动、裁剪、拆分和移除片段，并把素材库里的素材拖到轨道上或用 ＋ 选择来插入。右侧栏的 `dv-timeline` 标签类型把编辑器包在项目栏下；`TimelineView` 是 shell 中间区域的 时间线 视图（`dv.center.view`）。两者都显示项目的当前状态，当前状态改变时跟着改变。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app` 和 `@dv/api` 的 profile 里挂载插件，先用 `pnpm run build` 构建浏览器 bundle。

编辑器还有一条工具栏和一把标尺，每个片段带生产它的记录的最后一帧。拖动片段即移动，拖动片段边缘即裁剪，工具栏在播放头处拆分片段，其 撤销 和 重做 图标按钮把项目的当前位置往回或往前移一步（不论这一步是哪个视图做的），不写记录，当前位置是最后一步时 重做 不可用，Delete 键移除选中的片段。预览下方的控制栏左侧是时间码；中间是后退 5 秒、播放或暂停、前进 5 秒（编辑器获得焦点时，J、L、Shift+← 和 Shift+→ 也能跳 5 秒）；右侧是播放速度按钮和全屏按钮，播放速度按钮在 0.5×、1×、1.5×、2× 之间循环，并在浏览器标签页的会话内保持所选速度。原声轨道按每个片段的播放区间画出它的波形。拖动预览和工具栏之间的分隔线（或在分隔线上按 ArrowUp 和 ArrowDown）可改变轨道区的高度，浏览器把它记在 `localStorage` 键 `dv-timeline-track-height` 下；预览至少保留 160 px。

```yaml
- id: dv-ui-timeline
  name: '@dv/ui-timeline'
```

Host 半边不注册任何东西。浏览器半边注册 `dv-timeline` 标签类型（侧栏指南页以"时间线"提供）、中英文的 `dvTimeline` locale 命名空间，以及以自身 id `@dv/ui-timeline` 为键的标签主体。只要 `@dv/ui-shell` 的中间区域服务 `dvCenter` 存在，它就把 `TimelineView` 注册为 `dv.center.view` 条目 `timeline`（顺序 1，标签为标签类型的 时间线 / Timeline），编辑中间区域所有者属性 `projectId` 指定的项目，为所有者属性 `session` 指定的对话写入记录，并应用所有者属性 `request`。在同一作用域里，它还注册 `dv.media.preview.action` 插槽的条目 `dv.timeline.insert`，即 `@dv/ui-media` 的 `dvMedia.preview` 打开的素材预览里的一个按钮：打开的项目的视频素材显示按钮 插入片段，点击后以该素材调用 `dvCenter.show({ view: 'timeline', target: { insert } })`，由打开项目的时间线视图插入它，并关闭预览。只要 `@dv/ui-canvas` 的画布服务 `dvCanvas` 存在，它还以同一 id 在 `dvCanvas.recordsInUse` 注册一个 `@dv/ui-canvas/contract` 的 `RecordsInUse`：其 `uses` 对每条时间线的每个片段列出该片段等待的渲染（`source.record`），否则列出片段素材的生成记录，于是画布画出时间线播放的版本；其 `badges` 在每个有入点或出点的片段的素材上加 已裁剪 / Trimmed 标记。只要 `@dv/ui-history` 的历史服务 `dvHistory` 存在，它就在 `dvHistory.rows` 注册 `@dv/ui-history/contract` 的 `HistoryRow` `timeline.`：它不给时间线记录的名称加主体，它的 `focus` 返回带记录的时间线和片段的中间区域目标 `{ view: 'timeline', target: { timeline, clip } }`。时间线是记录的 `timeline` 参数，否则是其 `clip` 参数所属的时间线（每个片段属于分配它的记录的时间线；拆分出的片段属于被拆分片段的时间线），否则对没有该参数的 `timeline.create` 为 `t1`；片段是 `clip` 参数，否则是记录分配的第一个片段。找不到时间线的记录不定位。`@dv/ui-composer` 提供 `dvMentions` 时，它还注册提及类型 `clip`（ID 为 `@dv/ui-timeline`，分组 片段 / Clips，order 为 0，所以 `@` 菜单把片段列在其他每个类型之前）：每条时间线的每个片段显示为 时间线 1 · 片段 2 / Timeline 1 · Clip 2（未命名的时间线），带生成片段素材的记录的提示词的前 40 个字符（占位片段取它等待的渲染），缩略图为该记录输出的图片，没有时为片段自己的素材。`TimelineView` 应用中间区域交给它的请求后取走该请求。请求 `{ timeline, clip }` 选中该时间线；带 `clip` 时，编辑器显示该时间线后选中那个片段，并把播放头移到片段开头。请求 `{ insert }` 在视图读到状态后插入该素材：`timeline.clip_insert` 插在所选时间线（否则第一条）末尾；状态里没有时间线时为 `timeline.create`，新建包含该片段的 `t1` 并选中 `t1`。两种形式都不是的请求不改变任何东西。

| 手势 | 记录 |
| --- | --- |
| 拖动片段边缘 | `timeline.clip_trim {clip, in_sec, out_sec}`（`clip` 是片段 ID）；未设置的一端不写 |
| 拖动片段 | `timeline.clip_move {clip, to}`（`to` 是从 1 开始的位置） |
| 拆分 | 对播放头下的片段做 `timeline.clip_split {clip, at_sec}` |
| 对选中片段按 Delete | `timeline.clip_remove {clip}` |
| 把素材拖到轨道上，或用 ＋ 选择 | `timeline.clip_insert {timeline, at, asset}` |
| ＋ 新建、重命名、删除标签 | `timeline.create {timeline, assets: []}`（不带名称，标签显示 时间线 {n} / Timeline {n}）、`timeline.rename {timeline, name}`、`timeline.delete {timeline}` |
| 导出 | 一次 `timeline.export {timeline}` 调用；链接打开导出的视频 |
| 对选中的过期片段点"仍然保留" | 对创建该片段素材的记录调用 `POST /api/dv/stale/accept`（`proj.stale_accept`） |

每条记录都带 `surface: 'timeline'`、视图旁边的对话（存为记录的 `session`；记录是项目当前位置之后的一步），以及一句用 DSH 界面语言说明手势的意图。`TimelineView` 显示打开项目的中间区域字段 `timeline` 指定的时间线，否则显示第一条时间线；用户在那里选中或新建的时间线经所有者属性 `note` 设置该字段，因此 shell 把它写进 URL，会话切换器的封面也跟随它。标签主体为每个项目保留自己的所选时间线，不影响中间区域。`TimelineView` 通过 `@dv/ui-kit/locale.ts` 跟随 `<html lang>`；切换时间线标签会停止播放，并重置预览和播放头。点一个片段会选中它，不发送任何请求。＋ 的选择窗口打开时获得焦点。用关闭按钮、焦点在窗口里、在 ＋ 上或在包含窗口的元素上时按 Esc、点击窗口外面或用 Tab 移出窗口来关闭它时，不插入素材。素材没有时长时片段按五秒画。

DOM 带测试 ID `dv-timeline-body`、`dv-timeline-editor`、`dv-timeline-viewer`、`dv-timeline-viewer-empty`、`dv-timeline-time`、`dv-timeline-exported`、`dv-timeline-ruler` 和 `dv-timeline-playhead`；每个片段带 `data-clip`（片段 ID）、`data-clip-position` 和 `data-clip-stale`，每个标签带 `data-timeline`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`TimelineBody` 持有来自 `@dv/ui-kit/useView.ts` 的视图会话，在 `TimelineEditor` 上方画项目栏。`TimelineView` 自己读取项目的当前状态。`placeTimeline` 把状态里的一条时间线变成带坐标的片段；`useTimelinePlayer` 通过两个叠放的 `<video>` 元素播放它们。原声轨道的波形来自 `@dv/ui-kit/waveform.ts` 的 `clipPeaks` 和 `useAudioEnvelope`。每个手势都是一次 `DvClient.runOperation` 调用加一次状态重新拉取。

| 文件 | 内容 |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | 注册 |
| [`src/client/InsertClipAction.tsx`](src/client/InsertClipAction.tsx) | 素材预览的 插入片段 操作（`dv.media.preview.action`） |
| [`src/client/definition.ts`](src/client/definition.ts) | 标签类型 |
| [`src/client/TimelineBody.tsx`](src/client/TimelineBody.tsx) | 标签主体：项目栏和编辑器 |
| [`src/client/TimelineView.tsx`](src/client/TimelineView.tsx) | 中央视图：状态、写入、中间区域字段 `timeline`，以及历史和 插入片段 的请求 |
| [`src/client/selection.ts`](src/client/selection.ts) | 标签主体为每个项目所选的时间线，以及中央视图请求的读取 |
| [`src/client/TimelineEditor.tsx`](src/client/TimelineEditor.tsx) | 编辑器：标签、预览、工具栏、标尺、轨道、手势 |
| [`src/client/timelines.ts`](src/client/timelines.ts) | `timelinesOf(state)`（`timeline` 切片中的时间线，`@dv/timeline` 未加载时为 `[]`）、片段摆放、放下位置、时间码，以及 `videoAssets(state)`（＋ 提供的视频素材，最新的在前） |
| [`src/client/records-in-use.ts`](src/client/records-in-use.ts) | 画布的 `RecordsInUse`：片段记录和裁剪标记 |
| [`src/client/history-row.ts`](src/client/history-row.ts) | 时间线记录的 `HistoryRow`：每个片段所属的时间线和选中记录的定位 |
| [`src/client/mention.ts`](src/client/mention.ts) | 对话输入框 `@` 菜单的片段提及类型 |
| [`src/client/first-frame.ts`](src/client/first-frame.ts) | 视频的首帧，每个页面只读一次；没有静帧图的轨道片段把它沿整个宽度重复铺满 |
| [`src/client/player.ts`](src/client/player.ts) | 跨片段连续播放 |
| [`src/client/locales.ts`](src/client/locales.ts) | `dvTimeline` 词典 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/api`](../api/README.zh.md) — 每个手势背后的路由。
- [`@dv/ui-kit`](../ui-kit/README.zh.md) — 客户端、轨道几何、波形和 hook。
- [`@dv/timeline`](../timeline/README.zh.md) — 编辑器调用的 `timeline.*` 操作，包括导出调用的 `timeline.export` 操作。
- [`@dv/ui-shell`](../ui-shell/README.zh.md) — 工作区中间区域、`dvCenter` 和 `dv.center.view` 插槽。
- [`@dv/ui-media`](../ui-media/README.zh.md) — 素材预览及其 `dv.media.preview.action` 插槽。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；其手势写下的记录只经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；时间线不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只有一条视频轨道** — 原声轨道镜像视频片段，没有自己的编辑操作；字幕和配乐没有泳道。
- **波形在浏览器里解码** — 原声轨道为每个片段画波形（`@dv/ui-kit/waveform.ts`）时，会下载片段的整个媒体文件，用 Web Audio API 解码其音频，一次解码一个素材，并在本次页面加载内按素材缓存在内存里；音频解码期间、解码失败时、媒体没有音轨时，片段保持纯色块。媒体文件取不到时（网络错误或 5xx 状态），结果不进缓存：片段在 2 秒、8 秒、30 秒后各重试一次，片段下次挂载时从头再试。
