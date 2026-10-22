# 添加生成原语

[English](adding-a-generation-primitive.md) | 中文

## 概述

本指南为 DreamVerse 添加一个生成原语（primitive）。原语是一次模型调用的一种输入输出签名，例如由提示词生成图片。你编写一个原语包，它声明自己的目录行和生成任务，并调用 `@dv/generation` 的 `defineGeneration`。随后由一个提供方插件服务这些生成任务，组合包挂载这两个包。只要有模型服务其中一个生成任务，agent（智能体）就获得一个操作工具。`@dv/models`、`@dv/generation`、`@dv/project` 和 `@dv/shot-render` 这几个包不改动。示例是一个图片原语，包为 `@dv/image-generate`，组件为 `image`，操作为 `image.generate`，生成任务为 `t2i`。

## 目录

- [开始之前](#before-you-start)
- [本指南创建或修改的文件](#files-that-the-guide-creates-or-changes)
- [1. 创建原语包](#1-create-the-primitive-package)
- [2. 注册这个包](#2-register-the-package)
- [3. 由提供方服务这些生成任务](#3-serve-the-tasks-from-a-provider)
- [4. 在组合包中挂载原语](#4-mount-the-primitive-in-the-bundle)
- [5. 更新文档并运行检查](#5-update-the-documentation-and-run-the-checks)
- [延伸阅读](#further-exploration)

<a id="before-you-start"></a>
## 开始之前

阅读[生成](../subsystems/generation.zh.md)页面。它定义模型目录、`PrimitiveTypes`、`TaskMap` 和 `defineGeneration`。

先确认你确实需要一个原语。使用下表：

| 你要添加的                                                  | 做法                                                                                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 没有任何原语具备的输出类型或输入角色                        | 按本指南操作。唇形同步输出视频但输入角色不同，所以它是独立的原语。                                                                                                            |
| 输入角色与某个已有原语相同的生成任务                        | 修改提供方、该原语声明中的 `tasks` 记录，以及 `packages/dv/shot-plan/src/index.ts` 中的生成任务规则 `takesReferences` 和 `takesFirstFrame`。                                  |
| 为已有生成任务添加提供方、模型或服务器                      | 按仓库 skill [`dv-add-model-provider`](../../../.agents/skills/dv-add-model-provider/SKILL.md) 操作。                                                                         |

选定以下取值：

- 原语名称，例如 `image`，以及它的 `modality`。
- 原语的生成任务，例如 `t2i`，每个生成任务各有一个中文标签和一个英文标签。
- 包目录，例如 `image-generate`；组件键，例如 `image`；以及操作 `<component>.<verb>`，例如 `image.generate`。agent 工具是 `dv_image_generate`。
- 只有这个原语读取的条目字段，例如 `gpuSecondsPerCall`。

在仓库根目录、执行 `pnpm install` 之后运行每条命令。

<a id="files-that-the-guide-creates-or-changes"></a>
## 本指南创建或修改的文件

下面的文件树列出每个文件，以及创建或修改它的步骤。

```text
packages/dv/
├── <dir>/                         step 1: the primitive package
├── <provider>/                    step 3: entries for the primitive tasks
└── README.md, README.zh.md        step 5: package map row
docs/dreamverse/                   step 5: primitive package lists
packages/bundle/dv/
├── cordis.patch.yml               step 4: one row, provider config
├── package.json                   step 4: one dependency
└── tests/composition.spec.ts      step 4: plugin map
tsconfig.base.json                 step 2: one path
tsconfig.host.json                 step 2: one reference
pnpm-lock.yaml                     steps 2 and 4: pnpm install
```

<a id="1-create-the-primitive-package"></a>
## 1. 创建原语包

原语包是一个 domain 包，布局与 `packages/dv/shot-render` 相同。创建 `packages/dv/<dir>/`，其中包含 `package.json`、`tsconfig.json`、`src/index.ts`、`tests/<dir>.spec.ts` 和 README 三件套。`packages/dv/COMPONENT-TEMPLATE.md` 给出每个文件的规则。在 `dependencies` 中列出 `@dv/generation`、`@dv/models` 和 `@dv/project`。

在 `src/index.ts` 中编写以下部分：

1. 一个 `declare module '@dv/models'` 块，把原语的行加入 `PrimitiveTypes`，把每个生成任务加入 `TaskMap`。这一行包含 `modality`、`facts`、`request`、`result` 和 `entry`。每个 `TaskMap` 值是原语名称。
2. 一个 `GenerationSpec<'<primitive>'>` 声明，包含 `service`、`component`、`operation`、`primitive`、带标签的 `tasks`、`label`、`description`、`params`、`inputs`、`outputs`、`toRequest`、`toOutputs`、`estimate` 和 `summarize`。[`@dv/generation` README](../../../packages/dv/generation/README.zh.md#use-this-package) 定义每个字段。`toOutputs` 可以调用 `@dv/generation` 的辅助函数 `importOne`，把一个输出导入为素材。
3. 默认导出 `class <Name> extends defineGeneration(<declaration>) {}`，以及为服务名写的 `declare module '@deepseek-ai/cordis'` 条目。

示例是 `@dv/shot-render` 的 `src/index.ts`：它的 `RENDER_DECLARATION` 和类 `DvShotRender`。

在测试中，像 `packages/dv/shot-render/tests/shot-render.spec.ts` 那样，为每个生成任务在 `dvModels` 中注册一个假模型条目。把假条目的生成任务类型写成 `TaskOfPrimitive<'<primitive>'>`，这样以后加入 `TaskMap` 的生成任务不会破坏任何测试。断言操作及其工具只在假条目注册期间存在。

验证：运行 `CI=true pnpm exec vitest run packages/dv/<dir>`。所有测试通过。

<a id="2-register-the-package"></a>
## 2. 注册这个包

在 `shot-render` 的对应行之后添加路径别名和项目引用：

| 文件                 | 添加                                                   |
| -------------------- | ------------------------------------------------------ |
| `tsconfig.base.json` | `"@dv/<dir>": ["./packages/dv/<dir>/src/index.ts"]`    |
| `tsconfig.host.json` | `{ "path": "./packages/dv/<dir>" }`                    |

运行 `pnpm install --no-frozen-lockfile`。它链接这个包，并把它加入 `pnpm-lock.yaml`。

验证：运行 `CI=true pnpm run typecheck`。命令以退出码 0 结束。

<a id="3-serve-the-tasks-from-a-provider"></a>
## 3. 由提供方服务这些生成任务

提供方插件为模型所服务的每个生成任务注册一个模型条目。仓库 skill [`dv-add-model-provider`](../../../.agents/skills/dv-add-model-provider/SKILL.md) 给出提供方的操作流程。对于原语，还要做以下几件事：

1. 用 `import type` 从原语包导入请求类型。这是提供方唯一可以对 domain 包做的导入。
2. 用提供方的一个必填 `Config` 字段填写原语行的每个条目字段，例如 `gpuSecondsPerCall`。
3. 为每个条目提供一个 `promptSkill`，它的描述写出模型和生成任务，不写任何工具。

验证：运行 `CI=true pnpm exec vitest run packages/dv/<provider>`。所有测试通过。

<a id="4-mount-the-primitive-in-the-bundle"></a>
## 4. 在组合包中挂载原语

组合包 `@dv/bundle` 在 `@dv/project` 和 `@dv/models` 之后挂载原语包，因为它的服务注入这两个服务。编辑以下文件：

1. 在 `packages/bundle/dv/cordis.patch.yml` 中，在 `dv-shot-render` 行之后添加 `name: '@dv/<dir>'` 的 `dv-<dir>` 行。在提供方的行中，为原语的每个生成任务添加一个服务器。
2. 在 `packages/bundle/dv/package.json` 中，把 `"@dv/<dir>": "workspace:*"` 加入 `dependencies`。
3. 在 `packages/bundle/dv/tests/composition.spec.ts` 中，导入 `@dv/<dir>` 的默认导出，并把它加入 `PLUGINS`。如果某个组合包行的包在 `PLUGINS` 中没有条目，启动测试会失败。
4. 运行 `pnpm install --no-frozen-lockfile`。

验证：运行 `CI=true pnpm exec vitest run packages/bundle/dv`。所有测试通过。

<a id="5-update-the-documentation-and-run-the-checks"></a>
## 5. 更新文档并运行检查

架构适应度测试 `scripts/dv-architecture.ts` 检查原语的位置。基础包不写出任何原语名。提供方只导入原语包的请求类型。skill 文字不写出任何消费方工具。

1. 在 `packages/dv/README.md` 和 `packages/dv/README.zh.md` 的包地图中，为 `<dir>` 添加一行。
2. 运行 `git grep -n '@dv/shot-render' -- docs/dreamverse ':!*.zh.md'`。该命令打印 DreamVerse 页面中写出原语包的行。在列出原语包的每一行中加入 `@dv/<dir>`，并在对应的 `.zh.md` 页面中做同样的修改。
3. 记录 README 双语对：

   ```sh
   CI=true pnpm run verify-translation-pairing --write packages/dv/<dir>/README.md packages/dv/README.md
   ```

4. 用 `CI=true pnpm run verify-translation-pairing --write <English path>` 记录第 2 项中修改的每个页面。

验证：

1. 运行 `CI=true pnpm exec vitest run scripts/dv-architecture.spec.ts`。所有测试通过。
2. 运行 `CI=true pnpm run dv:owners | grep <component>`。输出在包 `<dir>` 下列出组件 `<component>`。
3. 运行 `CI=true pnpm run verify-package-readme-model-experience` 和 `CI=true pnpm run verify-translation-pairing`。两条命令都以退出码 0 结束。
4. 运行 `git status --short`。列表中没有 `@dv/models`、`@dv/generation`、`@dv/project` 或 `@dv/shot-render` 的文件。

<a id="further-exploration"></a>
## 延伸阅读

- [生成](../subsystems/generation.zh.md)：模型目录、`defineGeneration` 和 `GenerationApi`。
- [`@dv/models` README](../../../packages/dv/models/README.zh.md#model-keys)：键字段、条目成员和渲染请求。
- [生成 Agent Note](../../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-generation.zh.md)：为什么一个包只服务一种输入输出签名。
- [新行为的归属位置](where-new-behavior-goes.zh.md)：如何选择扩展点。
