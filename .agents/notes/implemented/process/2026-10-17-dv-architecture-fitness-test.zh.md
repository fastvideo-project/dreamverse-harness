# Agent Note: DreamVerse 架构适应度测试

Status: implemented

[English](2026-10-17-dv-architecture-fitness-test.md) | 中文

## 问题

`packages/dv` 下的 DreamVerse 包共享一个目标：每个插件只有一个目标，并且可以单独添加或移除（[分层](../architecture/2026-10-17-dv-architecture-layers.zh.md)）。代码偏离了这个目标，却没有任何检查失败。扫描器第一次读取这些包时，在 127 个不同位置发现了 197 处规则匹配。内核 `@dv/project` 声明了 `CharacterId` 和 `bible` 属性，其面向 agent（智能体）的文本提到了计划和镜头。UI 核心占其中 119 处：`packages/dv/ui-kit/src/client/tool-labels.ts` 为 23 个插件工具（例如 `dv_plan_create`）提供标签，`packages/dv/ui-canvas/src/client/graph.ts` 读取 `params.plan`、`params.shot` 和 `components.timeline`。`packages/dv/ui-shell/src/client/views.ts` 导入了 `@dv/ui-canvas/src/client/CanvasView.tsx`。`@dv/shot-plan` 提到了 `timeline.create` 和 `shot.render`，并导入了 `@dv/timeline`。fastvideo 的提示词 skill（技能）提到了 `dv_shot_render`，这是一个更高层的工具。

没有命令能显示某个名称归哪个包所有。也没有检查能衡量一次变更波及多远：图像生成工作修改了自身包以外 2 个包中的 7 个文件，音频生成工作修改了另外 3 个包中的 18 个文件。

## 决策

`scripts/dv-architecture.ts` 按规则 R1 到 R8 扫描 DreamVerse 包，`scripts/dv-architecture.spec.ts` 以 Vitest 测试的形式运行扫描。根目录的 `vitest.config.ts` 包含 `scripts/**/*.spec.ts`，因此 `pnpm test` 会运行它；`pnpm exec vitest run scripts/dv-architecture.spec.ts` 单独运行它。扫描器遍历每个 `.ts` 和 `.tsx` 文件的 TypeScript 语法树，因此注释永远不会匹配；skill Markdown 则按文本匹配。

`readScanFiles` 读取 `packages/dv/*/src/**/*.{ts,tsx}`、`packages/dv/*/skills/**/*.md`、`packages/bundle/dv/skills/**/*.md` 和 `packages/dv/*/package.json`，并跳过所有包含 `/tests/` 的路径。找不到内核源码时它会抛出错误，因此缩窄后的 glob 无法靠什么都不扫描而通过。`layerOf` 根据文件夹名称为每个包分配层，依据是 `BASE`、`SURFACE` 和 `UI_CORE` 列表以及 `workflow-` 和 `ui-` 前缀，并把调用 `dvModels.register(` 的包标为提供方。

每条失败行都会重复 `RULE_STATEMENTS` 中该规则的说明，违规会带上其子句字母，例如 `R1d`。

## 规则

| 规则 | `RULE_STATEMENTS` 中的说明 | 主要匹配内容 | 保护的内容 |
| --- | --- | --- | --- |
| R1 | The kernel names no plugin noun and never reads `started_by`.（内核不提及任何插件名词，也从不读取 `started_by`。） | 在 `project/src` 中：(a) `@dv/*` 导入；(b) 以字面量或 `components.<key>` 读取形式出现的插件组件键；(c) `CharacterId`、`LocationId`、`StyleId`、`bible`；(d) 字符串文本中的插件名词；(e) `types.ts`、`runner.ts` 和 `record-store.ts` 之外的 `started_by`。 | 添加或移除插件无需修改内核（[数据流](../architecture/2026-10-17-dv-architecture-data-flow.zh.md)）。 |
| R2 | Base packages, reference-kit included, name no media type; workflow-kit names no workflow.（基础包，包括 reference-kit，不提及任何媒体类型；workflow-kit 不提及任何工作流。） | (a) `models`、`generation` 和 `reference-kit` 中的 `image`、`audio` 及每个原语键；(b) `workflow-kit` 中某个工作流的键或操作，或该包超过 300 个非空行。 | 添加原语或工作流无需修改基础包（[生成](../architecture/2026-10-17-dv-architecture-generation.zh.md)、[工作流](../architecture/2026-10-17-dv-architecture-workflows.zh.md)）。 |
| R3 | One owner per component key, reference kind and operation; `defineReference` operations are checked at runtime; a `defineReference` key is one lowercase word and not `proj`, `asset`, `record` or `version`.（每个组件键、引用类型和操作只有一个所有者；`defineReference` 的操作在运行时检查；`defineReference` 的键是一个小写单词，且不是 `proj`、`asset`、`record` 或 `version`。） | 被声明两次的组件键；位于其键所属包之外的字面量操作；(c) 格式错误或保留的 `defineReference` 键。 | 每个名称随拥有它的唯一一个包一起移除（[引用名词](../architecture/2026-10-17-dv-architecture-reference-nouns.zh.md)）。 |
| R4 | A host package names only operations of its own component key.（宿主包只提及自身组件键的操作。） | 由其他包拥有的键所构成的 `<key>.<verb>` 字面量；`api` 和 `chat-references` 可以提及 `asset.import` 和 `asset.place`。 | 宿主包不会按操作名驱动其他插件。 |
| R5 | UI core names no plugin noun.（UI 核心不提及任何插件名词。） | (a) 插件操作字面量；(b) `proj` 和 `asset` 以外的 `components.<key>` 读取；(c) 字面量 `character`、`location`、`style`、`bible` 和 `plan`；(d) `params.plan`、`params.plan_version` 和 `params.shot`；(e, f) `DV_TOOL_LABELS` 和字面量中的插件工具名。 | UI 核心只通过注册表绘制插件（[UI 注册表](../architecture/2026-10-17-dv-architecture-ui-registries.zh.md)）。 |
| R6 | No deep import into another package's `src`.（不深层导入其他包的 `src`。） | `@dv/<pkg>/src/…` 导入说明符。 | 包之间只通过导出的入口相连。 |
| R7 | Dependencies point down the layers; a `./types` entry reaches no host-only module.（依赖沿层向下；`./types` 入口不触及任何仅限宿主的模块。） | (a) 按层表 `IMPORTS` 检查每个 `@dv/*` 导入；(b) 通过导入或 `declare module` 目标触及 `node:*`、`@deepseek-ai/cordis` 或 `@deepseek-ai/dsh-tools` 的 `./types` 入口。 | [分层](../architecture/2026-10-17-dv-architecture-layers.zh.md)的依赖方向，以及可在浏览器中加载的客户端入口。 |
| R8 | A skill never names a consumer; only the package that owns a reference kind names its tools.（skill 从不提及消费方；只有拥有某个引用类型的包才提及该类型的工具。） | 在 skill Markdown、提供方字面量和 skill 描述中：(a) 更高层的工具；(b) 基础包和提供方文本中的 `plan` 或 `continue_previous`；(c) 位于某工作流自身 skill 之外的该工作流工具；(d) 目录文本中 `dv_models_*` 以外的工具；(e) 其他工作流的 `<k>-directing`；(f) 位于引用名词所属包之外的该名词工具。 | skill 只提及在其包加载之处必然存在的工具。 |

