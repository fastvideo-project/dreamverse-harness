# Agent Note: DreamVerse 引用名词——reference kit 及其成员规则

Status: implemented

[English](2026-10-17-dv-architecture-reference-nouns.md) | 中文

## 问题

DreamVerse 保存三类镜头必须复现的条目：角色、场景和风格。这三类条目曾经都放在一对插件中。`@dv/story-bible` 拥有一个形如 `{ characters, locations, styles }` 的 `bible` slice、三个引用种类（reference kind）、按动词各用一个模板生成的六个操作（`bible.character_create`、`bible.location_update` 等）以及一个 `story-bible` skill（技能）。`@dv/ui-story-bible` 遍历一个含三个条目的 `KINDS` 列表来绘制这些名词，`@dv/api` 则逐个字段读取 `state.components.bible` 来收集参考图。修改一个名词（例如更丰富的角色编辑器）要同时修改这两个共享包，而一个 slice 装着三个名词，尽管每个名词都有自己的真源。

在此之前，这些名词波及的范围更广：内核 `@dv/project` 在 `project/src/types.ts` 中声明了 `CharacterId`、`LocationId`、`StyleId`，并为每个名词声明了一个输入引用分支；`@dv/ui-kit` 复制了版本类型；`@dv/ui-canvas`、`@dv/ui-composer`、`@dv/ui-history` 和 `@dv/chat-references` 各自写出了这三个名词。添加一个引用名词（reference noun）要改动内核、`ui-kit`、画布和 story bible。在没有共享库的情况下，作为独立插件对编写的名词会复制 story bible 的代码，与其只有文字上的差异。

## 决策

**引用名词**是一种组件，其条目具有以下形状，本文称之为 kit 形状：

- 每个条目有一个 ID 和一个版本列表。每次新建或修改都写入下一个版本，并保留之前的版本。
- 每个版本代表一组参考图（`references`，即资产 ID），并带有名称和描述。
- 输入以 `<id>@<version>` 指定一个版本，例如 `c1@3`，运行器把它解析为该版本的参考图。
- 修改会取代写出上一个版本的记录，因此用该版本生成的每条记录都会变为陈旧。

[数据流 Agent Note](2026-10-17-dv-architecture-data-flow.zh.md) 负责引用种类、`<id>@<version>` 的解析、陈旧标记和取代。本文负责这些名词以及它们共享的库。

角色、场景和风格是三个引用名词。每个名词是一对插件，并拥有自己的 slice：`@dv/character` 与 `@dv/ui-character`、`@dv/location` 与 `@dv/ui-location`、`@dv/style` 与 `@dv/ui-style`。每个宿主包拥有操作 `<k>.create` 和 `<k>.update`（agent（智能体）工具 `dv_<k>_create` 和 `dv_<k>_update`），`@` 菜单按顺序显示角色、场景和风格三个分区。

一个键命名一个名词的全部内容：组件键、引用种类、ID 参数、操作前缀、skill 名称和画布节点类型。每个宿主包带有一个手写的 skill `packages/dv/<k>/skills/<k>/SKILL.md`，其中只写出自己的工具。一个名词包从不导入另一个名词包：[架构适应度测试](../process/2026-10-17-dv-architecture-fitness-test.zh.md)的分层规则会拒绝导入另一个 domain 包的 domain 包。

## reference kit 的两半

每对名词插件对共享库 **reference kit** 的两半各调用一次。kit 只实现一次 kit 形状；名词包只填入各名词之间不同的部分。

**宿主一半：`@dv/reference-kit`。** 包 `packages/dv/reference-kit` 位于 base 层（[分层 Agent Note](2026-10-17-dv-architecture-layers.zh.md)）。`defineReference(spec)` 返回一个 Cordis 服务类，名词包默认导出它的一个子类，如 `packages/dv/character/src/index.ts` 中的 `class DvCharacter extends defineReference({...}) {}`。声明有七个字段：`service`、`component`、`noun`（`{ zh, en }`）、`meaning`、`reference`（输入角色）、`skill` 和可选的 `fields`。该类注入 `dvProject`，并注册组件键、reducer `referenceReducer(spec)`、同名的引用种类、标签由 `noun` 生成的操作 `<k>.create` 和 `<k>.update`，以及在 DSH skill 注册表已挂载时注册 skill `<k>`。`<k>.create` 拒绝含 `@` 或 `#` 的 ID，也拒绝 `dvProject.kindsWithId` 列出的任何 ID，因此 ID 在所有引用种类之间保持唯一。客户端入口 `@dv/reference-kit/types` 导出 `ReferenceVersion`、`ReferenceSlice` 和 `ReferenceKey`；只有当名词把键同时合并进 `ComponentStates` 和 `ReferenceKinds`、且其值为 `ReferenceSlice` 时，声明才能通过编译。该包不写出任何名词和媒体类型：声明提供名词文字和 `image` 输入角色。

