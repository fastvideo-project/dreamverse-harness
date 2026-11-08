---
description: "DreamVerse 参考名词（例如角色、场景和风格）的浏览器工具包：defineReferenceUi 把一个 ReferenceUiSpec 变成 UI 插件，注册该名词的画布节点类型、卡片和编辑器、版本种类、使用中的参考、@ 菜单种类和历史行；referenceDescriptors 返回同样的描述符而不生成插件。"
kind: "package-reference"
---

# @dv/ui-reference-kit

[English](README.md) | 中文

## 概述

使用本包，用一份声明为参考名词（例如角色、场景或风格）提供浏览器端的呈现。`defineReferenceUi` 返回的插件绘制每个条目的画布节点，该节点持有条目的每个版本，在素材选择窗口和 `@` 菜单中提供每个条目，在历史中为该名词的记录命名，并打开一个可以添加或移除条目参考素材的编辑器。`@dv/ui-character`、`@dv/ui-location` 和 `@dv/ui-style` 各是一份声明。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把 `@dv/ui-reference-kit` 加入名词 UI 包的 `devDependencies`，并导入 `@dv/ui-reference-kit/reference-kit.tsx`；`./*` 导出映射到 `src/client/*`，名词包的客户端 bundle 会内联该工具包。工具包没有 Loader 行：它的 Host 半边（`src/index.ts`）不导出任何内容。名词包导出插件，`@dv/ui-character` 就是这样做的：

```ts ignore-check
export const { inject, apply } = defineReferenceUi({
  id: '@dv/ui-character', key: 'character', slice: state => state.components.character,
  label: ['角色', 'Character'], mention: { section: ['角色', 'Characters'], order: 1 },
})
```

### 工具包 API

工具包是一个模块 [`src/client/reference-kit.tsx`](src/client/reference-kit.tsx)。它的描述符使用画布契约（`@dv/ui-canvas/contract`，即 `@dv/ui-canvas` 的 [`src/client/contract/index.ts`](../ui-canvas/src/client/contract/index.ts)）、历史契约（`@dv/ui-history/contract`）和 `@dv/ui-kit/registries.ts` 的类型。

| 符号 | 含义 |
| --- | --- |
| `ReferenceUiSpec<V>` | 一个名词：`id`（包名，每个描述符的所有者）、`key`（组件键，同时也是参考种类和节点类型键）、`color`（名词在主题节点色板中的位置，例如 `var(--dv-node-1)`）、`slice(state)`（名词的切片，从条目 ID 到其各版本的映射，名词的 Host 半边未加载时为 `undefined`）、`label`（卡片标签和选择窗口分区的中英文文本对），以及 `mention`（`@` 菜单分区的 `{ section, order }`） |
| `WireReferenceVersion` | wire 发送的条目的一个版本：`id`、`version`、`name`、`description`、`references` 和 `created_by`（写下它的记录） |
| `referenceDescriptors(spec)` | 为一个名词返回 `{ nodeType, versionKind, referencesInUse, mentionKind, historyRow }` |
| `defineReferenceUi(spec)` | 返回注册这些描述符以及卡片和编辑器条目的 `UiPlugin`（`{ inject: [], apply }`） |

描述符只读取名词自己的切片、`proj` 记录和 [`@dv/canvas`](../canvas/README.zh.md) 的节点列表；在节点列表中，`@dv/reference-kit` 的 `<key>.create` 在第 0 列产生条目的节点，每个 `<key>.update` 是它的一个版本：

- `nodeType` 是一个绘制 kind 为 `key` 的节点的 `NodeType`，颜色为声明的 `color`，主体高 30 px。对一个版本，它读取记录的 `<key>` 参数指名的条目：标题是最新版本的名称，没有时为记录的 `name` 参数（用于失败的新建），再没有时为条目 ID；`assets` 是最新的参考，`ref` 是 `{ kind: key, id }`。
- `versionKind` 是一个 `VersionKind`：`node(state, id)` 为持有该条目最新版本记录的节点，没有时为 null，`latest(state)` 列出每个条目的最新版本，`name` 和 `assets` 读取某个版本，版本不存在时分别为 null 和空。
- `referencesInUse` 是一个 `RecordsInUse`：`uses(state)` 列出最新参考的产出记录（`proj.created_by`）。
- `mentionKind` 是 `@dv/ui-composer` 的 `MentionKind`：条目为 `dv:<key>/<id>`，标签为名称（没有时为 ID），描述为说明的前 40 个字符，第一个参考作为缩略图。
- `historyRow` 是一个 `HistoryRow`：匹配 `<key>.`，主题取记录的 `name` 参数，没有时取它的 `<key>` 参数，显示为 「名称」（中文）或 “name”（英文），都没有时无主题。

在 `dvCanvas` 和插槽注册表存在时，插件先注册节点类型，再注册使用中的参考、版本种类，以及画布声明 `dv.canvas.card` 和 `dv.canvas.editor` 插槽后以 `key` 为键的条目；在此之内，它在 `dvMentions` 存在时注册 mention 种类。所以节点类型被拒绝时，该名词不留下这些注册中的任何一个。插件在 `dvHistory` 存在时注册历史行，`@dv/ui-canvas` 未加载时也会注册，因为历史行以该名词的操作为键。每个注册在任何加载顺序下都有效，并随它的服务或插件一起离开。

