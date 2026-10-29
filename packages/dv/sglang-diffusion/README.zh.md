---
description: "DreamVerse 的提供方插件 sglang-diffusion，服务本地 SGLang diffusion 服务器上的图片模型：为任务 t2i 的每个已配置模型（qwen-image-2.1-turbo）注册一个 dvModels 条目，带尺寸规则、所服务模型检查和 PNG 渲染。"
kind: "package-reference"
---

# @dv/sglang-diffusion

[English](README.md) | 中文

## 概述

使用本包用本地 SGLang diffusion 服务器上的模型生成图片。函数插件 `dv-sglang-diffusion` 是 [`@dv/models`](../models/README.zh.md) 模型目录的提供方 `sglang-diffusion`：它为 `models` 配置指定的每个模型注册一个任务 `t2i` 的条目，每个模型一台服务器。它服务 `qwen-image-2.1-turbo`（Qwen-Image 2.1 Turbo）。[`@dv/image-generate`](../image-generate/README.zh.md) 的工具 `dv_image_generate` 用这些条目渲染。

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

在 `@dv/models` 之后挂载插件，每个模型一台服务器。DreamVerse bundle 把它挂载为 `dv-sglang-diffusion` 行：

```yaml
- id: dv-sglang-diffusion
  name: '@dv/sglang-diffusion'
  config:
    models:
      qwen-image-2.1-turbo:
        baseUrl: http://127.0.0.1:30010
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `models` | 必填 | 要注册的模型，按模型名；未列出的模型不注册 |
| `models.<model>.baseUrl` | 必填 | 服务该模型的 SGLang diffusion 服务器的 HTTP 基础 URL，如 `http://127.0.0.1:30010` |

`models` 指定 `qwen-image-2.1-turbo` 以外的模型时，加载失败。插件挂载期间，模型目录持有条目 `image/t2i/sglang-diffusion/qwen-image-2.1-turbo`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/index.ts` 中的表 `SERVED` 为每个模型保存服务器端点不列出的内容：服务器的模型 ID（`Qwen/Qwen-Image-2.1-Turbo`）、条目描述、默认尺寸、尺寸倍数（32）、像素上限（4300800，即最大预设尺寸 2400x1792 的面积）和模型卡给出的七个按宽高比的尺寸。服务器忽略请求的 `model` 字段，所以 `facts()` 每次调用都读取 `GET /v1/models`，服务器列出其他模型时拒绝；`schema()` 先调用 `facts()`。`validateGenerationRequest` 不调用服务器：服务器对不是 32 倍数的尺寸以 HTTP 500 回答且不给原因，所以条目先拒绝它并给出最近的尺寸。它拒绝超过像素上限的尺寸，因为这样的尺寸可能在渲染完成之后在服务器上失败，或在工具结果的图片附件中失败，并给出宽高比最接近的预设尺寸；它也拒绝任何 `extra` 值。`render` 发送 `POST /v1/images/generations`，带提示词、尺寸（请求没有尺寸时用 `defaultSize`）、种子、`n: 1`、`response_format: 'b64_json'` 和 `output_format: 'png'`，因为对没有设置格式的模型，服务器自己的默认格式是 JPEG。它拒绝不含 PNG 图片的回答，例如 JPEG 字节或空的 `data` 列表，并返回所发送尺寸的 PNG。错误回答变为服务器的 `detail` 文本，或原样的回答体；中止时以信号的原因拒绝。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`、`inject`、`Config`、`apply`、表 `SERVED`、HTTP 调用，以及一个模型的模型目录条目 |
| [`tests/sglang-diffusion.spec.ts`](tests/sglang-diffusion.spec.ts) | 一个带 Project、素材池、模型目录和 `@dv/image-generate` 的 Loader 组合，对接一个以真实服务器的回答体回答的假服务器；可选的一组测试对接 `DV_SGLANG_DIFFUSION_TEST_URL` 指定的服务器 |

