---
description: "DreamVerse 的配音组件：dvVoiceConvert 服务在 @dv/models 的模型目录中声明 voice 原语和任务 a2a，并拥有操作 voice.convert（用调用按目录键指定的模型把一段语音录音用允许的音色重新说出来）和智能体工具 dv_voice_convert。"
kind: "package-reference"
---

# @fastvideo/dreamverse-voice-convert

[English](README.md) | 中文

## 概要

使用本包让用户为角色配音：用户录下一句台词，`voice.convert`（工具 `dv_voice_convert`）用一个 `a2a` 模型的某个音色把录音重新说一遍，保留它的文字、节奏和语调。它在 [`@dv/models`](../models/README.zh.md) 的模型目录中声明生成原语 `voice` 和任务 `a2a`。转换后的音频是记录唯一的输出，带有时长，镜头可以原样把它用作对白音轨。目录中有任务 `a2a` 的模型时，该操作才存在。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project`、`@dv/models` 和 `@dv/asset-pool` 之后挂载插件，并挂载一个注册任务 `a2a` 模型的提供方插件，例如 [`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.zh.md)。目录中至少有一个任务 `a2a` 的模型时（`dvModels.whileServing`），`voice.convert` 才注册。该操作的标签是 转换音色 / Convert voice，服务存续期间用 `dvModels.labelTasks` 把任务 `a2a` 标为 音色转换 / Voice conversion。DreamVerse 套件默认不挂载它；由 profile 补丁和它的提供方一起插入。

```yaml
- id: dv-voice-convert
  name: '@fastvideo/dreamverse-voice-convert'
```

插件没有配置。

| 操作 | 工具 | 输入和参数 | 输出和报告 |
| --- | --- | --- | --- |
| `voice.convert` | `dv_voice_convert` | 输入 `reference`（必填：一段音频录音）；参数 `modality`、`task`、`provider` 和 `model`（必填：目录条目的键）、`prompt`（必填：录音说的文字；模型不读取）、`voice`（必填：`dv_models_get` 列出的某个音色的键）、`seed`、`extra`（模型自身的参数） | 输出 `audio`，一个名为 `<记录 ID 前 8 位>.wav` 的 `audio/wav` 素材，带 `duration_sec`；报告 `{seed, model_id, voice, duration_sec}` |

该操作使用 GPU，和所有生成一样在后台运行，结果不确定。不带 `seed` 的调用会抽取一个种子并报告它；相同种子重复同一个版本。工作流在 `dvVoiceConvert` 上调用 [`@dv/generation`](../generation/README.zh.md) 的 `GenerationApi` 方法：`render`、`check` 和 `parseInputs`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

本包通过声明合并声明 `PrimitiveTypes` 的原语行 `voice`：事实 `VoiceModelFacts`（`modelId`），请求 `VoiceRequest`（`speech`，即录音素材，生产它的记录仍在运行时为 null；`voice`；`seed`；`extra`），结果 `Promise<ConvertedVoice>`（字节、`mime: 'audio/wav'` 和 `durationSec`），没有条目字段。它在 `TaskMap` 中把任务 `a2a` 映射到这一行。`@dv/generation` 的 `defineGeneration` 构建服务。请求取去掉首尾空白的 `voice` 和角色为 `reference` 的唯一素材；空音色被拒绝，提示 "The voice is empty; name one voice that dv_models_get lists for the model."，录音不是恰好一段的调用被拒绝，提示 "voice.convert takes exactly one speech recording in inputs.reference."。输入角色是 `reference`，因为版本编辑器的输入框把每个引用的素材都放在这个角色里发送。条目的 `validateGenerationRequest(request)` 在任何记录之前、并在 `render(request, signal)` 之前再次检查音色、录音和 `extra`。`toOutputs` 通过 `importOne` 带着时长导入音频。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvVoiceConvert`：原语行 `voice` 和任务 `a2a`，类型 `VoiceModelFacts`、`VoiceRequest` 和 `ConvertedVoice`，以及 `voice.convert` 的声明（请求、存储的输出和摘要） |
| [`tests/voice-convert.spec.ts`](tests/voice-convert.spec.ts) | 一个 Loader 组合，包含工具注册表、Project、ffmpeg、素材库、目录和服务，对接一个假的 `a2a` 模型；固定智能体读到的文字和卸载时的移除 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.zh.md)：为任务 `a2a` 注册 Seed-VC v1 及其允许音色的提供方插件。
- [`@fastvideo/dreamverse-ui-voice-convert`](../ui-voice-convert/README.zh.md)：录制并转换台词的配音标签页，以及画布上的配音版本。
- [`@fastvideo/dreamverse-workflow-voice`](../workflow-voice/README.zh.md)：把转换后的版本用作镜头音轨的配音技能。
- [`@dv/generation`](../generation/README.zh.md)：构建服务、检查和 `GenerationApi` 的辅助模块。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

目录中有任务 `a2a` 的模型时，有一个工具 `dv_voice_convert`，格式与 `@dv/project` 给每个操作工具的格式相同。参数是 `modality`、`task`、`provider`、`model`、`prompt`、`voice`、`seed` 和 `extra`，输入角色是 `reference`。`prompt` 参数写着 "The words the recording speaks, as plain text. The model does not read them; they title the take and are the dialogue text of a shot that uses it."；`voice` 写着 "The key of one voice that dv_models_get lists for the model."。

##### 工具描述原文

```markdown
Speak one speech recording again in an allowed voice with an a2a model from dv_models_list; modality, task, provider and model name it and are required. dv_models_get lists the model's voices; voice names one of them. The converted clip keeps the recording's words, timing and intonation, so use it as the dialogue track of a shot, reused unchanged. The clip is the one output; the result gives its duration. You cannot hear the clip, so ask the user which take to keep. Every call is a new take; the same seed repeats one. Uses the GPU.
```

#### Token 影响

定义约 600 个 token（含 `@dv/project` 的共享参数），在插件和至少一个任务 `a2a` 的模型挂载期间固定不变。

#### KV 缓存影响

定义位于每个智能体请求的稳定工具部分。第一个注册或最后一个移除的 `a2a` 模型会增删该工具，从而改变工具列表，使工具部分起的缓存前缀失效。

### 工具结果

#### 模型看到什么

调用返回 `@dv/project` 的操作工具文本：`done <record>: voice <voice> "<prompt>" (<时长，一位小数>s)`、`- audio: <素材 ID> (audio/wav) <素材 URL>` 一行、参数，以及报告 `{"seed":<种子>,"model_id":"<后端模型 ID>","voice":"<音色>","duration_sec":<秒数>}`；等待录音生产者的调用为 `pending`，由 DreamVerse 通知报告结果。被拒绝的调用列出问题，并以 "Nothing was generated; change the inputs or params, then call again." 结尾；转换失败时记录失败，错误是模型的消息。

#### Token 影响

每次调用约 140 个 token 的文本；拒绝约 30 到 80 个 token。

#### KV 缓存影响

每个结果在其调用之后追加到对话中；缓存前缀保持不变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **智能体听不到版本**：结果只带时长和调用方写下的文字，智能体无法判断版本好坏；工具描述让它请用户选择保留哪个版本。
- **每次调用一段录音**：超过音色模型窗口的长台词或两人对话，要分成多段录音分别转换；没有剪切或拼接音频的操作。
