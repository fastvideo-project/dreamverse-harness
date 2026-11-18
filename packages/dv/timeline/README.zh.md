---
description: "DreamVerse 的时间线组件：dvTimeline 服务、项目的时间线及其片段、视频轨和声音、二十五个 timeline.* 编辑操作和 timeline.export 操作及其智能体工具，以及 timeline 归约函数。"
kind: "package-reference"
---

# @dv/timeline

[English](README.md) | 中文

## 概述

用本包保存项目的时间线：每条时间线是一个剪辑好的视频，按播放顺序保存片段；片段是带入点、出点和片段 ID（例如 `cl3`）的素材。时间线还保存这些片段下方的视频轨，视频轨上的片段从各自的开始时间播放，在主视频轨的片段放完以后才显示；时间线还保存声音，即放在音轨上的音频素材。本包注册二十六个操作，即智能体工具 `dv_timeline_*`：二十五个从不创建文件的编辑操作，以及经 `dvFfmpeg` 把一条时间线写成一个视频的 `timeline.export`。本包的 `timeline` 归约函数把编辑记录折叠成 `timeline` 切片。挂载 DSH 技能注册表时，本包还注册 `timeline-editing` 技能。

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

每个操作声明界面代替其工具名显示的标签，例如 `timeline.clip_move` 的 移动片段 / Move clip 和 `timeline.export` 的 导出时间线 / Export timeline。

整条时间线的操作、`timeline.clip_insert` 和 `timeline.export` 用参数 `timeline`（时间线 ID，例如 `t1`）指定时间线：`timeline.update`、`timeline.rename` 和 `timeline.delete` 中它是必填项；`timeline.create` 默认为 `t1`，`timeline.clip_insert` 和 `timeline.export` 默认为第一条时间线。其他片段操作用参数 `clip` 中的片段 ID 指定片段，该 ID 同时确定了包含它的时间线。`timeline.sound_add`、`timeline.sound_track_remove`、`timeline.sound_track_rename` 和 `timeline.mute` 必须给出 `timeline`；`timeline.sound_remove` 用参数 `sound` 中的声音 ID 指定声音。音轨是一个编号：`0` 是片段自身音频下面的第一条音轨，`1` 是下一条，依此类推。`timeline.track_clip_add` 和 `timeline.video_track_remove` 必须给出 `timeline`，`timeline.track_clip_move` 用 `clip` 指定片段。主视频轨（视频 轨，片段一个接一个播放）下方的视频轨也是编号：`0` 是最先添加的一条，`1` 是下一条，依此类推；有了视频轨以后，时间线编辑器把主视频轨显示为 视频 1，把视频轨 `n` 显示为 视频 `n` + 2。