用 `DV_SGLANG_DIFFUSION_TEST_URL=http://127.0.0.1:30010 DV_SGLANG_OMNI_TEST_URL=http://127.0.0.1:8000 pnpm exec vitest run packages/dv/sglang-diffusion/tests` 运行这组可选测试，它渲染三张图片；其中指错服务器的用例把条目指向 `DV_SGLANG_OMNI_TEST_URL` 的语音服务器，只在设置了该变量时运行。

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/models`](../models/README.zh.md)：本插件注册进去的模型目录。
- [`@dv/image-generate`](../image-generate/README.zh.md)：使用方，带工具 `dv_image_generate`，以及图片请求和结果类型。
- [`@dv/generation`](../generation/README.zh.md)：包在本包的问题和拒绝外面的拒绝文本。

-----

<a id="model-experience"></a>
## 模型体验

### 模型目录条目和拒绝

#### 模型看到什么

`@dv/models` 的 `dv_models_list` 结果列出该条目的键（模态 `image`、任务 `t2i`、提供方 `sglang-diffusion`、模型 `qwen-image-2.1-turbo`）和下面的描述，没有提示词技能。`dv_models_get` 加上下面的 schema。在 `dv_image_generate` 的拒绝中，`validateGenerationRequest` 的问题跟在 `Model image/t2i/sglang-diffusion/qwen-image-2.1-turbo cannot generate this: ` 之后；`<down>` 把两边都向下取整到 32 的倍数，`<up>` 把两边都向上取整，每边至少 32，两者相同时用第二种形式；`<preset>` 是按宽高比列出的尺寸中宽高比与 `<W>x<H>` 最接近的一个。在拒绝中，`facts()` 或 `schema()` 的拒绝跟在 `Model image/t2i/sglang-diffusion/qwen-image-2.1-turbo is unavailable: ` 之后，`dv_models_get` 单独把它作为错误显示。渲染失败时，记录和工具调用以它的消息失败。

##### Entry description

```markdown
Qwen-Image 2.1 Turbo: a text-to-image model that renders legible text inside the image, such as posters, labels and interface layouts. The same seed, size and prompt give the same image.
```

##### Schema

```markdown
{"size":{"default":"1024x1024","rule":"width and height are positive multiples of 32, and width times height is at most 4300800","by_aspect_ratio":{"1:1":"2048x2048","4:3":"2400x1792","3:4":"1792x2400","3:2":"2528x1696","2:3":"1696x2528","16:9":"2752x1536","9:16":"1536x2752"}},"extra":{}}
```

##### Request problems

```markdown
Width and height must each be a multiple of 32, and <W>x<H> is not; the nearest sizes are <down> and <up>.
Width and height must each be a multiple of 32, and <W>x<H> is not; the nearest size is <size>.
The model renders at most 4300800 pixels, and <W>x<H> has <pixels>; the preset nearest its aspect ratio is <preset> (<ratio>).
This model takes no extra parameter; omit extra.
```

##### Server rejections

```markdown
The server at <baseUrl> serves <served IDs, comma-separated>, not Qwen/Qwen-Image-2.1-Turbo; the dv-sglang-diffusion config points this model at the wrong server.
The server at <baseUrl> cannot be reached.
The server at <baseUrl> answered GET /v1/models with HTTP <status>: <server text>
The server at <baseUrl> answered POST /v1/images/generations with HTTP <status>: <server text>
The server at <baseUrl> answered POST /v1/images/generations without a PNG image.
```

#### Token 影响

条目在 `dv_models_list` 结果中约 50 个 token，schema 在 `dv_models_get` 结果中约 130 个 token。每个问题句子在拒绝中约 20 到 40 个 token。

#### KV Cache 影响

条目只通过工具结果到达模型，工具结果追加到会话中。挂载或移除插件会注册或移除 DreamVerse 套件中唯一的 `t2i` 条目，从而加入或移除工具 `dv_image_generate`；见 [`@dv/image-generate` 的模型体验](../image-generate/README.zh.md#model-experience)。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **所服务的模型固定在代码中**：`src/index.ts` 中的 `SERVED` 列出插件能服务的模型；另一个 diffusion 模型需要在那里加一项，不能只改配置。
- **所服务模型检查读取启动时的名称**：`POST /update_weights_from_disk` 改变运行中服务器的权重，而 `GET /v1/models` 保留启动时的名称，所以 `facts()` 看不到这一变化。
- **每次智能体调用读三次模型列表**：`facts()` 每次调用都读取 `GET /v1/models`，而 `dv_image_generate` 的一次智能体调用会调用它三次：`prepareToolCall` 中的检查、写记录之前的检查，以及渲染之前。
- **某个尺寸的第一次调用更慢**：服务器按图片尺寸预热，所以每个尺寸的第一次调用，以及服务器空闲之后的第一次调用，耗时更长。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
