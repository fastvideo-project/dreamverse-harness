# 维护 Reactor 提供商

[English](reactor.md) | 中文

当 Reactor 新增模型、修改工作流或发布新 SDK 时，请按本指南更新 `@dv/reactor`。主机安装与配置见 [Reactor 插件 README](../../../packages/dv/reactor/README.zh.md)。

## 修改模型或协议

1. 将已部署模型的 schema 与现有配置对照。对于兼容的私有部署，配置原生模型 ID 并复用已有配置。对于新工作流，请在 [profiles.ts](../../../packages/dv/reactor/src/profiles.ts) 中补充支持的任务、时长、输出尺寸和输入限制。[Reactor 模型 API 参考](https://docs.reactor.inc/model-api-reference/overview)
2. 对 API 参考中有 "Generate a clip" 小节的模型，使用 Reactor 的 [Clip Generation API](https://docs.reactor.inc/generations/api-reference)。在 [profiles.ts](../../../packages/dv/reactor/src/profiles.ts) 中设置 `workflow: { kind: 'generation', ... }` 并填入该模型的首帧和尾帧输入名，HTTP 调用保留在 [generations.ts](../../../packages/dv/reactor/src/generations.ts) 中。没有该小节的模型使用 [SDK 桥接程序](../../../packages/dv/reactor/src/render.py)，Reactor 专用的命令、事件和录制行为放在其中。流式工作流在会话中录制片段。PixVerse 下载已保存的步骤产物。不要从会话录制中获取排队片段：录制只有在会话持续生成时才会就绪。验证 SDK 版本变更后，请更新[主机配置](../../../packages/dv/reactor/README.zh.md#use-this-package)中的版本。[Reactor Python SDK](https://docs.reactor.inc/sdk-reference/python/reactor) · [Reactor 录制](https://docs.reactor.inc/concepts/recordings)
3. 通过主机凭据服务解析 `REACTOR_API_KEY`。目录查询需要密钥，不会开启生成会话，并使用 `catalogTimeoutSeconds` 时限。账户路由（`GET` 检查已保存的密钥，`POST` 检查候选密钥）还会在已配置的模型使用 SDK 桥接程序时检查 `pythonPath` 能否导入 `reactor_sdk`，不能时返回 `needs-setup`，并给出固定版本的安装命令 `python3 -m pip install 'reactor-sdk==1.15.0'`；更改 SDK 版本时同步更新 [setup.ts](../../../packages/dv/reactor/src/setup.ts) 中的该命令。目录路由在没有密钥时返回 503，Reactor 拒绝密钥时返回 401，其他情况返回 502。`apiBaseUrl` 为目录、Clip Generation 请求、保存步骤下载和 SDK 会话选择 Reactor API 源。`timeoutSeconds` 限制 Clip Generation 渲染（上传、生成和下载）或 SDK 会话，每个已注册的时长都必须短于 `timeoutSeconds`。`pollIntervalMs` 设置 Clip Generation 的轮询间隔。Clip Generation 请求只提交一次且从不重试，因为丢失响应时生成可能已经开始并计费。在 Reactor 接受生成之后，取消或到达时限会发送一次 `DELETE /sessions/{生成 ID}`，取消 SDK 渲染则请求 SDK 断开连接。SDK 清理期间丢失连接时，由服务端会话时限限制其运行时间。Clip Generation 参考文档没有说明 Reactor 如何对生成计费，添加模型时请向 Reactor 确认计费方式。

## 验证并提交

准备好 `ffmpeg` 和 `ffprobe` 后，运行提供商和套件测试。[测试替身 Clip Generation API](../../../packages/dv/reactor/tests/fake-reactor-api.ts)覆盖上传、提交、轮询、下载、错误、时限和取消，SDK 测试替身覆盖流式模型、PixVerse 及其取消。套件测试用二者验证模型注册和媒体导入。[目录测试](../../../packages/dv/reactor/tests/catalog.spec.ts) · [套件测试](../../../packages/bundle/dv/tests/reactor.spec.ts)

运行付费线上冒烟测试时，请使用获准的测试凭据和安装了固定 SDK 版本的解释器。[线上测试](../../../packages/bundle/dv/tests/reactor-live.e2e.ts)通过 `DV_REACTOR_LIVE_TEST=1` 启用，并读取 `REACTOR_API_KEY`。FastH3-Omni 通过 Clip Generation API 运行，因此只有测试 SDK 模型时才需要解释器。验证修改涉及的模型和任务，提交 PR 时说明模型 ID、SDK 版本、测试结果，以及受影响的限制或会话行为。[贡献指南](../../../CONTRIBUTING.zh.md)
