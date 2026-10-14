# DreamVerse Harness

[English](README.md) | 中文

<p align="center"><img src="packages/dreamverse-ui/kit/public/logo.svg" alt="DreamVerse 标志" width="200"></p>

DreamVerse Harness 是面向 AI 视频制作的 agent harness（智能体框架）。你在对话中描述一段视频，视频智能体把请求变成角色、分镜计划、渲染出的镜头和剪辑好的时间线。你和智能体做的每一次修改都是同一个项目历史中的一步，因此你可以检查、撤销和重做双方的工作。

智能体在一台 GPU 视频服务器上渲染镜头，该服务器用 [FastVideo](https://github.com/hao-ai-lab/FastVideo) 运行 FastH3 模型。harness 运行智能体、存储每个项目，并提供 Web 界面：你在其中对话、在画布上摆放素材、编辑时间线。

DreamVerse Harness 是研究原型。**会出现破坏兼容性的变更。** 运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="features"></a>

## 功能

- **对话中的视频智能体。** 智能体遵循 `video-directing` skill（技能）：它编写设定库和分镜计划，请你确认计划，渲染已批准的镜头，再把镜头组装成时间线。预计 GPU 时间超过设定上限的渲染会等待你在对话中提出请求。
- **两种生成方式。** `ref2va` 由一段提示词、一张或多张参考图和一张可选的首帧渲染镜头；镜头可以从上一个镜头的最后一张静帧接续。`t2va` 只由一段提示词渲染镜头。两种生成方式都返回一段带音频的视频及其最后一张静帧。
- **设定库。** 角色、场景和风格是带版本的条目，分镜计划会引用它们。
- **分镜计划。** 一个计划列出各镜头的生成方式、提示词、参考图和时长。批准某个计划版次时，只渲染新增或改动的镜头，未改动的镜头复用已有版本。
- **项目画布。** 画布把素材和设定库条目显示为卡片。你可以从卡片为镜头渲染一个新版本，或替换参考图。
- **时间线编辑器。** 插入、移动、拆分、裁剪和替换片段，并用 ffmpeg 把一条时间线导出为一个视频文件。
- **素材库。** 导入图片和视频，从视频中截取静帧，并在对话消息中用 `@` 提及任意素材或项目条目。
- **你和智能体共用一份历史。** 历史面板按时间顺序列出每一步。撤销（Ctrl+Z）、重做（Shift+Ctrl+Z）和"回到某一步"对你的修改和智能体的修改作用相同。
- **项目和对话。** 导航栏列出各项目及每个项目的对话；入口页显示最近的项目和模板。
- **MCP 工具。** 打开 MCP 插件后，探索区提供预设的 Blender 和 ComfyUI MCP 服务器，一步即可添加。

<a id="run"></a>

## 运行

<a id="prerequisites"></a>

### 前置条件

- Node.js `^22.19` 或 `>=24`，以及 `pnpm`。
- `ffmpeg` 和 `ffprobe`。
- 一台 GPU 视频服务器：带 `streaming_v2` API 的 FastVideo，为 `ref2va` 服务 `MiniMaxAI/MiniMax-H3`。[`scripts/dreamverse/h3-ref2va.serve.yaml`](scripts/dreamverse/h3-ref2va.serve.yaml) 中的配置使用 4 张 GPU。另一台服务 `FastVideo/FastVideo-FastH3-8-Step-V2` 的服务器可启用 `t2va`。
- 一个供智能体使用的 OpenAI 兼容对话模型端点，例如服务 DeepSeek V4.1 的 SGLang 服务器，或一个 Groq API key。

<a id="start-the-video-server"></a>

### 启动视频服务器

在 GPU 机器上，用 DreamVerse 的服务器配置启动 FastVideo。服务器监听 `127.0.0.1:8029`。

```sh
fastvideo serve --config scripts/dreamverse/h3-ref2va.serve.yaml
```

[`scripts/dreamverse/launch-generation.sh`](scripts/dreamverse/launch-generation.sh) 用开发集群上的 FastVideo 检出目录和 ffmpeg 路径运行同一条命令。

<a id="run-from-source"></a>

### 启动 DreamVerse

本仓库是私有仓库，克隆前需要一个有 `Davids048/dreamverse-harness` 访问权限的 GitHub 账号。构建仓库，把 harness 指向视频服务器和智能体模型，然后启动 Web 界面：

```sh
git clone https://github.com/Davids048/dreamverse-harness.git
cd dreamverse-harness
pnpm install
pnpm run build

export DV_BACKEND_URL=http://127.0.0.1:8029
export DV_DEEPSEEK_BASE_URL=http://<sglang host>:30000/v1
export DV_FFMPEG="$(command -v ffmpeg)"

scripts/video-harness/launch.sh web
```

[`scripts/video-harness/launch.sh`](scripts/video-harness/launch.sh) 在 `DSH_HOME`（默认 `~/.local/state/dsh-video-harness`）下创建 `video-harness` profile，并在端口 `8092` 上启动 Web 界面。打开该命令打印的 URL。如需从另一台机器访问页面，请加上 `--trusted-host <public host>`。

如需不经 Web 界面运行一个任务并打印结果，请使用 headless profile：

```sh
scripts/video-harness/launch.sh headless "Make a video of this person dancing" --session-id demo
```

<a id="configuration"></a>

### 配置

启动脚本和 [`@dv/bundle` 配置](packages/bundle/dv/cordis.patch.yml)读取以下环境变量：

| 变量                                                         | 用途                                                                                  | 默认值                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------- |
| `DV_BACKEND_URL`                                             | `ref2va` 生成方式的 FastVideo 服务器。                                                | `http://127.0.0.1:8029`                   |
| `DV_T2VA_BACKEND_URL`                                        | `t2va` 生成方式的 FastVideo 服务器。不设置时，智能体没有 `t2va` 渲染工具。            | 不设置                                    |
| `DV_PORT`                                                    | Web 界面的端口。                                                                      | `8092`                                    |
| `DV_STATE_ROOT`                                              | 存放素材、项目、对话绑定和视图状态的目录。                                            | `~/.local/state/dv`                       |
| `DV_FFMPEG`、`DV_FFPROBE`                                    | 媒体程序的路径。                                                                      | 开发集群上的 ffmpeg 路径、`ffprobe`       |
| `DV_PUBLIC_URL`                                              | 对话卡片中素材链接所用的公开 origin。                                                 | 空                                        |
| `DV_AGENT_PROVIDER`、`DV_AGENT_MODEL`、`DV_AGENT_REASONING`  | 智能体的模型路由。设为 `groq` 和 `qwen/qwen3.8-27b` 即使用 Groq。                     | `deepseek-local`、`deepseek-v4.1`、`low`  |
| `DV_DEEPSEEK_BASE_URL`、`DV_DEEPSEEK_API_KEY`                | `deepseek-local` 路由的 OpenAI 兼容端点和 bearer token。                              | 开发集群上的地址、`none`                  |
| `DV_AGENT_VISION`                                            | 智能体模型不能读图时设为 `0`。                                                        | 开启图片输入                              |
| `GROQ_API_KEY`                                               | Groq 路由的 key。启动脚本从 `DV_ENV_FILE` 读取它。                                    | 不设置                                    |

[`@dv/bundle` README](packages/bundle/dv/README.zh.md) 详细说明每个变量。

<a id="architecture"></a>

## 架构

DreamVerse Harness 构建于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 之上；DeepSeek Harness 是一个每项能力都是 [Cordis](https://github.com/cordiverse/cordis) 插件的 agent harness。DeepSeek Harness 核心提供 agent loop（智能体循环）、会话、skill、工具、模型提供方和 Web 客户端。[`packages/dv/`](packages/dv) 下的 DreamVerse 包以插件形式加入视频制作能力，[`@dv/bundle`](packages/bundle/dv/README.zh.md) profile 层把它们组合到核心之上。

```text
views          @dv/ui-shell  @dv/ui-canvas  @dv/ui-timeline  @dv/ui-asset-pool  @dv/ui-composer  @dv/ui-history
  │ HTTP: /api/dv/…, /dv/events
  ▼
API            @dv/api              routes that read project state and run operations as the user
  │
  ▼
registry       @dv/project          operation records, history, undo and redo, agent tools
  ▲
  │ registerOperation
components     @dv/asset-pool  @dv/story-bible  @dv/shot-plan  @dv/shot-render
               @dv/timeline  @dv/inspector  @dv/chat-references
  │ ctx.dvRef2va, ctx.dvT2va
  ▼
render modes   @dv/render-modes     one Service Definition per render mode
  ▲
  │ implements
providers      @dv/fasth3-ref2va  @dv/fasth3-t2va      HTTP clients of the FastVideo server
```

- **`@dv/project` 负责项目的每一次修改。** 每个组件向 `@dv/project` 注册自己的操作。每个操作既是一个智能体工具（`dv_<operation>`），也是 Web 界面中的一个动作，每次调用都成为项目 `records.jsonl` 文件中的一条记录。项目状态、历史面板以及撤销和重做都由这些记录推导。
- **每种生成方式是一个能力 seam。** `@dv/render-modes` 定义渲染服务，两个 FastH3 包针对 FastVideo 服务器实现这些服务，`@dv/shot-render` 只为部署所服务的生成方式注册渲染工具。换一个视频模型只需要换一个 provider 包。
- **视图通过 `@dv/api` 读写。** 画布、时间线和历史面板通过 HTTP 路由运行操作，并随 `/dv/events` 事件流刷新，因此智能体做出的修改会即时出现在视图中。

一个请求按以下步骤流经系统：

1. 你发送一条对话消息。`@dv/chat-references` 解析消息提及的素材和项目条目。
2. 智能体用 `dv_bible_*` 和 `dv_plan_create` 工具编写设定库条目和分镜计划，并请你确认计划。
3. 你确认后，`dv_plan_approve` 为每个新增或改动的镜头排定一次渲染，并排定一次时间线更新。
4. 每次渲染调用 FastVideo 服务器，并存储该版本：视频及其最后一张静帧。
5. `@dv/api` 在 `/dv/events` 上推送这次修改，画布、时间线和历史面板显示新的状态。

[DreamVerse 包页面](docs/subsystems/video-harness.zh.md)定义操作记录、历史规则、确认机制和完整术语表。

<a id="repository-layout"></a>

## 仓库结构

| 路径                                                 | 内容                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| [`packages/dv/`](packages/dv)                        | DreamVerse 组件、生成方式、provider、API 和界面插件。                   |
| [`packages/bundle/dv/`](packages/bundle/dv)          | `@dv/bundle` profile 层和 `video-directing` skill。                     |
| [`scripts/video-harness/`](scripts/video-harness)    | profile 创建脚本和启动脚本。                                            |
| [`scripts/dreamverse/`](scripts/dreamverse)          | FastVideo 服务器配置和启动脚本。                                        |
| `packages/dreamverse/`、`packages/dreamverse-ui/`    | 较早的 DreamVerse 原型，渲染流程固定。                                  |
| 其他 `packages/` 包组、`apps/`、`vendor/`            | DeepSeek Harness 核心、应用和 vendored Cordis。                         |

<a id="development"></a>

## 开发

DeepSeek Harness 的[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)适用于本仓库。面向 agent：请遵循 [AGENTS.md](AGENTS.md)。贡献规则见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

<a id="license"></a>

## 许可证

[MIT](LICENSE)。DreamVerse Harness 构建于 DeepSeek Harness 之上，DeepSeek Harness 由 DeepSeek 以 MIT 许可证发布。

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
