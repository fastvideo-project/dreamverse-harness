---
description: "DreamVerse 风格组件的浏览器半边：用 defineReferenceUi 声明的风格画布节点类型、卡片、编辑器、版本种类、在用参考、@ 菜单种类和历史行。"
kind: "package-reference"
---

# @dv/ui-style

[English](README.md) | 中文

## 概述

使用本包在 DreamVerse 视图中显示 `@dv/style` 的风格。`@dv/ui-reference-kit/reference-kit.tsx` 的一个 `defineReferenceUi` 声明给这个名词它的画布节点类型 `style`（名称 风格 / Style，节点 ID `style:<id>`）、版本种类、在用参考、`dv.canvas.card` 和 `dv.canvas.editor` 条目（套件默认的卡片和 `ReferenceEditor`）、`@` 菜单种类（分区 风格 / Styles，顺序 3，地址 `dv:style/<id>`）和历史行（`style.`）。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠加了 `dsh-web-app`、`@dv/api`、`@dv/style`、`@dv/ui-canvas` 和 `@dv/ui-media` 的 profile 中挂载插件，`@dv/ui-media` 的 `dv.media` 组件工厂绘制参考素材。先构建浏览器包：`pnpm run build` 写出 `lib/client.js`。

```yaml
- id: dv-ui-style
  name: '@dv/ui-style'
```

Host 半边不注册任何东西。浏览器半边在各服务存在时注册每个描述符，每次注册随其服务或插件一起移除。编辑器中的每次修改都通过 `host.run` 运行 `style.update`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 不做事的 Host Loader 入口 |
| [`src/client/index.ts`](src/client/index.ts) | `defineReferenceUi` 声明（文件导出它的 `inject` 和 `apply`） |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`@dv/style`](../style/README.zh.md)：`style` 切片及其操作。
- [`@dv/ui-reference-kit`](../ui-reference-kit/README.zh.md)：`defineReferenceUi` 构建的内容。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；其编辑器写下的 `style.update` 记录只经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；本包不向模型发送任何内容。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **第 0 列** —— 节点类型和其他名词一起位于第 0 列，颜色为 `var(--dv-node-7)`，因为 `ReferenceUiSpec` 没有列字段。