| 操作 | 工具 | 参数 | 效果 |
| --- | --- | --- | --- |
| `timeline.create` | `dv_timeline_create` | `timeline`、`name`、`assets`（按顺序的素材 ID）；输入角色 `clip`（多个） | 添加一条时间线；ID 已存在时失败。没有 `assets` 时片段为按顺序的 `clip` 输入 |
| `timeline.update` | `dv_timeline_update` | `timeline`、`assets`（按顺序的素材 ID）；输入角色 `clip`（多个） | 用获得新片段 ID 的片段替换已有时间线的全部片段；保留名称 |
| `timeline.rename` | `dv_timeline_rename` | `timeline`、`name` | 设置名称 |
| `timeline.delete` | `dv_timeline_delete` | `timeline` | 删除时间线；其素材留在项目中 |
| `timeline.clip_insert` | `dv_timeline_clip_insert` | `timeline`、`at`、`asset` | 把素材作为片段插入到位置 `at`；时间线不存在时创建它 |
| `timeline.clip_move` | `dv_timeline_clip_move` | `clip`、`to` | 把片段移到主视频轨的位置 `to`；视频轨上的片段会移进主视频轨的这个位置，片段 ID 和入点、出点不变 |
| `timeline.clip_remove` | `dv_timeline_clip_remove` | `clip` | 移除片段；后面的片段前移 |
| `timeline.clip_split` | `dv_timeline_clip_split` | `clip`、`at_sec` | 在素材内的某个时间把片段分成同一素材的两个片段；后一部分获得新的片段 ID |
| `timeline.clip_trim` | `dv_timeline_clip_trim` | `clip`、`in_sec`、`out_sec` | 设置入点和出点；省略的点表示从素材开头播放或播放到素材结尾 |
| `timeline.clip_replace` | `dv_timeline_clip_replace` | `clip`、`asset` | 把片段换成另一个素材，保留其片段 ID 并重置入点和出点 |
| `timeline.sound_add` | `dv_timeline_sound_add` | `timeline`、`asset`、`start_sec`、`track`（默认 `0`） | 把音频素材作为声音放上去，从时间线开头之后 `start_sec` 秒开始；它可以与片段和其他声音重叠，并获得新的声音 ID。素材是其他媒体类型时以 "Asset <id> is not an audio file." 失败 |
| `timeline.sound_remove` | `dv_timeline_sound_remove` | `sound` | 移除声音；其素材留在项目中 |
| `timeline.sound_split` | `dv_timeline_sound_split` | `sound`、`at_sec` | 在素材内第 `at_sec` 秒处把声音拆成两段：第一段保留声音 ID、到这里结束，第二段获得新的声音 ID、从这里开始，留在它原来播放的时间线位置；不创建文件 |
| `timeline.sound_move` | `dv_timeline_sound_move` | `sound`、`start_sec`、`track` | 把声音移到 `start_sec`，给了 `track` 时还移到那条音轨（已有的音轨或最后一条的下一条） |
| `timeline.sound_trim` | `dv_timeline_sound_trim` | `sound`、`in_sec`、`out_sec` | 设置声音的入点和出点（缺少的一端表示素材的开头或结尾）；开始时间随入点移动同样的量，其余部分留在原处播放；不创建文件 |
| `timeline.sound_track_remove` | `dv_timeline_sound_track_remove` | `timeline`、`track` | 移除一条音轨及其全部声音和名称；后面每条音轨前移一位 |
| `timeline.sound_track_rename` | `dv_timeline_sound_track_rename` | `timeline`、`track`、`name` | 设置音轨名称（去掉首尾空白）；空名称显示带编号的默认名称 |
| `timeline.mute` | `dv_timeline_mute` | `timeline`、`target`、`track`、`muted` | 把主视频轨片段自身的音频（`target: video`）、视频轨 `track` 上片段自身的音频（`target: video_track`）或音轨 `track`（`target: sound`）静音（`muted: true`）或取消静音 |
| `timeline.track_clip_add` | `dv_timeline_track_clip_add` | `timeline`、`asset`、`start_sec`、`track` | 把一个视频素材放到视频轨 `track` 上，从 `start_sec` 开始；它得到新的片段 ID。素材是其他媒体类型时失败，原因为 "Asset <id> is not a video." |
| `timeline.track_clip_move` | `dv_timeline_track_clip_move` | `clip`、`start_sec`、`track`（默认为片段自己的轨道） | 把视频轨上的片段移到 `start_sec`，放到视频轨 `track` 上；主视频轨上已渲染好的片段会移出主视频轨、放到 `track` 上（这时必须给 `track`），片段 ID 和入点、出点不变，不再记录它来自哪次渲染 |
| `timeline.video_track_remove` | `dv_timeline_video_track_remove` | `timeline`、`track` | 删除一条视频轨及其全部片段和静音；它下面的每一条上移一位 |
| `timeline.video_track_move` | `dv_timeline_video_track_move` | `timeline`、`track`、`to` | 把一条视频轨连同片段和静音移到编号 `to`，让它盖住这个编号之后的轨道；两个编号之间的轨道朝它原来的编号移一位，`track_order` 不变 |
| `timeline.main_track_remove` | `dv_timeline_main_track_remove` | `timeline` | 删除主视频轨的片段；视频轨 0 成为主视频轨，它的片段按开始时间的顺序连在一起、去掉中间的空隙，保留片段 ID 和入点、出点，它的静音变成主视频轨原声的静音，其他视频轨的编号各减一。没有视频轨时，主视频轨留空 |
| `timeline.main_track_swap` | `dv_timeline_main_track_swap` | `timeline` | 对调主视频轨和视频轨 0：主视频轨的片段放到视频轨 0 上原来播放的时间（调用按素材长度算出这些时间，存入 `report.starts`），视频轨 0 的片段按开始时间的顺序成为主视频轨的片段，去掉中间的空隙；片段都保留 ID，两边的静音也对调 |
| `timeline.track_add` | `dv_timeline_track_add` | `timeline`、`kind`（`video` 或 `sound`） | 在时间线所有轨道的最下面添加一条空的视频轨或音轨 |
| `timeline.export` | `dv_timeline_export` | `timeline` | 把时间线写成一个 MP4 文件，作为记录的输出 `video`；不改变时间线 |

