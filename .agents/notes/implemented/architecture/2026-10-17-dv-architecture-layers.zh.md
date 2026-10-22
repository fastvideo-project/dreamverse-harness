# Agent Note: DreamVerse 插件的分层与依赖方向

Status: implemented

[English](2026-10-17-dv-architecture-layers.md) | 中文

## 问题

`packages/dv/` 下的 DreamVerse 包允许贡献者在一个插件内新增 operation，但名词和制作流程的顺序都写死在共享包里，因此改动其中任一项都会修改与该改动无关的包：

- 内核 `@dv/project` 在 `project/src/shared.ts` 的集合 `COMPONENT_KEYS`（`proj`、`asset`、`bible`、`plan`、`shot`、`timeline`、`inspect`）中写死了组件 key，它的 agent（智能体）工具文本和 `<id>@<version>` 解析器也点名了 story bible 的 character、location 和 style 版本。新增一个引用名词要修改内核、`@dv/ui-kit` 和 `@dv/story-bible`。
- 画布在类型 `CanvasNodeKind = 'bible' | 'asset' | 'plan' | 'take'`（`ui-canvas/src/client/graph.ts`）中写死了节点种类，`@dv/ui-kit`、`@dv/ui-history` 和 `@dv/ui-composer` 也在各自的 wire 类型、历史行和 `@` 提及菜单里点名了 story bible。
- `@dv/shot-plan` 装了三样东西：计划数据、审批 → 渲染 → 时间线这条流程（它的 `plan.approve` operation 按名字运行 `shot.render` 和 `timeline.create`），以及复用已有 take 的策略。这条流程没有自己的包，skill（技能）文本又把它描述了一遍。
- FastVideo 提供方的 prompt skill 点名了消费方工具 `dv_shot_render`（`fastvideo/src/fasth3.ts`），因此提供方认识它上层的插件。
- 在重构模型目录之后，以插件形式加入图像生成（#51）和音频生成（#59）时，除新的 primitive 包和提供方包外，仍分别修改了 `@dv/models` 的 6 个和 4 个文件，并修改了 `@dv/ui-kit`。

架构适应度测试 `scripts/dv-architecture.ts` 在改动前的代码上报告 197 处违规匹配，归为 127 个不同条目：119 处是 UI core 包点名插件名词，55 处是内核点名插件名词，13 处是 skill 点名自己上层的层，4 处是向上的依赖，3 处是深入别的包 `src` 的 import，3 处是宿主包点名其他插件的 operation。

## 决策

每个 DreamVerse 插件只有一个目标，并且每个插件都能单独加入或移除。一个插件是一个宿主包，有浏览器半部时再加一个 UI 包 `ui-<name>`；bundle 在 `packages/bundle/dv/cordis.patch.yml` 中为每个包写一行来组合它。十个层和唯一的依赖方向服务于这个目标：一个包只依赖对它一无所知的层，因此加入或移除一个插件不会修改它下层的包，也不会修改同级的包。

适应度测试中的 `layerOf` 根据包的目录名推断每个包的层；对提供方，则根据 `dvModels.register(` 调用推断，因此没有包声明自己的层。UI 包需要读取的宿主包还发布一个客户端面 `./types`，由浏览器程序编译。一个面只 import 和扩充其他面，因此浏览器程序从不编译宿主代码。

层、import 表和两个面记录在 [DreamVerse 架构](../../../../docs/dreamverse/architecture.zh.md)中，检查它们的脚本记录在 [DreamVerse 架构检查](../../../../docs/dreamverse/architecture-checks.zh.md)中。

### 其他 DreamVerse 架构笔记

- [数据流](2026-10-17-dv-architecture-data-flow.zh.md)：内核 `@dv/project`，以及从记录到视图的单向数据流。
- [生成](2026-10-17-dv-architecture-generation.zh.md)：模型目录、`@dv/generation`，以及如何新增一个原语。
- [工作流](2026-10-17-dv-architecture-workflows.zh.md)：每个工作流是它自己的包 `@dv/workflow-<key>` 中的一个组件，不含策略的镜头遍历是库 `@dv/workflow-kit`。
- [UI 注册表](2026-10-17-dv-architecture-ui-registries.zh.md)：UI 核心只绘制 UI 包注册到其注册表和 slot 中的内容，不点名任何插件名词。
- [引用名词](2026-10-17-dv-architecture-reference-nouns.zh.md)：建在共享 reference kit 上的 `character`、`location` 和 `style`，以及 kit 成员规则。
- [客户端状态类型](2026-10-17-dv-architecture-client-state-types.zh.md)：`ComponentStates` 的合并和部分 wire 视图。
- [适应度测试](../process/2026-10-17-dv-architecture-fitness-test.zh.md)：`scripts/dv-architecture.ts` 以测试的形式对照一个只降不升的基线运行分层规则，`pnpm dv:owners` 打印每项注册的所有者，`scripts/dv-blast-radius.ts` 限制一次变更的规模。
- [文档树](../process/2026-10-22-dreamverse-docs-tree.zh.md)：承载这些 Agent Note 机制细节的 `docs/dreamverse/` 目录树。

