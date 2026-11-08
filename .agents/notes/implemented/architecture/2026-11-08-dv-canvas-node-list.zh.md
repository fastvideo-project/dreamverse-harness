# Agent Note: DreamVerse 画布节点列表是从记录重建的宿主基础包

Status: implemented

[English](2026-11-08-dv-canvas-node-list.md) | 中文

## 问题

DreamVerse 画布曾为每条记录画一个节点。浏览器中的 `buildCanvasGraph` 按记录的 `based_on` 谱系分组，所以每次重跑、重试或修改提示词都会在被修改的节点旁边再加一个节点，长时间的会话让画布堆满同一个镜头的近似副本。节点列表只存在于浏览器中：宿主说不出项目有哪些节点，智能体只有在画布打开时才能读取它们（`dv_canvas_read`），它的 `dv_canvas_move` 也需要打开的画布才知道有哪些节点。节点的位置和尺寸存放在记录之外的 `<项目文件夹>/.dreamverse/canvas-layout.json`，所以撤销无法还原拖动或调整大小，历史不列出它们，智能体的移动也不是项目历史中的一步。

## 决策

新的宿主基础包 [`@dv/canvas`](../../../../packages/dv/canvas/README.zh.md)（服务 `dvCanvasNodes`，组件键 `canvas`）持有节点列表。它的 `canvas` 切片包含按节点 ID 索引的 `nodes`、`order` 和 `assets`（显示每个素材的节点）。一个节点包含 `kind`、`name`、`versions`（记录 ID，从旧到新；卡片显示最新的）、放置节点所放置的 `asset`，以及 `position` `{x, y, width, height}`，尺寸为 null 时取节点类型的默认尺寸。节点的 ID 是创建它的记录的 ID；一次放置多个素材时，之后的节点取 `<record>.2`、`<record>.3`。

归约函数（`packages/dv/canvas/src/reducer.ts`）从旧到新读取直到当前位置的链，并应用第一条匹配的规则：(1) `based_on` 是节点 N 某个版本的记录成为 N 的最新版本；(2) 某个 maker 注册的操作的记录在其列的第一个空行创建一个该 kind 的节点；(3) 已完成的 placement `place` 记录为每个还没有节点显示的输入素材创建一个节点；(4) 已完成的 placement `unplace` 记录删除该 placement 中其输入素材的节点；(5) 已完成的 `canvas.node_position` 记录设置它给出的位置字段；(6) 其他记录保持切片不变。规则 1 和 2 接受任何状态的记录，所以失败的渲染仍是一个版本，带有它的重试动作。`based_on` 是记录的核心字段，所以生产者无需画布字段：编辑器的提示词修改、重跑和重试传入它；调用方没有给出时，`@dv/project` 的 `OperationSpec.basedOn` 为 `@dv/reference-kit` 的 `<k>.update` 和 `@dv/text-node` 的写入填写它。

生产者在 `ctx.inject(['dvCanvasNodes'], …)` 里向服务注册，所以每个生产者不依赖画布也能加载：`registerMaker({operations, kind, column, makes?})` 用于 `defineGeneration`（`shot`、`image`、`audio`）、`defineReference`（`<k>.create`）、`@dv/text-node`（`textnode.write`）和 `@dv/asset-pool`（带 `place: true` 的 `asset.import`）；`registerPlacement({place, unplace, kind, column})` 用于 `asset.place` 和 `asset.unplace`，`@dv/asset-pool` 只在画布加载期间注册这两个操作。[`scripts/dv-architecture.ts`](../../../../scripts/dv-architecture.ts) 的规则 R4 只允许宿主包指名自己键下的操作，所以 `@dv/canvas` 只从这些注册中读取操作名。宿主和浏览器约定同一个字符串，即节点类型键：生产者的 `kind` 等于 UI 插件 `NodeType` 的 `type`，就像 React Flow 以 `nodeTypes` 为键、tldraw 为每种形状类型注册一个 `ShapeUtil`、Jupyter 按 MIME 类型选择渲染器一样。没有已注册类型的 kind 画成普通卡片。