卡片主体画出 `@dv/ui-kit/frame.ts` 的 `CARD_SURFACE`，并在其上绘制三部分。第一个参考通过 `dv.media` 以用途 `card` 填满缩略图行和底栏上方的框，左上角覆盖一个带名词颜色和标签的标签块。条目有两个或更多参考时，下面是一行缩略图（用途 `thumb`），每个高 44 单位、宽至多 44 单位，画框放不下这一行时变窄，第一个带描边；参考超过四个时显示三个缩略图和其余参考的 `+N`。底栏给出参考数量和当前版本，例如 2 张参考图 · 第 2 版 / 2 references · v2。文字按 `textScale` 缩放；大于 1 时卡片去掉底栏，使放大的文字放得下。节点是窗口节点：它的 `sizing` 默认画框宽 208 单位，最窄画框宽 104 单位，高度均为该宽度的 4:3（第一个参考）加 32 单位的底栏，有两个或更多参考时再加 52 单位的缩略图行（默认为 208 × 188 和 208 × 240）。主体填满画布给定尺寸的画框，所以更大的画框在同样的缩略图行和底栏上方显示更大的第一个参考。编辑器主体通过 `dv.media` 以用途 `card` 绘制显示中版本的参考，即所显示记录写下的条目版本，没有时为最新版本，每个参考在高 220 px、比例与素材相同的框里（尺寸未知的素材为正方形）。点击属于项目素材的参考会打开 `host.preview`；× 移除该参考，只剩最后一个时禁用。说明不为空时编辑器显示说明。＋ 添加素材 / + Add asset 打开 `host.pickAssets(references, { versions: false }, …)`，并追加条目尚未持有的选中项。每次修改都调用 `host.run`，操作为 `<key>.update`，参数为 `{ [key]: id }`，参考作为角色 `reference` 的输入，意图为 在画布上给 <name> 添加参考 / Add references to <name> from the canvas，或 在画布上移除 <name> 的一个参考 / Remove a reference of <name> from the canvas。条目还没有版本时，编辑器不绘制任何内容。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`referenceDescriptors` 从声明一次性构建每个描述符，所以插件和测试持有同一批对象。没有名词切片的状态不含条目，所以在名词的 Host 半边加载之前，每个描述符都不列出任何内容。`defineReferenceUi` 把卡片和编辑器包进闭包持有声明的组件，并为每个可选服务开一个 `ctx.inject` 块，所以缺少某个服务只跳过它自己的注册。

`tests/reference-kit.client.spec.tsx` 在 `@dv/ui-kit/tests/fixture.client.tsx` 的夹具状态上声明仅用于测试的名词 `test_ref`。它用一个含多个版本、无名条目、无参考条目和无版本条目的状态，以及一个没有该切片的状态检查每个描述符。它与真实的 `@dv/ui-media` 和 `@dv/ui-asset-pool` 插件一起挂载插件，检查每个注册都出现并在销毁时离开。它在 `@dv/ui-canvas` 的 `buildCanvasGraph` 构建的节点上绘制卡片和编辑器，并检查图片、缩略图、`+N` 计数、底栏、主体高度、`<key>.update` 请求、预览、选择窗口和被禁用的最后一个 ×。

| 文件 | 内容 |
| --- | --- |
| [`src/client/reference-kit.tsx`](src/client/reference-kit.tsx) | 声明、描述符、插件、卡片和编辑器 |
| [`src/index.ts`](src/index.ts) | 空的 Host 入口 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/reference-kit`](../reference-kit/README.zh.md) 声明参考名词的 Host 半边。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md) 绘制节点类型并渲染卡片和编辑器条目。
- [`@dv/ui-history`](../ui-history/README.zh.md) 绘制历史行。
- [`@dv/ui-composer`](../ui-composer/README.zh.md) 列出 `@` 菜单种类。
- [`@dv/ui-media`](../ui-media/README.zh.md) 通过 `dv.media` 绘制编辑器的参考图。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；参考编辑器写下的 `<key>.update` 记录只经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；工具包不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **卡片和编辑器通过 `@dv/ui-kit` 的 hook 读取文案。** `ReferenceCard` 和 `ReferenceEditor` 用 `useText` 选择文本，节点类型、版本种类和 mention 种类的标签用 `pickText`，它们都跟随 `<html lang>`，而不是使用注入的 `hooks` 源和插槽的 `t`。
- **所有名词使用同一列。** `@dv/reference-kit` 的 `defineReference` 把每个名词节点放在第 0 列；`ReferenceUiSpec` 和 `ReferenceSpec` 都没有字段可以改变它。
- **最后一个参考不能移除。** 不带参考的 `<key>.update` 会保留当前的参考，所以编辑器在最后一个参考上禁用 ×。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
