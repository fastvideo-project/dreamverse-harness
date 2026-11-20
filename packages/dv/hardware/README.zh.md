# @dv/hardware

[English](README.md) | 中文

通过 HTTP API 或仅密钥认证的 OpenSSH 转发连接生成 worker。模型 provider 检查各自 worker 的状态，并在接纳生成工作时复用这些连接。本服务不要求 NVIDIA、Spark 或特定模型系列。

## 配置

与现有的 Harness 凭据 provider 一起挂载本插件。它的实时字段 `workers` 通过 Harness 设置编辑。每个 worker 有一个稳定 ID 和一个 provider ID。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `workers` | `{}` | 按稳定 ID 保存的 worker |
| `workers.<id>.label` | 必填 | 显示名称 |
| `workers.<id>.provider` | `fastvideo` | 使用该连接的检查器和生成适配器所属的 provider |
| `workers.<id>.enabled` | `true` | 在此 worker 上接纳新工作 |
| `workers.<id>.transport` | `api` | 直接 API 或 `ssh` 转发 |
| `workers.<id>.baseUrl` | `http://127.0.0.1:18000` | API 源及可选的反向代理前缀 |
| `workers.<id>.credentialRef` | 空 | 现有凭据服务的引用，每次请求时解析 |
| `workers.<id>.sshHost` | 空 | Harness 主机上现有的 OpenSSH 主机别名 |
| `workers.<id>.remoteHost` | `127.0.0.1` | 从 SSH 服务器访问的 API 主机 |
| `workers.<id>.remotePort` | `18000` | 从 SSH 服务器访问的 API 端口 |
| `connectionTimeoutMs` | `10000` | 连接检查的截止时间 |

设置会拒绝保存或重新加载这样的清单：其中有无效的 ID、标签、provider、凭据引用、SSH 坐标或 URL，或有两个 worker 使用同一端点。已经存储在 profile 中的无效清单仍会启动服务：操作员提示词报告该错误，清单、检查和接纳都会拒绝，直到清单被编辑。

SSH 使用 Harness 主机的 OpenSSH 客户端和现有的已授权身份。它从不接受或传输私钥内容，从不询问密码，也从不自动信任新的主机密钥。该别名必须已经能以批处理认证和受信任的主机密钥工作。SSH 转发目前需要 macOS 或 Linux；直接 API 在 Windows 上也可用。

## 生成接纳

`workers(provider)` 捕获已启用的连接。`reserve(id)` 每个 worker 最多接纳一个本地操作。释放预留是幂等的。配置编辑不会重定向已接纳的操作。provider 在获取先前捕获的连接之前检查 `eligible(connection)`。原生后端仍须自行串行化其流水线，因为另一个 Harness 实例可能使用同一 API。

FastVideo 通过其实时设置 `useHardware` 启用此清单。它在空闲 worker 上选择已安装的模型，优先选择已驻留的兼容模型，并在所有符合条件且已安装的 worker 都忙碌时等待。此处未实现跨越一个视频的 worker 组。提供该操作之前，需要一个独立的分布式后端，以及对组内每个成员的原子预留。

## 检查

经过认证的浏览器路由提供 `GET /api/dv/hardware/status`、`POST /api/dv/hardware/check`，以及 `GET` 或 `POST /api/dv/hardware/models?worker=<id>`。检查对每个已启用的 worker 做一次有时限的尝试。模型路由目前支持原生 FastVideo 目录和显式的加载/卸载操作。模型下载尚未实现。

agent（智能体）工具 `dv_hardware_list` 报告名称、可用性、模型驻留和忙碌状态。它从不返回端点凭据。provider 检查器通过 `registerInspector` 注册；后备检查只访问 `/health`，无法断言物理 GPU 清单或模型驻留。

## 运行时不变量

不发布独立的不变量：预留的所有权是本服务私有的，没有可供比较的独立投影。行为测试覆盖预留的排他与释放、凭据轮换、端点校验、设置 schema 序列化，以及一项需主动启用的真实 SSH worker 检查。

## 现有的 RunPod Pod

硬件设置可以通过 `POST /api/dv/hardware/runpod/pods`，使用已保存的账户凭据引用，发现正在运行的 GPU Pod。发现过程向 RunPod 的 Pod 列表 API 发出一次经过认证的 `GET`，只返回 Pod ID、名称、状态和公开的 HTTP 端口。Pod 环境和账户凭据不会返回给浏览器。

