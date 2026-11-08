---
description: "DreamVerse 的提供方插件 seed-vc：把本地 Seed-VC 服务器上的 Seed-VC v1 注册为任务 a2a 的 dvModels 条目 seed-vc-v1，其音色是配置中允许的音色，每个音色带有插件发给服务器的目标音频。"
kind: "package-reference"
---

# @fastvideo/dreamverse-seed-vc

[English](README.md) | 中文

## 概要

使用本包，用 [Seed-VC](https://github.com/Plachtaa/seed-vc) v1（零样本音色转换模型）转换录音，模型由 [`@fastvideo/dreamverse-voice-acting`](../voice-acting/README.zh.md) 附带的 Seed-VC 服务器在 GPU 机器上提供。它在 [`@dv/models`](../models/README.zh.md) 的模型目录中注册一个条目：模态 `audio`、任务 `a2a`、提供方 `seed-vc`、模型 `seed-vc-v1`，由 [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.zh.md) 的操作 `voice.convert` 运行。配置中的 `voices` 是白名单：条目只转换为其中列出的音色。音色指定一个目标音频文件，或者只写说话人的名字，此时由服务器用该说话人的 VoxCeleb1 音频构建；服务器不保存音色列表。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

与 `@dv/models`、`@dv/asset-pool` 和 `@fastvideo/dreamverse-voice-convert` 一起挂载本插件。[`@fastvideo/dreamverse-voice-acting`](../voice-acting/README.zh.md) 套件插入它但默认关闭；由 profile 补丁带着服务器 URL 和允许的音色开启：

```yaml
- id: dv-seed-vc
  disabled: false
  config:
    baseUrl: http://gpu-host:8010
    voices:
      narrator:
        label: The Narrator
        target: /data/voices/narrator.wav
        note: Recorded by the narrator, who allowed its use for this project.
      sam-reed:
        label: Sam Reed
        note: Sam Reed allowed the use of their voice for this project.
```

| 配置字段 | 含义 |
| --- | --- |
| `baseUrl` | Seed-VC 服务器的 HTTP 基础 URL |
| `voices.<key>.label` | 音色选择器和 `dv_models_get` 显示的名字 |
| `voices.<key>.target` | 该音色 WAV 音频的绝对路径：一位说话人的干净语音，10 到 25 秒；服务器使用前 25 秒。没有它时，服务器用名为 `speaker` 的说话人的 VoxCeleb1 音频构建 |
| `voices.<key>.speaker` | 没有 `target` 的音色在 VoxCeleb1 中的说话人名字；默认为 `label` |
| `voices.<key>.note` | 谁允许使用该音色、用于什么；插件不读取 |
| `diffusionSteps` | `extra` 未设置时一次转换的细化步数，1 到 200；默认 50 |
| `targetSeconds` | 服务器构建的目标音频的语音秒数，4 到 25；默认 16 |

`voices` 为空，或某个配置的目标音频缺失或为空时，插件在加载时失败。没有 `target` 的音色在第一次转换时构建，约需两分钟，服务器会缓存该音频；VoxCeleb1 中没有的名字会让那次转换失败。只列出说话人允许你使用的音色。

-----

<a id="understand-the-implementation"></a>
## 理解实现

加载时插件把每个配置的目标音频读成 `data:` URI 并注册条目。对没有 `target` 的音色，第一次转换把 `{name, seconds}` 发到 `POST /v1/voices/build`；插件保留结果供之后的转换使用，构建失败则丢弃，下一次转换再请求。服务器在 `vox1_meta.csv` 中按名字找到说话人，只从数据集的远程 zip 读取该说话人的音频，拼接包含最干净片段的那次访谈中最干净的片段，并缓存在它的音色缓存文件夹里。`facts()` 和 `schema()` 调用 `GET /health`，检查服务器报告的模型是 `seed-vc-v1-whisper-small-wavenet`。`schema()` 返回 `{voices: [{key, label}], extra}`，唯一的 `extra` 参数是 `diffusion_steps`（整数，1 到 200，省略时为 `diffusionSteps`）。`validateGenerationRequest` 拒绝配置之外的音色、媒体类型不是音频的 `reference` 输入、未知的 `extra` 名称和无效的 `extra` 值。`render` 从 `dvAssetPool` 读取录音，把 `{diffusion_steps, source, target, seed}` 发到 `POST /v1/convert`（`extra` 未设置 `diffusion_steps` 时用配置的 `diffusionSteps`），返回 WAV 正文和 `x-duration-sec` 响应头给出的时长。服务器在已加载的模型上运行 Seed-VC 自己 `inference.py` 的转换，一次处理一个请求，并用请求的种子设置 `random`、NumPy 和 torch，所以相同种子重复同一个版本。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 配置、服务器调用、音色白名单和条目 |
| [`tests/seed-vc.spec.ts`](tests/seed-vc.spec.ts) | 一个带配音组件的 Loader 组合，对接一个假的 Seed-VC 服务器：条目及其 schema、一次转换、拒绝、服务器错误、中止的转换和加载失败 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.zh.md)：运行本条目的操作 `voice.convert`。
- [`@dv/models`](../models/README.zh.md)：模型目录，以及 `dv_models_list` 和 `dv_models_get`。
- [`@dv/sglang-omni`](../sglang-omni/README.zh.md)：同样形式、用于文字生成语音的提供方插件。

