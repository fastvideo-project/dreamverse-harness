# 引用名词

[English](reference-nouns.md) | 中文

本页是 DreamVerse 引用名词（reference noun）及其共享的 reference kit 的参考。这些名词是角色、场景和风格。宿主包 [`@dv/character`](../../../packages/dv/character/README.zh.md)、[`@dv/location`](../../../packages/dv/location/README.zh.md) 和 [`@dv/style`](../../../packages/dv/style/README.zh.md) 提供服务 `dvCharacter`、`dvLocation` 和 `dvStyle`，每个服务都是 [`@dv/reference-kit`](../../../packages/dv/reference-kit/README.zh.md) 上的一个声明。UI 包 [`@dv/ui-character`](../../../packages/dv/ui-character/README.zh.md)、[`@dv/ui-location`](../../../packages/dv/ui-location/README.zh.md) 和 [`@dv/ui-style`](../../../packages/dv/ui-style/README.zh.md) 在视图中显示这些名词，每个 UI 包都是 [`@dv/ui-kit`](../../../packages/dv/ui-kit/README.zh.md) 的文件 `packages/dv/ui-kit/src/client/reference-kit.tsx` 上的一个声明。`@dv/project` 的运行器、`@dv/chat-references`、`@dv/api`、`@dv/ui-canvas`、`@dv/ui-composer` 和 `@dv/ui-history` 通过 kit 注册的内容使用这些名词。[添加引用名词](../cookbook/adding-a-reference-noun.zh.md)给出添加名词的步骤，[引用名词 Agent Note](../../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-reference-nouns.zh.md) 给出这一设计的原因。

## 引用名词

引用名词是一种组件，其条目具有以下形状，称为 kit 形状：