选择已经在提供 FastVideo 服务的 HTTP 端口。保存的 worker 使用现有的 API 传输和 RunPod HTTPS 代理；它可选的 FastVideo bearer 密钥与 `DV_RUNPOD_API_KEY` 分开。发现过程不会创建、启动、停止或修改 Pod。Pod 正在运行并不说明 FastVideo 已就绪；保存后请使用常规的连接检查。真实账户验证仍需主动启用，伪 provider 测试不覆盖它。

## 模型体验

### `dv:hardware` 系统提示词部分

#### 模型看到什么

DSH 系统提示词服务挂载期间，每次请求都带有下面的 `dv:hardware` 部分，位于 `promptSectionOrder` 指定的顺序（默认 `4870`）。`<inventory>` 是一行：一个 JSON 数组，每个已保存的 worker 一项，包含 `id`、`label`、`provider` 和 `enabled`。已保存的清单无效时，这一行改为 `Worker configuration contains invalid or duplicate endpoints. Edit Hardware settings before generating.`。该部分从不包含端点、凭据或实时状态。

##### dv:hardware 文本

```markdown
Generation hardware:
When the user asks whether a device is connected, available, busy, or loaded, call dv_hardware_list immediately and report its result. Do not ask permission for this read-only inspection or claim no visibility before checking.
The configured worker IDs below are routing targets, not evidence of current connectivity. Read dv_hardware_list for live state.
<inventory>
The model catalog metadata says whether a model accepts a worker. For explicit placement, pass the worker ID as worker to a render or model tool that accepts it. Use the exact enabled worker ID. A pinned operation never falls back to another device. Omit worker to let the provider place independent jobs automatically.
Check model status per worker before switching models. Loading retains compatible common components when supported. Never unload or replace a busy worker. Submit independent clips together; wait only for clips whose inputs depend on an earlier output.
Only configured workers may be used. Do not infer distributed single-video support from multiple available workers, start Ray, change device connections, or access credentials from generation tools.
```

#### Token 影响

本包挂载期间，每次请求中约 230 个 token 的固定文本，每个已保存的 worker 另加约 20 个 token。

#### KV Cache 影响

固定的各行不变。保存对 worker ID、标签、provider 或启用标志的编辑，或者清单在有效与无效之间变化，会改变 `<inventory>` 行，使缓存前缀从本部分起失效。连接检查、预留或 worker 状态的变化不会改变本部分。

### `dv_hardware_list` 工具定义与结果

#### 模型看到什么

DSH 工具注册表挂载期间，agent 看到工具 `dv_hardware_list`，带下面的描述，没有参数。生成的工具目录不列出 DreamVerse 工具，所以本节引用工具描述。一次调用对每个已启用的 worker 检查一次，返回一个带 JSON 的文本块：一个数组，每个已保存的 worker 一项，包含 `id`、`label`、`provider`、`transport`、`enabled`、`reachable`、`busy`、`loadedModel`、`loadingModel` 和 `status`。已保存的清单无效时，调用失败，错误文本与上面 `<inventory>` 行的错误文本相同。

##### dv_hardware_list 描述

```markdown
Inspect enabled generation workers, connectivity, busy state, and resident models. Call this immediately when asked about connected devices or worker status; no confirmation is needed. Returned IDs can target render, model status, load, and unload calls. This does not configure hardware or start Ray.
```

#### Token 影响

工具注册表挂载期间，每次请求中定义约 75 个 token。每个已保存的 worker 的结果约 45 个 token。

#### KV Cache 影响

定义是稳定工具部分中的固定文本。挂载或移除本包会改变工具列表，使缓存前缀从工具部分起失效。每个结果在其调用之后进入对话。结果之前的缓存前缀不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **一个视频不能跨越多个 worker**：一个视频的 worker 组需要一个独立的分布式后端，以及对组内每个成员的原子预留。
- **没有模型下载**：模型路由只支持原生 FastVideo 目录和显式的加载与卸载操作。
- **SSH 转发需要 macOS 或 Linux**：Windows 上的 Harness 主机只能使用直接 API。
