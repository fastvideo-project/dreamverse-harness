---
description: "DreamVerse 角色组件的浏览器半边：用 defineReferenceUi 声明的角色画布节点类型、卡片、编辑器、版本种类、在用参考、@ 菜单种类和历史行。"
kind: "package-reference"
---

# @dv/ui-character

[English](README.md) | 中文

## 概述

使用本包在 DreamVerse 视图中显示 `@dv/character` 的角色。`@dv/ui-reference-kit/reference-kit.tsx` 的一个 `defineReferenceUi` 声明给这个名词它的画布节点类型 `character`（名称 角色 / Character，节点 ID `character:<id>`）、版本种类、在用参考、`dv.canvas.card` 和 `dv.canvas.editor` 条目（套件默认的卡片和 `ReferenceEditor`）、`@` 菜单种类（分区 角色 / Characters，顺序 1，地址 `dv:character/<id>`）和历史行（`character.`）。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠加了 `dsh-web-app`、`@dv/api`、`@dv/character`、`@dv/ui-canvas` 和 `@dv/ui-media` 的 profile 中挂载插件，`@dv/ui-media` 的 `dv.media` 组件工厂绘制参考素材。先构建浏览器包：`pnpm run build` 写出 `lib/client.js`。

```yaml
- id: dv-ui-character
  name: '@dv/ui-character'
```

Host 半边不注册任何东西。浏览器半边在各服务存在时注册每个描述符，每次注册随其服务或插件一起移除。编辑器中的每次修改都通过 `host.run` 运行 `character.update`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 不做事的 Host Loader 入口 |
| [`src/client/index.ts`](src/client/index.ts) | `defineReferenceUi` 声明（文件导出它的 `inject` 和 `apply`），以及 `NodeDataMap` 的 `character: ReferenceNodeData` 条目 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`@dv/character`](../character/README.zh.md)：`character` 切片及其操作。
- [`@dv/ui-reference-kit`](../ui-reference-kit/README.zh.md)：`defineReferenceUi` 构建的内容。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；其编辑器写下的 `character.update` 记录只经由 [`@dv/project`](../project/README.zh.md) 的 `dv:project` 提示词段落以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；本包不向模型发送任何内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **只有一种颜色** —— 节点类型使用 `var(--dv-kind-character)`，因为主题没有给每个名词的颜色变量。
