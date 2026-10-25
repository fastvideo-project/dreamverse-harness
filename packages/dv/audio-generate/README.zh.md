---
description: "DreamVerse 的音频组件：dvAudioGenerate 服务在 @dv/models 模型目录中声明 audio 生成原语和任务 t2a，并拥有操作 audio.generate（用调用以模型目录键指定的模型把一个提示词说成一个音频片段）和智能体工具 dv_audio_generate。"
kind: "package-reference"
---

# @dv/audio-generate

[English](README.md) | 中文

## 概述

使用本包生成语音片段。它在 [`@dv/models`](../models/README.zh.md) 模型目录中声明生成原语 `audio` 和任务 `t2a`，它唯一的操作 `audio.generate`（工具 `dv_audio_generate`）用必填参数 `modality`、`task`、`provider` 和 `model` 指定的模型目录条目把一个提示词说成一个音频片段。该片段是记录唯一的输出，带有它的时长。该操作没有种子，每次调用都是新版本。模型目录中有任务 `t2a` 的模型时，该操作才存在。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project`、`@dv/models` 和 `@dv/asset-pool` 之后挂载插件，并挂载一个注册任务 `t2a` 模型的提供方插件，例如 [`@dv/sglang-omni`](../sglang-omni/README.zh.md)。模型目录中至少有一个任务 `t2a` 的模型时注册 `audio.generate`（`dvModels.whileServing`）。该操作带标签 生成音频 / Generate audio；服务存续期间用 `dvModels.labelTasks` 在模型目录中标注任务 `t2a`：文字生成音频 / Audio from text。

```yaml
- id: dv-audio-generate
  name: '@dv/audio-generate'
```

本插件没有配置。

| 操作 | 工具 | 输入和参数 | 输出和报告 |
| --- | --- | --- | --- |
| `audio.generate` | `dv_audio_generate` | 没有输入；参数 `modality`、`task`、`provider` 和 `model`（必填：一个模型目录条目的键，即 `dv_models_list` 列出的键）、`prompt`（必填：要说的文字，使用模型提示词 skill 的标记）、`extra`（模型自己的参数，即 `dv_models_get` 列出的额外参数） | 输出 `audio`，一个名为 `<记录 ID 前 8 个字符>.wav`、带 `duration_sec` 的 `audio/wav` 素材；报告 `{model_id, duration_sec}` |

该操作使用 GPU，不是确定性的，并声明 `confirm: never`。该操作没有 `seed` 参数，不抽取也不报告种子（声明中的 `seed: false`），因为语音后端不接受种子；同一个提示词会得到不同的片段。工作流在 `dvAudioGenerate` 上调用 [`@dv/generation`](../generation/README.zh.md) 的 `GenerationApi` 方法：`render`、`check`、`findTake` 和 `parseInputs`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

本包通过声明合并声明 `PrimitiveTypes` 的原语行 `audio`：事实 `AudioModelFacts`（`modelId`），请求 `AudioRequest`（`prompt` 和 `extra`），结果 `Promise<GeneratedAudio>`（字节、`mime: 'audio/wav'` 和 `durationSec`），没有条目字段。它在 `TaskMap` 中把任务 `t2a` 映射到该行。`@dv/generation` 的 `defineGeneration` 根据 `audio.generate` 的声明构建服务。一次调用用 `dvModels.resolve` 查找指定键的模型目录条目，读取它的事实，并用去掉首尾空白的提示词和 `extra` 值构建请求；空提示词以“The prompt is empty; write the text to speak.”被拒绝。条目的 `validateGenerationRequest(request)` 在写任何记录之前判断提示词标记和 `extra`，并在条目的 `render(request, signal)` 之前再判断一次。声明的 `toOutputs` 通过 `importOne` 连同时长导入片段，所以素材库从不探测该片段。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvAudioGenerate`：原语行 `audio` 和任务 `t2a`，类型 `AudioModelFacts`、`AudioRequest` 和 `GeneratedAudio`，以及 `audio.generate` 的声明（请求、存储的输出和摘要） |
| [`tests/audio-generate.spec.ts`](tests/audio-generate.spec.ts) | 一个 Loader 组合，含工具注册表、Project、ffmpeg、素材库、模型目录和本服务，对接一个假的 `t2a` 模型；它固定智能体读到的文字以及销毁时的移除 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/project`](../project/README.zh.md)：操作、批准和智能体工具。
- [`@dv/models`](../models/README.zh.md)：模型目录，含 `dv_models_list` 和 `dv_models_get`。
- [`@dv/generation`](../generation/README.zh.md)：构建服务、其检查及其 `GenerationApi` 的辅助库。
- [`@dv/sglang-omni`](../sglang-omni/README.zh.md)：一个注册 `t2a` 模型及其提示词 skill 的提供方插件。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

模型目录中有任务 `t2a` 的模型时，有一个工具 `dv_audio_generate`，格式与 `@dv/project` 给每个操作工具的一样。参数是 `modality`、`task`、`provider`、`model`、`prompt` 和 `extra`，没有 `seed`；四个键参数和 `extra` 保留 `@dv/generation` 的说明。`prompt` 参数的说明是“The text to speak, in the markup of the prompt skill that dv_models_list names for the model.”。

##### 工具描述原文

```markdown
Generate one audio clip from the prompt with a t2a model from dv_models_list; modality, task, provider and model name it and are required. Before the first call for a model, load the prompt skill that dv_models_list names for it, because the prompt is written in the model's own markup. dv_models_get lists the model's own parameters for extra. The clip is the one output; the result gives its duration. You cannot hear the clip, so ask the user which take to keep. Every call is a new take, and the same prompt gives a different clip. Uses the GPU.
```

#### Token 影响

插件和至少一个任务 `t2a` 的模型挂载期间，定义固定约 550 个 token，包括 `@dv/project` 的共享参数。

#### KV Cache 影响

定义位于每个智能体请求固定的工具段中。第一个注册的或最后一个移除的 `t2a` 模型会增加或移除该工具，这会改变工具列表，使从工具段开始的缓存前缀失效；其他注册不改变定义。

### 工具结果

#### 模型看到什么

一次调用返回一个文本块：`done <record>: audio "<prompt>" (<duration, one decimal>s)`（提示词由 `@dv/generation` 的 `quotePrompt(prompt, 60)` 写出）、一行 `- audio: <asset ID> (audio/wav) <asset URL>`、参数，以及报告 `{"model_id":"<the backend's model ID>","duration_sec":<seconds>}`。模型校验拒绝的调用在写任何记录之前被拒绝，消息为“Model <modality>/<task>/<provider>/<model> cannot generate this: <problems> Nothing was generated; change the inputs or params, then call again.”；空提示词以“The prompt is empty; write the text to speak.”和同一结尾句被拒绝。渲染失败时记录失败，工具错误是模型的消息。

#### Token 影响

每次调用约 130 个 token 的文本；一条拒绝消息约 30 到 80 个 token。

#### KV Cache 影响

每个结果在调用之后追加到对话中；已缓存的前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **智能体听不到片段**：结果带有时长而没有转写文本，所以智能体无法评判一个版本；工具描述要求它询问用户保留哪个版本。
