# DreamVerse 架构检查

[English](architecture-checks.md) | 中文

本页是检查 [DreamVerse 架构](architecture.zh.md)的脚本的参考：适应度测试、所有者列表和变更规模检查。[适应度测试 Agent Note](../../.agents/notes/implemented/process/2026-10-17-dv-architecture-fitness-test.zh.md) 记录了这些检查采用这种设计的理由。

| 检查     | 脚本                                                                                                      | 命令                                                        | 失败条件                                                 | 自动运行于                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 适应度测试  | [`scripts/dv-architecture.ts`](../../scripts/dv-architecture.ts)，由 `scripts/dv-architecture.spec.ts` 运行 | `pnpm exec vitest run scripts/dv-architecture.spec.ts`    | 规则 R1 到 R8 的违规计数与基线不同                                | `pnpm test`，以及经 `pnpm run check:ci:coverage` 运行的 CI 任务 `node 24 / coverage` 和 `windows node 24 / coverage` |
| 所有者列表  | [`scripts/dv-owners.ts`](../../scripts/dv-owners.ts)                                                    | `pnpm dv:owners`                                          | 不会失败；它为每个有所有者的名称打印一行                                 | 没有检查运行它                                                                                                    |
| 变更规模检查 | [`scripts/dv-blast-radius.ts`](../../scripts/dv-blast-radius.ts)                                        | `pnpm exec tsx scripts/dv-blast-radius.ts --base <sha> …` | 路径不属于自身范围、接线文件或允许的 glob（R9），变更过大（R10），或新增行上有 lint 发现 | 没有检查运行它；`scripts/dv-architecture.spec.ts` 只测试它的函数                                                          |

## 适应度测试

适应度测试按规则 R1 到 R8 扫描 DreamVerse 包。它把违规与基线 `scripts/dv-architecture.baseline.json` 比较。根目录的 `vitest.config.ts` 包含 `scripts/**/*.spec.ts`，因此每次运行完整的 Vitest 套件都会运行适应度测试。

`readScanFiles` 读取以下文件，并跳过所有包含 `/tests/` 的路径：

- `packages/dv/*/src/**/*.{ts,tsx}`；
- `packages/dv/*/skills/**/*.md` 和 `packages/bundle/dv/skills/**/*.md`；
- `packages/dv/*/package.json`，用于读取每个包的 `./types` 入口。

