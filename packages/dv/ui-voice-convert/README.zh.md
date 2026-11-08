---
description: "DreamVerse 配音的浏览器半边：右侧栏的配音标签页，用浏览器麦克风把台词录进素材库，并用 voice.convert 把录音转换为允许的音色；以及用 defineGenerationUi 声明的、画布上作为配音版本的 voice.convert 记录。"
kind: "package-reference"
---

# @fastvideo/dreamverse-ui-voice-convert

[English](README.md) | 中文

## 概要

使用本包，让用户在 web 应用里为角色表演台词。右侧栏的 配音 / Voice 标签页把载入的剧本一次一句放大显示，用浏览器麦克风录下每一句，作为所打开项目的音频素材保存，并通过 [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.zh.md) 的一次 `voice.convert` 运行，把录音转换为某个 `a2a` 模型的音色。转换后的版本是画布上的配音节点，其版本编辑器的音色选项列出模型的音色。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

与 `@fastvideo/dreamverse-voice-convert` 和一个任务 `a2a` 的提供方一起挂载本插件；DreamVerse 套件默认不挂载它。

```yaml
- id: dv-ui-voice-convert
  name: '@fastvideo/dreamverse-ui-voice-convert'
```

| 手势 | 请求或事件 |
| --- | --- |
| 载入剧本，然后选择 `.txt` 或 `.md` 文件 | 以 `text/plain` 对该文件发出 `POST /api/dv/assets/import`（浏览器不给 Markdown 媒体类型），该剧本成为所选剧本；剧本 菜单列出项目的 `text/plain` 和 `text/markdown` 素材 |
| 提词器 | 所选剧本的文本（`GET /dv/assets/<AssetId>`）由 `parseScript` 解析：`名字: 台词` 行、剧本格式的段落（大写的说话人，下面到空行或下一个说话人为止是台词），以及没有说话人的其他行；括号或方括号中的行、场景标题（`INT.`、`EXT.`），以及段落中小写词里夹着大写词的行（动作描写，例如 `Fletcher SLAPS him.`）被跳过；只要剧本里有任何说话人，没有说话人的行也算动作描写。当前台词连同说话人、位置（`第 3 / 12 句`）和已录制时的 ✓ 放大显示，下面是全部台词的列表 |
| 录制这一句、停止、重录、保存这条；提词器获得焦点时的空格、回车、← 和 → | 保存时以 `<剧本词干>-line-<NN>.wav` 和 `surface=asset_pool` 导入该条，重新读取状态，在转换表单中选中该条及其文字，并切换到下一句 |
| 开始录音，然后 停止 | 浏览器请求麦克风；录音被解码，以单声道 16 位 WAV 的形式留在标签页里，名为 `line-<YYYYMMDD-HHMMSS>.wav`，并带播放器 |
| 保存录音 | `POST /api/dv/assets/import`，带 `surface=asset_pool` 和标签所在的对话；新素材成为所选录音 |
| 丢弃 | 丢掉录音；不写入任何内容 |
| 转换 | `POST /api/dv/operation`，操作 `voice.convert`，`surface: 'asset_pool'`，所选录音作为输入 `reference`，所选音色的模型键和 `voice`，台词文字去掉首尾空白后作为 `prompt` |

在录音菜单中选择某一句的录音会填入它的文字。录音菜单列出项目的音频素材，最新的在前；音色菜单列出 `GET /api/dv/models` 中每个 `a2a` 模型的音色。没有这样的模型时，标签页提示没有可用的音色模型；没有录音时，它要求先录制一段再转换。被拒绝或失败的请求以警告显示其消息。浏览器只在安全来源上提供麦克风，例如通过 SSH 隧道访问的 `http://127.0.0.1`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

客户端插件在右侧栏标签注册表中注册 `dv-voice` 标签类型，并以键 `@fastvideo/dreamverse-ui-voice-convert` 在插槽 `sidebar.right.pane.tab` 中注册其主体；主体为 `useCurrentProject` 给出的项目绘制 `VoicePanel`。一个 `defineGenerationUi` 声明把 `voice.convert` 记录认领为节点类型 `voice`（调色板位置 `var(--dv-node-6)`，主体高度 72），并注册其卡片、版本编辑器、重试动作、对话卡片、历史行和参数栏。参数栏的选项菜单列出所选模型 `schema()` 中的音色，`@` 过滤只提供一段音频录音。`browserRecorder` 用 `MediaRecorder` 录音，用 `AudioContext` 解码，把各声道混为一个，并用 `encodeWav` 编码为 16 位 PCM WAV，因此素材库能读出录音的时长。

| 文件 | 内容 |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | 标签类型、其主体和配音版本 |
| [`src/client/VoicePanel.tsx`](src/client/VoicePanel.tsx) | 配音面板和浏览器麦克风 |
| [`src/client/voice-bar.ts`](src/client/voice-bar.ts) | `voice.convert` 的参数栏 |
| [`src/client/wav.ts`](src/client/wav.ts) | 单声道混合和 WAV 编码 |
| [`src/client/ScriptPanel.tsx`](src/client/ScriptPanel.tsx) | 剧本提词器 |
| [`src/client/script.ts`](src/client/script.ts) | 剧本解析和逐句录音的文件名 |
| [`src/client/useTake.ts`](src/client/useTake.ts) | 一次一条麦克风录音，由提词器和单句录音共用 |
| [`tests/script.client.spec.tsx`](tests/script.client.spec.tsx) | 剧本解析、录音文件名，以及提词器的手势和按键 |
| [`tests/voice.client.spec.tsx`](tests/voice.client.spec.tsx) | WAV 编码、参数栏，以及面板在脚本化 API 和假麦克风上的手势 |
| [`tests/plugin.client.spec.tsx`](tests/plugin.client.spec.tsx) | 插槽运行时下的注册及其移除，以及在桩化浏览器 API 上的浏览器麦克风 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.zh.md)：标签页运行的操作。
- [`@dv/ui-generation`](../ui-generation/README.zh.md)：绘制配音版本的生成工具包。
- [`@dv/ui-asset-pool`](../ui-asset-pool/README.zh.md)：素材库面板，在 音频 一组下列出录音和版本。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；配音标签页和配音版本写下的 `asset.import` 和 `voice.convert` 记录只经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；本包不向模型发送任何内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **不能剪辑**：标签页保存整段录音；要改台词就重新录制，而不是剪切。
- **智能体读不到剧本**：没有工具读取文本素材的内容，所以智能体从标签页写下的 `voice.convert` 记录或从用户那里得知台词的文字。
