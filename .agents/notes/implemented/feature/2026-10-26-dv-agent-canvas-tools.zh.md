# Agent Note: DreamVerse agent 从打开的画布读取画布节点，并由宿主移动它们

Status: implemented

[English](2026-10-26-dv-agent-canvas-tools.md) | 中文

## 问题

用户请 DreamVerse agent 整理画布，例如“图片放左边，角色放中间，计划放右边”，会被拒绝：`dv_asset_place` 和 `dv_asset_unplace` 只能把素材放上画布或移出画布，没有工具能设置节点的位置（issue #87）。代码中的三个事实决定了移动节点的工具的形态。节点位置存放在 `CanvasLayoutStore`（`packages/dv/ui-canvas/src/layout.ts`）中，每个项目一个 JSON 文件，位于 `<项目文件夹>/.dreamverse/canvas-layout.json`，由 `@dv/ui-canvas` 宿主一半的路由 `POST /api/dv/canvas/layout` 写入。节点列表、默认位置和卡片高度来自 `packages/dv/ui-canvas/src/client/graph.ts` 的 `buildCanvasGraph`，它只在浏览器中运行，所以宿主不知道这些值。`CanvasView` 只在打开项目时读取一次布局，所以已打开的画布只有在收到通知时才会画出之后的写入。该 issue 还要求在可撤销的项目操作与视图状态之间为移动做出选择。

## 决定

`@dv/ui-canvas` 的宿主一半（`src/index.ts`，由 `tsconfig.host.json` 构建）注册 agent 工具 `dv_canvas_read` 和 `dv_canvas_move`，它不保存画布的副本。由另一个 agent 启动的 agent 发起的调用会立即失败，并告诉该 agent 把画布改动写进它的最终结果。否则宿主一半找到该 agent 的聊天 session 的项目，即文件夹为该 session 工作目录的 Workspace（`@dv/project/folder` 的 `workspaceOfSession`），两个工具都通过 `CanvasChannel`（`src/agent-channel.ts`）读取画布。在浏览器一半中，`CanvasViews`（`src/client/agent-canvas.ts`）按项目和聊天 session 记录已挂载的画布，并为每一对通过 `EventSource` 保持流式 Fetch 路由 `GET /api/dv/canvas/agent?project=<id>&session=<id>` 打开。宿主一半在该项目位于该 agent 的 session（`agent.session.id`）旁的每条已打开流上写一个 `read` 帧 `{ id, stream }`，由一条流的第一个已挂载画布根据它绘制的内容以 `{ id, stream, project, cards }` 调用 `POST /api/dv/canvas/agent/answer` 回答。读取 id 和流 id 都是随机 UUID，回答只有指向该读取所写入的流时才了结读取；其他回答得到 404。回答既不绘制也不保存任何东西。没有这样的流打开时，调用立即以 “No open canvas shows project <id>” 失败，不移动任何节点；Config `answerTimeoutMs`（默认 10000）只限制这次读取。

宿主一半把 `CanvasLayoutStore.read` 返回的位置叠加到回答的卡片上，因为画布可能还没有画出另一个标签页的拖拽。`planMove`（`src/canvas.ts`）拒绝重复列出的节点、未知节点，以及会与其他卡片相距不足 24 单位的被移动卡片。在写入之前被取消的调用不移动任何节点。随后宿主一半用 `CanvasLayoutStore.write` 只写入一次被移动的位置，并在该项目的每条已打开流上写一个 `moved` 帧 `{ project, positions }`，不论它位于哪个 session 旁。该项目在每个标签页中的每个已挂载画布都用 `place` 画出这次移动。`place` 还会把被移动的节点从未保存的自动位置和待保存的拖拽中移除，因此两者都不会覆盖 agent 设置的位置。

两条路由都是 `@dv/ui-canvas` 在 Connection 的 `/api` 通道上的精确 Fetch 路由，因此只接纳已认证的浏览器，`packages/dv/` 之外的包都不改动。Connection 的 HTTP 桥按到达顺序写出路由响应体的每个分块，并在断开连接时中止请求的 signal；流在这次中止时结束其响应体，宿主一半卸载时结束每条流。