-----

<a id="model-experience"></a>
## 模型体验

### 目录条目和拒绝

#### 模型看到什么

`@dv/models` 的 `dv_models_list` 结果列出该条目的键（模态 `audio`、任务 `a2a`、提供方 `seed-vc`、模型 `seed-vc-v1`）和描述 "Seed-VC v1: speaks a speech recording again in another voice, keeping its words, timing and intonation; voices: <key> (<label>), …"。`dv_models_get` 另外给出音色和 `extra` schema。`dv_voice_convert` 的拒绝在 "Model audio/a2a/seed-vc/seed-vc-v1 cannot generate this: " 之后带上下面的校验句子。`facts()` 或 `schema()` 失败时为 `The server at <baseUrl> serves <model>, not seed-vc-v1-whisper-small-wavenet; the dv-seed-vc baseUrl points at the wrong server.`、`The server at <baseUrl> cannot be reached.` 或 `The server at <baseUrl> answered GET /health with HTTP <status>: <server text>`。转换失败时为 `The server at <baseUrl> answered POST /v1/convert with HTTP <status>: <server text>`、`The server at <baseUrl> answered POST /v1/convert without a positive x-duration-sec.` 或 `The server at <baseUrl> cannot be reached.`；服务器文本是 `application/json` 正文的 `error`，否则是原样的正文。

##### 校验句子

```markdown
This model has no voice "<voice>"; its voices are <keys, comma-separated>.
The reference input <asset> is not audio; give one recording of the spoken line.
This model takes no extra parameter <names, comma-separated>; it takes diffusion_steps.
extra."diffusion_steps" must be an integer.
```

#### Token 影响

`dv_models_list` 结果中的条目约 60 个 token，每个音色另加约 10 个；`dv_models_get` 结果约 90 个 token。每个拒绝句子约 15 到 30 个 token。

#### KV 缓存影响

条目只通过工具结果到达模型，工具结果追加到会话中；挂载或移除插件只通过 `@fastvideo/dreamverse-voice-convert` 的 `dv_voice_convert` 改变工具列表。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **目标音频只读一次**：插件在加载时读取每个配置的目标音频，构建的音频在插件存续期间保留，修改后的音频要在插件重启后生效。
- **构建的音色只来自 VoxCeleb1**：只写名字的音色必须是 VoxCeleb1 的说话人，其访谈音频为 16 kHz 且语气平静；来自其他录音的音色需要 `target` 文件。
- **一次一个转换**：服务器一次处理一个请求；并发的版本互相等待。