`timeline` 切片为 `{timelines: Timeline[]}`；`Timeline` 为 `{id, name, clips, track_clips, muted_video_tracks, track_order, sounds, sound_track_names, video_muted, muted_sound_tracks}`，`Clip` 为 `{id, asset, source, in_sec, out_sec}`，其中 `id` 是片段 ID，`source` 是片段所来自的渲染输出 `{record, output}`（已有素材的片段为 null），入点或出点为 null 表示素材的开头或结尾。`asset` 不为 null 时片段就绪；`asset` 为 null 的片段是尚未完成的渲染的占位片段。它的 `ClipStatus` 由来源记录推导，从不存储：`ready`；来源记录为 pending 或 running 时为 `rendering`；否则为 `failed`。`Sound` 为 `{id, asset, in_sec, out_sec, start_sec, track}`，其中 `id` 是声音 ID：它在时间线开始后 `start_sec` 秒开始，播放素材的 `in_sec` 到 `out_sec`，入点或出点为 null 表示素材的开头或结尾，片段自身的音频在它下面照常播放。`sounds` 按添加顺序排列，`sound_track_names` 按音轨编号保存音轨名称，缺失或为空的名称显示为 声音 {n}。`video_muted` 表示片段自身的音频是否静音，`muted_sound_tracks` 按升序列出静音的音轨编号。只有静音的音轨也算已保存的音轨。`track_clips` 中的 `TrackClip` 为 `{id, asset, in_sec, out_sec, start_sec, track}`：它在时间线开始后 `start_sec` 秒开始，播放素材的 `in_sec` 到 `out_sec`，同一条轨道上的片段从不重叠。主视频轨在结束之前盖住所有视频轨片段。主视频轨结束以后，时间线只显示并播放编号最小、此刻有片段的那条轨道上的片段；这条轨道此刻没有片段的地方，显示下一条轨道。`clip_remove`、`clip_split`、`clip_trim` 和 `clip_replace` 也作用于视频轨片段：裁剪它的入点会让开始时间移动同样的量，分割后的第二段从第一段结束处开始。`track_clips` 按添加顺序排列，`muted_video_tracks` 按升序列出静音的视频轨。`track_order` 从上往下列出主视频轨及其自身音频下方各条轨道的类型（`video` 或 `sound`），第 n 个 `video` 是视频轨 n，第 n 个 `sound` 是音轨 n：新时间线为 `['sound']`，`timeline.track_add` 和指定最后一条轨道下一条的调用把新轨道加到最下面，删除轨道时去掉它的那一项。每一项让它的轨道一直保存着，空的也一样，直到被删除，所以新时间线有一条空的音轨 0，最后一个片段或声音被移除的轨道仍然保留，音轨全部删除后的时间线一条音轨也没有。本包导出类型 `Timeline`、`Clip`、`ClipId`、`ClipStatus`、`TrackClip`、`TrackKind`、`Sound`、`SoundId`、`TimelineId` 和 `TimelineState`（切片）。

`timeline.export` 不是确定性的，因为它的输出取决于项目状态中时间线的片段，而参数并不指明这些片段；每次调用都重新导出。它在 `cpu` 资源类别中运行。时间线未知、项目没有时间线或时间线的主视频轨没有片段时，调用让记录失败。时间线中有占位片段时，调用在写下记录之前被拒绝，并列出片段位置，例如 "Clips 3, 5 of timeline t1 are not ready yet."；`exportTimeline` 抛出同样的错误。服务方法 `exportTimeline(timeline, dir)` 为其他调用方把拼好的文件写入 `dir` 并返回其路径。

加载 `@dv/canvas` 时，插件还注册 `timeline.place`（工具 `dv_timeline_place`，标签 把时间线放到画布上 / Place timeline on canvas，必填参数 `timeline`），并通过 `dvCanvasNodes` 的 `registerMaker` 登记它：每条完成的记录在布局第 3 列生成一个 `timeline` 类型的画布节点，声明的尺寸 640 × 390 使下一个放置的节点避开它的默认画框。它的前置检查在写入任何记录之前拒绝不存在的时间线（"Timeline t9 does not exist."）和已有 `timeline` 节点显示的时间线（"Timeline t1 is already on the canvas as node <id>."）；节点被 `canvas.node_remove` 移除后，这条时间线可以再次作为新节点放到画布上。时间线被删除后，节点仍留在原处。[`@dv/ui-timeline`](../ui-timeline/README.zh.md) 绘制这个节点，并从画布的添加菜单把时间线放到画布上。

