---
description: "DreamVerse 参考名词（例如角色、地点和风格）的浏览器端套件：defineReferenceUi 把一个 ReferenceUiSpec 变成该名词的画布节点类型、版本类别、使用中的版本、@ 菜单类别、历史行和编辑器条目。"
kind: "package-reference"
---

# @dv/ui-reference-kit

[English](README.md) | 中文

## 概述

使用本包，用一份声明为参考名词（例如角色、地点或风格）提供浏览器端的呈现。`defineReferenceUi` 返回该名词的描述符和注册它们的客户端插件主体：每个条目的最新版本在画布上一个节点、供素材选择窗口使用的条目版本、`@` 菜单条目、该名词记录的历史主体，以及一个为条目添加或移除参考素材的编辑器。`@dv/ui-character`、`@dv/ui-location` 和 `@dv/ui-style` 各是一个声明。

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

把 `@dv/ui-reference-kit` 加入名词 UI 包的 `devDependencies`，并导入 `@dv/ui-reference-kit/reference-kit.tsx`；`./*` 导出映射到 `src/client/*`，名词包的客户端打包会内联这个套件。套件没有 Loader 行：它的 Host 半边（`src/index.ts`）不导出任何东西。

| 符号 | 含义 |
| --- | --- |
| `defineReferenceUi(spec)`、`ReferenceEditor` | `defineReferenceUi(spec)`：由一个 `ReferenceUiSpec`（`id` 是包名，也是编辑器插槽键；`key` 是组件键、引用种类和节点类型；`slice(state)`，即该名词的切片，宿主半边未加载时为 `undefined`，此时各描述符不列出任何条目；`label`；`mention`；可选的 `editor`）生成一个参考名词的描述符：在第 0 列为每个条目的最新版本画一个节点 `<key>:<id>` 的 `NodeType`、一个 `VersionKind`、列出最新引用的生产记录的 `TakesInUse`、列出 `dv:<key>/<id>` 条目的 `MentionKind`、匹配 `<key>.` 并以记录的 `name`（否则以其 ID 参数）命名的 `HistoryRow`，以及注册它们和 `dv.canvas.editor` 条目的客户端插件主体 `apply(ctx)`；`ReferenceEditor`：默认编辑器主体（参考图、描述、`children` 行和“＋ 添加素材”），每次修改都通过 `host.run` 写入 `<key>.update`，用编辑器条目的 `renderFactorySlot` 通过 `@dv/ui-media` 的 `dv.media` 组件工厂以用途 `card` 绘制每张参考图，点击时打开 `host.preview` |
| `WireReferenceVersion` | 线上发送的条目的一个版本：`id`、`version`、`name`、`description`、`references` 和 `created_by`（写下它的记录） |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`defineReferenceUi` 只由声明构建一次每个描述符，所以插件和测试持有同一组对象。没有该名词切片的状态不含任何条目，所以在名词的 Host 半边加载之前，每个描述符都什么也不列出。`tests/reference-kit.client.spec.tsx` 在 `@dv/ui-kit/tests/fixture.client.tsx` 的夹具状态上声明仅用于测试的名词 `test_ref`，检查每个描述符、各项注册及其移除，以及编辑器写入的 `<key>.update`。

| 文件 | 内容 |
| --- | --- |
| [`src/client/reference-kit.tsx`](src/client/reference-kit.tsx) | 声明、描述符、插件主体和编辑器 |
| [`src/index.ts`](src/index.ts) | 空的 Host 入口 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/reference-kit`](../reference-kit/README.zh.md) 声明参考名词的 Host 半边。
- [`@dv/ui-canvas`](../ui-canvas/README.zh.md) 绘制节点类型并渲染编辑器条目。
- [`@dv/ui-history`](../ui-history/README.zh.md) 绘制历史行。
- [`@dv/ui-composer`](../ui-composer/README.zh.md) 列出 `@` 菜单类别。
- [`@dv/ui-media`](../ui-media/README.zh.md) 通过 `dv.media` 绘制编辑器的参考图。

-----

<a id="model-experience"></a>
## 模型体验

间接，经由 `@dv/project`；引用编辑器写下的 `<key>.update` 记录只通过 [`@dv/project`](../project/README.zh.md) 的 `dv:project` 提示词段落以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；这个套件不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **编辑器通过 `@dv/ui-kit` 的 hook 读取文案。** `ReferenceEditor` 用 `useText` 选择文字，描述符标签使用 `pickText`，它们跟随 `<html lang>`，而不是读取 inject 的 `hooks` 来源和插槽的 `t`。
- **最后一个参考不能移除。** 不带参考的 `<key>.update` 会保留当前的参考，所以编辑器在最后一个参考上禁用 ×。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
