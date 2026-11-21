# 维护 OpenRouter 提供商

[English](openrouter.md) | 中文

当 OpenRouter 新增模型类型、修改目录或生成 API，或改变模型计费方式时，请按本指南更新 `@dv/openrouter`。主机安装与配置见 [OpenRouter 插件 README](../../../packages/dv/openrouter/README.zh.md)。

## 修改模型或协议

1. 本包不保存模型列表。用户在 `models`、`imageModels` 或 `audioModels` 配置中把本地别名映射到 OpenRouter 模型 ID，只有对应的实时目录列出该模型时，提供商才会注册它。符合现有任务的新模型无需修改代码。[OpenRouter 视频指南](https://openrouter.ai/docs/guides/overview/multimodal/video-generation) · [图片指南](https://openrouter.ai/docs/guides/overview/multimodal/image-generation) · [语音指南](https://openrouter.ai/docs/features/multimodal/tts)
2. 出现新字段或目录行变化时，更新 [catalog.ts](../../../packages/dv/openrouter/src/catalog.ts) 中的解析器。视频模型需要时长、分辨率和宽高比，带放大倍数的模型会被排除。视频模型支持的任务由 [index.ts](../../../packages/dv/openrouter/src/index.ts) 中的 `tasks()` 决定：`ref2v` 来自模型目录的图片输入，`i2v` 和 `fl2v` 来自视频目录列出的帧图片。OpenRouter 只以 PCM 提供语音的厂商列在 `PCM_ONLY_VENDORS` 中，图片的 `extra` 选项在 `IMAGE_PARAMETER_TEXT` 中说明。请使 [openrouter-video-prompting.md](../../../packages/dv/openrouter/skills/openrouter-video-prompting.md) 中的提示规则与已注册的任务一致。
3. 通过主机凭据服务解析密钥。`credentialRef` 指定其名称，默认为 `OPENROUTER_API_KEY`。客户端只在发往 `baseUrl` 的请求的 `Authorization` 头中发送密钥，拒绝重定向，并且不把密钥写入错误文本。一次视频调用向 `videos` 提交一次，并每隔 `pollIntervalMs`（默认 5000 毫秒）轮询任务。中止只会停止本地轮询；OpenRouter 没有文档化的取消路由，所以付费任务会继续，schema 声明 `cancellation: 'monitoring_only'`。不要添加自动重试：失败或结果不明的提交可能已经计费。如果 OpenRouter 发布了取消路由，请在中止时调用它，并同时更新 schema、条目描述和 README 中的限制。
4. 注册是惰性的。空配置不发出任何请求，目录中没有的已配置 ID 会被跳过，并在目录路由的 `error` 字段中列出。修改 `apply` 中的 `resolve` 时请保持这一行为；取代、重试和释放规则由 [`@dv/models`](../../../packages/dv/models/README.zh.md#share-model-registration-code) 的同步辅助函数负责。

## 验证并提交

准备好 `ffmpeg` 和 `ffprobe` 后运行提供商测试；它们不在默认路径时，把 `DV_FFMPEG` 和 `DV_FFPROBE` 设为其路径。模拟的 OpenRouter 服务器覆盖目录解析、注册与移除、请求体、轮询、失败、中止和媒体转换。[客户端测试](../../../packages/dv/openrouter/tests/client.spec.ts) · [提供商测试](../../../packages/dv/openrouter/tests/openrouter.spec.ts)

本包没有自动化的付费测试。修改协议或模型时，请使用获准的测试密钥和计费上限，把模型加入临时配置，用 `dv_models_get` 检查，并以最短时长或一小段文本渲染。在 PR 中说明模型 ID、任务、结果，以及与目录不一致的限制或计费行为。不要在 PR 中包含密钥和签名的媒体 URL。[贡献指南](../../../CONTRIBUTING.zh.md)