- 每个条目有一个 ID 和一个版本列表。每次新建或修改都写入下一个版本，并保留之前的版本。
- 每个版本代表一组参考图（`references`，即素材 ID）。版本还带有名称和描述。
- 输入以 `<id>@<version>` 指定一个版本，例如 `c1@3`。运行器把该输入解析为该版本的参考图。
- 修改会取代写出上一个版本的记录。[项目](project.zh.md#staleness)页面的陈旧状态一节说明哪些记录随之变为陈旧。

一个键命名一个名词的每个部分。这些部分是组件键、引用种类、ID 参数、操作前缀、skill（技能）名称和画布节点类型。例如，键 `character` 命名切片 `components.character`、`character.create` 的参数 `character`、skill `character` 和节点 ID `character:c1`。

名词的切片类型是 `ReferenceSlice<V>`。它把每个 ID 映射到该 ID 的版本，按从旧到新排列。版本的类型是 `ReferenceVersion<I>`，字段为 `id`、`version`、`name`、`description`、`references` 和 `created_by`，即写出该版本的记录。`<k>.create` 写出的版本的 `version` 为 1，每次 `<k>.update` 加 1。

| 名词 | 键          | 宿主包（服务）                   | UI 包              | `@` 菜单分区和顺序   |
| ---- | ----------- | -------------------------------- | ------------------ | -------------------- |
| 角色 | `character` | `@dv/character`（`dvCharacter`） | `@dv/ui-character` | 角色 / Characters，1 |
| 场景 | `location`  | `@dv/location`（`dvLocation`）   | `@dv/ui-location`  | 场景 / Locations，2  |
| 风格 | `style`     | `@dv/style`（`dvStyle`）         | `@dv/ui-style`     | 风格 / Styles，3     |

## reference kit 的两半

reference kit 只实现一次 kit 形状，分为两半。宿主半部是包 `@dv/reference-kit`，包含 `defineReference`。UI 半部是文件 `packages/dv/ui-kit/src/client/reference-kit.tsx`，包含 `defineReferenceUi` 和 `ReferenceEditor`，UI 包以 `@dv/ui-kit/reference-kit.tsx` 导入它。每个名词包对所属的半部调用一次，只填入各名词之间不同的部分。下图显示名词 `<k>` 的两次调用以及每次调用注册的内容。

```text
┌─ host package @dv/<k> ────────────────────────────────────────────┐
│ export default class Dv<K> extends defineReference({              │
│   service, component: '<k>', noun, meaning, reference, skill,     │
│   fields? }) {}                                                   │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │ the constructor injects dvProject
                                  ▼
  dvProject.registerComponent       component key <k>
  dvProject.registerReducer         referenceReducer(spec)
  dvProject.registerReferenceKind   reference kind <k>: <id>@<version>
  dvProject.registerOperation       <k>.create   tool dv_<k>_create
  dvProject.registerOperation       <k>.update   tool dv_<k>_update
  skills.register                   skill <k>, while skills is present

┌─ UI package @dv/ui-<k> ───────────────────────────────────────────┐
│ export const <k> = defineReferenceUi({                            │
│   id: '@dv/ui-<k>', key: '<k>', slice, label, mention, editor? }) │
│ export const apply = <k>.apply                                    │
└─────────────────────────────────┬─────────────────────────────────┘
                                  │ apply(ctx)
                                  ▼
  dvCanvas.nodeTypes                NodeType, node ID <k>:<id>
  dvCanvas.takesInUse               references in use
  dvCanvas.versionKinds             VersionKind
  slots: dv.canvas.editor           editor body, key @dv/ui-<k>
  dvMentions.kinds                  MentionKind, dv:<k>/<id>
  dvHistory.rows                    HistoryRow, match <k>.
```

## 宿主声明：`defineReference`

`defineReference(spec)` 返回一个 Cordis 服务类。宿主包默认导出该类的一个子类，如 `packages/dv/character/src/index.ts` 中的 `class DvCharacter extends defineReference({...}) {}`。声明有以下字段：

- `service`：Cordis 服务名，例如 `dvCharacter`。
- `component`：名词的键。
- `noun`：操作标签中的名词文字 `{ zh, en }`，例如 新建角色 / Create character。
- `meaning`：一个条目是什么，写进 `<k>.create` 的描述。
- `reference`：两个操作的输入角色。kit 不写出任何媒体类型，因此由声明给出每个角色的 `image` 类型。
- `skill`：skill 的 `description` 和 `whenToUse` 文字，以及其正文的 `file` URL。
- `fields`：可选的额外版本字段。每个字段是两个操作共有的一个参数，并带有新 ID 的初始值。

服务类注入 `dvProject`。它的构造函数注册组件键、归约函数、引用种类、两个操作和 skill，如图所示。只有当 DSH skill 注册表 `skills` 存在时，构造函数才注册 skill。归约函数 `referenceReducer(spec)` 只读取已完成的 `<k>.create` 和 `<k>.update` 记录。它的 agent（智能体）摘要给出字段 `<k>s`，内容是每个 ID 的最新版本。引用种类通过以下方法读取切片：

- `assetsOf` 给出一个版本的参考图。
- `createdBy` 给出写出一个版本的记录。
- `latest` 给出一个 ID 的最新版本。

`<k>.create` 写出一个 ID 的第 1 版。它拒绝空 ID 和含 `@` 或 `#` 的 ID。它还拒绝 `dvProject.kindsWithId` 列出的 ID，因此 ID 在所有引用种类之间唯一。`<k>.update` 写出一个 ID 的下一版，并拒绝未知 ID。修改保留它省略的每个参数，不带输入的修改保留上一版的参考图。[`@dv/reference-kit` README](../../../packages/dv/reference-kit/README.zh.md) 列出两个操作的参数和模型看到的文字。

客户端入口 `@dv/reference-kit/types` 导出 `ReferenceVersion`、`ReferenceSlice` 和 `ReferenceKey`。只有键的类型是 `ReferenceKey` 时，声明才能通过编译。为满足这个类型，宿主包必须把该键同时合并进 `@dv/project/types` 的 `ComponentStates` 和 `ReferenceKinds`，且值为 `ReferenceSlice`。适应度规则 R2 和 R3 也适用于 kit 和每个 `defineReference` 键。[DreamVerse 架构检查](../architecture-checks.zh.md)的规则一节给出这两条规则。

## UI 声明：`defineReferenceUi`

`defineReferenceUi(spec)` 返回一个名词的各描述符和 `apply(ctx)`，即注册这些描述符的客户端插件主体。UI 包导出 `apply = <k>.apply`。声明有以下字段：

- `id`：包名，例如 `@dv/ui-character`。它是每个描述符的 ID，也是编辑器条目的键。
- `key`：名词的键。
- `slice`：从协议状态返回该名词切片的函数。宿主包未加载时切片为 `undefined`，此时各描述符不列出任何条目。
- `label`：卡片标签和选择器分区，例如 角色 / Character。
- `mention`：`@` 菜单分区及其顺序。
- `editor`：可选的编辑器主体。默认是 `ReferenceEditor`。

UI 包只能以 `import type` 导入其宿主包，因此无法在运行时读取 `noun`。所以 UI 声明重复宿主声明的标签对。

`apply(ctx)` 在每个描述符所属注册表的服务存在时注册该描述符。`dvCanvas` 来自 `@dv/ui-canvas`，它也声明 slot `dv.canvas.editor`。`dvMentions` 来自 `@dv/ui-composer`，`dvHistory` 来自 `@dv/ui-history`。节点类型为每个条目的最新版本画一个条目 `<k>:<id>`。在用参考是产出最新参考图的那些记录。提及种类把条目列为 `dv:<k>/<id>`。History 行匹配 `<k>.` 的记录，并以记录的 `name` 参数命名条目，否则以条目 ID 命名。

`ReferenceEditor` 是默认的编辑器主体。它显示参考图、描述、`children` 的各行，以及按钮 ＋ 添加素材 / + Add asset。每次改动都通过 `host.run` 以输入角色 `reference` 运行 `<k>.update`。版本只有一张参考图时，编辑器禁用移除按钮。

<a id="extension-points"></a>
## 扩展点

kit 有四个扩展点。名词包通过它们为自己的名词添加行为：

- 宿主声明的 `fields`：额外的版本字段。每个字段是两个操作共有的一个参数。
- `ReferenceEditor` 的 `children`：额外的表单行。包裹 `ReferenceEditor` 的 `editor` 主体传入它们。每一行通过 `update` 写入，`update` 以该行的参数、不带输入运行 `<k>.update`。
- UI 声明的 `editor`：替代 `ReferenceEditor` 的完整编辑器主体。
- 更多 `<k>.*` 操作：名词的服务类在自己的构造函数中注册它们，因为该类继承 `defineReference` 返回的类。

## 谁导入 kit

只有六个名词包在 `src` 中导入 kit。三个宿主包导入 `@dv/reference-kit`，三个 UI 包导入 `@dv/ui-kit/reference-kit.tsx`。其他每个插件都通过 kit 注册的内容读取名词：

- `@dv/project` 的运行器通过已注册的引用种类解析 `c1@3`。
- `@dv/chat-references` 为 `dvProject.listReferenceKinds()` 中的每个种类展开 `dv:<kind>/<id>`。
- `@dv/api` 从各记录已解析的输入中收集各版本的参考图（`mentionedAssets`）。
- `@dv/ui-canvas`、`@dv/ui-composer` 和 `@dv/ui-history` 从 `dvCanvas`、`dvMentions` 和 `dvHistory` 注册表绘制名词。

其他形状的组件，例如 `@dv/shot-plan` 或 `@dv/timeline`，自己调用 `dvProject.registerComponent`、`registerReducer` 和 `registerOperation`。`packages/dv/COMPONENT-TEMPLATE.md` 展示这些调用以及 `registerReferenceKind`。

<a id="kit-membership"></a>
## kit 成员规则

名词只在其条目具有 kit 形状时使用 kit。kit 遵循以下规则：

- **不为单个名词加选项。** kit 不添加只有一个名词使用的选项、分支、默认值或标记。名词包只通过四个扩展点添加行为。
- **直接注册。** 名词可能需要不同的版本形状、不同的新建或修改语义，或不同的 `<id>@<version>` 结果。此时它的两个包停止使用 kit，直接向 `dvProject` 和客户端注册表注册。这次改动只修改这两个包，因为其他每个插件都通过注册表读取名词。
- **至少两个名词，否则不保留。** kit 至少保留两个名词。只剩一个名词使用 kit 时，kit 的代码移入该名词的两个包。

代码评审执行这些规则。没有自动检查执行它们。[引用名词 Agent Note](../../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-reference-nouns.zh.md) 给出这些规则的原因。

| 名词需要                                       | 机制                                  | 是否使用 kit    |
| ---------------------------------------------- | ------------------------------------- | --------------- |
| 更多版本字段和表单行                           | `fields`、`children`                  | 是              |
| 不同的编辑器，例如角色形象面板                 | `editor`                              | 是              |
| 更多操作，例如训练 LoRA 或检查面部一致性       | 名词服务类的构造函数                  | 是              |
| 不同的版本含义，或不同的 `<id>@<version>` 结果 | 直接向 `dvProject` 和客户端注册表注册 | 否              |
