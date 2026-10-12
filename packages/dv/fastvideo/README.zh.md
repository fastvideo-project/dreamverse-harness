---
description: "DreamVerse 面向本地 FastVideo streaming_v2 服务器上视频模型的公司插件：把配置的模型 fasth3 以生成方式 reference（FastH3 Ref2VA）和 text（FastH3 8-Step V2）注册进 dvModels 模型目录，并附带每个模型和生成方式的提示词 skill。"
kind: "package-reference"
---

# @dv/fastvideo

[English](README.md) | 中文

## 概述

使用本包以本地 FastVideo streaming_v2 服务器上的视频模型渲染镜头。函数插件 `dv-fastvideo` 是 [`@dv/models`](../models/README.zh.md) 模型目录的公司插件：它注册 `models` 配置列出的每个模型，只注册配置为其指定了服务器的生成方式，每种生成方式一个服务器。它以生成方式 `reference`（FastH3 Ref2VA：提示词、参考图和可选的首帧）和 `text`（FastH3 8-Step V2：只有提示词）服务 `fasth3`（以 FastH3 形式提供的 MiniMax H3）。DSH skill 注册表挂载期间，它为每种配置的生成方式注册提示词 skill。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/models` 之后挂载本插件，每个模型的每种生成方式配一个服务器。DreamVerse bundle 以行 `dv-fastvideo` 挂载它，每种生成方式直接写明一个服务器：

```yaml
- id: dv-fastvideo
  name: '@dv/fastvideo'
  config:
    models:
      fasth3:
        reference:
          baseUrl: http://10.244.19.118:8029
          gpuSecondsPerVideoSecond: 4
        text:
          baseUrl: http://10.244.16.130:8031
          gpuSecondsPerVideoSecond: 1.5
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `models` | 必填 | 要注册的模型（按模型名），以及每个模型要以哪些生成方式提供（按生成方式名）；未列出的模型或生成方式不会注册 |
| `models.<model>.<mode>.baseUrl` | 必填 | 以该生成方式渲染该模型的 FastVideo streaming_v2 服务器的 HTTP 基础 URL，如 `http://127.0.0.1:8029` |
| `models.<model>.<mode>.gpuSecondsPerVideoSecond` | 必填 | 该服务器每渲染一秒视频所用的 GPU 秒数；模型为该生成方式声明它，用于渲染前的 GPU 估算 |

