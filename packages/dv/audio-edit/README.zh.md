---
description: "DreamVerse 的音频编辑组件：dvAudioEdit 服务及其两个操作 audioedit.split（在给定时间或最长的停顿处把一个音频素材切成几段）和 audioedit.speed（加快或放慢播放而不改变音调），以及它们的智能体工具。"
kind: "package-reference"
---

# @dv/audio-edit

[English](README.md) | 中文

## 概述

使用本包让智能体把音频（例如生成的旁白）配合到时间线的片段上。它的两个操作经 `dvFfmpeg` 运行 ffmpeg，`dvProject` 把它们变成智能体工具 `dv_audioedit_split` 和 `dv_audioedit_speed`：`audioedit.split` 在给定时间或最长的停顿处把一个音频素材切成几段，`audioedit.speed` 把它加快或放慢播放而不改变音调。两者都写出新的 WAV 素材，不改动输入。该组件没有归约函数。界面把这两个操作显示为 切分音频 / Split audio 和 调整语速 / Change speed。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project`、`@dv/ffmpeg` 和 `@dv/asset-pool` 之后挂载插件。

```yaml
- id: dv-audio-edit
  name: '@dv/audio-edit'
  config:
    pauseDb: -35
    minPauseSec: 0.3
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `pauseDb` | `-35` | `audioedit.split` 把低于此电平（dB）的声音算作停顿 |
| `minPauseSec` | `0.3` | `audioedit.split` 能在其中下刀的最短停顿，单位秒 |

| 操作 | 工具 | 输入和参数 | 报告 |
| --- | --- | --- | --- |
| `audioedit.split` | `dv_audioedit_split` | 输入 `audio`；`pieces`（2 或更多，在最长的停顿处切）与 `at`（切点时间，单位秒，大于 0、递增、相邻至少隔 1 毫秒）二选一 | `{pieces: [{start_sec, end_sec, duration_sec}]}` |
| `audioedit.speed` | `dv_audioedit_speed` | 输入 `audio`；`speed`（0.5 到 100）与 `duration_sec`（大于 0；算出的倍数也须在同一范围内）二选一 | `{speed, duration_sec}` |

两个参数都没给或都给了、或取值超出范围的调用，会在写任何记录之前以 `invalid_params` 被拒绝。音频无法满足的调用会把其记录标为失败，代码为 `operation_failed`：停顿不够切成 `pieces` 段、切点在结尾或结尾之后、输入不是音频、音频解码后没有样本，或 ffmpeg 出错。第一段输出的角色是 `piece`，之后各段的角色依次是 `output_1`、`output_2` 等。`audioedit.speed` 是确定性的，所以输入和参数相同的重复调用会复用之前的输出；`audioedit.split` 不是，因为它在停顿处的切点还取决于 `pauseDb` 和 `minPauseSec`。服务方法 `split(audio, cut, dir)` 和 `speed(audio, change, dir)` 为其他调用方做同样的检查。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`split` 先把第一条音频流解码成 16 位 PCM WAV 文件，再用 ffprobe 读取它的时长；对 MP3 文件，这个解码后的长度可能与容器报告的时长不同。给了 `pieces` 时，它在这个 WAV 文件上运行 ffmpeg 的 `silencedetect` 滤镜，保留开始于 0 之后、结束于结尾前至少 1 毫秒的停顿，取其中最长的 `pieces − 1` 个，在它们的正中间下刀。这 1 毫秒的余量使音频结尾处的停顿不计入，即使 `silencedetect` 和 ffprobe 对其结束时间的舍入相差 1 微秒。所有时间都四舍五入到毫秒。随后一条 ffmpeg 命令从这个 WAV 文件切出每一段，格式为 16 位 PCM WAV，因此各段覆盖音频直到其四舍五入到毫秒的长度，每段写出的长度与报告的长度相差不到 1 毫秒。给了 `duration_sec` 时，`speed` 以同样方式解码输入，由解码后的长度算出倍数；给了 `speed` 时，它直接读取输入。随后它应用保持音调的 ffmpeg `atempo` 滤镜，再用 ffprobe 读取结果的时长写入报告。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvAudioEdit`：两个操作及其服务方法 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/project`](../project/README.zh.md)：操作、确定性复用和智能体工具。
- [`@dv/ffmpeg`](../ffmpeg/README.zh.md)：`run` 和 `probe`。
- [`@dv/asset-pool`](../asset-pool/README.zh.md)：本组件读写的素材文件。
- [`@dv/timeline`](../timeline/README.zh.md)：`dv_timeline_sound_add` 把切出的各段放到音轨上。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

两个工具 `dv_audioedit_split` 和 `dv_audioedit_speed`，采用 `@dv/project` 给每个操作工具的格式。`dv_audioedit_split` 说明它把一个音频素材切成首尾相接、覆盖整段的几段，例如把一段旁白切成每个片段一句，并接受 `pieces` 或 `at`。`dv_audioedit_speed` 说明它加快或放慢一个音频素材而不改变音调，例如一句比片段还长的旁白，并接受 `speed` 或 `duration_sec`。两者都接受输入 `audio`，都说明每个结果是新的 WAV 素材以及 "Runs on the CPU."；`dv_audioedit_speed` 的描述以 "Repeating a call with the same inputs and params reuses the earlier result." 结尾。

#### Token 影响

两个定义连同 `@dv/project` 的共享参数约 650 个 token，挂载插件期间固定不变。这个数字按它们的大小（各约 1,250 个字符）估算，没有用分词器测量。

#### KV 缓存影响

这些定义位于每个智能体请求稳定的工具部分；挂载或移除插件会改变工具列表，使从工具部分开始的缓存前缀失效。

### 工具结果

#### 模型看到什么

一次调用返回一个文本块：`done <record>: ` 加摘要（`split into 3 pieces`、`speed ×1.25` 或 `fitted to 5 s`），每个输出一行，包括角色、素材 ID、MIME 类型和 URL，然后是参数和报告：每段在输入中的 `start_sec`、`end_sec` 和 `duration_sec`，或所用的倍数和结果的 `duration_sec`。

#### Token 影响

调速结果约 120 个 token；切分结果约 100 个 token，每段再加约 60 个，按大小估算。

#### KV 缓存影响

结果在调用之后追加到对话中；缓存前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只写新文件**：每次调用都写出新的 WAV 素材；两个操作都不会裁剪或调速已经在时间线上的声音。
- **按电平找停顿**：带 `pieces` 的 `audioedit.split` 把每段持续 `minPauseSec`、低于 `pauseDb` 的声音都当作停顿，所以人声下面的音乐或嘈杂背景会掩盖停顿；这时智能体改传 `at`。
- **只用第一条音频流**：有多条音频流的文件，只读取并切分第一条。
- **还没有 skill 使用这两个工具**：没有工作流 skill 告诉智能体什么时候切分或调速旁白。
- **没有录制的会话**：没有 e2e 故事或录制会话快照驱动 `dv_audioedit_split` 或 `dv_audioedit_speed`，它们的模型可见文本只由本包的测试固定。
