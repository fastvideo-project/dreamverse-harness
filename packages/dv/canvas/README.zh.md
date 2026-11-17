---
description: "DreamVerse 的画布组件：dvCanvasNodes 服务和 canvas 切片，即从记录重建的项目节点列表，含每个节点的 kind、版本和位置；canvas.node_position、canvas.node_remove 和 canvas.node_rename 操作及其智能体工具；以及生产者用来指名会产生节点的操作的注册。"
kind: "package-reference"
---

# @dv/canvas

[English](README.md) | 中文

## 概述

使用本包把项目画布上有什么作为项目的一部分保存下来。`canvas` 切片列出每个节点及其 kind、版本、位置和尺寸，并从记录重建，所以撤销、重做和历史覆盖节点的每次变化。重跑会加入被重跑版本所在的节点，该节点保留其名称。一条记录移动或调整一个节点的大小（`canvas.node_position`）、移除节点（`canvas.node_remove`）或重命名一个节点（`canvas.node_rename`）；智能体的工具 `dv_canvas_node_position`、`dv_canvas_node_remove` 和 `dv_canvas_node_rename` 无论画布是否打开都能用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project` 之后挂载插件，服务注入 `@dv/project`。服务没有配置。它向 `dvProject` 注册组件键 `canvas`、`canvas` 归约函数和操作 `canvas.node_position`、`canvas.node_remove` 与 `canvas.node_rename`，`dvProject` 把它们变成智能体工具 `dv_canvas_node_position`、`dv_canvas_node_remove` 和 `dv_canvas_node_rename`。`@dv/api` 注入 `dvCanvasNodes`，所以浏览器总能收到 `canvas` 切片。

```yaml
- id: dv-canvas
  name: '@dv/canvas'
