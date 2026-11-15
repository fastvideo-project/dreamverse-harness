---
description: "DreamVerse 的 Blender 工作流技能：在 DSH 技能注册表挂载期间，通过一个 FileSystemSkillProvider 提供 skills/blender-scenes/SKILL.md，即在用户连接的 Blender 中搭建、检查和渲染场景的流程。"
kind: "package-reference"
---

# @fastvideo/dreamverse-workflow-blender

[English](README.md) | 中文

## 概要

使用本包教智能体在用户连接的 Blender 中工作：修改前先读取场景，用小步的 Python 修改场景，查看结果，并用 [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.zh.md) 的工具把静帧和动画渲染进项目。在 DSH 技能注册表 `skills` 挂载期间，一个 `FileSystemSkillProvider`（提供方名称 `workflow-blender`）提供本包的 `skills/` 文件夹，不读取其他文件夹。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

与 `@fastvideo/dreamverse-blender-bridge` 一起挂载本插件；[`@fastvideo/dreamverse-blender`](../blender/README.zh.md) 会插入这两个插件。

```yaml
- id: dv-workflow-blender
  name: '@fastvideo/dreamverse-workflow-blender'
```

插件没有配置。唯一的技能是 `blender-scenes`：没有连接 Blender 时怎么做、修改前读取场景、每次 `dv_blender_run` 调用只做一个小修改、每次可见的修改后查看画面，以及把静帧和短动画渲染进项目。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`apply` 在 `ctx.inject(['skills'])` 中注册提供方，所以技能在注册表挂载期间存在，并随插件一起移除。提供方设置 `includeDefaultRoots: false`，只有一个自定义文件夹，即本包的 `skills/`。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 插件：名称、空配置和提供方注册 |
| [`skills/blender-scenes/SKILL.md`](skills/blender-scenes/SKILL.md) | Blender 流程 |
| [`tests/workflow-blender.spec.ts`](tests/workflow-blender.spec.ts) | 一个带技能注册表的 Loader 组合：提供的文件、不读取的用户技能文件夹，以及卸载时的移除 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.zh.md)：技能调用的工具和操作。
- [`@dv/workflow-story`](../workflow-story/README.zh.md)：同样形式的故事和广告工作流技能。

-----

<a id="model-experience"></a>
## 模型体验

### 技能目录

#### 模型看到什么

技能注册表挂载期间，技能目录列出 `blender-scenes` 及其描述；智能体用 `skill` 工具加载正文。

##### 目录条目

```markdown
- `blender-scenes`: The procedure for building, checking and rendering a 3D scene in the Blender that the user connected to the harness: read the scene, change it in small Python steps, look at the result, and render stills or animations into the project. For requests such as 'build a scene in Blender', 'add a camera move', 'light this set', or 'render this shot from Blender'.
```

#### Token 影响

目录中约 80 个 token，智能体每次加载技能约 800 个 token。

#### KV 缓存影响

挂载或移除插件会改变技能列表，`dsh-tool-skill` 追加一份替换目录；加载的技能正文作为工具结果追加。两者都不影响它们之前的缓存前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **只有英文**：技能正文是英文，与其他 DreamVerse 工作流技能相同。