运行时负责 R3 未覆盖的部分：`packages/dv/project/src/runner.ts` 拒绝重复的组件键（`component_exists`）、重复的操作（`operation_exists`）以及不带 `<component>.` 前缀的操作名，`packages/dv/project/src/reducers.ts` 拒绝重复的引用类型（`kind_exists`）。测试用 `scripts/fixtures/dv-architecture/` 中的 24 个 fixture（测试前置数据）和内联用例固定每个子句。

## 基线与例外标记

`scripts/dv-architecture.baseline.json` 把 `<file> <rule> <matched text>` 映射到一个计数。键中不含行号，因此移动代码不会改变任何内容。`compareBaseline` 在键缺失、匹配数多于计数以及少于计数时都会失败，因此移除违规的变更须在同一提交中调低对应条目。已提交的基线是 `{}`。

TypeScript 代码行可以以唯一的例外标记 `// dv-arch-allow R<k>: <reason>` 结尾，其中原因必须是 `RULE_STATEMENTS.marker` 引用的固定文本。该标记只抑制其所在行上 `R<k>` 的匹配。任何其他标记文本以及未抑制任何匹配的标记都会作为 `marker` 违规失败。`packages/` 下没有文件带有该标记。

## 所有者列表

`pnpm dv:owners` 运行 `scripts/dv-owners.ts`，打印 `listOwners` 的各行。`listOwners` 读取 R3 遍历收集的事实（`collectFacts`），因此列表与规则看到的是同一批声明。各行来自组件键声明、字面量操作声明、`defineReference` 和 `defineReferenceUi` 调用、类型为 UI 注册表条目的变量以及 skill 文件。各行按键排序，因此 `pnpm dv:owners | grep character` 会把 `@dv/character` 和 `@dv/ui-character` 的九行作为一个整块打印出来。

## 变更规模检查

`scripts/dv-blast-radius.ts` 针对一个基准提交检查一次变更：

```
pnpm exec tsx scripts/dv-blast-radius.ts --base <sha> [--own <dir or glob>]... [--allow <glob>[:max=<n>][:net-delete]]... [--max-lines <n>] [--lint]
```

它从 `scripts/change-scope.ts` 读取已变更的路径，包括未跟踪的文件。每个路径必须属于自身范围、属于接线文件，或匹配某个 `--allow` glob。接线文件是固定列表 `WIRING`（根目录 tsconfig 文件、`pnpm-lock.yaml`、bundle 注册文件），`docs/dreamverse/` 下的每个文件，另加合并基准中不存在的包的 `README.md`、`package.json` 和 `tsconfig.json`，以及合并基准中已存在时的基线文件。`:max=<n>` 限制所匹配文件的新增行与删除行之和，`:net-delete` 在所匹配文件行数增加时失败；基线文件始终带有 `:net-delete`。

新增一行计 1，删除一行计 0.5，而删除行的去空白文本若在另一个文件中被新增，则计 0。测试、spec 文件、`pnpm-lock.yaml`、`README.zh.md` 和 `*.i18n.yaml` 计 0，合并基准中不存在的包只计 `src/` 和 `skills/`。计数行超过 400 行或超过 `--max-lines <n>` 的上限时检查失败；有逻辑变更的既有包超过 3 个时也失败，逻辑变更指 `src` 变更超过 2 行，且其中有文件不在任何带限制的 glob 内。`--lint` 运行默认 oxlint 配置，需要先完成宿主构建，并且只在新增行上有发现时失败。失败行以 `R9:` 开头表示路径和限制问题，以 `R10:` 开头表示规模问题。

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