```

| 操作 | 工具 | 输入和参数 | 产出 |
| --- | --- | --- | --- |
| `canvas.node_position` | `dv_canvas_node_position` | 参数 `node`（必填，一个节点 ID）、`x`、`y`、`width`、`height`；四者至少给一个；`width` 和 `height` 大于 0 | 无 |
| `canvas.node_remove` | `dv_canvas_node_remove` | 参数 `nodes`（必填，一个或多个节点 ID）；记录的 `report.removed` 保留每个被移除节点移除前的样子 | 无 |
| `canvas.node_rename` | `dv_canvas_node_rename` | 参数 `node`（必填，一个节点 ID）和 `name`（必填，字符串或 null；去掉首尾空白，换行变成空格，最多 80 个字符；为空或 null 时清除名称） | 无 |

对每个调用方，前置条件在写任何记录之前拒绝当前状态中没有的节点（消息列出节点 ID），以及 `x`、`y`、`width`、`height` 一个都没给的调用。它不检查与其他节点的重叠。调用没给的字段保持原值。`canvas.node_remove` 的前置条件在写任何记录之前拒绝空的 `nodes` 和当前状态中没有的节点；每条消息都以 `Nothing was removed.` 结尾。被移除节点的版本、这些版本的素材以及对它们的每个引用都保留：镜头输入、时间线片段、对话提及、`based_on` 和素材库。最新版本处于等待或运行中的节点也可以移除；它的渲染继续，产出进入素材库。`canvas.node_rename` 的前置条件拒绝未知节点、超过 80 个字符的名称、给 maker 指名了 `renameOperation` 的 kind 的节点起的名称，以及与节点当前名称相同的名称。这样的节点的卡片显示其条目的名称，例如 `timeline` 节点显示时间线的名称，拒绝消息指出 `renameOperation` 对应的工具。名称只设置画布标签：角色、场景或风格的名称、文本节点的路径、素材的名称和文件都保持不变，也没有记录变为过期。名称不必唯一，因为节点 ID 区分节点。

生产者在 `ctx.inject(['dvCanvasNodes'], …)` 里指名其记录会产生节点的操作，所以它不依赖本包也能加载，并在画布加载时重新注册：

| 方法 | 注册 | 使用者 |
| --- | --- | --- |
| `registerMaker({operations, kind, column, makes?, renameOperation?})` | `operations` 的记录在布局列 `column`（最左为 0）产生 `kind` 节点；`makes(record)` 收到记录的 `params` 和 `status`，返回 false 时跳过该记录；`renameOperation` 指名重命名 `kind` 节点所显示条目的操作，这样的节点没有自己的名称 | `@dv/generation` 的 `defineGeneration`（`shot`、`image`、`audio`，第 2 列），`@dv/reference-kit` 的 `defineReference`（`<k>.create`，kind `<k>`，第 0 列），`@dv/text-node`（`textnode.write`，kind `text`，第 0 列），`@dv/asset-pool`（已完成且带 `place: true` 的 `asset.import`，kind `asset`，第 0 列），`@dv/timeline`（已完成的 `timeline.place`，kind `timeline`，第 3 列，`renameOperation` 为 `timeline.rename`） |
| `registerPlacement({place, kind, column})` | 已完成的 `place` 记录为每个还没有节点显示的输入素材添加一个 `kind` 节点；`canvas.node_remove` 像移除其他节点一样移除这样的节点 | `@dv/asset-pool`（`asset.place`，kind `asset`，第 0 列） |

每个方法返回其注册的注销函数。某个 maker 或 placement 已指名的操作会抛出 `invalid_params`。`kind` 是浏览器半边绘制该节点所用的节点类型键：UI 插件注册一个 `type` 为同一字符串的 `@dv/ui-canvas/contract` `NodeType`，没有对应类型的 kind 画成普通卡片。

切片 `state.components.canvas` 包含按节点 ID 索引的 `nodes`、`order`（按创建顺序的节点 ID）和 `assets`（显示每个素材的节点）。一个节点包含 `kind`；`name`（null：卡片显示其节点类型计算出的标题）；`versions`，节点显示的记录，从旧到新，卡片上是最新的；`asset`，由 placement 产生的节点才有；以及 `position`，以画布单位计、y 向下增长的 `{x, y, width, height}`，其中 `x` 和 `y` 是节点的左上角（其 20 单位标题行的顶边），`width` 和 `height` 是标题行下方的画框，为 null 时取节点类型的默认尺寸。节点的 ID 是创建它的记录的 ID；一次放置多个素材时，第二个及之后的节点取记录 ID 加 `.2`、`.3` 等。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

归约函数从旧到新读取直到当前位置的链上每条记录，并应用第一条匹配的规则。(1) `based_on` 是节点 N 某个版本的记录成为 N 的最新版本，除非其操作是画布自己的操作（`canvas.node_position`、`canvas.node_remove`、`canvas.node_rename`）、某个 placement 的操作，或 kind 与 N 不同的 maker 的操作；这样的记录继续匹配后面的规则。(2) 某个 maker 指名的操作、且 `makes` 接受的记录，在其列的第一个空行创建一个该 maker kind 的节点，使用默认尺寸。(3) 已完成的 placement `place` 记录为每个还没有节点显示的输入素材创建一个节点。(4) 已完成的 `canvas.node_remove` 记录从 `nodes`、`order` 和 `assets` 中删除其 `nodes` 参数指名的节点；撤销会重放不含该记录的链，所以每个节点带着名称、版本和位置回来。(5) 已完成的 `canvas.node_position` 记录在切片持有的节点上设置其参数给出的位置字段。(6) 已完成的 `canvas.node_rename` 记录设置切片持有的节点的名称；名称为空或 null 时清除它，而 maker 指名了 `renameOperation` 的 kind 的节点，名称保持为 null。(7) 其他记录保持切片不变。规则 1 和 2 接受任何状态的记录，所以等待中、运行中或失败的版本在节点上显示其状态；失败的渲染仍是一个版本，带有它的重试动作。`assets` 把 placement 节点放置的素材和每个节点最新版本的产出映射到该节点。

生产者无需画布字段即可设置 `based_on`。编辑器的提示词修改、重跑和重试以被重跑的版本作为 `based_on`。调用方没有给出 `based_on` 时，`@dv/project` 的 `OperationSpec.basedOn` 填写它：`@dv/reference-kit` 的 `<k>.update` 以及 `@dv/text-node` 的 `textnode.write` 和 `textnode.edit` 指名该条目最新版本的记录，所以角色、场景、风格或文本路径的每个版本都加入同一个节点。`based_on` 指名的记录不在任何节点中时，例如被移除节点的某个版本，该记录落到规则 2 并产生一个新节点。

新节点取其列中第一个没有节点覆盖其格子的行：一列宽 240 单位、一行高 200 单位，默认尺寸的节点在其角上覆盖一个格子，因为只有浏览器知道节点类型的默认尺寸。切片在每次读取时从记录计算，所以它跟随该次读取时已加载的注册。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvCanvasNodes`：组件、归约函数、`canvas.node_position`、`canvas.node_remove`、`canvas.node_rename`、`registerMaker` 和 `registerPlacement` |
| [`src/reducer.ts`](src/reducer.ts) | 带七条规则的 `canvas` 归约函数、名称规则、空行放置和智能体摘要 |
| [`src/types.ts`](src/types.ts) | `NodeId`、`NodePosition`、`CanvasNode`、`CanvasState`、`NodeMaker`、`AssetPlacement` 和 `canvas` 切片声明 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/project`](../project/README.zh.md)：归约函数、`based_on`、`OperationSpec.basedOn`、撤销，以及每个操作的智能体工具。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md)：绘制节点列表、为拖动或调整大小写入 `canvas.node_position`、为 从画布移除 / Remove from canvas 写入 `canvas.node_remove`、为重命名写入 `canvas.node_rename` 的浏览器画布。
- [`@dv/asset-pool`](../asset-pool/README.zh.md)：素材节点以及操作 `asset.place`。
- [画布节点列表](../../../.agents/notes/implemented/architecture/2026-11-08-dv-canvas-node-list.zh.md)：为什么节点列表是宿主基础包，以及为什么移动是记录。

-----

<a id="model-experience"></a>
## 模型体验

### `dv_canvas_node_position` 工具定义

#### 模型看到什么

一个工具 `dv_canvas_node_position`，格式与 `@dv/project` 给每个操作工具的一样，带共享参数 `reason`、`supersedes` 和 `based_on`，没有 `inputs`。描述和参数描述见下文。

##### dv_canvas_node_position 描述

```markdown
Move or resize one canvas node: give the new x and y of the top-left corner of the node (the top of its 20-unit caption), and the new width and height of its frame, which sits below the caption; canvas units, y grows downward. Fields you leave out keep their value. Works whether or not the user has a canvas open, and the user sees the change at once. The change is a step of the project history, so dv_proj_undo reverts it. dv_proj_state lists the nodes under canvas.
```

##### dv_canvas_node_position 参数描述

```markdown
- node: The node ID, as dv_proj_state or dv_canvas_read lists it.
- x: The new left edge of the node.
- y: The new top edge of the node.
- width: The new frame width; more than 0.
- height: The new frame height; more than 0.
```

#### Token 影响

约 380 个 token，插件挂载期间固定不变；其中约 200 个是 `@dv/project` 的共享参数。

#### KV Cache 影响

该定义位于每次智能体请求中固定的工具部分；挂载或移除插件会改变工具列表，使缓存前缀从工具部分起失效。

### `dv_canvas_node_position` 结果

#### 模型看到什么

一次调用返回一个文本块：`done <record>: moved node <id>`，调用给出 `width` 或 `height` 时为 `resized node <id>`，以及参数。未知节点以 `The canvas has no node <id>. Its nodes are: <ids>.` 失败，没给任何字段的调用以 `Give at least one of x, y, width and height.` 失败，尺寸为 0 或更小时以 `width must be more than 0.` 或 `height must be more than 0.` 失败。用户的移动或调整大小以项目更新行的形式到达智能体，例如 `- done <record> (user on canvas): moved node <id>`。

#### Token 影响

每次调用约 40 个 token。

#### KV Cache 影响

结果在调用之后追加到对话中；已缓存的前缀保持不变。

### `dv_canvas_node_remove` 工具定义

#### 模型看到什么

一个工具 `dv_canvas_node_remove`，格式相同，带共享参数 `reason`、`supersedes` 和 `based_on`，没有 `inputs`。描述和参数描述见下文。

##### dv_canvas_node_remove 描述

```markdown
Remove nodes from the canvas. Each node goes with all its versions and the edges to and from it. Its assets stay in the asset pool, and every use of them stays: shot inputs, timeline clips, and nodes made from its outputs. A node that is still rendering can be removed; its output goes to the asset pool. A later step based on a version of a removed node makes a new node. Works whether or not the user has a canvas open. The removal is a step of the project history, so dv_proj_undo brings the nodes back with their versions and positions.
```

##### dv_canvas_node_remove 参数描述

```markdown
- nodes: The node IDs to remove, as dv_proj_state or dv_canvas_read lists them.
```

#### Token 影响

约 330 个 token，插件挂载期间固定不变；其中约 200 个是 `@dv/project` 的共享参数。

#### KV Cache 影响

该定义位于每次智能体请求中固定的工具部分；挂载或移除插件会改变工具列表，使缓存前缀从工具部分起失效。

### `dv_canvas_node_rename` 工具定义

#### 模型看到什么

一个工具 `dv_canvas_node_rename`，格式相同，带共享参数 `reason`、`supersedes` 和 `based_on`，没有 `inputs`。

##### dv_canvas_node_rename 描述

```markdown
Rename one canvas node: the name replaces the title on its card, in dv_canvas_read and in dv_proj_state. The name is trimmed, line breaks become spaces, and it has at most 80 characters; an empty or null name clears it, so the card shows the title its type computes again. The name is only the canvas label: the node keeps its id, versions, assets, files, text path and character, location or style name, and nothing becomes stale. A node that shows an item with a name of its own, such as a timeline, takes no name here: the call is refused and names the tool that renames the item. Names need not be unique. Works whether or not the user has a canvas open. The change is a step of the project history, so dv_proj_undo reverts it.
```

##### dv_canvas_node_rename 参数描述

```markdown
- node: The node ID, as dv_proj_state or dv_canvas_read lists it.
- name: The new name; empty or null clears it.
```

#### Token 影响

约 360 个 token，插件挂载期间固定不变；其中约 200 个是 `@dv/project` 的共享参数。

#### KV Cache 影响

该定义位于每次智能体请求中固定的工具部分；挂载或移除插件会改变工具列表，使缓存前缀从工具部分起失效。

### `dv_canvas_node_remove` 结果

#### 模型看到什么

一次调用返回一个文本块：`done <record>: removed node <ids> from the canvas`、参数，以及 `report: {"removed": {<id>: <node>}}`，即每个被移除节点移除前的样子，含 `kind`、`name`、`versions` 和 `position`。指名画布中没有的节点的调用以 `The canvas has no node <ids>; its nodes are: <ids>. Nothing was removed.` 失败，`nodes` 为空的调用以 `Name at least one node. Nothing was removed.` 失败。用户的移除以项目更新行的形式到达智能体，例如 `- done <record> (user on canvas): removed node <id> from the canvas`。

#### Token 影响

每次调用约 60 个 token，报告中每个被移除的节点另加约 60 个。

#### KV Cache 影响

结果在调用之后追加到对话中；已缓存的前缀保持不变。

### `dv_canvas_node_rename` 结果

#### 模型看到什么

一次调用返回一个文本块：`done <record>: renamed node <id> to "<name>"`，名称为空或 null 时为 `cleared the name of node <id>`，以及参数。未知节点的失败与 `dv_canvas_node_position` 相同，过长的名称以 `The name can have at most 80 characters; this one has <n>.` 失败，给 maker 指名了 `renameOperation` 的 kind 的节点起名称以 `Node <id> shows the name of its <kind>; rename the <kind> with <tool>.` 失败，对 `timeline` 节点，消息以 `rename the timeline with dv_timeline_rename.` 结尾，与当前名称相同时以 `The node is already named "<name>".` 失败，没有名称的节点则以 `The node has no name to clear.` 失败。用户的重命名以项目更新行的形式到达智能体，例如 `- done <record> (user on canvas): renamed node <id> to "<name>"`。

#### Token 影响

每次调用约 40 个 token。

#### KV Cache 影响

结果在调用之后追加到对话中；已缓存的前缀保持不变。

### 项目摘要的 `canvas` 字段

#### 模型看到什么

`dv_proj_state` 和项目状态消息给出的项目摘要带有 `canvas`：每个节点一项，按创建顺序，`{node, kind, name, shown, x, y, width, height}`，其中 `name` 是用户或智能体给出的名称，为 null 时表示节点类型计算出的标题，`shown` 是最新版本的记录，为 null 的 `width` 或 `height` 是节点类型的默认尺寸。

#### Token 影响

每个节点约 40 个 token。

#### KV Cache 影响

该字段属于工具结果或项目状态消息，二者都追加到对话中；之后的移动只改变之后的摘要，所以已缓存的前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **新节点可能与高卡片重叠**：宿主按名义上 240 × 200 的格子放置新节点，因为只有浏览器知道每种节点类型的默认尺寸，所以高于一行的默认卡片可能与下一行放置的节点重叠，直到用户或智能体移动它。
- **移动不检查重叠**：`canvas.node_position` 接受覆盖另一个节点的位置，因为宿主只有在调整大小之后才知道节点的尺寸。
- **含 `asset.unplace` 记录的项目**：该操作已删除，所以归约函数跳过旧版本写下的这种记录，它移除过的素材节点会重新显示，直到用户或智能体用 `canvas.node_remove` 移除它。
- **节点跟随已加载的生产者**：某个生产者未加载时，它的记录不产生节点，这些节点的移动也不起作用，直到它再次加载。