移动是视图状态，和拖拽相同。它不写记录，`dv_proj_undo` 也不会撤销它；工具描述告诉 agent 改为把节点移回去。`scripts/dv-architecture.ts` 中的 `CORE_TOOL` 接纳 `dv_canvas_*`，因为这些工具名是 UI 核心源码中的字面量，而[适应度测试](../process/2026-10-17-dv-architecture-fitness-test.zh.md)的 R5 (f) 会检查这类字面量。

## 考虑过的替代方案

**写入记录的可撤销项目操作。** `dv_proj_undo` 将能撤销移动。它被否决，因为布局是视图状态，`CanvasLayoutStore` 从不把它写成记录，用户的拖拽也不写记录；agent 的移动与拖拽写入同一份布局。

**由已打开的画布规划、绘制并保存移动，然后回答。** 它被否决，因为宿主一半在该项目位于该 session 旁的每条已打开流上写 `read` 帧，所以该 session 的每个标签页和每个画布都会对同一次调用采取行动。两个画布可能都写入，第一个回答决定调用的结果，且可能与另一个画布所做的不一致；取消或超时还可能在某个画布已保存移动之后报告 “Nothing was moved”。

**由宿主一半自行构建画布图。** 它被否决，因为节点列表、默认位置和卡片高度只存在于浏览器中，宿主需要第二份 `buildCanvasGraph` 才能规划移动。

**`@deepseek-ai/dsh-api-remotes` 中的两个转发 harness 事件 `client-tool/call` 和 `client-tool/applied`。** 它们通过 `scopeTarget(agent, agent)` 到达调用方 agent 的 Client。它被否决，因为它为一个 DreamVerse 功能改动 harness 包（`packages/api/remotes`、`packages/core/scope`）。

**在 `@dv/api` 的 `/dv/events` 上推送 `moved`。** 它能为每个页面和项目省下一条 HTTP 连接。它被否决，因为该流只携带 `dvProject.subscribe` 的 Project 变化，布局不属于其中，而读取仍需要自己的流。

## 后果

agent 一次调用即可整理画布，该调用只写入一次布局，该项目每个已打开的画布无需重新加载就显示移动。调用需要该对话旁有一个已打开的、显示该对话项目的画布，位于另一个对话旁的该项目画布从不作答：中心显示时间线视图且没有打开画布标签页时，两个工具都会立即失败。子 agent 既不能读取也不能移动画布。聊天中显示原始工具名，因为 `@dv/ui-kit` 的 `DV_TOOL_LABELS` 没有 `dv_canvas_*` 行。

`@dv/ui-canvas` 是唯一一个带有注册工具的宿主一半的 UI 核心包。这个宿主一半拥有布局存储，所以移动不需要调用路由；在 `@dv/` 包中它只导入 `@dv/project/folder`，[分层](../architecture/2026-10-17-dv-architecture-layers.zh.md)规则允许 UI 核心包导入它。`@dv/api` 不需要知道画布节点的结构。每个页面在 `/dv/events` 之外为每个已打开的项目和聊天 session 多保持一条长连接 HTTP，它计入浏览器对每个主机六条 HTTP/1.1 连接的上限。

`packages/dv/ui-canvas/tests/tools.spec.ts` 通过两条路由覆盖宿主工具：该项目每个已打开画布都画出的一次写入、只到达调用方 session 旁画布的读取、已关闭的流、回答之前的取消或超时、在取消之前已开始的写入、保存的位置、被拒绝的子 agent，以及每种失败。`tests/canvas.spec.ts` 覆盖 `planMove` 和 wire 解析函数，`tests/agent-canvas.client.spec.ts` 覆盖 `CanvasViews`，`tests/canvas-view.client.spec.tsx` 覆盖不同项目的两个画布和两种覆盖竞争。`packages/dv/e2e/tests/stories/canvas-timeline.e2e.ts` 中的故事 “the agent reads the open canvas and moves two nodes” 检查两个已打开的页面都画出移动、没有页面写入它，并且它在重新加载后仍然保留。
