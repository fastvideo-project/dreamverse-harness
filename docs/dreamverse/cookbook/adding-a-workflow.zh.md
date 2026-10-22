# 添加工作流

[English](adding-a-workflow.md) | 中文

## 概述

本指南为 DreamVerse 添加一个工作流。工作流是一个组件，它预览并批准分镜计划的一个版次，并写出该版次的渲染和时间线。你编写宿主包 `@dv/workflow-<key>` 和 UI 包 `@dv/ui-workflow-<key>`，然后添加接线。agent（智能体）获得工具 `dv_<key>_preview` 和 `dv_<key>_approve` 以及 skill `<key>-directing`。`@dv/project`、`@dv/shot-plan`、`@dv/shot-render`、`@dv/timeline`、`@dv/workflow-kit`、`@dv/workflow-story` 和 UI 核心的文件都不改动。示例是一个广告工作流，键为 `ad`，它的操作接受一组画幅比例变体。

## 目录

- [开始之前](#before-you-start)
- [本指南创建或修改的文件](#files-that-the-guide-creates-or-changes)
- [1. 创建工作流包](#1-create-the-workflow-package)
- [2. 创建 UI 包](#2-create-the-ui-package)
- [3. 添加接线](#3-add-the-wiring)
- [4. 更新包地图并运行检查](#4-update-the-package-map-and-run-the-checks)
- [延伸阅读](#further-exploration)

<a id="before-you-start"></a>
## 开始之前

阅读[工作流](../subsystems/workflows.zh.md)页面。它定义工作流约定、审批链和 `@dv/workflow-kit` 的镜头遍历。故事工作流 `@dv/workflow-story` 是本指南每个文件的示例。

选定键 `<key>`，即一个小写单词，例如 `ad`。这个键命名组件、操作 `<key>.preview` 和 `<key>.approve`、skill `<key>-directing` 以及两个包。

在仓库根目录、执行 `pnpm install` 之后运行每条命令。

<a id="files-that-the-guide-creates-or-changes"></a>
## 本指南创建或修改的文件

下面的文件树列出每个文件，以及创建或修改它的步骤。

```text
packages/dv/
├── workflow-<key>/                                step 1: the workflow package
├── ui-workflow-<key>/                             step 2: the UI package
└── README.md, README.zh.md                        step 4: package map rows
packages/bundle/dv/
├── cordis.patch.yml                               step 3: host row and client row
├── package.json                                   step 3: two dependencies
├── tests/composition.spec.ts                      step 3: plugin map
└── README.md, README.zh.md                        step 3: workflow and skill lists
docs/dreamverse/subsystems/
└── agent-and-api.md, agent-and-api.zh.md          step 3: skills table row
scripts/verify-package-readme-model-experience.ts  step 3: one entry
tsconfig.base.json                                 step 3: two paths
tsconfig.host.json                                 step 3: one reference
tsconfig.client.json                               step 3: one reference
pnpm-lock.yaml                                     step 3: pnpm install
```

<a id="1-create-the-workflow-package"></a>
## 1. 创建工作流包

工作流包的布局与 `packages/dv/workflow-story` 相同。创建 `packages/dv/workflow-<key>/`，其中包含 `package.json`、`tsconfig.json`、`src/index.ts`、`src/reducer.ts`、`skills/<key>-directing/SKILL.md`、测试和 README 三件套。编写以下部分：

1. 服务 `dv<Name>`。它注入 `dvProject`、`dvShotPlan`、`dvShotRender` 和 `dvTimeline`，并注册组件键 `<key>` 及其归约函数。
2. 读取操作 `<key>.preview`，带 `readOnly: true` 和 `confirm: 'never'`。它报告预览行、GPU 估算和 `problems`。
3. 写操作 `<key>.approve`，带 `confirm: 'always'` 和一个 `confirmSummary`。只要 `problems` 不为空，它的 `prepareToolCall` 和 `precondition` 就拒绝调用。它的 `execute` 写出整条链。
4. `Owns` 函数，它接受本工作流的 `<key>.approve` 记录。
5. skill `<key>-directing`，在 `ctx.inject(['skills'], …)` 内注册。
6. 一个 REAL-composition 测试，像 `packages/dv/workflow-story/tests/fixture.ts` 那样通过 Loader 启动一个仅供测试的 `cordis.yml`。

调用 `@dv/workflow-kit` 的函数，不复制其中任何一个：`walkShot`、`planShots`、`checkShots`、`shotLine`、`scheduleShots`、`takeFilter` 和 `keepTimeline`。通过 `dvShotRender` 运行渲染，通过 `dvTimeline.layout` 运行布局，不按名称运行任何操作。广告工作流把每个变体作为 `walkShot` 的覆盖值和 `lane` 传入。它把每个变体链接在前一个变体最后一次渲染之后（`after`）。

验证：运行 `CI=true pnpm exec vitest run packages/dv/workflow-<key>`。所有测试通过。

<a id="2-create-the-ui-package"></a>
## 2. 创建 UI 包

UI 包的布局与 `packages/dv/ui-workflow-story` 相同。在 `src/client/index.ts` 中，为 `<key>.approve` 在 `dvCanvas.chainAnchors` 中注册一个链锚点，并在 `dvHistory.rows` 中注册一个历史行。宿主包没有 `./types` 客户端面，所以 UI 包像 `isStorySlice` 那样自行收窄 `<key>` slice。

验证：运行 `CI=true pnpm exec vitest run packages/dv/ui-workflow-<key>`。所有测试通过。

<a id="3-add-the-wiring"></a>
## 3. 添加接线

接线挂载两个包，并在文档中列出工作流及其 skill。编辑以下文件：

1. 在 `packages/bundle/dv/cordis.patch.yml` 中，在 `dv-workflow-story` 行之后添加 `dv-workflow-<key>` 行，在 `dv-ui-workflow-story` 行之后添加 `dv-ui-workflow-<key>` 行。
2. 在 `packages/bundle/dv/package.json` 中，把两个包都加入 `dependencies`。
3. 在 `packages/bundle/dv/tests/composition.spec.ts` 中，导入 `@dv/workflow-<key>` 的默认导出，并把它加入 `PLUGINS`。如果某个组合包行的包在 `PLUGINS` 中没有条目，启动测试会失败。
4. 把 `"@dv/workflow-<key>"` 和 `"@dv/ui-workflow-<key>"` 加入 `tsconfig.base.json` 的 `paths`。把 `{ "path": "./packages/dv/workflow-<key>" }` 加入 `tsconfig.host.json`，把 `{ "path": "./packages/dv/ui-workflow-<key>" }` 加入 `tsconfig.client.json`。
5. 在 `scripts/verify-package-readme-model-experience.ts` 中，在 `packages/dv/ui-workflow-story` 的条目之后，为 `packages/dv/ui-workflow-<key>` 在 `SENTENCE_MODEL_EXPERIENCE` 中添加一个条目。
6. 在组合包 README 双语对 `packages/bundle/dv/README.md` 和 `README.zh.md` 中，把工作流加入列出已挂载包的句子。把 skill `<key>-directing` 加入 `skill-filesystem` 句子。
7. 在双语对 `docs/dreamverse/subsystems/agent-and-api.md` 和 `agent-and-api.zh.md` 中，为 skill `<key>-directing` 在 skill 表中添加一行。
8. 运行 `pnpm install --no-frozen-lockfile`。它链接这两个包，并把它们加入 `pnpm-lock.yaml`。

验证：

1. 运行 `CI=true pnpm exec vitest run packages/bundle/dv`。所有测试通过。
2. 运行 `CI=true pnpm run typecheck`。命令以退出码 0 结束。

<a id="4-update-the-package-map-and-run-the-checks"></a>
## 4. 更新包地图并运行检查

架构适应度测试 `scripts/dv-architecture.ts` 检查每个工作流的导入、操作名和 skill 文字。只有工作流自己的 skill 写出它的 `dv_<key>_*` 工具和 `<key>-directing` skill。

1. 在 `packages/dv/README.md` 和 `packages/dv/README.zh.md` 的包地图中，为每个包添加一行。
2. 记录本指南修改的双语对：

   ```sh
   CI=true pnpm run verify-translation-pairing --write packages/dv/workflow-<key>/README.md packages/dv/ui-workflow-<key>/README.md packages/dv/README.md packages/bundle/dv/README.md docs/dreamverse/subsystems/agent-and-api.md
   ```

验证：

1. 运行 `CI=true pnpm exec vitest run scripts/dv-architecture.spec.ts`。所有测试通过。
2. 运行 `CI=true pnpm run dv:owners | grep <key>`。输出在包 `workflow-<key>` 下列出组件 `<key>` 和 skill `<key>-directing`。
3. 运行 `CI=true pnpm run verify-package-readme-model-experience` 和 `CI=true pnpm run verify-translation-pairing`。两条命令都以退出码 0 结束。
4. 运行 `git status --short`。列表中没有 `@dv/project`、`@dv/shot-plan`、`@dv/shot-render`、`@dv/timeline`、`@dv/workflow-kit` 或 `@dv/workflow-story` 的文件。

<a id="further-exploration"></a>
## 延伸阅读

- [工作流](../subsystems/workflows.zh.md)：工作流约定、审批链和镜头遍历。
- [`@dv/workflow-kit` README](../../../packages/dv/workflow-kit/README.zh.md)：镜头遍历的函数。
- [工作流 Agent Note](../../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-workflows.zh.md)：为什么工作流是普通组件，以及为什么 kit 有行数上限。
- [新行为的归属位置](where-new-behavior-goes.zh.md)：如何选择扩展点。
