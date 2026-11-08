---
description: "DreamVerse 的引用工具包：defineReference 把一个引用名词的声明变成它的 Cordis 服务，带组件、归约函数、引用种类、创建和更新操作以及 skill。"
kind: "package-reference"
---

# @dv/reference-kit

[English](README.md) | 中文

## 概述

使用本包声明一个引用名词：一类条目，比如一个人或一个地点，它把参考图保存为版本，镜头以 `<id>@<version>` 指明版本。`defineReference(spec)` 返回一个名词的服务类。该类向 `dvProject` 注册组件键 `spec.component`、它的归约函数、同名的引用种类、操作 `<k>.create` 和 `<k>.update`，以及名为 `<k>` 的 skill。工具包不写任何名词和媒体类型；名词用语、输入角色和 skill 由声明给出。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

名词包用 `@dv/reference-kit/types` 声明自己的 ID、版本和切片类型，把切片合并进 `@dv/project/types` 的 `ComponentStates`，把 ID 类型合并进 `ReferenceKinds`，并默认导出 `defineReference({...})` 的子类。该服务注入 `dvProject`，没有配置字段。

| 字段 | 含义 |
| --- | --- |
| `service` | Cordis 服务名，例如 `dvCharacter` |
| `component` | 组件键，同时是引用种类、ID 参数和操作前缀 |
| `noun` | 标签里的名词：新建<zh> / Create <en> 和 修改<zh> / Update <en> |
| `meaning` | 一个条目是什么，写进创建操作的描述 |
| `reference` | 两个操作的输入角色 |
| `skill` | skill 的 `description`、`whenToUse` 和正文文件的 `file` URL |
| `fields` | 可选的额外版本字段：两个操作上各一个参数，以及新 ID 的初始值 |

| 操作 | 参数 | 效果 |
| --- | --- | --- |
| `<k>.create` | `<k>`（ID，不含 `@` 或 `#`）、`name`、`description`、每个 `fields` 参数 | 新 ID 的第 1 版；`dvProject.kindsWithId` 列出该 ID 时失败 |
| `<k>.update` | `<k>`（ID）、`name`、`description`、每个 `fields` 参数 | 下一版；保留调用未改的内容；取代上一版的记录，并以它为 `based_on`，所以加入该条目的画布节点；ID 未知时失败 |

名词的切片是 `ReferenceSlice<V>`：从 ID 到按时间先后排列的版本的映射。一个版本（`ReferenceVersion<I>`）有 `id`、`version`、`name`、`description`、`references`（资产 ID）和 `created_by`（写出它的记录），以及每个 `fields` 值。[`@dv/canvas`](../canvas/README.zh.md) 的 `dvCanvasNodes` 加载期间，该服务把 `<k>.create` 注册为第 0 列 `<k>` 节点的 maker，所以每个条目是一个持有所有版本的画布节点。`referenceReducer(spec)` 是服务注册的归约函数。

-----

<a id="understand-the-implementation"></a>
## 理解实现

归约函数只读已完成的 `<k>.create` 和 `<k>.update` 记录。版本的参考图是记录输入解析出的资产；不带输入的更新保留上一版的图。引用种类从切片作答：`assetsOf` 给出一个版本的图，`createdBy` 给出写出它的记录，`latest` 给出一个 ID 的最新版本。所有注册都传变量，所以静态扫描只看到每个名词声明里的 `component:` 字面量。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `defineReference`、`referenceReducer`、引用种类、两个操作和 skill 注册 |
| [`src/types.ts`](src/types.ts) | `ReferenceVersion`、`ReferenceSlice` 和 `ReferenceKey` |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/project`](../project/README.zh.md)：操作、归约函数、引用种类、过期标记和撤销。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到的内容

每个名词两个工具，`dv_<k>_create` 和 `dv_<k>_update`，格式与 `@dv/project` 给每个操作工具的格式相同。每个工具在键 `<k>` 下接收 ID，以及 `name`、`description`（"Words carried into every prompt: wardrobe, mood, or look."）、每个 `fields` 参数和声明里的输入角色。创建描述说明该名词是什么、镜头以输入 `<k>@1` 指明它，以及 ID 不得与输入以 `<id>@<version>` 指明的任何其他条目重名。

#### Token 影响

一个名词的两个定义约 600 个 token，在名词插件挂载期间固定存在。

#### KV Cache 影响

定义位于每次智能体请求的稳定工具段；挂载或移除一个名词会改变工具列表，使工具段起的缓存前缀失效。

### 工具结果

#### 模型看到的内容

一次调用返回一个文本块：`done <record>: <k> <name> created`（更新为 `<k> <id> updated`）以及参数。被拒绝的 ID 返回说明原因的工具错误，例如 "The ID 'c1' already names a location; update it, or choose another ID."

#### Token 影响

每次调用约 50 个 token。

#### KV Cache 影响

结果在调用后追加到对话中；缓存前缀保持不变。

### Skill

#### 模型看到的内容

skill 目录列出每个已挂载名词的 skill `<k>`，带其声明里的 description 和 `whenToUse` 文本；加载它返回名词的 skill 文件。

#### Token 影响

目录条目和正文是名词包的文本；工具包不增加内容。

#### KV Cache 影响

目录条目位于稳定的 skill 段；挂载或移除一个名词会改变目录。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Skill 名称**：skill 名称就是组件键，而 DSH skill 名称须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，所以键中含 `_` 的名词没有 skill；skill 注册表会记录这次拒绝。
- **不能删除**：条目一旦创建就留在项目中；更新只能修改它。