工作流技能（例如 `@dv/workflow-skills` 的 `story-directing`）用智能体工具 `dv_timeline_create` 和 `dv_timeline_update` 排布渲染结果：每个 `clip` 输入指明一个渲染输出 `<record>#<output>`，渲染尚未完成的片段在完成前是占位片段。

-----

<a id="understand-the-implementation"></a>
## 理解实现

编辑操作只写记录。每个操作的 `execute` 用记录父节点处的状态检查调用；当要创建的时间线已存在、指定的其他时间线或片段不存在、位置超出时间线、分割或裁剪指定了占位片段（"Clip cl3 is still rendering."）、分割时间不在片段内、裁剪范围为空、指定的声音不存在、拆分声音的时间不在声音内、裁剪声音后范围为空或声音会在时间线开始之前开始、`start_sec` 为负、`track` 不是 0 或以上的整数、`timeline.sound_track_remove` 指定了时间线没有的音轨、`timeline.sound_add` 或 `timeline.sound_track_rename` 指定的音轨超过最后一条音轨的下一条（新时间线带一条空的音轨 0，接受音轨 0 和 1；音轨全部删除后的时间线接受音轨 0 和 1，与以前的版本一致）、音轨名称不是字符串、`timeline.sound_add` 的素材不是音频文件，`timeline.mute` 指定的音轨超过最后一条音轨的下一条、`target` 不是 `video`、`video_track` 或 `sound`、`muted` 不是布尔值，`timeline.track_clip_add` 的素材不是视频，视频轨调用指定的轨道超过最下面一条的下一条（对 `timeline.video_track_remove` 和 `timeline.video_track_move` 的两个编号是时间线没有的轨道），`timeline.main_track_remove` 指定的时间线既没有主视频轨片段也没有视频轨，`timeline.main_track_swap` 指定的时间线没有视频轨、主视频轨有片段仍在渲染（"Clip cl2 is still rendering; it cannot leave the main video track yet."）或有片段长度未知，`timeline.track_clip_move` 指定了主视频轨的片段却没给 `track`，或调用会让某个视频轨片段与同轨的另一个片段重叠、在时间线开始之前开始、或长度未知（素材没有已知时长且没有出点）时，它以原因使记录失败，例如 "The new clip would overlap clip cl4 on video track 0 (2s to 6s); pick another start_sec or track."。这些操作不是 `deterministic` 的，因此运行器每次调用都执行这项检查，而不复用先前的记录。归约函数应用每条已完成的记录，并忽略无法应用的记录。

**占位片段。** `timeline.create` 和 `timeline.update` 在 `OperationSpec.pendingInputRoles` 中声明输入角色 `clip`，因此 `clip` 输入可以指向尚未完成的渲染的输出：调用立即运行，渲染进行时其记录已完成。归约函数把每个 `clip` 输入排成带该 `source` 的片段；在渲染完成前，输入的 `resolved_asset` 以及片段的 `asset` 为 null，渲染完成后由记录的当前形式填入。渲染失败时片段仍是占位片段。移动、移除和替换可用于占位片段；替换会放入素材并清空其 `source`。智能体摘要把占位片段列为 `{clip, asset: null, status, record, in_sec, out_sec}`，其中 `record` 是它等待的渲染。

**片段 ID。** 添加片段的操作在 `execute` 中分配片段 ID，并按片段顺序存入记录的 `report.clips`：`timeline.create` 和 `timeline.update` 每个片段一个，`timeline.clip_insert` 一个，`timeline.clip_split` 为后一部分分配一个（前一部分保留原片段 ID）。`cl` 之后的数字比项目历史列表中（包括当前位置之后的步骤）任一时间线记录的 `report.clips` 中的最大数字大 1，也大于分配给仍在运行的调用的任何数字，因此历史列表中不会有两个片段共用一个 ID，无论片段加在哪个状态中。归约函数只从 `report.clips` 读取片段 ID。已完成的记录如果其 `report.clips` 与它添加的片段不符，或指定了已在使用的 ID，则不产生任何效果。

