---
description: "DreamVerse 面向本地 SGLang-Omni 服务器上语音模型的提供方插件 sglang-omni：为任务 t2a 把配置的模型 fish-audio-drama-3（Fish Audio Drama 3）注册到 dvModels 模型目录，带说话人和额外参数 schema、请求校验、所服务模型检查和提示词 skill。"
kind: "package-reference"
---

# @dv/sglang-omni

[English](README.md) | 中文

## 概述

使用本包，用本地 SGLang-Omni 服务器上的语音模型说出片段。函数插件 `dv-sglang-omni` 是 [`@dv/models`](../models/README.zh.md) 模型目录的 provider `sglang-omni`：它为 `models` 配置列出的每个模型注册一个任务 `t2a` 的模型目录条目。它提供 `fish-audio-drama-3`（Fish Audio Drama 3，以 `fishaudio/drama-3` 提供）。DSH skill 注册表挂载期间，模型目录注册该条目的提示词 skill `fish-audio-drama-3-prompting`。说出片段的工具是 [`@dv/audio-generate`](../audio-generate/README.zh.md) 的 `dv_audio_generate`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/models` 之后挂载插件，每个模型一个服务器。DreamVerse bundle 以行 `dv-sglang-omni` 挂载它：

```yaml
- id: dv-sglang-omni
  name: '@dv/sglang-omni'
  config:
    models:
      fish-audio-drama-3:
        baseUrl: http://127.0.0.1:8000
        gpuSecondsPerCall: 3
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `models` | 必填 | 要注册的模型，按模型名；未列出的模型不注册 |
| `models.<model>.baseUrl` | 必填 | 提供该模型的 SGLang-Omni 服务器的 HTTP 基础 URL，例如 `http://127.0.0.1:8000` |
| `models.<model>.gpuSecondsPerCall` | 必填 | 该服务器上一个片段的 GPU 秒数；条目声明它，用于调用运行之前的 GPU 预估 |

