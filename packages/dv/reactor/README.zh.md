---
description: "使用 Reactor 托管的视频模型生成 DreamVerse 镜头。"
kind: "package-reference"
---

# @dv/reactor

[English](README.md) | 中文

## 摘要

使用 Reactor 生成 DreamVerse 镜头。选择支持文本、参考素材、关键帧或剧本数字人的模型。DreamVerse 保存视频片段和一张 PNG 尾帧。FastH3、FastH3-Omni、H3 Reference Turbo Realtime 和 Pika H3 Flex 使用 Reactor 的 Clip Generation HTTP API。其余模型通过 Reactor SDK 会话流式输出，Reactor 按会话时长对其收费。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和推迟的工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 DreamVerse 主机的凭据存储或环境变量中设置 `REACTOR_API_KEY`。在 profile 的 `cordis.patch.yml` 中配置要启用的模型别名。DreamVerse 套件的默认模型列表为空。

只有 PixVerse R2 Director、LTX、Helios、LongLive 2.0 和两个 Visko Orbis 模型需要 Python SDK。FastH3、FastH3-Omni、H3 Reference Turbo Realtime 和 Pika H3 Flex 由主机通过 HTTPS 调用 Reactor，只需要 API 密钥。对于 SDK 模型，主机需要在 Python 3.10 或更高版本的环境中安装 `reactor-sdk==1.15.0`。请安装到设为 `pythonPath` 的解释器中：

```sh
python3 -m pip install 'reactor-sdk==1.15.0'
```

如果主机使用专用 Python 环境，请运行该环境的 `python -m pip`，并在 profile 的 `cordis.patch.yml` 中把其解释器设为 `pythonPath`。

```yaml
- id: dv-reactor
  config:
    pythonPath: /path/to/venv/bin/python
    models:
      fast-h3:
        profile: fast-h3
```

通过 `dv_models_list` 查找提供商 `reactor` 的已配置别名。用 `dv_models_get` 查看任务和支持的时长，再把提供商、模型别名和任务传给 `dv_shot_render`。套件包含 FastH3、FastH3-Omni、H3 Reference Turbo Realtime、Pika H3 Flex、PixVerse R2 Director、LTX、Helios、LongLive 2.0 和两个 Visko Orbis 模型的配置。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `pythonPath` | `python3` | 能导入 Reactor SDK 的主机 Python 解释器。Clip Generation 模型不使用它。 |
| `credentialRef` | `REACTOR_API_KEY` | harness 凭据存储在每次渲染时解析的名称。 |
| `timeoutSeconds` | `360` | 单次渲染的最长时长，单位为秒。对 Clip Generation 模型，涵盖上传、生成和下载。对 SDK 模型，它是会话时长，涵盖连接、上传、生成、流式输出、录制和下载。取 1 到 3600 的整数。 |
| `apiBaseUrl` | `https://api.reactor.inc` | Reactor API 的 HTTPS 源，不含路径、查询或凭据。它用于模型目录、Clip Generation 请求、PixVerse 保存步骤的下载，以及通过 `api_url` 参数创建的 SDK 会话。其他取值会导致加载失败。 |
| `pollIntervalMs` | `5000` | Clip Generation 状态轮询的间隔，单位为毫秒。Reactor 返回更长的 `Retry-After` 头时以其为准，最长 60 秒。取 1 到 60000 的整数。 |
| `catalogTimeoutSeconds` | `30` | 单次 `GET /api/dv/reactor/catalog` 请求 Reactor 的时限，单位为秒。取 1 到 300 的整数。 |
| `models` | DreamVerse bundle 默认为空 | 可用于生成工具的模型别名。每项包含 `profile`，并可覆盖 `modelId` 和 `durationsSec`。 |

`timeoutSeconds` 必须大于片段时长加上准备和生成所需时间。超过时限的 Clip Generation 渲染会在 Reactor 端取消。流式 SDK 工作流按实时速度运行，Reactor 按会话时长对 SDK 会话收费，因此 `timeoutSeconds` 也是单次 SDK 渲染的费用上限。Clip Generation 参考文档没有说明 Reactor 如何对生成计费，请在 Reactor 账户中确认这些模型的计费方式。插件只注册短于 `timeoutSeconds` 的时长，所以 `dv_models_get` 不会列出无法完成的时长。例如默认值 `360` 会去掉 LTX 中 360 秒及以上的时长，而 LTX 最长支持 300 秒。如果某个别名没有短于 `timeoutSeconds` 的时长，加载插件或应用新设置时会失败，错误信息指明该别名和 `timeoutSeconds`。

如果账户只能访问部分模型，请在 `models` 中配置所需的配置子集。对于实现相同模型命令的私有部署，请将完整的 `owner/name` 填入 `modelId`，并选择对应的 `profile`。

