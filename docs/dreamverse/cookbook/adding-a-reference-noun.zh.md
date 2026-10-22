# 添加引用名词

[English](adding-a-reference-noun.md) | 中文

## 概述

本指南为 DreamVerse 添加一个引用名词（reference noun）。引用名词是一类条目，例如道具；它把参考图保存为版本，镜头以 `<id>@<version>` 指定其中一个版本。你把场景（location）名词复制成两个包，改写其中的名词用词，注册这两个包，再把它们挂载到组合包中。完成后，agent（智能体）获得工具 `dv_<k>_create` 和 `dv_<k>_update` 以及 skill `<k>`。画布、`@` 菜单和历史面板显示这些条目。除这两个名词包之外，本指南只修改组合包 `@dv/bundle`、TypeScript 配置、`pnpm-lock.yaml`、一个检查脚本和文档。本指南以键 `prop` 为例。

## 目录

- [开始之前](#before-you-start)
- [本指南创建或修改的文件](#files-that-the-guide-creates-or-changes)
- [1. 创建宿主包](#1-create-the-host-package)
- [2. 创建 UI 包](#2-create-the-ui-package)
- [3. 在 TypeScript 配置中注册这两个包](#3-register-the-packages-in-the-typescript-configs)
- [4. 在组合包中挂载名词](#4-mount-the-noun-in-the-bundle)
- [5. 更新文档](#5-update-the-documentation)
- [6. 运行架构检查](#6-run-the-architecture-checks)
- [延伸阅读](#further-exploration)

<a id="before-you-start"></a>
## 开始之前

先确认这个名词符合 reference kit。每个条目有一个 ID 和一个版本列表。每个版本代表一组参考图，每次修改都写入下一个版本。如果名词需要别的版本含义，[kit 成员规则](../subsystems/reference-nouns.zh.md#kit-membership)不允许该名词使用 kit。此时按 `packages/dv/COMPONENT-TEMPLATE.md` 所示直接注册，不要使用本指南。

选定以下取值：

- 键 `<k>`，由字母和数字组成的一个小写单词，例如 `prop`。这个键命名组件、引用种类、ID 参数、操作、skill 和画布节点类型。键 `proj`、`asset`、`record` 和 `version` 已被保留。
- 名词的中文和英文，例如道具和 `prop`。
- `@` 菜单顺序，即下一个空闲的数字。角色是 1，场景是 2，风格是 3。

在仓库根目录、执行 `pnpm install` 之后运行每条命令。在 shell 中设置一次键、键的首字母大写形式和中文名词：

```sh
k=prop
K=Prop
zh=道具
```

<a id="files-that-the-guide-creates-or-changes"></a>
## 本指南创建或修改的文件

下面的文件树列出每个文件，以及创建或修改它的步骤。

```text
packages/dv/
├── <k>/                                          step 1: copy of location/
├── ui-<k>/                                       step 2: copy of ui-location/
└── README.md, README.zh.md                       step 5: package map rows
docs/dreamverse/                                  step 5: noun lists
packages/bundle/dv/
├── cordis.patch.yml                              step 4: two rows
├── package.json                                  step 4: two dependencies
└── tests/composition.spec.ts                     step 4: plugin map, noun order
scripts/verify-package-readme-model-experience.ts step 5: one entry
tsconfig.base.json                                step 3: three paths
tsconfig.host.json                                step 3: one reference
tsconfig.client.json                              step 3: two references
pnpm-lock.yaml                                    steps 1, 2 and 4: pnpm install
```

<a id="1-create-the-host-package"></a>
## 1. 创建宿主包

宿主包 `@dv/<k>` 是 `@dv/reference-kit` 的一个 `defineReference` 声明。复制场景包，并替换其中的名词用词：

```sh
cp -r packages/dv/location packages/dv/$k
rm -rf packages/dv/$k/node_modules packages/dv/$k/lib
mv packages/dv/$k/skills/location packages/dv/$k/skills/$k
mv packages/dv/$k/tests/location.spec.ts packages/dv/$k/tests/$k.spec.ts
grep -rl -i location packages/dv/$k | xargs perl -pi -e "s/location/$k/g; s/Location/$K/g"
grep -rl 场景 packages/dv/$k | xargs perl -pi -e "s/场景/$zh/g"
```

然后改写仍在描述地点的文字：

1. 在 `src/index.ts` 中，设置 `meaning`、`skill.description` 和 `skill.whenToUse` 的文字，以及 JSDoc 行。
2. 在 `src/types.ts` 中，修改 JSDoc 行和 ID 示例 `l1`。
3. 在 `skills/<k>/SKILL.md` 中，写明 agent 如何创建和修改这些条目。只写出工具 `dv_<k>_create` 和 `dv_<k>_update`。
4. 在 `tests/<k>.spec.ts` 中，修改 skill 测试所期望的 skill 句子，使它与 `SKILL.md` 一致。
5. 在 `package.json` 中，修改 `description`。
6. 在 `README.md` 和 `README.zh.md` 中，描述这个名词及其限制。两个文件的标题和行数保持一致。

要添加版本字段、表单行、编辑器或更多操作，使用 kit 的[扩展点](../subsystems/reference-nouns.zh.md#extension-points)。

运行 `pnpm install --no-frozen-lockfile`。它链接这个包的依赖，并把这个包加入 `pnpm-lock.yaml`。

验证：运行 `CI=true pnpm exec vitest run packages/dv/$k`。所有测试通过。

<a id="2-create-the-ui-package"></a>
## 2. 创建 UI 包

UI 包 `@dv/ui-<k>` 是 `@dv/ui-kit/reference-kit.tsx` 的一个 `defineReferenceUi` 声明。复制场景 UI 包，并替换其中的名词用词：

```sh
cp -r packages/dv/ui-location packages/dv/ui-$k
rm -rf packages/dv/ui-$k/node_modules packages/dv/ui-$k/lib
mv packages/dv/ui-$k/tests/ui-location.client.spec.tsx packages/dv/ui-$k/tests/ui-$k.client.spec.tsx
grep -rl -i location packages/dv/ui-$k | xargs perl -pi -e "s/location/$k/g; s/Location/$K/g"
grep -rl 场景 packages/dv/ui-$k | xargs perl -pi -e "s/场景/$zh/g"
```

然后设置 `@` 菜单顺序：

1. 在 `src/client/index.ts` 中，设置 `mention.order`。
2. 在 `tests/ui-<k>.client.spec.tsx` 中，修改 mention 测试名称和期望列表中的顺序 `2`。
3. 在 `README.md` 和 `README.zh.md` 中，修改概述中的顺序 `2`。
4. 在 `package.json` 中，检查 `description`。

运行 `pnpm install --no-frozen-lockfile`。

验证：运行 `CI=true pnpm exec vitest run packages/dv/ui-$k`。所有测试通过。

<a id="3-register-the-packages-in-the-typescript-configs"></a>
## 3. 在 TypeScript 配置中注册这两个包

每个包需要一个路径别名和一个项目引用。在对应的 `style` 行之后添加这些行：

| 文件                   | 添加                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig.base.json`   | `"@dv/<k>": ["./packages/dv/<k>/src/index.ts"]`、`"@dv/<k>/types": ["./packages/dv/<k>/src/types.ts"]` 和 `"@dv/ui-<k>": ["./packages/dv/ui-<k>/src/index.ts"]` |
| `tsconfig.host.json`   | `{ "path": "./packages/dv/<k>" }`                                                                                                                                   |
| `tsconfig.client.json` | `{ "path": "./packages/dv/<k>/tsconfig.client.json" }` 和 `{ "path": "./packages/dv/ui-<k>" }`                                                                      |

验证：运行 `CI=true pnpm run typecheck`。命令以退出码 0 结束。它先检查宿主程序（包括测试文件），再检查浏览器程序。

<a id="4-mount-the-noun-in-the-bundle"></a>
## 4. 在组合包中挂载名词

组合包 `@dv/bundle` 挂载这两个包。编辑以下文件：

1. 在 `packages/bundle/dv/cordis.patch.yml` 中，在 `dv-style` 行之后添加 `name: '@dv/<k>'` 的 `dv-<k>` 行。在 `dv-ui-style` 行之后添加 `name: '@dv/ui-<k>'` 的 `dv-ui-<k>` 行。把这个名词加入列出由插件注册的 skill 的注释。
2. 在 `packages/bundle/dv/package.json` 中，把 `"@dv/<k>": "workspace:*"` 和 `"@dv/ui-<k>": "workspace:*"` 加入 `dependencies`。
3. 在 `packages/bundle/dv/tests/composition.spec.ts` 中，导入 `@dv/<k>` 的默认导出，并把它加入 `PLUGINS`。如果某个组合包行的包在 `PLUGINS` 中没有条目，启动测试会失败。
4. 在同一文件中，更新检查名词顺序的测试。修改测试名称、名词模式和期望列表。把必须紧接在 `dv-ui-shot-plan` 之前的行改为 `dv-ui-<k>`。
5. 运行 `pnpm install --no-frozen-lockfile`。

验证：运行 `CI=true pnpm exec vitest run packages/bundle/dv`。所有测试通过。

<a id="5-update-the-documentation"></a>
## 5. 更新文档

每个包 README 和每个 DreamVerse 页面都是带一致性记录的双语对。UI README 使用简短的模型体验句，这句话需要一个经过审核的条目。

1. 在 `scripts/verify-package-readme-model-experience.ts` 中，在 `packages/dv/ui-style` 的条目之后，为 `packages/dv/ui-<k>` 在 `SENTENCE_MODEL_EXPERIENCE` 中添加一个条目。
2. 在 `packages/dv/README.md` 和 `packages/dv/README.zh.md` 的包地图中，为 `<k>` 和 `ui-<k>` 各添加一行。
3. 运行 `git grep -n -E '@dv/(ui-)?style\b' -- docs/dreamverse ':!*.zh.md'`。该命令打印 DreamVerse 页面中列出名词的行。在每一行中，把 `<k>` 加在 `style` 之后。在名词表或 skill 表中，添加一行。在对应的 `.zh.md` 页面中做同样的修改。
4. 记录 README 双语对：

   ```sh
   CI=true pnpm run verify-translation-pairing --write packages/dv/$k/README.md packages/dv/ui-$k/README.md packages/dv/README.md
   ```

5. 用 `CI=true pnpm run verify-translation-pairing --write <English path>` 记录第 3 项中修改的每个页面。

验证：运行 `CI=true pnpm run verify-package-readme-model-experience`、`CI=true pnpm run verify-translation-pairing` 和 `CI=true pnpm run verify-md-links`。三条命令都以退出码 0 结束。

<a id="6-run-the-architecture-checks"></a>
## 6. 运行架构检查

架构适应度测试 `scripts/dv-architecture.ts` 检查每个 DreamVerse 包的导入、操作名和 skill 文字。脚本 `dv:owners` 打印拥有每个名字的包。

验证：

1. 运行 `CI=true pnpm exec vitest run scripts/dv-architecture.spec.ts`。所有测试通过。
2. 运行 `CI=true pnpm run dv:owners | grep $k`。输出有九行。包 `<k>` 拥有组件、引用种类、操作 `<k>.create` 和 `<k>.update` 以及 skill。包 `ui-<k>` 拥有节点类型、版本种类、mention 种类和历史行 `<k>.`。

<a id="further-exploration"></a>
## 延伸阅读

- [引用名词](../subsystems/reference-nouns.zh.md)：reference kit、它的两半及其扩展点。
- [新行为的归属位置](where-new-behavior-goes.zh.md)：如何选择扩展点。
- [引用名词 Agent Note](../../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-reference-nouns.zh.md)：kit 为什么存在，以及名词何时停止使用 kit。
- [`packages/dv/COMPONENT-TEMPLATE.md`](../../../packages/dv/COMPONENT-TEMPLATE.md)：每个 DreamVerse 组件的布局和检查。