**UI 一半：`ui-kit/src/client/reference-kit.tsx`。** 文件 `packages/dv/ui-kit/src/client/reference-kit.tsx` 以 `@dv/ui-kit/reference-kit.tsx` 导入，包含 `defineReferenceUi(spec)` 和 `ReferenceEditor`。声明有六个字段：`id`（包名，同时是编辑器 slot 键）、`key`、`slice`、`label`、`mention` 和可选的 `editor`。`defineReferenceUi` 返回该名词的 `NodeType`、`VersionKind`、在用引用、`MentionKind` 和 `HistoryRow`，以及 `apply(ctx)`：注册这些描述符和 `dv.canvas.editor` 条目的客户端插件主体。默认编辑器主体 `ReferenceEditor` 把每次改动都通过 `host.run` 写为 `<key>.update`。[UI 注册表 Agent Note](2026-10-17-dv-architecture-ui-registries.zh.md) 负责这些注册表，[客户端状态类型 Agent Note](2026-10-17-dv-architecture-client-state-types.zh.md) 负责 slice 缺失时的含义。UI 声明重复宿主声明中的标签对。

**扩展点。** 名词通过四种机制在 kit 内扩展：

- 宿主一半的 `fields`：额外的版本字段，每个字段是两个操作共有的一个参数；省略某字段的修改保留其上一个值。
- UI 一半的 `children`：`ReferenceEditor` 内额外的表单行，通过 `<key>.update` 写入。
- UI 一半的 `editor`：替代 `ReferenceEditor` 的完整编辑器主体。
- 更多 `<k>.*` 操作：名词的服务类在自己的构造函数中注册它们，因为该类继承 `defineReference` 返回的类。

## 谁导入 kit

只有六个名词包从 `src` 导入 kit：三个宿主包导入 `@dv/reference-kit`，三个 UI 包导入 `@dv/ui-kit/reference-kit.tsx`。除此之外，只有测试、`scripts/dv-architecture.ts` 及其 fixture（测试前置数据）、根 tsconfig 文件和 `pnpm-lock.yaml` 在代码中引用 kit；`packages/dv/COMPONENT-TEMPLATE.md`、`docs/dreamverse/architecture.md`、各包 README 和 Agent Notes 记述它。

其他插件只看到 kit 注册的内容。`@dv/chat-references` 为 `dvProject.listReferenceKinds()` 中的每个种类展开 `dv:<kind>/<id>`。运行器通过已注册的引用种类解析 `c1@3`。`@dv/api` 在 `mentionedAssets` 中从记录已解析的输入收集参考图。`@dv/ui-canvas`、`@dv/ui-composer` 和 `@dv/ui-history` 从 `dvCanvas`、`dvMentions` 和 `dvHistory` 注册表绘制。运行时没有插件依赖 kit，名词也可以绕过它：`packages/dv/COMPONENT-TEMPLATE.md` 展示了直接调用 `registerComponent`、`registerReducer`、`registerReferenceKind` 和 `registerOperation` 的写法，其他形状的组件（例如 `@dv/shot-plan` 和 `@dv/timeline`）就是这样自行注册的。

## kit 成员规则

名词只在其条目具有 kit 形状时留在 kit 上。

- **不为单个名词加选项。** kit 不添加只有一个名词使用的选项、分支、默认值或标记。名词只通过四个扩展点扩展。
- **离开 kit。** 如果某项需求改变版本形状、新建或修改的语义，或 `<id>@<version>` 解析到的内容，该名词就离开 kit。此后它的两个包直接向 `dvProject` 和画布注册表注册。这次迁移只修改这两个包，因为其他每个插件都通过内核和画布注册表读取名词。
- **至少两个名词，否则不保留。** kit 至少保留两个名词。只剩一个名词时，kit 合并回该名词。
- **预计的第一个案例。** 角色预计是第一个离开的名词，因为预计它会自己管理更多行为。

| 名词需要                                       | 机制                                | 是否留在 kit 上 |
| ---------------------------------------------- | ----------------------------------- | --------------- |
| 更多版本字段和表单行                           | `fields`、`children`                | 是              |
| 不同的编辑器，例如角色形象面板                 | `editor`                            | 是              |
| 更多操作，例如训练 LoRA 或检查面部一致性       | 名词服务类的构造函数                | 是              |
| 不同的版本含义，或不同的 `<id>@<version>` 结果 | 直接向 `dvProject` 和画布注册表注册 | 否              |

## UI 一半为何放在 ui-kit 中

宿主一半是独立的包，而 UI 一半是 `@dv/ui-kit` 中的一个文件，原因是[架构适应度测试](../process/2026-10-17-dv-architecture-fitness-test.zh.md)的导入规则：UI 层的包只能导入 `@dv/ui-kit`、以 `import type` 导入与之配对的宿主包的 `./types`，以及 UI 核心包的 slot 声明。这一放置反映的是改动的大小，并不表示引用名词与 `@dv/ui-kit` 的其他内容属于一类。该文件属于 UI 核心，因此受「UI 核心不写出插件名词」这条规则约束。

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
