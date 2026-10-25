---
description: "DreamVerse 面向 OpenAI 风格视频任务 API 的 FastVideo 服务器上视频模型的 provider 插件 fastvideo：把配置的模型 fasth3 按任务 ref2v（FastH3 Ref2VA）和 t2v（FastH3 8-Step V2）各注册一个 dvModels 模型目录条目，并附带每个条目的输入与额外参数 schema、请求校验和提示词 skill。"
kind: "package-reference"
---

# @dv/fastvideo

[English](README.md) | 中文

## 概述

使用本包以 FastVideo 视频任务服务器上的视频模型渲染镜头。函数插件 `dv-fastvideo` 是 [`@dv/models`](../models/README.zh.md) 模型目录的 provider `fastvideo`：它为 `models` 配置列出的每个模型、为配置给它指定了服务器的每个任务注册一个目录条目，每个任务一个服务器。它为任务 `ref2v`（FastH3 Ref2VA：提示词、参考图片，以及可选的首帧）和任务 `t2v`（FastH3 8-Step V2：只有提示词）提供 `fasth3`（以 FastH3 形式提供的 MiniMax H3）。DSH skill 注册表挂载期间，它为每个配置的条目注册提示词 skill。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/models`、`@dv/asset-pool` 和 `@dv/ffmpeg` 之后挂载本插件，每个模型的每个任务配一个服务器。DreamVerse bundle 以行 `dv-fastvideo` 挂载它，每个任务直接写明一个服务器：

```yaml
- id: dv-fastvideo
  name: '@dv/fastvideo'
  config:
    models:
      fasth3:
        ref2v:
          baseUrl: http://10.244.19.118:8029
          gpuSecondsPerVideoSecond: 4
        t2v:
          baseUrl: http://10.244.16.130:8031
          gpuSecondsPerVideoSecond: 1.5
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `models` | 必填 | 要注册的模型（按模型名），以及每个模型要为哪些任务提供（按任务 ID）；未列出的模型或任务不会注册 |
| `models.<model>.<task>.baseUrl` | 必填 | 为该任务渲染该模型的 FastVideo 视频任务服务器的 HTTP 基础 URL，如 `http://127.0.0.1:8029` |
| `models.<model>.<task>.gpuSecondsPerVideoSecond` | 必填 | 该服务器每渲染一秒视频所用的 GPU 秒数；该模型和任务的条目声明它，用于渲染前的 GPU 估算 |

