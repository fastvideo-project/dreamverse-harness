# @dv/ui-hardware

[English](README.md) | 中文

在设置中添加“硬件”页面。展开某台设备即可管理装在该设备上的生成模型。托管的模型 API 在 **设置 → 模型** 中管理，不在这里。

硬件设置通过带修订号防护的 Harness 设置保存 worker 坐标。API 密钥通过现有的凭据服务写入；已保存的值从不读回编辑器。添加硬件从一个显示名称开始，再选择本地 FastVideo 服务器、现有的 SSH 别名，或兼容的 API 端点（包括托管的 GPU 服务）。地址从 Harness 主机解析，而不是从浏览器解析。稳定的 worker ID 由名称生成。高级字段公开 ID、凭据引用和远程 API 主机/端口。

“设备模型”读取展开设备自己的原生目录，并提供显式的加载/卸载控件；设备忙碌或模型未安装时控件禁用。目录读取失败时提供单独的重试，刷新只重读当前打开的那台设备。自定义权重必须在目标 worker 上向 FastVideo 注册。API 凭据需要兼容的模型端点；通用的 provider 协议需要相应的生成适配器。本页面不会把权重下载到浏览器，也不承诺与任意模型兼容。

## 组合

挂载 `@dv/hardware`、常规的 Harness 设置和凭据服务，以及一个生成 provider。DreamVerse bundle 包含这个浏览器配套组件。启动常规 `dsh` profile 之前，用 `pnpm --filter @dv/ui-hardware bundle` 构建它的客户端产物。

## 运行时不变量

不发布独立的不变量。Host 设置和凭据拥有持久值；本包是它们的 UI 消费方。组件测试覆盖密钥引用、被拒绝的编辑、忙碌 worker 的控件和模型生命周期操作。

## 连接现有的 RunPod Pod

选择 **Add hardware → RunPod Pod**，保存 RunPod 账户 API 密钥，然后选择 **Find my Pods**。选择 FastVideo 已在其上运行的公开 HTTP 端口。当该端点需要认证时，另行保存 FastVideo worker 密钥，然后选择 **Save and check**。账户密钥只用于列出 Pod；它从不作为 worker 凭据保存。此流程不会预置或启动付费 Pod。

## 模型体验

无，因为这些页面只编辑已保存的硬件 worker 和凭据，所有面向模型的内容都属于 `@dv/hardware` 和生成 provider。

#### KV Cache 影响

没有直接影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **没有权重下载或安装**：设备模型面板没有下载操作，因为不存在 worker 安装 API；自定义权重必须在目标 worker 上向 FastVideo 注册。
- **没有任意 provider 协议**：API 凭据需要兼容的模型端点，通用的 provider 协议需要自己的生成适配器。
- **没有预置**：RunPod 流程列出现有的 Pod，不会预置或启动付费 Pod。
