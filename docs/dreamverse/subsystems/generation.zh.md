# 生成

[English](generation.md) | 中文

本页是 DreamVerse 生成的参考：`@dv/models` 的模型目录，以及 `shot.render` 在渲染前做的检查。

<a id="model-catalog"></a>
## 模型目录

模型目录是 [`@dv/models`](../../../packages/dv/models/README.zh.md) 的 `dvModels` 服务，它是一个能力 seam，其 Service Provider 是提供方插件（如 [`@dv/fastvideo`](../../../packages/dv/fastvideo/README.zh.md)），其 Consumer 包括 `@dv/shot-render`。每个镜头用其 `modality`、`task`、`provider` 和 `model` 所指定的模型目录条目渲染；[`@dv/models` README](../../../packages/dv/models/README.zh.md) 定义键、条目、渲染请求、智能体工具，以及添加提供方、模型或服务器的步骤。

`shot.render` 的 precondition 对每个调用方都拒绝：不在模型目录中的模型键、缺少提示词、超出条目事实的参数、多于一个的首帧，以及条目拒绝的渲染请求。每个条目的 `validateGenerationRequest(request)` 负责模型的请求规则，例如输入接受的媒体类型和数量（`fasth3` 在生成任务 `ref2v` 下至少一个参考素材）、模型不接受的首帧，以及无效的 `extra` 值；`shot.render` 组装请求，在写入记录前和真正渲染前各调用一次，自己不检查任何模型规则。分镜计划的每个镜头写明自己的 `modality`、`task`、`provider` 和 `model`；生成任务为 `ref2v` 的镜头使用自己的参考素材，没有时使用计划的参考素材，`continue_previous: true` 让该镜头从上一个镜头的最后一张静帧开始。`plan.create` 和 `plan.update` 拒绝生成任务不是 `ref2v` 却带参考素材的镜头，以及镜头 1 上或生成任务不是 `ref2v` 的镜头上的 `continue_previous`。