在 Web profile 中，`GET /api/dv/reactor/catalog` 列出配置的 API 密钥可见的所有模型。每项的 `shotModels` 列出该模型在 DreamVerse 中已配置的别名。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>供应商实现</summary>

[Cordis 插件](src/index.ts)注册[模型配置](src/profiles.ts)，在主机上读取 API 密钥，并将 DreamVerse 任务映射到模型输入。[Clip Generation 客户端](src/generations.ts)用 `POST /files` 上传每个输入，只提交一次 `POST /generations`，轮询 `GET /generations/{id}` 直到 `succeeded` 或 `failed`，再从签名 URL 下载 `output.mp4`。它只向配置的源发送 API 密钥，这些请求拒绝重定向，也不向签名 URL 发送凭据。如果渲染在 Reactor 接受生成之后被取消或到达 `timeoutSeconds`，它会用生成 ID 发送 `DELETE /sessions/{id}`。取消请求失败不会替换原始错误。镜头渲染器随后用 `ffmpeg` 重新封装 MP4、探测时长并提取尾帧，与 SDK 片段的处理相同。没有 Clip Generation 参考文档的模型使用[SDK 桥接程序](src/render.py)，它调用 Reactor 官方 Python SDK：为每次渲染开启一个有时限的会话，上传素材、发出命令并录制片段。PixVerse 通过 Reactor 保存步骤的 API 直接提供 MP4。桥接程序不从会话录制中获取排队片段，因为录制只有在会话持续生成时才会就绪。完成、取消或失败后，桥接程序关闭会话。Helios 在每个分块完成后通过 `state.current_frame` 报告累计帧数。桥接程序根据该帧数决定何时录制。

插件运行 Python 桥接程序，因为 Reactor 官方 Python SDK 是无头会话、上传、命令和录制下载的官方客户端。插件只通过 stdin 把 API 密钥交给桥接程序，桥接进程使用 `scrubbedParentEnv` 返回的环境运行，因此密钥不会进入子进程环境。

Reactor 在共享模型目录中注册条目，并将媒体交给镜头渲染器。这两项结果都没有独立的运行时记录，因此此包不发布运行时不变量伴随模块。套件测试覆盖 Reactor 会话关闭和本地录制文件清理。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Reactor 模型 API 参考](https://docs.reactor.inc/model-api-reference/overview)
- [Reactor 录制](https://docs.reactor.inc/concepts/recordings)
- [Reactor 维护指南](../../../docs/cookbook/providers/reactor.zh.md)
- [DreamVerse 镜头渲染](../shot-render/README.zh.md)

<a id="model-experience"></a>
## 模型体验

### 请求上下文和条件

#### 模型看到什么

智能体可用 `dv_models_list` 查询已启用的 Reactor 模型，并用 `dv_models_get` 读取其任务 schema。每个模型收到按其协议展开项目素材引用的镜头提示词。对于 LTX，镜头提示词是要朗读的剧本。

#### Token 影响

智能体查询目录时会收到 Reactor 模型的元数据。启用供应商不会添加新的提示词段落。

#### KV Cache 影响

目录结果追加到对话。供应商不会在固定请求前缀中加入文本。

## 已知限制和推迟的工作

<a id="known-limitations-and-deferred-work"></a>

- 流式工作流要求部署启用 Reactor 录制。PixVerse 使用 Reactor 保存步骤的文件。
- 需要互动控制、实时麦克风或摄像头输入以及机器人会话的模型会出现在目录发现结果中。这些模型需要各自的工作流才能生成 DreamVerse 镜头。
- 通过主机 profile 启用内置的镜头模型配置，并将别名映射到实现相同工作流的私有部署。
- 取消 Clip Generation 渲染会停止监控，并请求 Reactor 取消该生成。无法到达 Reactor 的取消请求会让生成继续完成，Reactor 会保留其结果 48 小时。
- 取消 SDK 渲染时，插件请求 SDK 断开连接。如果主机在清理期间失去连接，服务端的会话时限仍然有效。
- Clip Generation 模型的提示词长度限制（FastH3 为 1024 个 UTF-8 字节，其他为 2048 个）由 Reactor 执行，并在错误信息中给出限制。
- Clip Generation 对 FastH3 和 Pika H3 Flex 接受 64 MiB 的输入文件，但 DreamVerse 仍将其限制为 25 MiB。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护说明</summary>

bundle 测试替换外部 SDK 和 Clip Generation API（[测试替身 API](tests/fake-reactor-api.ts)）并检查 MP4 和 PNG 导入。`packages/bundle/dv/tests/reactor-live.e2e.ts` 中的付费冒烟测试通过 Clip Generation API 渲染 FastH3-Omni，需要设置 `DV_REACTOR_LIVE_TEST=1` 并提供主机 API 密钥。

</details>