移动是记录。[`@dv/ui-canvas`](../../../../packages/dv/ui-canvas/README.zh.md) 中的拖动或角把手调整大小在手势结束时写一条 `canvas.node_position` 记录，`dvProject` 把该操作变成智能体工具 `dv_canvas_node_position`，没有打开的画布也能用。历史通过 `@dv/ui-history` 可选的 `HistoryRow.label` 把这些行标为 移动节点 / Moved “{title}” 和 调整大小 / Resized “{title}”。归约函数的 `agentSummary` 把 `canvas`（节点、kind、名称、显示的版本、位置）加入项目摘要。`canvas-layout.json` 只保存视口，它是视图状态：撤销不会平移或缩放。`dv_canvas_move` 及其 `moved` 流帧已删除；`dv_canvas_read` 报告以节点 ID 为键、带 `versions` 和 `shown` 的卡片，因为只有浏览器知道每种类型的默认尺寸。节点列表只来自已记录的记录，智能体通过结果已记录的工具读取它，所以"模型可见 ⟺ 已记录"规则成立，无需新的 `SessionEventMap` 成员。

## 曾考虑的替代方案

**由 `@dv/ui-canvas` 持有节点列表。** 列表必须在没有打开画布时也能更新，例如智能体渲染时，所以归约函数和操作必须在宿主上运行。`@dv/ui-canvas` 是 UI 核心，只能值导入内核的 `@dv/project/grammar` 和 `@dv/project/folder`（`scripts/dv-architecture.ts` 中的 `importAllowed`，规则 R7 (a)），所以它无法注册归约函数或操作。

**把位置留在 `canvas-layout.json` 中。** 该文件位于记录之外，所以撤销、重做和历史无法还原或列出移动，智能体的移动也需要某个 UI 包的宿主半边来写入。每次手势一条记录的代价是每次拖动在 `records.jsonl` 中多一行，并把每次移动放进历史列表，这正是用户要求的行为。

**在生成工具上增加 `node` 参数。** 智能体会指名渲染加入的节点。它被否决，因为 `based_on` 已经把一个版本连到它所修改的记录，每个调用方都已设置它，而第二个链接可能与它不一致。

**保留浏览器按 `based_on` 谱系分组。** `buildCanvasGraph` 可以为每个谱系组画一个节点。它被否决，因为该分组为每次重跑画一个节点，宿主仍然不知道任何节点，没有画布的智能体和撤销都无法触及这些节点。

## 后果

**设计带来的好处。** 重跑、重试或修改提示词会给同一个节点添加一个版本；卡片显示最新版本，带 v{n} 和错开的画框，编辑器的版本条显示较早的版本。每次移动和调整大小都是撤销能还原、历史能命名的一步。智能体在 `dv_proj_state` 中读取节点，并在没有打开画布时移动它们。

**付出的代价。** 宿主按名义上 240 × 200 的格子放置新节点，因为只有浏览器知道类型的默认尺寸，所以高的默认卡片可能与下一行放置的节点重叠，直到有人移动它；出于同样原因，`canvas.node_position` 不拒绝重叠的位置。每次拖动增加一条记录。未加载的生产者不产生节点，其节点的移动也不起作用，直到它再次加载，因为切片在每次读取时从记录和已加载的注册计算。`@dv/ui-canvas/contract` 的 `NodeType` 契约去掉了 `claimed`、`entries`、`column` 和 `deepenOn`，`dv.canvas.editor.claimed` 插槽已删除，所以每种节点类型通过一个 `entry(node)` 和一个编辑器插槽绘制。`@dv/ui-shot-render` 的节点类型键是 `shot`（标签 镜头 / Shot），`@dv/ui-text-node` 的是 `text`，以等于宿主的 kind。

**验证。** `packages/dv/canvas/tests/reducer.spec.ts` 覆盖每条归约规则、空行放置、重跑的重跑加入第一个节点、撤销重放恢复较早的位置，以及摘要字段；`packages/dv/canvas/tests/canvas.spec.ts` 通过 Loader 启动服务，覆盖重跑留在同一节点、节点随其 maker 离开、没有打开画布时的 `dv_canvas_node_position` 及其撤销、各种拒绝，以及卸载时的移除。`packages/dv/e2e/tests/stories/canvas-timeline.e2e.ts` 的节点列表故事检查一个节点两个版本、撤销能还原的拖动和调整大小，以及没有打开画布时智能体的移动。dv-architecture 门检查包的层级和规则 R3、R4、R7。
