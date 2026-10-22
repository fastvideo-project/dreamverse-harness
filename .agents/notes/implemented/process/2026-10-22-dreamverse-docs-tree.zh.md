# Agent Note: DreamVerse 文档树

Status: implemented

[English](2026-10-22-dreamverse-docs-tree.md) | 中文

## 问题

DreamVerse 文档曾是一个 6,470 词的页面 `docs/subsystems/video-harness.md`。另一个页面 `docs/subsystems/video-harness-design.md` 指向外部文档，并描述了代码中不存在的分支模型。DeepSeek Harness 文档把架构地图、子系统参考页面、实操指南和术语表放在不同层级，而 DreamVerse 的文字把这些内容混在一个页面中。

八份已实现的 DreamVerse Agent Note 承载着在文档中没有归属的当前状态。它们大约一半的文字描述层、类型和机制，而不是决定及其备选方案。这类事实每一条都要在一份 Agent Note 中保持正确，而文档标准把 Agent Note 留给决策理由。

main 上有两项检查失败。`packages/dv/` 没有包组 README，所以 `verify-subsystem-pages` 失败。`scripts/project-doc-site.spec.ts` 中的子系统索引测试失败，因为 `docs/subsystems/README.md` 中没有 `video-harness-design.md` 的行。

## 决策

DreamVerse 文档是一棵同级目录树 `docs/dreamverse/`，层级与 DeepSeek Harness 文档相同：

- `architecture.md`，各层的有序地图；
- `architecture-checks.md`，检查各层的脚本；
- `subsystems/`，每个 DreamVerse 子系统一页参考页面；
- `cookbook/`，带编号验证步骤的实操指南；
- `glossary.md`，代码、记录、工具和界面文案所用的名称。

每份 DreamVerse Agent Note 保留 `## Problem`、`## Decision`、`## Alternatives considered` 和 `## Consequences`。它的 `## Decision` 用一到三段写出决定本身，并链接承载机制细节的文档页面。

各项检查接受这棵目录树。`verify-subsystem-pages` 接受指向 `docs/dreamverse/subsystems/` 的包组 README 链接。子系统索引测试同时读取 `docs/subsystems/` 和 `docs/dreamverse/subsystems/`。`scripts/dv-blast-radius.ts` 把 `docs/dreamverse/` 下的每个文件计为接线。文档网站不发布这棵目录树，`scripts/doc-budgets.manifest.json` 也不为其页面设置字数预算。[DreamVerse 文档索引](../../../../docs/dreamverse/README.zh.md)列出这些页面。

## 曾考虑的替代方案

**把目录命名为 `docs/dv-subsystems/`。** 这个目录包含架构地图、检查页面、实操指南和术语表，所以一个只说子系统的名称只描述了它五个部分中的一个。

**在 `docs/subsystems/` 中建一个子目录。** 文档结构参考让这个目录保持扁平，因为其中的页面是并列的（[`structure-hierarchy.md`](../../../skills/dsh-doc/references/structure-hierarchy.md#documentation-hierarchy)）。

**把每份 Agent Note 整体移入 `docs/`。** 没有文档规则允许 Agent Note 变成文档页面，而且文档页面不包含被否决的备选方案，而这部分正是 Agent Note 防止重复争论的内容。

**保留每份 Agent Note 的全文，并把其中的事实复制到 `docs/`。** 这样每条事实有两个归属，两份副本会彼此脱节。

**在 `docs/subsystems/video-harness.md` 保留一个桩页面。** 桩页面没有内容，而索引测试还要求为一个只指向别处的页面写一行。

## 后果

这棵目录树有 17 个英文页面，每个都有中文页面和一致性记录：索引、架构地图、检查页面、术语表、子系统索引及 8 个子系统页面，以及 4 个实操指南。`verify-subsystem-pages` 和子系统索引测试通过。

八份 DreamVerse Agent Note 变短了。按英文文件的 `wc -w` 统计，拆分前共 14,583 词，拆分后共 8,979 词：

| Agent Note                           | 拆分前 | 拆分后 |
| ------------------------------------ | ----: | ----: |
| `dv-architecture-client-state-types` | 1,767 | 1,407 |
| `dv-architecture-data-flow`          | 1,843 | 1,063 |
| `dv-architecture-generation`         | 1,800 | 1,162 |
| `dv-architecture-layers`             | 1,914 | 1,274 |
| `dv-architecture-reference-nouns`    | 1,837 | 1,071 |
| `dv-architecture-ui-registries`      | 1,839 | 1,011 |
| `dv-architecture-workflows`          | 1,781 | 1,104 |
| `dv-architecture-fitness-test`       | 1,802 |   887 |

DreamVerse 页面的中文术语，例如 reference noun 译作引用名词、take 译作版本，记录在 [`docs/i18n/terminology.md`](../../../../docs/i18n/terminology.md) 的 DreamVerse 一节中。

DreamVerse 的读者在文档网站上找不到这些页面。他们从仓库、`docs/subsystems/README.zh.md` 和各包 README 进入这些页面。之后新增的 DreamVerse 页面放在这棵目录树中，放进拥有其事实的那一层。
