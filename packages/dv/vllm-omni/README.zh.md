---
description: "DreamVerse 的提供方插件 vllm-omni，服务本地 vLLM-Omni 服务器上的图片和语音模型：为每个已配置模型注册一个 dvModels 条目，任务 t2i 的 qwen-image-2.1-turbo 和任务 t2a 的 qwen3-tts-customvoice，带 schema、请求校验、所服务模型检查和渲染。"
kind: "package-reference"
---

# @dv/vllm-omni

[English](README.md) | 中文

## 概述

使用本包用本地 [vLLM-Omni](https://github.com/vllm-project/vllm-omni) 服务器上的模型生成图片和语音。函数插件 `dv-vllm-omni` 是 [`@dv/models`](../models/README.zh.md) 模型目录的提供方 `vllm-omni`：它为 `models` 配置指定的每个模型注册一个模型目录条目，每个模型一台服务器，因为每台 vLLM-Omni 服务器只服务一个模型。它服务任务 `t2i` 的 `qwen-image-2.1-turbo`（Qwen-Image 2.1 Turbo）和任务 `t2a` 的 `qwen3-tts-customvoice`（Qwen3-TTS 1.7B CustomVoice）。[`@dv/image-generate`](../image-generate/README.zh.md) 的工具 `dv_image_generate` 用图片条目渲染，[`@dv/audio-generate`](../audio-generate/README.zh.md) 的工具 `dv_audio_generate` 用语音条目朗读。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

每个模型启动一台 vLLM-Omni 服务器，然后在 `@dv/models` 之后挂载插件。下面的服务器用 vLLM 0.34.0 上的 vLLM-Omni `cf457a688f` 测试过：

```sh
vllm serve Qwen/Qwen-Image-2.1-Turbo --omni --port 8091
vllm serve Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice --omni --port 8092 --trust-remote-code --enforce-eager \
  --deploy-config vllm_omni/deploy/qwen3_tts.yaml
```

DreamVerse bundle 把插件声明为禁用的 `dv-vllm-omni` 行；部署在其 profile patch 中设置 `disabled: false`，并把 URL 换成自己服务器的 URL：

```yaml
- id: dv-vllm-omni
  name: '@dv/vllm-omni'
  disabled: true
  config:
    models:
      qwen-image-2.1-turbo:
        baseUrl: http://127.0.0.1:8091
      qwen3-tts-customvoice:
        baseUrl: http://127.0.0.1:8092
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `models` | 必填 | 要注册的模型，按模型名；未列出的模型不注册 |
| `models.<model>.baseUrl` | 必填 | 服务该模型的 vLLM-Omni 服务器的 HTTP 基础 URL，如 `http://127.0.0.1:8091` |

`models` 指定 `qwen-image-2.1-turbo` 和 `qwen3-tts-customvoice` 以外的模型时，加载失败。插件挂载期间，模型目录为每个已配置模型持有一个条目：`image/t2i/vllm-omni/qwen-image-2.1-turbo` 和 `audio/t2a/vllm-omni/qwen3-tts-customvoice`。挂载 `@dv/image-generate` 和 `@dv/audio-generate`，智能体才能用它们渲染。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/http.ts` 发送每个请求。它从 vLLM-Omni 发送的 OpenAI 回答体 `{"error": {"message": ...}}` 读取错误回答的文本，否则原样引用回答体；无法连接的服务器变为 `The server at <baseUrl> cannot be reached.`，中止时以信号的原因拒绝。每个条目的 `facts()` 和 `schema()` 每次调用都读取 `GET /v1/models`，服务器没有列出模型的 ID 时拒绝，因为配置可能把一个模型指向另一个模型的服务器。每次渲染都把模型的 ID 作为 `model` 发送；vLLM-Omni 对其他 ID 以 HTTP 400 回答。

`src/image.ts` 中的表 `IMAGES` 为每个图片模型保存 vLLM-Omni 端点不列出的内容：服务器的模型 ID（`Qwen/Qwen-Image-2.1-Turbo`）、条目描述、默认尺寸 1024x1024、尺寸网格（32 像素）和模型卡给出的七个按宽高比的尺寸，其中最大面积 4300800 像素（2400x1792）是像素上限。vLLM-Omni 把不在网格上的边长向下取整且不报错（1000x1000 渲染为 992x992），所以 `validateGenerationRequest` 不调用服务器，拒绝这样的尺寸并给出不超过像素上限的最近网格尺寸；两者都超过上限时，给出宽高比最接近的尺寸。它拒绝超过像素上限的尺寸并给出宽高比最接近的尺寸，也拒绝任何 `extra` 值：服务器为该模型把 `true_cfg_scale` 设为 1，所以反向提示词不起作用，请求把步数留给模型的默认值。`render` 发送 `POST /v1/images/generations`，带模型 ID、提示词、尺寸（请求没有尺寸时用默认尺寸）、种子、`n: 1`、`response_format: 'b64_json'` 和 `output_format: 'png'`。不含 PNG 图片的回答，以及 `size` 与所发送尺寸不同的回答，都使渲染失败。

`src/speech.ts` 中的表 `SPEECHES` 保存语音模型的 ID（`Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`）、条目描述和 `extra` 参数：`voice`、`language`（vLLM-Omni 语音 API 的十一个值之一）、`instructions` 和 `speed`。`schema()` 加上 `GET /v1/audio/voices` 列出的预设声音；它省略服务器同样列出的上传声音，因为上传声音是只有 Base 检查点才能朗读的声音克隆输入。`validateGenerationRequest` 为模型不接受的 `extra` 名称返回一句话，为每个不符合其 schema 的 `extra` 值返回一句话（用 `@deepseek-ai/dsh-tools` 的 `validateArgs` 检查），为 0.25 到 4 以外的 `speed` 返回一句话，为超过 500 个字符的 `instructions` 返回一句话（服务器对这两者都以 HTTP 400 回答），为不属于这些预设声音的 `voice` 返回一句话，像服务器一样按小写比较；只有带 `voice` 的请求读取服务器。`render` 发送 `POST /v1/audio/speech`，带 `extra` 值、模型 ID、`input`（提示词）和 `response_format: 'wav'`。`x-audio-truncated` 头为 `true` 的片段使渲染失败，并告诉智能体拆分文本；不以 `RIFF` 开头的回答体，以及 `x-audio-duration-seconds` 头缺失或不是正数的片段，也使渲染失败。片段的时长就是这个头的值。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`、`inject`、`Config` 和 `apply`，后者构建每个已配置模型的条目 |
| [`src/http.ts`](src/http.ts) | HTTP 调用、错误文本和所服务模型检查 |
| [`src/image.ts`](src/image.ts) | 表 `IMAGES`、尺寸检查和图片条目 |
| [`src/speech.ts`](src/speech.ts) | 表 `SPEECHES`、声音和 `extra` 检查以及语音条目 |
| [`tests/fixture.ts`](tests/fixture.ts) | 测试的 Loader 组合，以及一个以运行中服务器的回答体和头回答的假 vLLM-Omni 服务器 |
| [`tests/vllm-omni.spec.ts`](tests/vllm-omni.spec.ts) | 对接假服务器的注册、卸载、配置、facts 和 schema、每种拒绝、两种渲染及其失败 |
| [`tests/real-server.spec.ts`](tests/real-server.spec.ts) | 一个可选测试，对接 `DV_VLLM_OMNI_IMAGE_URL` 和 `DV_VLLM_OMNI_SPEECH_URL` 指定的服务器 |

用 `DV_VLLM_OMNI_IMAGE_URL=http://127.0.0.1:8091 DV_VLLM_OMNI_SPEECH_URL=http://127.0.0.1:8092 pnpm exec vitest run packages/dv/vllm-omni/tests` 运行这个可选测试，它渲染三张图片和一个片段；其中指错服务器的用例把语音条目指向图片服务器，只在两个变量都设置时运行。

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/models`](../models/README.zh.md)：本插件注册进去的模型目录。
- [`@dv/image-generate`](../image-generate/README.zh.md)：图片条目的使用方，带工具 `dv_image_generate`。
- [`@dv/audio-generate`](../audio-generate/README.zh.md)：语音条目的使用方，带工具 `dv_audio_generate`。
- [`@dv/sglang-diffusion`](../sglang-diffusion/README.zh.md)：在 SGLang diffusion 服务器上提供同一图片模型的提供方。

-----

<a id="model-experience"></a>
## 模型体验

### 模型目录条目与拒绝

#### 模型看到的内容

`@dv/models` 的 `dv_models_list` 结果列出每个条目的键和描述，不带提示词技能：模态 `image`、任务 `t2i`、提供方 `vllm-omni`、模型 `qwen-image-2.1-turbo`，以及模态 `audio`、任务 `t2a`、提供方 `vllm-omni`、模型 `qwen3-tts-customvoice`，描述如下。`dv_models_get` 加上下面的 schema；语音 schema 列出服务器返回的声音和四个 `extra` 参数及其类型、描述，`language` 还列出其取值。`validateGenerationRequest` 的问题跟在 `dv_image_generate` 或 `dv_audio_generate` 拒绝中的 `Model <key> cannot generate this: ` 之后。`facts()` 或 `schema()` 的拒绝跟在拒绝中的 `Model <key> is unavailable: ` 之后，`dv_models_get` 把它单独作为错误显示。渲染失败以其消息使记录和工具调用失败。在尺寸问题中，`<down>` 把两边都向下取整到 32 的倍数，`<up>` 把两边都向上取整，每边至少 32；句子不给出超过像素上限的尺寸，两者相同时只给出一个尺寸。两个尺寸都超过上限时，句子改为给出宽高比最接近的尺寸；如果请求的尺寸也超过上限，则省略这个句子，因为像素上限的句子会给出那个尺寸。模型目录报告 `hosting: self-hosted`。

##### 条目描述

```markdown
Qwen-Image 2.1 Turbo: a fast text-to-image model that renders legible text inside the image, such as posters, labels and interface layouts. The same seed, size and prompt give the same image.
Qwen3-TTS 1.7B CustomVoice: speech from text in ten languages with a choice of preset voices, and a style instruction such as "speak slowly and sadly". One voice per clip; it makes no sound effects or music.
```

##### 图片 schema

```markdown
{"size":{"default":"1024x1024","rule":"width and height are multiples of 32, and width times height is at most 4300800","by_aspect_ratio":{"1:1":"2048x2048","4:3":"2400x1792","3:4":"1792x2400","3:2":"2528x1696","2:3":"1696x2528","16:9":"2752x1536","9:16":"1536x2752"}},"extra":{}}
```

##### 请求问题

```markdown
Width and height must be multiples of 32; use <down> or <up> instead of <W>x<H>.
<W>x<H> has <pixels> pixels, above the limit of 4300800; the largest size of aspect ratio <ratio> is <preset>.
This model takes no extra parameter; omit extra.
This model takes no extra parameter <names, comma-separated>; it takes voice, language, instructions, speed.
extra."<name>" must be a string.
extra."speed" must be a number.
extra."speed" must be from 0.25 to 4.
extra."instructions" must be at most 500 characters.
extra."language" must be one of ["Auto","Chinese","English","Japanese","Korean","German","French","Russian","Portuguese","Spanish","Italian"].
The server has no voice "<voice>"; it has <voices, comma-separated>.
```

##### 服务器拒绝与渲染失败

```markdown
The server at <baseUrl> serves <served IDs, comma-separated>, not <model ID>; the dv-vllm-omni config points this model at the wrong server.
The server at <baseUrl> cannot be reached.
The server at <baseUrl> answered <method> <route> with HTTP <status>: <server text>
The server at <baseUrl> answered POST /v1/images/generations without a PNG image.
The server at <baseUrl> answered POST /v1/images/generations with an image of size <size>, not <W>x<H>.
The server stopped the clip at its token budget before the text ended; split the text into shorter clips.
The server at <baseUrl> answered POST /v1/audio/speech with a body that is not a WAV file.
The server at <baseUrl> answered POST /v1/audio/speech with x-audio-duration-seconds <value as JSON>, not a positive number of seconds.
```

#### Token 影响

`dv_models_list` 结果中每个条目约 50 个 token，`dv_models_get` 结果中图片 schema 约 130 个 token、语音 schema 约 230 个 token。每个问题句子在拒绝中约 15 到 50 个 token。

#### KV Cache 影响

条目只通过工具结果到达模型，工具结果追加到会话中。挂载或移除插件会注册或移除一个 `t2i` 条目和一个 `t2a` 条目，当没有其他提供方服务这些任务时，这会增加或移除工具 `dv_image_generate` 和 `dv_audio_generate`；见 [`@dv/image-generate` 模型体验](../image-generate/README.zh.md#model-experience)和 [`@dv/audio-generate` 模型体验](../audio-generate/README.zh.md#model-experience)。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **所服务模型固定在代码中**：`IMAGES` 和 `SPEECHES` 列出插件能服务的模型；另一个 vLLM-Omni 模型需要在那里加一项，而不只是改配置。
- **没有声音克隆**：语音条目暴露 CustomVoice 模型的预设声音；参考音频、上传的声音以及 Qwen3-TTS 的 Base 和 VoiceDesign 任务都没有暴露。
- **指令长度上限固定在代码中**：条目拒绝超过 500 个字符的 `instructions`，这是 vLLM-Omni 的默认上限；以其他上限启动的服务器可能接受条目拒绝的更长指令，或以 HTTP 400 拒绝更短的指令。
- **截断由模型报告**：只有服务器发送 `x-audio-truncated: true` 时条目才使片段失败；不发送这个头的模型可能返回在文本结束前停止的片段。
- **服务器启动后的第一次调用很慢**：第一次语音请求会在服务器上编译内核，在 GB200 上用了约 106 秒，之后约 1.5 秒。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
