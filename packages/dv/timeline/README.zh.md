---
description: "DreamVerse 的时间线组件：dvTimeline 服务、项目的时间线及其片段、十个 timeline.* 编辑操作和 timeline.export 操作及其智能体工具，以及 timeline 归约函数。"
kind: "package-reference"
---

# @dv/timeline

[English](README.md) | 中文

## 概述

用本包保存项目的时间线：每条时间线是一个剪辑好的视频，按播放顺序保存片段；片段是带入点、出点和片段 ID（例如 `cl3`）的素材。本包注册十一个操作，它们成为智能体工具 `dv_timeline_*`：十个从不创建文件的编辑操作，以及经 `dvFfmpeg` 把一条时间线写成一个视频的 `timeline.export`。本包的 `timeline` 归约函数把编辑记录折叠成 `timeline` 切片。挂载 DSH 技能注册表时，本包还注册 `timeline-editing` 技能，它把剪辑说法对应到确切的 `dv_*` 调用。每个操作声明界面代替其工具名显示的标签，例如 `timeline.clip_move` 的 移动片段 / Move clip 和 `timeline.export` 的 导出时间线 / Export timeline。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project`、`@dv/ffmpeg` 和素材库 `@dv/asset-pool` 之后挂载本插件。它没有配置项。挂载 `@deepseek-ai/dsh-skill` 的技能注册表 `skills` 时，插件用 `ctx.skills.register` 注册 [`skills/timeline-editing/SKILL.md`](skills/timeline-editing/SKILL.md) 中的 `timeline-editing` 技能；没有注册表时，操作照常工作，不注册技能。

```yaml
- id: dv-timeline
  name: '@dv/timeline'