找不到 `@dv/project` 的源文件时，`readScanFiles` 抛出错误，因此缩窄后的 glob 无法靠什么都不扫描而通过。扫描器遍历每个 `.ts` 和 `.tsx` 文件的 TypeScript 语法树，因此注释永远不会匹配。它按文本匹配 skill（技能）Markdown。`layerOf` 为每个包分配层，见[层](architecture.zh.md#layers)。

### 规则

每条失败行都会重复 [`scripts/dv-architecture.ts`](../../scripts/dv-architecture.ts) 的 `RULE_STATEMENTS` 中该规则的说明。违规带有子句字母，例如 `R1d`。R3 把子句 (a) 和 (b) 报告为 `R3`，把子句 (c) 报告为 `R3c`。

| 规则  | 主要匹配内容                                                                                                                                                                                                                                                             | 保护的内容                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| R1  | 在 `project/src` 中：(a) `@dv/*` 导入；(b) 以字面量或 `components.<key>` 读取形式出现的插件组件键；(c) `CharacterId`、`LocationId`、`StyleId` 和 `bible` 属性；(d) 字符串文本中的单词 character、location、style、plan、shot、timeline 和 clip；(e) `types.ts`、`runner.ts` 和 `record-store.ts` 之外的 `started_by`。 | 添加或移除插件无需修改内核（[项目数据](architecture.zh.md#project-data)）。 |
| R2  | (a) `models`、`generation` 和 `reference-kit` 中的 `image`、`audio` 及每个原语键，以及 `generation` 中的 `video`、`shot` 和 `plan`；(b) `workflow-kit` 中某个工作流的键或操作，或该包超过 300 个非空行。                                                                                                    | 添加原语或工作流无需修改基础包。                                        |
| R3  | (a) 两个包都声明的组件键；(b) 位于其键所属包之外的字面量操作；(c) 格式错误或保留的 `defineReference` 键。                                                                                                                                                                                               | 移除一个包会移除它拥有的每个名称。                                       |
| R4  | 由其他包拥有的键所构成的 `<key>.<verb>` 字面量。`api` 和 `chat-references` 可以提及 `asset.import` 和 `asset.place`。                                                                                                                                                                     | 宿主包不会按操作名驱动其他插件。                                        |
| R5  | (a) 插件操作字面量；(b) `proj` 和 `asset` 以外的 `components.<key>` 读取；(c) 字面量 `character`、`location`、`style`、`bible` 和 `plan`；(d) `params.plan`、`params.plan_version` 和 `params.shot`；(e) `DV_TOOL_LABELS` 中的插件工具名；(f) 字面量中的插件工具名。                                            | UI 核心只通过注册表绘制插件。                                        |
| R6  | `@dv/<pkg>/src/…` 导入说明符。                                                                                                                                                                                                                                           | 包之间只通过导出的入口相连。                                          |
| R7  | (a) 按 [import 表](architecture.zh.md#import-direction) `IMPORTS` 检查每个 `@dv/*` 导入；(b) 通过导入或 `declare module` 目标触及 `node:*`、`@deepseek-ai/cordis` 或 `@deepseek-ai/dsh-tools` 的 `./types` 入口。                                                                          | 各层的依赖方向，以及可在浏览器中加载的客户端面。                                |
| R8  | 在 skill Markdown、提供方字面量和 skill 描述中：(a) 更高层的工具；(b) 基础包和提供方文本中的 `plan` 或 `continue_previous`；(c) 位于某工作流自身 skill 之外的该工作流工具；(d) skill 描述中的任何工具，以及目录文本中 `dv_models_*` 以外的工具；(e) 其他工作流的 `<k>-directing`；(f) 位于引用名词所属包之外的该名词工具。                                           | skill 只提及在其包加载之处必然存在的工具。                                |

`@dv/project` 的运行时检查 R3 没有扫描的部分。`packages/dv/project/src/runner.ts` 拒绝重复的组件键（`component_exists`）、重复的操作（`operation_exists`）以及不带 `<component>.` 前缀的操作名。`packages/dv/project/src/reducers.ts` 拒绝重复的引用类型（`kind_exists`）。测试用 `scripts/fixtures/dv-architecture/` 中的 fixture（测试前置数据）和内联用例固定每个子句。

### 基线

`scripts/dv-architecture.baseline.json` 把键 `<file> <rule> <matched text>` 映射到一个计数。键中不含行号。`compareBaseline` 在三种情况下失败：

1. 基线中没有的键；
2. 匹配数多于某个键的计数；
3. 匹配数少于某个键的计数。

每条失败行给出键、实际计数、基线计数、匹配所在的行，以及规则的说明。变更移除一处违规时，在同一提交中调低它的计数。

### 例外标记

TypeScript 代码行可以以唯一的例外标记 `// dv-arch-allow R<k>: temporary exception` 结尾。该标记抑制其所在行上 `R<k>` 每个子句的匹配。任何其他标记文本，以及未抑制任何匹配的标记，都会作为 `marker` 违规失败。

<a id="owner-listing"></a>
## 所有者列表

`pnpm dv:owners` 运行 `scripts/dv-owners.ts`，它把 `listOwners` 的各行打印成一张表，列为 `what`、`name`、`package`、`where` 和 `extra`。`listOwners` 读取 R3 遍历收集的事实（`collectFacts`），因此列表与规则看到的是同一批声明。各行来自以下声明：

- 组件键声明（`registerComponent('<k>')` 和 `component: '<k>'`）；
- 字面量操作声明；
- `defineReference` 和 `defineReferenceUi` 调用；
- 类型为 UI 注册表条目 `NodeType`、`VersionKind`、`MentionKind` 和 `HistoryRow` 的变量；
- skill 文件。

各行按键排序，因此 `pnpm dv:owners | grep character` 把 `@dv/character` 和 `@dv/ui-character` 的各行作为一个整块打印出来。列表只找到声明中以字符串字面量写出的操作名。名称来自常量或参数的操作没有对应行。

## 变更规模检查

`scripts/dv-blast-radius.ts` 针对一个基准提交检查一次变更：

```text
pnpm exec tsx scripts/dv-blast-radius.ts --base <sha> [--own <dir or glob>]... [--allow <glob>[:max=<n>][:net-delete]]... [--max-lines <n>] [--lint]
```

脚本从 `scripts/change-scope.ts` 读取已变更的路径：已提交、已暂存、未暂存和未跟踪的文件。它打印不属于自身范围和接线文件的路径（`X` 行）、每个允许 glob 的限制、计数行，以及有逻辑变更的包。最后一行是 `PASS` 或 `FAIL`，失败时退出码为 1。

### R9：路径和限制

每个已变更的路径必须属于自身范围、属于接线文件，或匹配某个 `--allow` glob。自身范围的路径以某个 `--own` 目录开头，或匹配某个 `--own` glob。接线文件总是允许，并且从不计数：

- 根目录的 TypeScript 配置、lockfile，以及 `packages/bundle/dv/` 的组合文件和文档文件（[`scripts/dv-blast-radius.ts`](../../scripts/dv-blast-radius.ts) 中的常量 `WIRING` 列出它们）；
- `docs/dreamverse/` 下的每个文件（`DOCS_WIRING`）；
- 合并基准中不存在的包的 `README.md`、`package.json` 和 `tsconfig.json`；
- 合并基准中已存在时的基线文件。

`:max=<n>` 限制 glob 所匹配文件的新增行与删除行之和。`:net-delete` 在这些文件行数增加时失败。基线文件始终带有 `:net-delete`。每条 R9 失败行以 `R9:` 开头。

### R10：规模

检查按以下权重计算变更的行数：

- 新增一行计 1。
- 删除一行计 0.5。
- 删除的非空行，若其去空白文本在另一个文件中被新增，计 0。
- 测试、spec 文件、`pnpm-lock.yaml`、`README.zh.md`、`*.i18n.yaml` 和接线文件计 0。
- 合并基准中不存在的包只计 `src/` 和 `skills/` 中的行。

计数行超过 400 行或超过 `--max-lines <n>` 的上限时，检查失败。有逻辑变更的既有包超过 3 个时，检查也失败。一个包有逻辑变更，指它有超过 2 行 `src` 变更。它还必须至少有一个已变更的 `src` 文件不在任何带限制的 glob 内。每条 R10 失败行以 `R10:` 开头。

### lint

`--lint` 经 `scripts/run-oxlint.ts` 对已变更的 `.ts` 和 `.tsx` 文件运行默认 oxlint 配置。类型感知规则读取宿主构建，因此先运行 `tsc -b tsconfig.host.json`。检查只在新增行上有发现时失败，每条失败行以 `lint:` 开头。

没有任何 `package.json` 脚本或 `scripts/run-gates.ts` 配置运行变更规模检查。审查者手动运行它，并为每次变更选择参数。
