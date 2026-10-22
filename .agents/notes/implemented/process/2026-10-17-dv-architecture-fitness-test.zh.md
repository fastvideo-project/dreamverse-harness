# Agent Note: DreamVerse 架构适应度测试

Status: implemented

[English](2026-10-17-dv-architecture-fitness-test.md) | 中文

## 问题

`packages/dv` 下的 DreamVerse 包共享一个目标：每个插件只有一个目标，并且可以单独添加或移除（[分层](../architecture/2026-10-17-dv-architecture-layers.zh.md)）。代码偏离了这个目标，却没有任何检查失败。扫描器第一次读取这些包时，在 127 个不同位置发现了 197 处规则匹配。内核 `@dv/project` 声明了 `CharacterId` 和 `bible` 属性，其面向 agent（智能体）的文本提到了计划和镜头。UI 核心占其中 119 处：`packages/dv/ui-kit/src/client/tool-labels.ts` 为 23 个插件工具（例如 `dv_plan_create`）提供标签，`packages/dv/ui-canvas/src/client/graph.ts` 读取 `params.plan`、`params.shot` 和 `components.timeline`。`packages/dv/ui-shell/src/client/views.ts` 导入了 `@dv/ui-canvas/src/client/CanvasView.tsx`。`@dv/shot-plan` 提到了 `timeline.create` 和 `shot.render`，并导入了 `@dv/timeline`。fastvideo 的提示词 skill（技能）提到了 `dv_shot_render`，这是一个更高层的工具。

没有命令能显示某个名称归哪个包所有。也没有检查能衡量一次变更波及多远：图像生成工作修改了自身包以外 2 个包中的 7 个文件，音频生成工作修改了另外 3 个包中的 18 个文件。

## 决策

`scripts/dv-architecture.ts` 按规则 R1 到 R8 扫描 DreamVerse 包，`scripts/dv-architecture.spec.ts` 以 Vitest 测试的形式运行扫描，因此任何回退都会让 `pnpm test` 失败，并用文字说出被破坏的规则。扫描器遍历 TypeScript 语法树，因此注释永远不会匹配。它把违规与一个基线比较，基线按文件、规则和匹配文本计数，因此移除违规的变更须在同一提交中调低对应条目。已提交的基线是 `{}`，唯一的例外标记带固定的原因文本，只抑制其所在行上的匹配。

`pnpm dv:owners` 根据规则读取的同一批事实，打印每个组件键、引用类型、操作、skill 和 UI 注册的所有者包。`scripts/dv-blast-radius.ts` 针对一个基准提交衡量一次变更。计数行超过 400 行或有逻辑变更的既有包超过 3 个时它失败，并且移动行和删除行的权重低于新增行。

规则、基线、例外标记、所有者列表和变更规模检查记录在 [DreamVerse 架构检查](../../../../docs/dreamverse/architecture-checks.zh.md)中。

## 曾考虑的替代方案

**按文件和行号作为基线条目的键。** 变更若移动了它并未修复的文件中的行，这样的条目就会失效，因此键由文件、规则和匹配文本组成，并带计数。

**用永久标记保留一个读取旧记录的读取器。** 这个读取器会给 `@dv/workflow-story` 第二个目标，即读取其他插件的记录，而它的标记将永远无法移除。

**在 R1 (b) 中豁免 `asset`。** `asset` 也是 `@dv/asset-pool` 的组件键，因此该豁免会掩盖内核中的 `'asset'` 字面量和 `components.asset` 读取。R1 (b) 只豁免 `proj`。

**在 R3 中静态扫描引用类型。** 曾有一个辅助函数把类型作为数据传入来注册类型，因此扫描字面量 `kind:` 值会漏掉它们。改由运行时的 `kind_exists` 检查负责。

**让 `defineReference` 也静态声明 `<k>.create` 和 `<k>.update`。** 没有用例显示存在额外声明能捕获、而运行时 `operation_exists` 检查会漏掉的错误，而且所有者列表本来就会推导出这些行。

**扫描文本中的名词。** 对 UI 核心字面量做中文词扫描，也会命中不涉及任何注册表的产品文案；对 skill 文本做类型词扫描，也会命中故事用语，例如 "the story's characters"。这些列表由审查者检查。

**为 `dv:owners` 添加词过滤参数，或用 `data-node-owner` DOM 属性标记节点。** 各行按键排序，因此 `grep` 已能得到一个整块；而该属性会增加一个 DOM 字段和测试，却没有任何用户目标需要它。

**把一次变更限制为 250 行 `src`。** 项目负责人把 400 计数行设为目标；移动行和删除行权重较低，因为纯移动或纯删除审查起来很快。

**让任意 `--allow` glob 都把包排除在逻辑计数之外。** 不带限制的 glob 会让逻辑变更伪装成接线文件；只有 `:max` 和 `:net-delete` 能让该计数保持为一个确定的数字。

**对整个仓库运行 lint，或只用 staged 配置运行 lint。** 让完整 lint 通过需要仓库级清理；而 `.oxlintrc.staged.json` 设置了 `typeAware: false`，放过了默认配置会报告的类型错误。`--lint` 使用默认配置，只检查新增行。

## 后果

这些包从 197 处匹配降到空基线且没有任何标记，任何回退都会让 `pnpm test` 失败，并用文字说明被破坏的规则。用变更规模检查测量，在这套分层上重建的图像生成工作在自身包之外修改了 2 个测试文件，而不是 7 个文件；音频生成工作修改了其提供方的 12 个文件，而不是 3 个包中的 18 个文件。

R1 (c)、R1 (d) 和 R5 (c) 匹配固定名称，例如 `CharacterId`、单词 timeline 和字面量 `plan`，因此不在这些列表中的名词能通过它们；R1 (b) 和 R5 (b) 等基于键的子句会跟随已注册的键。包的层由其文件夹名称决定，提供方由其 `dvModels.register(` 调用决定。

R3 和所有者列表只看到字面量形式的操作名。通过常量命名的操作，例如 `packages/dv/workflow-story/src/reducer.ts` 中的 `APPROVE` 和 `packages/dv/timeline/src/reducer.ts` 中的 `OPERATIONS`，不会有对应行：`pnpm dv:owners` 列出 13 个操作，遗漏了 `story.approve`、`shot.render`、`plan.update` 以及时间线操作。没有测试把该列表与运行时所有者进行比较。

没有任何 `package.json` 脚本或 `scripts/run-gates.ts` 配置运行变更规模检查；`scripts/dv-architecture.spec.ts` 只测试它的函数。审查者需手动运行它，并为每次变更选择参数。