```

整条时间线的操作、`timeline.clip_insert` 和 `timeline.export` 用参数 `timeline`（时间线 ID，例如 `t1`）指定时间线：`timeline.update`、`timeline.rename` 和 `timeline.delete` 中它是必填项；`timeline.create` 默认为 `t1`，`timeline.clip_insert` 和 `timeline.export` 默认为第一条时间线。其他片段操作用参数 `clip` 中的片段 ID 指定片段，该 ID 同时确定了包含它的时间线。

| 操作 | 工具 | 参数 | 效果 |
| --- | --- | --- | --- |
| `timeline.create` | `dv_timeline_create` | `timeline`、`name`、`assets`（按顺序的素材 ID）；输入角色 `clip`（多个） | 添加一条时间线；ID 已存在时失败。没有 `assets` 时片段为按顺序的 `clip` 输入 |
| `timeline.update` | `dv_timeline_update` | `timeline`、`assets`（按顺序的素材 ID）；输入角色 `clip`（多个） | 用获得新片段 ID 的片段替换已有时间线的全部片段；保留名称 |
| `timeline.rename` | `dv_timeline_rename` | `timeline`、`name` | 设置名称 |
| `timeline.delete` | `dv_timeline_delete` | `timeline` | 删除时间线；其素材留在项目中 |
| `timeline.clip_insert` | `dv_timeline_clip_insert` | `timeline`、`at`、`asset` | 把素材作为片段插入到位置 `at`；时间线不存在时创建它 |
| `timeline.clip_move` | `dv_timeline_clip_move` | `clip`、`to` | 把片段移到位置 `to` |
| `timeline.clip_remove` | `dv_timeline_clip_remove` | `clip` | 移除片段；后面的片段前移 |
| `timeline.clip_split` | `dv_timeline_clip_split` | `clip`、`at_sec` | 在素材内的某个时间把片段分成同一素材的两个片段；后一部分获得新的片段 ID |
| `timeline.clip_trim` | `dv_timeline_clip_trim` | `clip`、`in_sec`、`out_sec` | 设置入点和出点；省略的点表示从素材开头播放或播放到素材结尾 |
| `timeline.clip_replace` | `dv_timeline_clip_replace` | `clip`、`asset` | 把片段换成另一个素材，保留其片段 ID 并重置入点和出点 |
| `timeline.export` | `dv_timeline_export` | `timeline` | 把时间线写成一个 MP4 文件，作为记录的输出 `video`；不改变时间线 |

`timeline` 切片为 `{timelines: Timeline[]}`；`Timeline` 为 `{id, name, clips}`，`Clip` 为 `{id, asset, source, in_sec, out_sec}`，其中 `id` 是片段 ID，`source` 是片段所来自的渲染输出 `{record, output}`（已有素材的片段为 null），入点或出点为 null 表示素材的开头或结尾。`asset` 不为 null 时片段就绪；`asset` 为 null 的片段是尚未完成的渲染的占位片段。它的 `ClipStatus` 由来源记录推导，从不存储：`ready`；来源记录为 pending 或 running 时为 `rendering`；否则为 `failed`。本包导出类型 `Timeline`、`Clip`、`ClipId`、`ClipStatus`、`TimelineId`、`TimelineState`（切片）和 `LayoutCall`（`layout` 的参数）。

`timeline.export` 不是确定性的，因为它的输出取决于项目状态中时间线的片段，而参数并不指明这些片段；每次调用都重新导出。它在 `cpu` 资源类别中运行，从不请求确认。时间线未知、项目没有时间线或时间线没有片段时，调用让记录失败。时间线中有占位片段时，调用在写下记录之前被拒绝，并列出片段位置，例如 "Clips 3, 5 of timeline t1 are not ready yet."；`exportTimeline` 抛出同样的错误。服务方法 `exportTimeline(timeline, dir)` 为其他调用方把拼好的文件写入 `dir` 并返回其路径。

工作流通过两个服务方法排布渲染结果。`layout(call)` 用一条记录排布 `call.clips`（按播放顺序的 `{record, output}` 引用）：状态中有 `call.timeline` 这条时间线时，用 `timeline.update` 替换它的片段；否则用 `timeline.create` 创建下一个空闲 ID，即比已用最大编号大一的 `t<n>`（没有时间线的项目为 `t1`）。记录立即运行，所以生产者尚未完成的片段是占位片段。记录复制调用的 `RecordOrigin` 字段和 `started_by`，唯一的参数是 `timeline`。`layout` 返回记录和时间线。`lastWrite(state, timeline)` 在状态位置之前的记录中返回该时间线最新的已完成 `timeline.create` 或 `timeline.update` 记录，没有时返回 null。片段编辑不算在内，记录的含义由调用方决定。

-----

<a id="understand-the-implementation"></a>
## 理解实现

编辑操作只写记录。每个操作的 `execute` 用记录父节点处的状态检查调用；当要创建的时间线已存在、指定的其他时间线或片段不存在、位置超出时间线、分割或裁剪指定了占位片段（"Clip cl3 is still rendering."）、分割时间不在片段内或裁剪范围为空时，它以原因使记录失败。这些操作不是 `deterministic` 的，因此运行器每次调用都执行这项检查，而不复用先前的记录。归约函数应用每条已完成的记录，并忽略无法应用的记录。

**占位片段。** `timeline.create` 和 `timeline.update` 在 `OperationSpec.pendingInputRoles` 中声明输入角色 `clip`，因此 `clip` 输入可以指向尚未完成的渲染的输出：调用立即运行，渲染进行时其记录已完成。归约函数把每个 `clip` 输入排成带该 `source` 的片段；在渲染完成前，输入的 `resolved_asset` 以及片段的 `asset` 为 null，渲染完成后由记录的当前形式填入。渲染失败时片段仍是占位片段。移动、移除和替换可用于占位片段；替换会放入素材并清空其 `source`。智能体摘要把占位片段列为 `{clip, asset: null, status, record, in_sec, out_sec}`，其中 `record` 是它等待的渲染。

**片段 ID。** 添加片段的操作在 `execute` 中分配片段 ID，并按片段顺序存入记录的 `report.clips`：`timeline.create` 和 `timeline.update` 每个片段一个，`timeline.clip_insert` 一个，`timeline.clip_split` 为后一部分分配一个（前一部分保留原片段 ID）。`cl` 之后的数字比项目历史列表中（包括当前位置之后的步骤）任一时间线记录的 `report.clips` 中的最大数字大 1，也大于分配给仍在运行的调用的任何数字，因此历史列表中不会有两个片段共用一个 ID，无论片段加在哪个状态中。归约函数只从 `report.clips` 读取片段 ID。已完成的记录如果其 `report.clips` 与它添加的片段不符，或指定了已在使用的 ID，则不产生任何效果。

**导出。** `exportTimeline` 从素材库取得每个片段的文件。`in_sec` 和 `out_sec` 都为 null 的片段播放整个素材，直接使用素材的文件。其他片段被裁成操作 `scratchDir` 中的新文件，定位放在 `-i` 之后并重新编码（yuv420p 的 H.264，AAC 音频），因此裁切落在准确的帧上。随后用 concat demuxer 以流复制拼接这些片段文件。ffmpeg 拒绝流复制时（例如文件的编码不一致），concat 滤镜按第一个文件的画面尺寸缩放并补边，重新编码每个文件的画面。操作探测拼好的文件，带上时长和画面尺寸导入它，并以时间线名称命名。归约函数忽略导出记录。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvTimeline`：十个编辑操作 spec、全部十一个操作的注册、片段 ID 的分配以及 `layout` 和 `lastWrite` |
| [`src/export.ts`](src/export.ts) | `timeline.export` 操作 spec 和 `exportTimeline` |
| [`src/reducer.ts`](src/reducer.ts) | `timeline` 归约函数及其与操作共用的片段检查 |
| [`src/types.ts`](src/types.ts) | `Timeline`、`Clip`、`ClipId`、`TimelineId`、`LayoutCall` 以及 `timeline` 切片声明 |
| [`skills/timeline-editing/SKILL.md`](skills/timeline-editing/SKILL.md) | `timeline-editing` 技能的正文 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/project`](../project/README.zh.md)：操作、归约函数、撤销和智能体工具。
- [`@dv/ffmpeg`](../ffmpeg/README.zh.md)：导出使用的 `run` 和 `probe`。
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md)：本包遵循的布局。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

十一个工具 `dv_timeline_create`、`dv_timeline_update`、`dv_timeline_rename`、`dv_timeline_delete`、`dv_timeline_clip_insert`、`dv_timeline_clip_move`、`dv_timeline_clip_remove`、`dv_timeline_clip_split`、`dv_timeline_clip_trim`、`dv_timeline_clip_replace` 和 `dv_timeline_export`，格式与 `@dv/project` 为每个操作工具提供的格式相同。编辑工具用 `timeline` 指定时间线（例如 `t1`；默认第一条时间线），用 `clip` 指定片段（例如 `cl3`），参数描述让智能体去 `dv_proj_state` 的 `timelines` 及其 `clips` 里查找。`dv_timeline_export` 的描述是 "Export a timeline to one video: each clip with an in or out point is trimmed to that range, and all clips are joined in timeline order. Runs on the CPU."，它自己只有一个参数 `timeline`。

#### Token 影响

挂载本插件时，十一个定义固定约 2,750 个 token；`@dv/project` 的共享参数给每个定义最多增加约 200 个 token。

#### KV Cache 影响

这些定义位于每个智能体请求固定的工具段中；挂载或移除插件会改变工具列表，使从工具段开始的缓存前缀失效。

### 工具结果

#### 模型看到什么

一次调用返回一个文本块，包含记录状态和一行摘要，例如 `clip cl3 moved to 1`；添加片段的调用还在 `report.clips` 中返回这些片段的 ID，不适用于时间线的调用返回带失败记录原因的工具错误。`dv_timeline_export` 返回 `done <record>: exported timeline t1`（没有 `timeline` 时为 `exported the first timeline`）、一行 `- video: <AssetId> (video/mp4) <url>`，以及参数；视频不发送图片块。`dv_proj_state` 按片段 ID（字段 `clip`）列出每条时间线及其片段，智能体的项目块也列出它们，并附上每个片段的产生记录；占位片段不显示素材，而显示其状态（`rendering` 或 `failed`）和它等待的渲染记录。

#### Token 影响

每次调用约 50 到 150 个 token；片段多的新建或更新再加上其素材列表。一次导出调用返回约 80 个 token。

#### KV Cache 影响

每个结果在调用之后追加到对话中；已缓存的前缀保持不变。

### 技能

#### 模型看到什么

技能目录列出 `timeline-editing` 及其描述和使用时机。智能体加载该技能时，读到一张表：从用户的剪辑说法（剪辑、重做、更换参考和风格、调整顺序、删除、回到之前的版本、撤销、恢复撤销、导出）到按顺序的 `dv_*` 调用及其必需参数，以及适用于每一行的规则。重做调用 `dv_shot_render`，并沿用生成该片段的记录的模型和生成任务。

#### Token 影响

插件挂载期间，技能目录中约 60 个 token；智能体每次加载该技能约 1,800 个 token。

#### KV Cache 影响

目录条目位于稳定的技能部分；挂载或移除插件会改变目录。加载的技能作为工具结果追加到对话中；已缓存的前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **素材是参数而不是输入**：`asset` 和 `assets` 作为参数记录，因此素材的产生记录被取代时，片段不会使其记录过期。
- **拼接回退只保留画面**：流复制失败时，`timeline.export` 重新编码的回退丢弃音频，导出的视频没有声音。
- **流复制接受部分不一致的文件**：ffmpeg 对画面尺寸不同的片段做流复制时不报错，播放器随后以错误的尺寸显示后面的片段；只有被拒绝的流复制才回退到重新编码。
- **没有 GPU 编码器**：导出的裁剪和回退拼接用 CPU 上的 `libx264` 重新编码。