## 曾考虑的替代方案

**用通用步骤引擎取代工作流插件。** 一个引擎运行任意配置好的步骤序列，第二条流程就不需要自己的包。它落选的原因是当时只有一个工作流，而决策规定两个工作流都存在之前不建通用步骤引擎。`workflow-kit` 的限制（不点名工作流 key，`src` 最多 300 个非空行）防止这个库长成那样的引擎。

**不设工作流库：复制镜头遍历，或让一个工作流 import 另一个。** 它落选的原因是依赖方向表禁止一个工作流 import 另一个工作流，而复制的遍历代码会被仓库的重复代码检查拦下（6 行、60 个 token）。`workflow-lib` 层存放两个工作流都可以 import 的遍历代码。

**用带类型的 `OperationMap` 按 operation 名字调用。** 各插件把自己的参数合并进一张映射表，`dvProject.run` 按 operation 名字为每次调用提供类型。它落选的原因是：服务在拥有该 operation、了解其参数的插件内部包装 `run`；surface 以用户身份按名字调用 operation，由 runner 校验参数；而且没有任何新增插件需要这张映射表。

**UI 部分放在双面包里。** 宿主包以带 `dsh.client` 清单的 `./client` 入口自己发布浏览器部分。它落选的原因是当时没有任何 DreamVerse 宿主包有客户端部分，而同时有两部分的包除 `tsdown.config.ts` 和 `dsh.client` 清单外，还需要三个 tsconfig 文件（宿主 leaf、客户端 leaf 和只做 solution 的根）。

**为客户端面拆分宿主配置。** 每个带 `./types` 面的包也把宿主程序移进 `tsconfig.host.json`，放在只做 solution 的根配置之下，与仓库中其他双面包的布局一致。它落选的原因是这需要在 12 个 DreamVerse 包中增加 `tsconfig.host.json` 引用，却不比不拆分的形式多检查出任何问题；`tsconfig.json` 仍是宿主配置。

**`./types` 文件 import 裸的宿主包。** `src/types.ts` 直接从 `@dv/project` import 类型并扩充它。它落选的原因是 `@dv/project` 解析到 `project/src/index.ts`，后者 import 了 `node:crypto` 和 Cordis 宿主，于是任何读取客户端面的 UI 包都会在浏览器程序中编译宿主代码，类型检查失败。各个面只 import 和扩充其他面，适应度测试追踪每个面来保证这一点。

**把插件类型手工复制进 `@dv/ui-kit`。** `ui-kit/src/client/types.ts` 持有插件 slice 类型的副本，因此浏览器程序从不触及宿主包。它落选的原因是每份副本都让 UI core 点名一个插件，并且会与其所有者脱节；每个宿主包发布自己的 `./types` 面，`@dv/ui-kit` 的 `ComponentStates` 只声明 `proj` 和 `asset` 两个 slice。

## 后果

**分层带来的好处。** 适应度测试在发布的代码上报告 0 处违规，它的 baseline 文件 `scripts/dv-architecture.baseline.json` 为 `{}`，而改动前是 197 处匹配。因此，对一个名词、一个 primitive 或一个工作流的改动只发生在该插件自己的包里；每类新增的实测成本记录在拥有该机制的笔记中：[引用名词](2026-10-17-dv-architecture-reference-nouns.zh.md)、[生成](2026-10-17-dv-architecture-generation.zh.md)和[工作流](2026-10-17-dv-architecture-workflows.zh.md)。

**包更多。** `packages/dv/` 有 36 个包，改动前是 24 个。`story-bible` 已删除；新增了 `character`、`location`、`style`、`generation`、`reference-kit`、`workflow-kit` 和 `workflow-story`，以及 UI 包 `ui-character`、`ui-location`、`ui-style`、`ui-shot-plan`、`ui-shot-render` 和 `ui-workflow-story`。有浏览器部分的插件是两个包、两行 bundle 配置。

**层的名单写在代码里。** 新增的 base、surface 或 UI core 包必须加进 `scripts/dv-architecture.ts` 中的 `BASE`、`SURFACE` 或 `UI_CORE`。其他包按目录名（`workflow-*`、`ui-*`）、按 `dvModels.register(` 调用，或者作为领域插件分类，并按该层的 import 规则检查。

**surface 读取领域 slice。** surface 可以读取任何领域插件的 slice 类型，没有规则扫描这些读取。`api/src/wire.ts`、`api/src/summaries.ts` 和 `chat-references/src/expand.ts` 读取 `timeline` slice；[客户端状态类型](2026-10-17-dv-architecture-client-state-types.zh.md)记录了这在宿主侧留下的缺口。