`models` 列出 `fish-audio-drama-3` 以外的模型时加载失败。插件挂载期间，模型目录中每个配置的模型有一个条目，例如 `audio/t2a/sglang-omni/fish-audio-drama-3`。挂载 `@dv/audio-generate`，智能体才能说出片段；挂载 DSH skill 注册表（`@deepseek-ai/dsh-skill`），智能体才能加载提示词 skill。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/index.ts` 中的表 `SERVED` 把本插件能提供的每个模型映射到它在服务器上的模型 ID、目录描述、说话人编号、额外参数 schema 和提示词 skill 文件。`fish-audio-drama-3` 在该服务器上只说说话人 0，它唯一的额外参数是数字 `speed`。同一个值 `speakers` 同时提供 `schema()` 的 `speakers` 列表和说话人拒绝。服务器忽略请求的 `model` 字段，所以 `facts()` 和 `schema()` 每次调用都读取 `GET /v1/models`，并在服务器未列出 `fishaudio/drama-3`、以 HTTP 错误应答或无法连接时拒绝；不缓存应答。`facts()` 报告服务器的模型 ID。`schema()` 报告 `{"speakers": [0], "extra": {"speed": {"type": "number", "description": "Speaking rate; 1 is normal."}}}`。`validateGenerationRequest(request)` 不读取服务器，每个成立的检查返回一句话，顺序为：服务器不说的说话人标签（`<|speaker:N|>`，无论格式是否正确），每个标签按首次出现的顺序只列一次；除说话人标签外没有文字的提示词，服务器会以 HTTP 200 和几乎无声的片段应答它；模型不接受的 `extra` 名称；以及未通过其 schema 的每个 `extra` 值，用 `@deepseek-ai/dsh-tools` 的 `validateArgs` 检查。`render(request, signal)` 发送一次 `POST /v1/audio/speech`，带 `extra` 值、`input`（提示词）和 `response_format: 'wav'`，并把 `signal` 传下去以取消 HTTP 请求。`x-finish-reason` 头不是 `stop` 的片段失败；服务器在长度上限处截断片段时发送 `length`。它从 WAV 头读取时长：`data` 块的大小除以 `fmt ` 块的字节率，其他块按其大小跳过；不含完整 `data` 块的正文失败。它把请求的墙钟时间记为 GPU 秒数。每个条目通过 `ctx.effect` 注册，并以 `promptSkill` 携带提示词 skill，`content` 为 skill 文件的文字。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`、`inject`、`Config`、`apply`、表 `SERVED`、所服务模型检查、请求校验、WAV 时长，以及一个模型的模型目录条目 |
| [`skills/fish-audio-drama-3-prompting.md`](skills/fish-audio-drama-3-prompting.md) | `fish-audio-drama-3` 任务 `t2a` 的 skill 正文：说话人标签、声音事件、语言、片段长度、声音、一个示例和来源 |
| [`tests/fixture.ts`](tests/fixture.ts) | 两个 spec 共用的 Loader 组合，以及一个用运行中服务器的正文和头应答的假 SGLang-Omni 服务器 |
| [`tests/sglang-omni.spec.ts`](tests/sglang-omni.spec.ts) | 对接假服务器的注册、销毁、配置、事实和 schema、每一条拒绝、渲染及其失败 |
| [`tests/real-server.spec.ts`](tests/real-server.spec.ts) | 一个可选启用的 spec，对接 `DV_SGLANG_OMNI_TEST_URL` 指定的服务器；`DV_SGLANG_DIFFUSION_TEST_URL` 指定一个运行中的 SGLang diffusion 服务器时，运行其指错服务器的用例 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/models`](../models/README.zh.md)：本插件注册进去的模型目录。
- [`@dv/audio-generate`](../audio-generate/README.zh.md)：使用者，含工具 `dv_audio_generate`。
- [`dsh-tool-skill`](../../skill/tool-skill/README.zh.md)：智能体如何看到 skill 目录并加载一个 skill。

-----

<a id="model-experience"></a>
## 模型体验

### 任务 t2a 的提示词 skill

#### 模型看到什么

skill 注册表挂载且配置了 `fish-audio-drama-3` 期间，`dsh-tool-skill` 渲染的 skill 目录列出下面的目录条目。智能体用 `fish-audio-drama-3-prompting` 调用 `skill` 工具时，工具结果带有 `skills/fish-audio-drama-3-prompting.md`：说话人标签只能用 `dv_models_get` 在 `speakers` 下列出的编号，只列出 0 时每个角色一个片段；方括号声音事件，例如 `[laughs]`；模型卡列出的 83 种语言；每个片段最多约 95 秒语音；模型为每个片段选择声音；一个示例提示词；以及模型卡和 cookbook 来源。用户不能用 `/fish-audio-drama-3-prompting` 调用该 skill；只有智能体加载它。

##### 目录条目

```markdown
- `fish-audio-drama-3-prompting`: Prompt markup of model fish-audio-drama-3 for task t2a: speaker tags, sound events, clip length, and voices.
```

#### Token 影响

条目和 skill 注册表挂载期间，目录中约 30 个 token；智能体每次加载该 skill 约 370 个 token。

#### KV Cache 影响

挂载或移除插件会改变 skill 列表，`dsh-tool-skill` 追加一个替换目录；加载的 skill 正文作为工具结果追加。两者都不改变它们之前的已缓存前缀。

### 目录条目和拒绝

#### 模型看到什么

`@dv/models` 的 `dv_models_list` 结果列出该条目，带它的键（模态 `audio`、任务 `t2a`、provider `sglang-omni`、模型 `fish-audio-drama-3`）、提示词 skill 名和描述 "Fish Audio Drama 3: expressive speech from text in many languages, with sound events such as laughs and sighs written into the text."。`dv_models_get` 加上 `schema()` 报告的说话人和 `extra` schema。`dv_audio_generate` 的拒绝在 "Model audio/t2a/sglang-omni/fish-audio-drama-3 cannot generate this: " 之后带有下面的校验句子。`facts()` 或 `schema()` 的拒绝为 `The server at <baseUrl> serves <served IDs>, not fishaudio/drama-3; the dv-sglang-omni config points this model at the wrong server.`、`The server at <baseUrl> cannot be reached.` 或 `The server at <baseUrl> answered GET /v1/models with HTTP <status>: <server text>`。渲染失败为 `The server stopped the clip at its length limit before the text ended; split the text into shorter clips.`、`The server at <baseUrl> answered POST /v1/audio/speech with HTTP <status>: <server text>`、`The server at <baseUrl> answered POST /v1/audio/speech with a body that is not a WAV file.` 或 `The server at <baseUrl> cannot be reached.`；服务器文字是 `application/json` 正文的 `error.message`，否则是它的 `detail`，否则是原样的正文。

##### 校验句子

```markdown
This server speaks only <allowed tags>, and the prompt has <refused tags>. Write one clip per character, each with <allowed tags> or no speaker tag.
The prompt has no text to speak besides its speaker tags; write the words to speak after the tag.
This model takes no extra parameter <names, comma-separated>; it takes speed.
extra."speed" must be a number
```

#### Token 影响

`dv_models_list` 结果中该条目约 70 个 token，`dv_models_get` 结果约 85 个 token。每个拒绝句子约 15 到 40 个 token。

#### KV Cache 影响

该条目只通过工具结果到达模型，工具结果追加到会话中，所以挂载或移除插件时，除上面描述的 skill 目录变化外，已缓存的前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **每个片段一个说话人**：服务器只说说话人 0，所以一段对话每行台词一个片段；模型为每个片段选择声音，所以一个角色在两个片段中的声音可能不同。
- **skill 中固定的长度**：skill 写明每个片段约 95 秒，来自服务器默认的 token 上限；上限更低的服务器会更早截断片段，这些片段以长度上限消息失败。
- **所服务的模型固定在代码中**：`src/index.ts` 中的 `SERVED` 列出本插件能提供的模型；另一个 SGLang-Omni 模型需要在那里加一项及其提示词 skill，而不只是改配置。
- **不能选择声音**：`extra` 只接受 `speed`；不提供服务器的 `voice` 字段及其上传的声音。
