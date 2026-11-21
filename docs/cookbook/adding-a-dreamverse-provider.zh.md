# 贡献 DreamVerse 模型提供商

[English](adding-a-dreamverse-provider.md) | 中文

本指南说明如何让视频、图像或语音模型可供 DreamVerse Harness 用户使用，或如何保持现有提供商为最新。提供商是一个插件，它把每个模型和任务各注册一个 `ModelEntry` 到模型目录；之后智能体、选择器以及镜头、图像和音频流水线无需其他改动即可使用该模型。

## 1. 选择路径

- **官方内置（推荐）。** 在本仓库的 `packages/dv/<provider>` 下贡献一个插件。该插件随 DreamVerse 一起构建和发布，直接复用共享包，并在同一套 CI 中运行。贡献者负责保持其维护指南为最新（[第 8 节](#8-maintain-first-party-support)）。
- **仓库外。** 发布你自己的包，用户用 `dsh plugin add` 把它安装到自己的配置档中。它适用于主机端提供商，现有的缺口见[第 10 节](#10-ship-a-provider-outside-this-repository)。

开始之前，向提供商收集插件所需的信息：每个模型和任务的限制（时长、宽高比、分辨率、输入数量和媒体类型）、模型参数、稳定的模型 ID、媒体的输入输出方式、错误格式、任务如何取消以及取消是否会停止计费，以及请求如何鉴权。缺少某项时，请在 PR 中说明，不要自行编造数值。对于视频，不要编造提供商未公布的帧率或像素尺寸；按时长计费的云服务提供精确的 `durationsSec`。

## 2. 选择模板

| 集成方式 | 模板 | 可借鉴的部分 |
| --- | --- | --- |
| 带异步任务的托管 HTTP API | [`@dv/openrouter`](../../packages/dv/openrouter/README.zh.md) | 密钥解析、`redirect: 'error'`、提交一次后轮询、由目录驱动的别名、图像和语音输出的规范化。 |
| 只提供其他语言 SDK 的厂商 | [`@dv/reactor`](../../packages/dv/reactor/README.zh.md) | 子进程桥接：stdin 上的一个 JSON 请求、清理过的环境、有时限的会话、测试中的模拟 SDK。 |
| 自托管的 OpenAI 兼容图像或音频服务器 | [`@dv/vllm-omni`](../../packages/dv/vllm-omni/README.zh.md) | 每个模型一个服务器、已服务模型检查、渲染前拒绝不支持的尺寸。 |
| 自托管视频服务器 | [`@dv/fastvideo`](../../packages/dv/fastvideo/README.zh.md)（限制写在配置中）、[`@dv/uniserve`](../../packages/dv/uniserve/README.zh.md)（限制从服务器读取） | 整段视频请求，以及 `@dv/fastvideo` 中多服务器的 worker 路由。 |

本指南所要求文档的示例：[Reactor 维护指南](providers/reactor.zh.md)和 [OpenRouter 维护指南](providers/openrouter.zh.md)。

## 3. 复用已有部分

不要重新实现这些内容。详情见各自所属的 README。

| 需求 | 使用 |
| --- | --- |
| 条目类型、事实、schema、请求校验、流事件、提示 skill | [`@dv/models`](../../packages/dv/models/README.zh.md)：`ModelEntry`、`RenderModelFacts`、`RenderRequest`、`RenderStreamEvent`、`promptSkill`。 |
| 由已配置的别名注册条目 | `@dv/models`：`syncModelEntries`、`syncModelEntriesAsync`、`assertModelAlias`（[注册辅助函数](../../packages/dv/models/README.zh.md#share-model-registration-code)）。 |
| 读取输入媒体 | [`@dv/asset-pool`](../../packages/dv/asset-pool/README.zh.md)：`get`、`path`、`mediaType`、`hasAudio`、`read`。不要直接读取原始素材 ID。 |
| 探测和末帧 | [`@dv/ffmpeg`](../../packages/dv/ffmpeg/README.zh.md)：`probe`、`lastFrame`、`run`。 |
| 提示引用 | [`@dv/project`](../../packages/dv/project/README.zh.md)：`replacePromptCitations`、`citedAsset`、`citedInput`。不要手写引用 URI。 |
| 密钥 | [`@deepseek-ai/dsh-credentials`](../../packages/credentials/credentials/README.zh.md)：`credentialRef`、`isCredentialRefName`，以及主机端的 `ctx.credentials.resolve`。 |
| 子进程的环境 | [`@deepseek-ai/dsh-subprocess`](../../packages/subprocess/subprocess/README.zh.md)：`scrubbedParentEnv`。 |
| 面向浏览器的发现路由 | `ctx.inject(['connection'], ...)` 和 `connection.fetch.register`，如 OpenRouter 和 Reactor 的目录路由。 |
| 使用这些条目 | [`@dv/shot-render`](../../packages/dv/shot-render/README.zh.md)、[`@dv/image-generate`](../../packages/dv/image-generate/README.zh.md)、[`@dv/audio-generate`](../../packages/dv/audio-generate/README.zh.md)。提供商只用 `import type` 引入图像和音频请求类型，从不导入这些使用方。 |

[dv-architecture.ts](../../scripts/dv-architecture.ts) 中的分层检查只允许提供商以值导入 `@dv/project` 和基础包（`models`、`generation`、`asset-pool`、`canvas`、`ffmpeg`、`reference-kit`、`hardware`），并且从不导入其他提供商。运行 `pnpm exec vitest run scripts/dv-architecture.spec.ts`，确认它没有针对你的包的报告。

## 4. 实现插件

清单、`tsconfig` 和注册步骤见[添加包](adding-a-package.zh.md)。导出 `name`、`inject`、`Config` 和 `apply`；注入 `dvModels` 以及你读取的服务（`dvAssetPool`、`dvFfmpeg`、`credentials`）。

- **稳定的 ID。** 提供商 ID 是不含 `/` 的小写名称。条目的 model 是本地别名；提供商的原生 ID 属于配置。
- **配置。** 每个随部署而变化的值都是经过校验的 `Config` 字段：基础 URL、超时、模型列表、凭据引用。`DEFAULT_*` 常量不算可配置。把 `models` 设为 `.volatile()`，使修改能到达运行中的注册表。用 `assertModelAlias` 检查别名，用 `isCredentialRefName` 检查凭据引用，使错误的值让插件加载失败。休眠安装（`models: {}`）不发出任何网络调用。
- **注册。** 按别名和任务构建条目，并用 `syncModelEntries` 或 `syncModelEntriesAsync` 注册。固定条目使用 `ctx.effect(() => ctx.dvModels.register(entry), label)`。每项贡献都是 effect，所以卸载时会被释放。
- **条目约定。** [ModelEntry](../../packages/dv/models/src/types.ts) 的 JSDoc 规定了 `facts`、`schema`、`validateGenerationRequest` 和 `render` 的语义。在任何付费调用之前，用面向智能体的一句话拒绝每个有问题的请求。用 `replacePromptCitations` 从提示中去掉引用。
- **输出。** 视频渲染按顺序产出 `last_frame`、`video_start`、`chunk` 和 `done`，末帧来自 `dvFfmpeg.lastFrame`。图像条目返回 PNG 字节和像素尺寸，语音条目返回带时长的 WAV 片段；其他格式用 `dvFfmpeg` 转换。
- **密钥。** 每次操作都在主机端解析密钥，不缓存，`Config` 中只保存其引用名称。不要把密钥放进 argv、子进程环境、日志或错误。通过 stdin 把它传给子进程，并用 `scrubbedParentEnv()` 启动子进程。带鉴权的请求使用 `redirect: 'error'`，并且从不记录签名 URL。
- **取消与计费。** 把中止信号传给每个请求，并以 `signal.reason` 拒绝。提供商没有取消路由时，在 schema 中声明 `cancellation: 'monitoring_only'`，并在描述中说明停止不会取消付费任务。付费请求只发送一次，绝不自动重试。
- **失败。** 配置错误在加载时或在能解析的最早时刻明确失败。提供商不再提供的已配置模型会被跳过并列出，不会被悄悄丢弃。

## 5. 测试并记录证据

- 让每个 `src` 文件达到 100% 覆盖率（`pnpm run test:coverage` 是 CI 门禁）。用 `pnpm exec vitest run <tests> --coverage --coverage.include=<src file>` 检查单个包。
- 添加真实组合测试：在 `packages/bundle/dv/tests/` 中通过 `bootBundle` 启动真实的套件行（[Reactor 示例](../../packages/bundle/dv/tests/reactor.spec.ts)），只替换厂商：模拟的 HTTP 服务器（[OpenRouter](../../packages/dv/openrouter/tests/openrouter.spec.ts)、[vLLM-Omni](../../packages/dv/vllm-omni/tests/fixture.ts)）或解释器路径上的模拟 SDK（[Reactor 测试夹具](../../packages/bundle/dv/tests/fixtures/reactor/reactor_sdk.py)）。自行管理端口和临时目录并在结束时清理（[测试策略](../testing.zh.md)）。
- 覆盖注册与释放、配置拒绝、来自提供商的 `facts` 和 `schema`、每句拒绝语各一个用例、渲染事件顺序、提供商错误和中止。
- 用 `tests/expected/` 下归属方自有的期望文件固定模型可见的工具 schema，如 [`packages/bundle/dv/tests/expected/tools`](../../packages/bundle/dv/tests/expected/tools) 所做。会话中可见的输出变化时，更新无密钥的录制会话快照（[何时需要快照](../testing.zh.md)）。
- 付费的线上测试需主动启用：命名为 `*.e2e.ts`，由环境变量控制，没有密钥时跳过，如 [reactor-live.e2e.ts](../../packages/bundle/dv/tests/reactor-live.e2e.ts) 通过 `DV_REACTOR_LIVE_TEST=1` 所做。

## 6. 编写文档

- 使用 [dsh-doc](../../.agents/skills/dsh-doc/SKILL.md) 的 `package-reference` 模板编写中英文包 README，包含模型体验一节：模型看到的条目描述、提示 skill 和拒绝语。在“进一步探索”下链接本指南和维护指南。
- 编写维护指南 `docs/cookbook/providers/<provider>.md` 和 `.zh.md`，并在两个 README 中链接。没有维护指南的提供商包会使 `pnpm run verify-provider-maintenance-guides` 失败。
- 用 `pnpm run verify-translation-pairing --write <file>` 重新记录每一对文件，然后运行 `pnpm run test:docs`。

## 7. 把提供商接入套件

- 在 [cordis.patch.yml](../../packages/bundle/dv/cordis.patch.yml) 中添加行 `dv-<provider>` 并让 `models` 为空，同时在套件 `package.json` 中添加依赖。
- 在 `tsconfig.base.json` 的 paths 中添加 `@dv/<provider>` 条目，并在 `tsconfig.host.json` 中添加引用。
- 把插件加入 [bundle.ts](../../packages/bundle/dv/tests/bundle.ts) 的 `PLUGINS`，并在 `composition.spec.ts` 中覆盖该行。

<a id="8-maintain-first-party-support"></a>
## 8. 维护官方内置支持

提供商合并后，由贡献者（或贡献者所代表的厂商）负责维护：在 PR 中写明联系人，并保持维护指南为最新。仓库没有 code owners 文件，所以评审者依靠该联系人处理提供商相关问题。引发变更的事项发生时，在同一个 PR 中更新提供商：

- 提供商新增、重命名或下线模型。
- API 或 SDK 版本变化，或插件读取的字段变化。
- 限制变化：时长、尺寸、输入数量、媒体类型。
- 取消或计费行为变化。

各类变更的做法：

- **模型映射。** 由目录驱动的提供商在配置中把别名映射到原生 ID，符合现有任务的模型无需改代码。带内置配置档的提供商修改配置档表。维护指南会指明文件。
- **版本固定。** 在 README 的安装说明和维护指南中记录所支持的 SDK 或 API 版本。升级时，用新版本运行提供商测试和线上冒烟测试，然后更新这两份文档。
- **下线模型。** 已保存的项目保留已渲染的媒体。指向已移除别名的渲染请求会因未知模型错误而被拒绝，智能体会选择其他模型。提供商仍提供该模型时，在条目描述中注明下线信息和替代模型。提供商停止提供后，再从套件默认值和维护指南中移除该别名。由目录驱动的提供商会报告其目录中没有的已配置模型，而不是失败。
- **PR 中的证据。** 提供商和套件测试结果；针对变更的模型和任务的线上冒烟测试，包括模型 ID、版本和结果；变化的限制或计费行为；以及已更新的中英文 README 和指南。

## 9. 提交拉取请求

- Fork 仓库，并向默认分支提交一个聚焦的 PR。较大的变更请先开 issue（[贡献指南](../../CONTRIBUTING.zh.md)）。
- 填写 PR 模板：动机、变更，以及带证据的测试。
- 恰好添加一个 `kind/*` 标签（`kind/feature` 或 `kind/bug-fix`），并添加所有相关的 `area/*` 标签，如 `area/video` 和 `area/web`。
- 运行能覆盖该差异的最小检查（[dsh-pre-push-checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md)），只报告你实际运行的内容。
- 不要把密钥、签名的媒体 URL 和私有部署细节放进差异、测试和日志。
- 改变可见 GUI 行为的变更需附上用 PR 的真实流程录制的 GIF（[record-browser-gif](../../.agents/skills/record-browser-gif/SKILL.md)）。

<a id="10-ship-a-provider-outside-this-repository"></a>
## 10. 在本仓库之外发布提供商

仓库之外的包通过套件补丁挂载其插件，用户把它安装到自己的配置档中。

1. 发布一个包，包含 `"type": "module"`、导出 `name`、`inject`、`Config` 和 `apply` 的插件、作为对等依赖的 `@deepseek-ai/cordis`，以及 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。补丁插入一行，例如 `- insert: [{ id: dv-acme, name: '@acme/dreamverse-provider', config: { models: {} } }]`。参见[发布插件](../user/develop/basic/publish.zh.md)。
2. 用户在设置了 `DSH_HOME` 的 DreamVerse 检出目录中运行 `scripts/video-harness/setup-profile.sh`，然后运行 `pnpm dsh plugin --profile video-harness add <包、tarball 或 github:owner/repo#sha>`，再在 `profiles/video-harness/cordis.patch.yml` 中重新写出 `models`。`pnpm dsh --profile video-harness --dump-config` 会显示插入的行。添加和移除 tarball 包不会影响 `setup-profile.sh` 创建的 `@dv/bundle` 链接。
3. 用户通过凭据存储或 `credentialRef` 所指的环境变量提供密钥。

目前的缺口：

- `@dv/*` 包是私有的，导出 TypeScript 源码，也没有版本承诺。请对照 DreamVerse 检出目录做类型检查，或自己写最小接口并使用 JavaScript，并预期需要跟进仓库变化。
- DreamVerse 通过源码启动器从源码检出目录运行，所以用户需要一份检出。
- 仓库之外的包没有文档化的方式来添加浏览器设置页。用户通过凭据存储或环境变量设置密钥。
- 使用 `dsh plugin add` 安装，而不是在补丁中写绝对路径：按路径加载的插件可能会加载自己的一份 harness 包。
- 目前没有提供商目录。请在 [FastVideo Slack](https://join.slack.com/t/fastvideo/shared_invite/zt-4heayzk81-lOkgpvJRoceuZjNP7pXxJA) 或 [Discord](https://discord.gg/dqc2J2yNQ) 中分享该包，或将其作为官方内置提供商贡献。