**声音 ID。** `timeline.sound_add` 和 `timeline.sound_split` 各在 `execute` 中分配一个声音 ID（例如 `sd2`），并存入记录的 `report.sounds`。`sd` 之后的数字按片段 ID 的规则，取历史列表中的 `report.sounds` 和仍在运行的调用计算，因此声音 ID 同样在项目内唯一、从不复用。已完成的记录如果其 `report.sounds` 对 `timeline.sound_add` 或 `timeline.sound_split` 不是恰好一个 ID、对其他操作不为空，或指定了已在使用的 ID，则不产生任何效果。

**导出。** `exportTimeline` 从素材库取得每个片段的文件。`in_sec` 和 `out_sec` 都为 null 的片段播放整个素材，直接使用素材的文件。其他片段被裁成操作 `scratchDir` 中的新文件，定位放在 `-i` 之后并重新编码（yuv420p 的 H.264，AAC 音频；`video_muted` 打开时不带音频），因此裁切落在准确的帧上。随后用 concat demuxer 以流复制拼接这些片段文件。ffmpeg 拒绝流复制时（例如文件的编码不一致），concat 滤镜按第一个文件的画面尺寸缩放并补边，重新编码每个文件的画面，拼好的文件没有音频。有视频轨片段比拼好的视频结束得晚时，拼好的视频末尾补黑帧，一直补到这些片段中最晚的结束时间；每个这样的片段的文件（同样裁切；所在轨道静音时不带音频）缩放到适合画面，补黑边，从拼好的视频结束处画到它自己结束，轨道编号最大的先画，所以编号小的轨道盖住编号大的。比拼好的视频先结束的视频轨片段不放进去。音频跟着画面走：每个画上去的片段的音频，在拼好的视频结束之前和编号更小的轨道有片段播放时被静音，其余的音频和主视频轨的音频混合。操作探测结果文件，带上时长和画面尺寸导入它，并以时间线名称命名。导出不包含时间线的声音；`video_muted` 打开时，流复制也去掉片段自身的音频（`-an`），所以两种拼接方式得到的文件都没有音频。归约函数忽略导出记录。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvTimeline`：二十五个编辑操作 spec、全部二十六个操作的注册、以及片段 ID 和声音 ID 的分配 |
| [`src/export.ts`](src/export.ts) | `timeline.export` 操作 spec 和 `exportTimeline` |
| [`src/place.ts`](src/place.ts) | `timeline.place` 操作 spec 和 `timeline` 节点的节点生成登记 |
| [`src/reducer.ts`](src/reducer.ts) | `timeline` 归约函数及其与操作共用的片段和声音检查 |
| [`src/types.ts`](src/types.ts) | `Timeline`、`Clip`、`ClipId`、`Sound`、`SoundId`、`TimelineId` 以及 `timeline` 切片声明 |
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

二十六个工具 `dv_timeline_create`、`dv_timeline_update`、`dv_timeline_rename`、`dv_timeline_delete`、`dv_timeline_clip_insert`、`dv_timeline_clip_move`、`dv_timeline_clip_remove`、`dv_timeline_clip_split`、`dv_timeline_clip_trim`、`dv_timeline_clip_replace`、`dv_timeline_sound_add`、`dv_timeline_sound_remove`、`dv_timeline_sound_split`、`dv_timeline_sound_move`、`dv_timeline_sound_trim`、`dv_timeline_sound_track_remove`、`dv_timeline_sound_track_rename`、`dv_timeline_mute`、`dv_timeline_track_clip_add`、`dv_timeline_track_clip_move`、`dv_timeline_video_track_remove`、`dv_timeline_video_track_move`、`dv_timeline_main_track_remove`、`dv_timeline_main_track_swap`、`dv_timeline_track_add` 和 `dv_timeline_export`，格式与 `@dv/project` 为每个操作工具提供的格式相同。编辑工具用 `timeline` 指定时间线（例如 `t1`；默认第一条时间线），用 `clip` 指定片段（例如 `cl3`），参数描述让智能体去 `dv_proj_state` 的 `timelines` 及其 `clips` 里查找；`dv_timeline_sound_remove` 用 `sound`（例如 `sd2`）指定 `timelines` 的 `sounds` 中的声音。`dv_timeline_sound_add` 的描述以 "The exported video does not include sounds yet." 结尾。`dv_timeline_export` 的描述是 "Export a timeline to one video: each clip with an in or out point is trimmed to that range, the clips of the main video track are joined in timeline order, and the clips of the video tracks under it play after its end, a track with a lower number covering those with higher numbers, picture and audio. Muted audio (dv_timeline_mute) is left out. The sound tracks are not included yet. Runs on the CPU."，它自己只有一个参数 `timeline`。 `dv_timeline_track_clip_add` 的描述说明轨道 0 是主视频轨下面的第一条，用户只有在主视频轨的最后一个片段结束以后、编号更小的轨道此刻没有片段时，才看到并听到这个片段。加载 `@dv/canvas` 时还有第二十七个工具 `dv_timeline_place`，描述为 "Put a timeline on the canvas as one node. The node shows the timeline's picture and tracks in small, with a line from each node whose output the timeline plays; selecting the node outlines those nodes. A timeline goes on the canvas once, and its node stays until dv_canvas_node_remove takes it off. Works whether or not the user has a canvas open. The change is a step of the project history, so dv_proj_undo reverts it."，唯一的自有参数是 `timeline`。

#### Token 影响

挂载本插件时，二十六个定义固定约 6,000 个 token，加载 `@dv/canvas` 时 `dv_timeline_place` 再多约 300 个；`@dv/project` 的共享参数给每个定义最多增加约 200 个 token。

#### KV Cache 影响

这些定义位于每个智能体请求固定的工具段中；挂载或移除插件会改变工具列表，使从工具段开始的缓存前缀失效。

### 工具结果

#### 模型看到什么

一次调用返回一个文本块，包含记录状态和一行摘要，例如 `clip cl3 moved to 1`；添加片段的调用还在 `report.clips` 中返回这些片段的 ID，`dv_timeline_sound_add` 返回 `t1 sound sd2 added at 3s`，并在 `report.sounds` 中返回声音 ID；不适用于时间线的调用返回带失败记录原因的工具错误。`dv_timeline_export` 返回 `done <record>: exported timeline t1`（没有 `timeline` 时为 `exported the first timeline`）、一行 `- video: <AssetId> (video/mp4) <url>`，以及参数；视频不发送图片块。`dv_proj_state` 按片段 ID（字段 `clip`）列出每条时间线及其片段，智能体的项目块也列出它们，并附上每个片段的产生记录；占位片段不显示素材，而显示其状态（`rendering` 或 `failed`）和它等待的渲染记录。有音轨的时间线（包括新时间线）还以 `{track, name}` 列出每条音轨的 `sound_tracks`，没有名称的音轨为 `''`，静音的音轨带 `muted: true`；片段自身音频被静音的时间线显示 `video_muted: true`；主视频轨下方有视频轨的时间线以 `{track, clips}` 从轨道 0 开始列出每条轨道的 `video_tracks`，静音的轨道带 `muted: true`，片段按开始时间以 `{clip, asset, url, start_sec, in_sec, out_sec}` 列出；有声音的时间线以 `{sound, asset, url, start_sec, in_sec, out_sec, track}` 列出 `sounds`；没有这些内容的时间线不带对应字段。 `dv_timeline_place` 返回 `done <record>: t1 placed on the canvas` 和参数，被拒绝时返回带前置检查消息的工具错误；新节点以 `timeline` 类型出现在 `dv_proj_state` 的 `canvas` 字段中。

#### Token 影响

每次调用约 50 到 150 个 token；片段多的新建或更新再加上其素材列表。一次导出调用返回约 80 个 token。

#### KV Cache 影响

每个结果在调用之后追加到对话中；已缓存的前缀保持不变。

### 技能

#### 模型看到什么

技能目录列出 `timeline-editing` 及其描述和使用时机。智能体加载该技能时，读到一张表：从用户的剪辑说法（剪辑、重做、更换参考和风格、调整顺序、删除、回到之前的版本、撤销、恢复撤销、静音、导出）到按顺序的 `dv_*` 调用及其必需参数，以及适用于每一行的规则。重做调用 `dv_shot_render`，并沿用生成该片段的记录的模型和生成任务。

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
- **导出不含声音**：`timeline.export` 只写入片段及其自身音频，因此导出的视频不包含任何声音。
- **视频轨只放已有素材**：尚未完成的渲染不能放到主视频轨下方的视频轨上，没有操作能把片段在主视频轨和这些轨道之间移动，视频轨片段总是铺满画面，没有位置、大小或不透明度。
- **声音按原音量播放**：没有操作能设置声音的音量，或让它淡入淡出。
- **技能不涵盖声音**：`timeline-editing` 技能没有把任何说法对应到声音工具。