`models` 列出 `fasth3` 以外的模型、模型不提供的任务（`fasth3`：`ref2v`、`t2v`），或没有任何任务的模型时，加载失败。本插件挂载期间，模型目录为每个配置的任务持有一个 provider 为 `fastvideo`、模型为 `fasth3` 的条目，如 `video/ref2v/fastvideo/fasth3`。同时挂载 DSH skill 注册表（`@deepseek-ai/dsh-skill`），智能体才能加载提示词 skill。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`src/index.ts` 中的表 `SERVED` 把本插件能提供的每个模型映射到该模型自己的文件声明的任务，例如 `src/fasth3.ts` 中的 `FASTH3`：每个任务的条目描述（模型的长处和短处）、任务 API 的任务名、模型事实、接受的输入、额外参数 schema、参考标签和提示词 skill。`fasth3` 在任务 `ref2v` 下接受至少一个媒体类型为 `image` 的 `reference` 资产和一个可选的、媒体类型为 `image` 的 `first_frame`，在任务 `t2v` 下不接受任何输入；两个任务都没有额外参数。任务 API 从 `data:` URL 读取参考图片，拒绝 `data:` 形式的视频和音频，所以 `fasth3` 不接受参考视频或音频。任务 `ref2v` 的服务器以任务名 `ref2va` 提供 FastH3 Ref2VA，任务 `t2v` 的服务器以任务名 `t2va` 提供 FastH3 8-Step V2（`FastVideo/FastVideo-FastH3-8-Step-V2`）。本插件为每个配置的任务注册一个条目，模态为 `video`，带该任务、provider `fastvideo` 和模型名，并在隔离的 `dvFastvideoGeneration` 作用域中创建一个 `@dv/fastvideo-generation-client` 的视频任务客户端，所以宿主不会多出 `dvFastvideoGeneration` 服务。任务 API 不报告模型事实，所以 `facts()` 报告 `SERVED` 中所服务任务的事实：对 `fasth3` 而言，模型 ID 为 `fasth3-ref2va` 或 `fasth3-t2va`，宽高比 `16:9`，分辨率 `720p`（1344x768），时长 5 到 15 秒，以及 17n+5 网格上每个整数时长在 24 fps 下的帧数，如 5 秒为 124 帧。输入上限来自该任务的 `maxReferences`，`fasth3` 为 9。模型把首帧算作一个参考，所以在任务 `ref2v` 下，`reference` 输入比总数少一，`first_frame` 最多一个资产；任务 `t2v` 没有输入。`schema()` 根据同一份事实报告 agent 需要的时长范围（带 `min` 和 `max` 的 `duration_sec`）、`aspect_ratios` 和 `resolutions`，以及每个已声明输入的 `min`、`max` 和媒体类型，再加上额外参数 schema；任务 `ref2v` 的 `inputs` 和 `extra` 是 `{"inputs": {"reference": {"min": 1, "max": 8, "media_types": {"image": {}}}, "first_frame": {"min": 0, "max": 1, "media_types": {"image": {}}}}, "extra": {}}`。`validateGenerationRequest(request)` 按该任务声明的输入和上限检查请求：拒绝放在该任务未声明的输入里的素材、少于输入 `min` 的素材、媒体类型（用 `dvAssetPool.mediaType` 读取）不在输入声明内的素材，以及某个输入的素材数量超过上限的情况。随后检查 `extra`：该任务不接受的参数名用一句列出该任务额外参数的话拒绝，已知参数名的值用 `@deepseek-ai/dsh-tools` 的 `validateArgs` 按其 schema 检查。声明了 `promptProblems` 的任务还按模型自己的提示词规则检查提示词：`fasth3` 拒绝有首帧、但提示词没有以 `dv:input/first_frame` 引用首帧的请求，因为只有提示词写明时，H3 才把一张图当作首帧。每个问题一句话。`render(request, signal)` 按每个输入资产 ID 从 `dvAssetPool` 读取 MIME 类型和字节，向该任务的服务器提交一个任务，带该任务的任务名、画面尺寸和帧数、种子，以及参考（按输入顺序在前，首帧在后），每个都是图片 `data:` URL。它等到任务完成，并传递 `signal` 以停止等待；服务器会完成已开始的任务。随后它依次产出 MIME 类型为 `video/mp4` 的 `video_start`、作为一个 `chunk` 的整个 MP4、`dvFfmpeg` 从该 MP4 解码出的最后一帧 `last_frame`，以及带客户端计时的 `done`。发送提示词之前，`render` 把每个参考的引用（`@[<label>](dv:asset/<AssetId>)`，用 `@dv/project` 的 `parsePromptCitations` 读取）和首帧的引用（`dv:input/first_frame`）换成所服务模型给这个媒体的标签。`SERVED` 中该任务的 `assignReferenceLabels` 按服务器接收的顺序（先是按输入顺序的参考，然后是首帧）接收请求的媒体及其媒体类型，为每个媒体返回一个标签，模型不命名的媒体返回 null。`assignFasth3ReferenceLabels` 把第 k 张图片标为 `<Picture k>`，所以首帧是参考图片之后的那张图片。没有标签的引用换成引用自己的标签。每个条目通过 `ctx.effect` 注册，并以 `promptSkill` 携带其任务的提示词 skill，skill 文件的文本作为 `content`。条目存在且 skill 注册表挂载期间，模型目录注册该 skill，所以插件或注册表移除时 skill 消失。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `name`、`inject`、`Config`、`apply`、表 `SERVED`、配置检查和单个模型与任务的目录条目 |
| [`src/types.ts`](src/types.ts) | `ServedTask`（一个被服务模型在一个任务下接受的内容）、`ServedFacts`（它的事实），以及它用到的输入类型 |
| [`src/reference-labels.ts`](src/reference-labels.ts) | `AssignReferenceLabels`（为参考分配模型标签的函数类型），以及把每个参考引用换成其标签的 `modelPrompt` |
| [`src/fasth3.ts`](src/fasth3.ts) | `FASTH3`（本插件为 MiniMax H3 提供的任务及其事实），以及 `assignFasth3ReferenceLabels`：分配 MiniMax H3 的参考标签 |
| [`skills/fasth3-reference-prompting.md`](skills/fasth3-reference-prompting.md) | `fasth3` 在任务 `ref2v` 下的 skill 正文：DreamVerse 对接说明，后接原样复制的 MiniMax-H3 官方全参考提示词指南 |
| [`skills/fasth3-text-prompting.md`](skills/fasth3-text-prompting.md) | `fasth3` 在任务 `t2v` 下的 skill 正文：DreamVerse 对接说明，后接原样复制的 MiniMax-H3 官方提示词指南（T2VA / I2VA / FL2VA / L2VA） |
| [`tests/fastvideo.spec.ts`](tests/fastvideo.spec.ts) | 用 Loader 组装 skill 注册表、Project、ffmpeg、资产池、模型目录和本插件，每个任务对接一台假的视频任务服务器；一个可选测试对 `DV_FASTVIDEO_TEST_URL` 指定的服务器做真实渲染 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/models`](../models/README.zh.md)：本插件注册进的模型目录。
- [`@dv/shot-render`](../shot-render/README.zh.md)：consumer，提供工具 `dv_shot_render`。
- [`@dv/fastvideo-generation-client`](../fastvideo-generation-client/README.zh.md)：视频任务客户端。
- [`dsh-tool-skill`](../../skill/tool-skill/README.zh.md)：智能体如何看到 skill 目录并加载 skill。

-----

<a id="model-experience"></a>
## 模型体验

### 任务 ref2v 的提示词 skill

#### 模型看到什么

skill 注册表挂载且 `fasth3` 配置了任务 `ref2v` 期间，`dsh-tool-skill` 渲染的 skill 目录列出下面的目录条目。智能体用 `fasth3-reference-prompting` 调用 `skill` 工具时，工具结果带有 `skills/fasth3-reference-prompting.md`：一段面向模型 `fasth3`、任务 `ref2v` 的镜头的 DreamVerse 对接说明（一个 DreamVerse 镜头就是一个目标视频；六个改写部分组成 `prompt`；只接受参考图片，按参考顺序编号 `<Picture N>`；参考图片以 `@[<label>](dv:asset/<AssetId>)` 引用，插件把它换成对应的 `<Picture N>`，首帧以 `@[首帧](dv:input/first_frame)` 引用，插件把它换成下一个 `<Picture N>`；不使用指南中的 `<Video N>` 和 `<Audio N>`；至少一张参考图片；最多 8 张图片加首帧；`duration_sec` 为 5 到 15），后接原样复制的 MiniMax-H3 官方全参考提示词指南 `VIDEO_PROMPT_WRITING_GUIDE_ref_en.md`。用户不能用 `/fasth3-reference-prompting` 调用该 skill；只有智能体加载它。

##### 目录条目

```markdown
- `fasth3-reference-prompting`: Model limits and prompt rules for model fasth3 for task ref2v: reference images, how the prompt names them, and how a shot continues the previous one.
```

#### Token 影响

该条目和 skill 注册表挂载期间，目录中约 40 个 token；智能体每次加载该 skill 约 6,300 个 token。

#### KV Cache 影响

挂载或移除本插件会改变 skill 列表，`dsh-tool-skill` 会追加一份替换目录；加载的 skill 正文作为工具结果追加。两者都不改变它们之前的缓存前缀。

### 任务 t2v 的提示词 skill

#### 模型看到什么

skill 注册表挂载且 `fasth3` 配置了任务 `t2v` 期间，skill 目录列出下面的目录条目。智能体用 `fasth3-text-prompting` 调用 `skill` 工具时，工具结果带有 `skills/fasth3-text-prompting.md`：一段面向模型 `fasth3`、任务 `t2v` 的镜头的 DreamVerse 对接说明（使用指南的 T2VA 模式，所以提示词直接从三个字段 `integrated_multimodal_description`、`overall_soundscape` 和 `non_diegetic_music` 开始；一个 DreamVerse 镜头就是一个目标视频；一切都用文字描述，必须保持同一张脸时使用任务 `ref2v`；`duration_sec` 为 5 到 15），后接原样复制的 MiniMax-H3 官方提示词指南 `VIDEO_PROMPT_WRITING_GUIDE_base_en.md`。用户不能用 `/fasth3-text-prompting` 调用该 skill；只有智能体加载它。

##### 目录条目

```markdown
- `fasth3-text-prompting`: Model limits and prompt rules for model fasth3 for task t2v: the three prompt fields, shot changes, camera motion, speakers and dialogue, sound and music.
```

#### Token 影响

该条目和 skill 注册表挂载期间，目录中约 40 个 token；智能体每次加载该 skill 约 4,200 个 token。

#### KV Cache 影响

挂载或移除本插件会改变 skill 列表，`dsh-tool-skill` 会追加一份替换目录；加载的 skill 正文作为工具结果追加。两者都不改变它们之前的缓存前缀。

### 目录条目和渲染事实

#### 模型看到什么

`@dv/models` 的 `dv_models_list` 结果列出每个配置的条目，带它的键（模态 `video`、任务、provider `fastvideo`、模型 `fasth3`）和描述：任务 `ref2v` 的描述为 "MiniMax H3 served as FastH3 Ref2VA: video with sound, dialogue and music written in the prompt, from reference images and an optional first frame. Keeps a face, place or style the same across shots through the references, and continues a shot from the previous shot's last still. Needs at least one reference image."；任务 `t2v` 的描述为 "MiniMax H3 served as FastH3 8-Step V2: video with sound, dialogue and music written in the prompt, from the prompt alone. A subject keeps its look only as far as the same words describe it, and no shot starts from an earlier shot's last still; a face that must stay the same needs fasth3 for task ref2v."。本插件由其事实得出的 schema 出现在 `dv_models_get` 的结果中：允许的时长、宽高比和分辨率，以及任务 `ref2v` 下的输入数量和媒体类型。所服务任务的事实出现在 `dv_shot_render` 的结果和拒绝文本中：服务器的模型 ID（`model_id`）、画面尺寸和帧数、允许的宽高比、分辨率和时长，以及由 `gpuSecondsPerVideoSecond` 得出的 GPU 估算。

#### Token 影响

`dv_models_list` 结果中每个条目的描述约 60 个 token，`dv_models_get` 结果中 `ref2v` 的 schema 约 80 个 token。`validateGenerationRequest` 拒绝某个请求时，`dv_shot_render` 的拒绝文本带有本包写出的问题句子，每句约 15 到 25 个 token，例如 "Its reference input needs at least 1 of type image; this shot has 0." 或 "fasth3 has no extra parameter `cfg` for task ref2v; its extra parameters: none."；其余结果和拒绝文本由 `@dv/models` 和 `@dv/shot-render` 写出。

#### KV Cache 影响

条目只通过追加到会话的工具结果到达模型，所以挂载或移除本插件除上文所述的 skill 目录变化外，不改变缓存前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **事实固定在代码中**：任务 API 不报告模型事实，所以 `facts` 和 `schema` 报告 `src/fasth3.ts` 中的表；以其他画面尺寸或时长启动的服务器，在表更新之前会与 `dv_models_get` 和 `dv_shot_render` 的拒绝文本不一致，skill 也写明同样的 5 到 15 秒和参考上限。
- **没有参考视频或音频**：任务 API 只从服务器路径或 `http` URL 读取视频和音频，所以 `fasth3` 在任务 `ref2v` 下只接受参考图片。
- **参考宽高比**：`RenderModelFacts` 没有参考宽高比字段，所以镜头渲染把参考素材发给服务器前不检查宽高比。
- **停止的渲染保留其 GPU 任务**：中止 `render` 只停止等待，服务器会完成已开始的任务。
- **任务 t2v 不保持身份**：在任务 `t2v` 下模型只看到提示词，所以主体只有在相同文字描述的范围内保持外观，镜头也不能从较早镜头的最后静帧开始；必须保持同一张脸或接续另一个镜头时，需要任务 `ref2v`。
- **可提供的模型固定在代码中**：`src/index.ts` 中的 `SERVED` 列出本插件能提供的模型和任务；另一个 FastVideo 模型，或为其他任务提供的 `fasth3`，需要在那里加条目并配上提示词 skill，仅改配置不够。
