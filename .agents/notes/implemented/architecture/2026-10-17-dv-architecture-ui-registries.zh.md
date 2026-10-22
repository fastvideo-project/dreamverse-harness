# Agent Note: DreamVerse UI 注册表——UI 核心绘制 UI 插件注册的内容

Status: implemented

[English](2026-10-17-dv-architecture-ui-registries.md) | 中文

## 问题

共用的浏览器端包直接点名插件名词，因此一个插件的界面无法单独添加或移除。`@dv/ui-canvas` 通过 `BibleKind` 和 `bibleItems`（`ui-canvas/src/client/graph.ts`）绘制故事设定节点，持有分镜计划编辑器（`PlanHeader`、`PlanShots`），并从 `@dv/ui-asset-pool` 深导入 `AssetsPanel` 和 `Preview`。`@dv/ui-history` 通过 `scheduledBy` 把渲染折叠在一次批准之下，而 `scheduledBy` 读取 `plan.approve` 的报告；它还在一个带 `plan.*` 分支的 `switch` 中为记录命名。`@dv/ui-composer` 读取 `state.components.timeline` 和 `state.components.bible` 来构建 `@` 菜单。`@dv/ui-shell` 深导入画布视图和时间线视图（`ui-shell/src/client/views.ts`）。`@dv/ui-kit` 把 `RENDER_OPERATION = 'shot.render'` 固定为唯一一个其记录算作版本（take）的操作。添加一个引用名词要改动 `ui-canvas`、`ui-history`、`ui-composer` 和 `ui-kit`；一个图像或音频操作在 kit 学会它的名字之前画不出任何版本。

## 决策

DreamVerse 的浏览器端分为 UI 核心和 UI 插件；[分层](2026-10-17-dv-architecture-layers.zh.md) 列出每一层的包和允许的导入。UI 核心是 `@dv/ui-kit`、`@dv/ui-canvas`、`@dv/ui-history`、`@dv/ui-shell` 和 `@dv/ui-composer`；它只绘制插件注册的内容，不点名任何插件名词（[R5](../process/2026-10-17-dv-architecture-fitness-test.zh.md)）。UI 插件是带 `./client` 入口的包 `packages/dv/ui-<name>`；宿主包 `<name>` 存在时，两者配对。`@dv/ui-kit` 是一个库：它不注册任何东西，每个消费方打包自己导入的模块。UI 半部如何为自己的 slice 定类型，见 [客户端状态类型](2026-10-17-dv-architecture-client-state-types.zh.md)。

每个注册表都是一个 Cordis 服务，由读取它的 UI 核心包在其 `apply` 的顶层提供，绝不在 effect 内提供，因为其他插件从各自的 fiber 向它注册。注册表的每个键只有一个所有者。UI 半部在 `ctx.inject` 内以 `scope.effect` 注册每个描述符，因此插件在服务缺席时也能加载，服务或插件离开时它的描述符随之离开。UI 半部只通过运行操作来改变项目数据（[数据流](2026-10-17-dv-architecture-data-flow.zh.md)）。“type”指画布节点类型，“kind”指内核的引用种类或提及种类；把绘制出的节点命名为 `NodeEntry`，也把它与生成参数 `seed` 区分开。

注册表、slot、描述符类型以及画布、历史和提及规则记录在 [界面](../../../../docs/dreamverse/subsystems/ui.zh.md) 中。

## 曾考虑的替代方案

**由 `@dv/ui-kit` 中的一个 `DvUi` 服务持有所有注册表。** 它被否决，因为 ui-kit 没有客户端插件入口，而 DSH 客户端注册表是由某个插件在 `apply` 顶层提供的服务。把 slot 类型放在 ui-shell 或 ui-canvas 中也被否决，因为那会让一个 UI 核心包导入另一个 UI 核心包。

**ui-kit 中的模块级注册表对象。** 它被否决，因为每个导入 ui-kit 的打包产物都有自己的副本，shell 绘制的画布副本因此够不到插件填充的注册表。

**把插件的 UI 半部作为其宿主包的 `./client` 入口。** 它输给了独立的 `ui-<name>` 包，因为同时带宿主面和客户端面的包需要三个 tsconfig 文件。

**只按 `started_by.record` 分组版本，不用链锚点。** 它在两次批准各自开启版本时仍把所有版本挂在同一个分镜计划节点上，并且在第四版计划复用第一次批准的版本后隐藏了第二次批准开启的第 4 镜版本。只有工作流知道哪些起始记录属于同一个分镜计划节点，所以由工作流注册锚点。

**把在用版本作为节点类型的一个可选方法。** 时间线报告在用版本，但不绘制任何节点，而节点类型的每个字段都是必需的，所以 `takesInUse` 是独立的注册表。

**按插件提供卡片的 slot（`dv.canvas.node`）和节点认领。** 没有插件注册卡片或认领，所以这个 slot 是一个无人使用、无测试覆盖的扩展点。

**按记录产出或内核记录上的 `resource` 字段区分版本。** 按产出判断会把待处理的版本隐藏到它完成为止。内核字段只对其加入之后写入的记录有效，而已存储的记录中没有一条带它（0/2178），所以由操作声明决定，记录事实作为回退。

**只有 `{ node, state }` 的编辑器 slot 所有者。** 只导入 ui-kit 的条目那样就得去掉 添加素材 和素材预览，或复制选择器和预览；`EntryEditorHost` 借出回调，不借出 React 节点。

**把 `VersionKind` 和 `MentionKind` 改名为 `…Type`。** `VersionType.kind` 会混用两个词，保留原名让改名少改约 130 行。

**每张卡片上的 `data-node-owner` 属性。** [适应度测试](../process/2026-10-17-dv-architecture-fitness-test.zh.md) 的所有者列表把 `data-node-type` 值映射到它的包，而该属性会增加一个 DOM 字段和若干测试行，没有任何用户目标需要它们。

## 后果

插件的界面随它自己的包添加或移除。一个手写的 UI 半部为 `prop` 名词注册一个节点类型、一个版本种类、在用版本、一个历史行和一个提及种类，没有修改任何 UI 核心文件；一个广告工作流的 UI 半部把第二条链挂在同一个分镜计划节点上，没有修改自身包以外的任何文件。基于 `defineReferenceUi` 构建的名词的成本见 [引用名词](2026-10-17-dv-architecture-reference-nouns.zh.md) 笔记。

注册表带来间接层和运行时失败方式：

- 键冲突是运行时错误：当两个插件声明同一个节点类型 `id`、起始操作、引用种类或历史 `match` 时，`register` 抛出异常，类型检查发现不了它。
- 画布只通过描述符读取插件数据，因此分镜计划只有通过一个带 `approvedVersions` 的已注册 `ChainAnchor` 才会显示为已批准。
- 右侧边栏中的画布标签页主体不渲染任何 slot：在那里条目编辑器只显示标题栏，素材选择器只列出版本条目，素材标签点开后没有预览。
- `@dv/ui-kit/src/client/types.ts` 手写复制宿主的协议类型，因此宿主上新增的字段要手动加到 kit 中。
- 三个名词的节点类型共用颜色 `var(--dv-kind-character)`，因为 ui-shell 主题（`ui-shell/src/client/theme.ts`）没有定义场景或风格的颜色变量。
- `ui-canvas/src/client/locales.ts` 中的语言键 `node.takeKind` 在版本卡片的标签中保留了 “kind” 一词。
