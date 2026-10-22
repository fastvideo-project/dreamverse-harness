# Agent Note: DreamVerse 引用名词——reference kit 及其成员规则

Status: implemented

[English](2026-10-17-dv-architecture-reference-nouns.md) | 中文

## 问题

DreamVerse 保存三类镜头必须复现的条目：角色、场景和风格。这三类条目曾经都放在一对插件中。`@dv/story-bible` 拥有一个形如 `{ characters, locations, styles }` 的 `bible` slice、三个引用种类（reference kind）、按动词各用一个模板生成的六个操作（`bible.character_create`、`bible.location_update` 等）以及一个 `story-bible` skill（技能）。`@dv/ui-story-bible` 遍历一个含三个条目的 `KINDS` 列表来绘制这些名词，`@dv/api` 则逐个字段读取 `state.components.bible` 来收集参考图。修改一个名词（例如更丰富的角色编辑器）要同时修改这两个共享包，而一个 slice 装着三个名词，尽管每个名词都有自己的真源。

在此之前，这些名词波及的范围更广：内核 `@dv/project` 在 `project/src/types.ts` 中声明了 `CharacterId`、`LocationId`、`StyleId`，并为每个名词声明了一个输入引用分支；`@dv/ui-kit` 复制了版本类型；`@dv/ui-canvas`、`@dv/ui-composer`、`@dv/ui-history` 和 `@dv/chat-references` 各自写出了这三个名词。添加一个引用名词（reference noun）要改动内核、`ui-kit`、画布和 story bible。在没有共享库的情况下，作为独立插件对编写的名词会复制 story bible 的代码，与其只有文字上的差异。

## 决策

**引用名词**是一种组件，其条目具有 kit 形状：每个条目有一个 ID 和一个版本列表，每个版本代表一组参考图，输入以 `<id>@<version>` 指定一个版本，修改会取代写出上一个版本的记录。[数据流 Agent Note](2026-10-17-dv-architecture-data-flow.zh.md) 负责引用种类、`<id>@<version>` 的解析、陈旧标记和取代。本文负责这些名词以及它们共享的库。

角色、场景和风格是三个引用名词。每个名词是一对插件，并拥有自己的 slice：`@dv/character` 与 `@dv/ui-character`、`@dv/location` 与 `@dv/ui-location`、`@dv/style` 与 `@dv/ui-style`。每对名词插件对共享库 **reference kit** 的两半各调用一次，kit 只实现一次 kit 形状：base 层包 `@dv/reference-kit`（[分层 Agent Note](2026-10-17-dv-architecture-layers.zh.md)）的 `defineReference`，以及文件 `packages/dv/ui-kit/src/client/reference-kit.tsx` 的 `defineReferenceUi`。名词包只填入各名词之间不同的部分。一个名词包从不导入另一个名词包，其他每个插件都通过 kit 填入的内核和客户端注册表读取名词。

名词只在其条目具有 kit 形状时使用 kit。需要不同形状的名词停止使用 kit 并直接注册。这次迁移只修改该名词的两个包，因为其他每个插件都通过注册表读取名词。角色预计是第一个停止使用 kit 的名词，因为预计它会自己管理更多行为。kit 形状、两个声明及其注册的内容、扩展点和成员规则记述在 [DreamVerse 引用名词](../../../../docs/dreamverse/subsystems/reference-nouns.zh.md)中，[添加引用名词](../../../../docs/dreamverse/cookbook/adding-a-reference-noun.zh.md)给出步骤。

## UI 半部为何放在 ui-kit 中

宿主半部是独立的包，而 UI 半部是 `@dv/ui-kit` 中的一个文件，原因是[架构适应度测试](../process/2026-10-17-dv-architecture-fitness-test.zh.md)的导入规则：UI 层的包只能导入 `@dv/ui-kit`、以 `import type` 导入与之配对的宿主包的 `./types`，以及 UI 核心包的 slot 声明。这一放置反映的是改动的大小，并不表示引用名词与 `@dv/ui-kit` 的其他内容属于一类。该文件属于 UI 核心，因此受「UI 核心不写出插件名词」这条规则约束。

## 曾考虑的替代方案

**名为 `@dv/reference-kind` 的包，配合 `defineReferenceKind` 和 `defineReferenceKindUi`。** 它被否决，因为一次调用注册六样东西，而 `defineReferenceKind` 读起来像是 `registerReferenceKind` 的薄包装层。`pnpm dv:owners` 把种类行打印在名词所在的包下，满足了这个名字背后的查找需求（[架构适应度测试](../process/2026-10-17-dv-architecture-fitness-test.zh.md)）。

**带 `plural`、`idExample` 和 `describe` 的十字段宿主声明。** 它被否决，因为 story bible 的三个名词之间只有键、中文名词和含义不同。ID 示例和描述文字对三者都相同，并且插入的是键，因此 kit 推导出摘要字段 `<k>s`，并只保留一份文字。

**从声明生成的 skill。** 它被否决，因为 skill 包含随名词而异的建议：角色 skill 要求描述只写服装和情绪、绝不写面部特征，风格 skill 讲的是胶片颗粒感之类的观感。生成器需要为每一条这样的建议增加一个声明字段，这会让 kit 膨胀。kit 只加载名词的 `skill.file`。

**从宿主声明读取名词文字的 UI 声明。** 它被否决，因为 UI 包只能以 `import type` 导入其宿主包，所以无法在运行时读取 `noun`。UI 声明因此重复一份标签对。

**独立的 `@dv/ui-reference-kit` 包。** 它因改动大小而被否决：名词 UI 包不能导入另一个 UI 层的包，所以这个包需要在 `scripts/dv-architecture.ts` 中增加一层，而 `@dv/ui-kit` 中的一个文件不需要修改任何规则。

## 后果

一个名词只需两次声明。`@dv/character` 有 46 个非空 `src` 行，`@dv/ui-character` 有 23 个；场景和风格的大小相同。在一次试验构建中，基于 kit 的第四个名词 `prop` 只修改了它自己的两个包 `prop` 和 `ui-prop`，没有修改任何共享包。第二次试验通过 `fields`、`children` 和 `editor` 给角色加上 `traits` 字段和自己的编辑器，只改动了 `character` 和 `ui-character`。

对 kit 的改动会同时影响每个名词。kit 中的一次缺陷修复同时修好三个名词，而为一个名词加的选项会让三个名词都背负它。没有自动检查执行成员规则；由评审执行。

挂载一个名词仍要修改它那对包之外的接线文件：`packages/bundle/dv/` 下的 bundle 文件、`tsconfig.base.json` 中的路径别名，以及 `docs/dreamverse/` 各页中的名词列表。

UI 一半与无关代码共用一个包：`@dv/ui-kit/src/client` 有 22 个模块、2404 行，其中包括 `/api/dv` 客户端、wire 类型和时间线几何，并且有 14 个 UI 包依赖 `@dv/ui-kit`。

已知缺口：

- `defineReferenceUi` 把每张卡片的颜色都设为 `var(--dv-kind-character)`，因此场景和风格的卡片与角色同色。UI 核心名词规则（[R5](../process/2026-10-17-dv-architecture-fitness-test.zh.md)）发现不了它，因为该规则匹配完整的字符串字面量，而这个名词位于一个 CSS 字符串内部。
- `ReferenceEditor` 写入的输入角色是 `reference`，因此声明了其他输入角色名的名词需要自己的 `editor`。
- kit 没有删除操作：条目一旦创建就留在项目中，修改只能改变它。