`models` 列出 `fasth3` 以外的模型、模型不提供的生成方式（`fasth3`：`reference`、`text`），或没有任何生成方式的模型时，加载失败。本插件挂载期间，模型列表和 `dv_shot_render` 的 `model` 参数包含 `fasth3` 及其配置的生成方式。同时挂载 DSH skill 注册表（`@deepseek-ai/dsh-skill`），智能体才能加载提示词 skill。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/index.ts` 中的表 `SERVED` 列出本插件能提供的内容：每个模型的公司（`local FastVideo`）、简介，以及每种生成方式接受的输入、额外参数 schema 和提示词 skill。`fasth3` 在生成方式 `reference` 下接受至少一张 `reference` 图片和一张可选的 `first_frame`，在生成方式 `text` 下不接受任何输入；两种生成方式都没有额外参数。生成方式 `reference` 的服务器提供 FastH3 Ref2VA，生成方式 `text` 的服务器提供 FastH3 8-Step V2（`FastVideo/FastVideo-FastH3-8-Step-V2`）。本插件为每种配置的生成方式在隔离的 `dreamverseGeneration` 作用域中创建一个 `@dreamverse/generation-client` 的 streaming_v2 客户端，所以宿主不会多出 `dreamverseGeneration` 服务。`facts(mode)` 从该生成方式的服务器读取 `GET /v1/streamv2/capabilities`，报告服务器的模型 ID、宽高比、分辨率、画面尺寸、时长范围和帧数，以及配置的 `gpuSecondsPerVideoSecond`。服务器把首帧算作一张请求图片，所以在生成方式 `reference` 下，`facts` 报告的 `maxReferenceImages` 比服务器的 `max_reference_images` 少一，并为服务器的每张图片保留一个 `imageLabels` 条目（`Picture 1` 到 `Picture N`），首帧使用最后一张参考图之后的标签；在生成方式 `text` 下，它报告 `maxReferenceImages` 为 0、`imageLabels` 为空。`render(mode, request, signal)` 向该生成方式的服务器发送一个 `POST /v1/streamv2/generate`，参考图按输入顺序在前，首帧在后，向服务器请求最后一帧，并传递 `signal` 以取消 HTTP 请求。模型通过 `ctx.effect` 注册，每个 skill 在 `ctx.inject(['skills'], …)` 内通过 `ctx.skills.register` 注册，所以 skill 注册表挂载时 skill 出现，插件或注册表移除时消失。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`、`inject`、`Config`、`apply`、表 `SERVED`、配置检查和模型条目 |
| [`skills/fasth3-reference-prompting.md`](skills/fasth3-reference-prompting.md) | `fasth3` 在生成方式 `reference` 下的 skill 正文：DreamVerse 对接说明，后接原样复制的 MiniMax-H3 官方全参考提示词指南 |
| [`skills/fasth3-text-prompting.md`](skills/fasth3-text-prompting.md) | `fasth3` 在生成方式 `text` 下的 skill 正文：DreamVerse 对接说明，后接原样复制的 MiniMax-H3 官方提示词指南（T2VA / I2VA / FL2VA / L2VA） |
| [`tests/fastvideo.spec.ts`](tests/fastvideo.spec.ts) | 用 Loader 组装 skill 注册表、模型目录和本插件，每种生成方式对接一台假的 streaming_v2 服务器；一个可选测试对 `DV_FASTVIDEO_TEST_URL` 指定的服务器做真实渲染 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/models`](../models/README.zh.md)：本插件注册进的模型目录。
- [`@dv/shot-render`](../shot-render/README.zh.md)：consumer，提供工具 `dv_shot_render`。
- [`@dreamverse/generation-client`](../../dreamverse/generation-client/README.zh.md)：streaming_v2 客户端。
- [`dsh-tool-skill`](../../skill/tool-skill/README.zh.md)：智能体如何看到 skill 目录并加载 skill。

-----

<a id="model-experience"></a>
## 模型体验

### 生成方式 reference 的提示词 skill

#### 模型看到什么

skill 注册表挂载且 `fasth3` 配置了生成方式 `reference` 期间，`dsh-tool-skill` 渲染的 skill 目录列出下面的目录条目。智能体用 `fasth3-reference-prompting` 调用 `skill` 工具时，工具结果带有 `skills/fasth3-reference-prompting.md`：一段面向 `model: fasth3, mode: reference` 的 `dv_shot_render` 以及同一模型和生成方式的计划镜头的 DreamVerse 对接说明（一个 DreamVerse 镜头就是一个目标视频；六个改写部分组成 `prompt`；只用 `<Picture N>` 和 `<Subject N>` 引用；图片编号且首帧排在参考图之后；至少一张、最多 8 张参考图；`duration_sec` 为 5 到 15），后接原样复制的 MiniMax-H3 官方全参考提示词指南 `VIDEO_PROMPT_WRITING_GUIDE_ref_en.md`。用户不能用 `/fasth3-reference-prompting` 调用该 skill；只有智能体加载它。

##### 目录条目

```markdown
- `fasth3-reference-prompting`: Model limits and prompt rules for dv_shot_render with model fasth3 in mode reference: reference images, how the prompt names them, and how a shot continues the previous one.
```

#### Token 影响

该生成方式和 skill 注册表挂载期间，目录中约 40 个 token；智能体每次加载该 skill 约 6,000 个 token。

#### KV Cache 影响

挂载或移除本插件会改变 skill 列表，`dsh-tool-skill` 会追加一份替换目录；加载的 skill 正文作为工具结果追加。两者都不改变它们之前的缓存前缀。

### 生成方式 text 的提示词 skill

#### 模型看到什么

skill 注册表挂载且 `fasth3` 配置了生成方式 `text` 期间，skill 目录列出下面的目录条目。智能体用 `fasth3-text-prompting` 调用 `skill` 工具时，工具结果带有 `skills/fasth3-text-prompting.md`：一段面向 `model: fasth3, mode: text` 的 `dv_shot_render` 以及同一模型和生成方式的计划镜头的 DreamVerse 对接说明（使用指南的 T2VA 模式，所以提示词直接从三个字段 `integrated_multimodal_description`、`overall_soundscape` 和 `non_diegetic_music` 开始；一个 DreamVerse 镜头就是一个目标视频；一切都用文字描述，必须保持同一张脸时使用生成方式 `reference`；`duration_sec` 为 5 到 15），后接原样复制的 MiniMax-H3 官方提示词指南 `VIDEO_PROMPT_WRITING_GUIDE_base_en.md`。用户不能用 `/fasth3-text-prompting` 调用该 skill；只有智能体加载它。

##### 目录条目

```markdown
- `fasth3-text-prompting`: Model limits and prompt rules for dv_shot_render with model fasth3 in mode text: the three prompt fields, shot changes, camera motion, speakers and dialogue, sound and music.
```

#### Token 影响

该生成方式和 skill 注册表挂载期间，目录中约 40 个 token；智能体每次加载该 skill 约 4,200 个 token。

#### KV Cache 影响

挂载或移除本插件会改变 skill 列表，`dsh-tool-skill` 会追加一份替换目录；加载的 skill 正文作为工具结果追加。两者都不改变它们之前的缓存前缀。

### 模型列表行和渲染事实

#### 模型看到什么

`@dv/models` 的 `dv:models` 段落列出 `fasth3`，公司为 `local FastVideo`，带配置的生成方式、没有额外参数，简介为 "MiniMax H3 (FastH3); video with sound, dialogue and music written in the prompt"。本插件从服务器读取的事实出现在 `dv_models_get` 的结果中，也出现在 `dv_shot_render` 的结果和拒绝文本中：服务器的模型 ID（`model_id`）、画面尺寸和帧数、生成方式 `reference` 下的图片标签、允许的宽高比、分辨率和时长、参考图上限，以及由 `gpuSecondsPerVideoSecond` 得出的 GPU 估算。

#### Token 影响

模型列表中该模型的一行约 35 个 token；除 `@dv/models` 和 `@dv/shot-render` 写出的结果和拒绝文本外，本包不增加 token。

#### KV Cache 影响

挂载或移除本插件会注册或移除 `fasth3`，这会改变 `dv:models` 段落和 `dv_shot_render` 的 `model` 参数；缓存前缀从这两处变化中靠前的一处起失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **skill 中的固定限制**：`skills/fasth3-reference-prompting.md` 写明 5 到 15 秒、最多 8 张参考图，`skills/fasth3-text-prompting.md` 写明 5 到 15 秒，而 `facts` 从服务器读取限制；服务器的限制不同时，skill 会与 `dv_models_get` 和 `dv_shot_render` 的拒绝文本不一致。
- **参考图宽高比**：`RenderModelFacts` 没有对应字段，所以 `facts` 丢弃服务器的 `max_reference_aspect_ratio`，镜头渲染把参考图发给服务器前不检查宽高比。
- **生成方式 text 不保持身份**：在生成方式 `text` 下模型只看到提示词，所以主体只有在相同文字描述的范围内保持外观，镜头也不能从较早镜头的最后静帧开始；必须保持同一张脸或接续另一个镜头时，需要生成方式 `reference`。
- **可提供的模型固定在代码中**：`src/index.ts` 中的 `SERVED` 列出本插件能提供的模型和生成方式；另一个 FastVideo 模型，或以其他生成方式提供的 `fasth3`，需要在那里加条目并配上提示词 skill，仅改配置不够。
