---
description: "DreamVerse 的工作流技能：一个 FileSystemSkillProvider 把每个 skills/<name>/SKILL.md（例如 story-directing 和 ad-making）作为技能提供；添加或修改某个工作流的调用顺序时打开本页。"
kind: "package-reference"
---

# @dv/workflow-story

[English](README.md) | 中文

## 概述

用本包为 DreamVerse 智能体提供工作流。每个工作流是一个技能文件 `skills/<name>/SKILL.md`，保存该工作流的调用顺序，例如 `story-directing`（把一个故事逐个镜头渲染到时间线上）和 `ad-making`（一条简短的产品广告）。默认不注册操作或工具；可选 MiniMax 集成增加一个受限的参考文档读取工具。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在带有 `@deepseek-ai/dsh-skill` 的技能注册表 `skills` 的组合中挂载本插件。默认由名为 `workflow-story` 的 `FileSystemSkillProvider` 提供 [`skills/`](skills/) 中的每个 `<name>/SKILL.md`，该提供方不读取其他文件夹。Web 创建项目时选择一个 MiniMax 技能或明确关闭，项目创建后选择固定且优先生效。可选配置 `minimaxSkillsMode`（`off`、`manual`、`auto`，默认 `off`）和 `minimaxSkill` 仅为没有保存选择的项目提供默认值，分别来自 `DV_MINIMAX_SKILLS_MODE` 和 `DV_MINIMAX_SKILL`。详见 [MiniMax 集成](minimax/README.zh.md)。

```yaml
- id: dv-workflow-story
  name: '@dv/workflow-story'
```

要添加工作流，就添加带有 frontmatter 字段 `name` 和带引号的 `description` 的 `skills/<name>/SKILL.md`；提供方无需改代码即可提供该文件。然后运行一次 `pnpm exec vitest run packages/bundle/dv/tests/skills.spec.ts -u`，写入它的快照 `packages/bundle/dv/tests/expected/skills/<name>.txt`。技能只在以 "If `<tool>` is in your tool list" 开头的行中写出本包 `dependencies` 之外的包的 `dv_*` 工具（`scripts/dv-architecture.ts` 的规则 R8g）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`apply` 等待 `skills`，并把提供方注册为副作用，所以技能随插件或注册表一起移除。`package.json` 的 `dependencies` 列出技能无需条件即可调用其工具的包：`@dv/project`（`dv_proj_*`）、`@dv/shot-render`（`dv_shot_render`）和 `@dv/timeline`（`dv_timeline_*`）。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 插件：`skills/` 上的技能提供方 |
| [`skills/story-directing/SKILL.md`](skills/story-directing/SKILL.md) | `story-directing` 技能 |
| [`skills/ad-making/SKILL.md`](skills/ad-making/SKILL.md) | `ad-making` 技能 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/shot-render`](../shot-render/README.zh.md)：`dv_shot_render` 及其参数 `continue_from`。
- [`@dv/timeline`](../timeline/README.zh.md)：`dv_timeline_create`、`dv_timeline_update` 和 `dv_timeline_export`。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

默认工具列表不变。启用 MiniMax 时增加 `dv_minimax_read_reference`；执行时必须已选中 Skill，只能读取该 Agent 当前所选 Skill 的文档。

#### Token 影响

默认不增加 token；启用 MiniMax 时增加一个参考文档读取工具的定义。

#### KV Cache 影响

默认工具部分不变。启用 MiniMax 会改变一次工具定义，后续路由不会改变工具定义。

### 工具结果

#### 模型看到什么

默认没有来自本包的工具结果。可选参考文档工具以文本返回所请求的原始文档。

#### Token 影响

默认不增加 token；按需读取参考文档时追加文档正文。

#### KV Cache 影响

可选参考文档结果追加到对话中，不改变更早的历史。

### 技能

#### 模型看到什么

技能目录列出每个工作流技能及其描述。智能体加载 `story-directing` 时，读到调用顺序：用 `dv_textnode_write` 写文本节点 `story/theme.md`、`story/beats.md` 和 `story/storyboard.md`，每个阶段都基于 `dv_textnode_read` 为上一阶段返回的文本，并在 `from` 中写明上一阶段；给出摘要并以粗体提一个问题，用户同意前不做任何生成；然后按故事顺序为每个镜头调用 `dv_shot_render` 和 `dv_proj_wait`，其中渲染接续上一镜头的镜头之前，智能体先用 `dv_asset_grab_still`（以及工具列表中有的 `dv_inspect_asset` 和 `dv_inspect_image`）检查上一镜头的结尾，再传 `continue_from` 渲染该镜头，渲染后检查两个镜头之间的衔接，衔接失败时提出一种修复方案并等待用户；最后调用 `dv_timeline_create`。它还告诉智能体如何延长、缩短或修改时间线上的故事。

#### Token 影响

挂载插件期间，每个工作流技能在技能目录中占一行，最多 400 个码点（`story-directing` 约 60 个 token）；每次加载加入技能正文，少于 8192 个码点（`story-directing` 约 1800 个 token）。`@dv/bundle` 的 [`skills.spec.ts`](../../bundle/dv/tests/skills.spec.ts) 检查这两个上限。

#### KV Cache 影响

目录条目位于稳定的技能部分；挂载或移除插件会改变目录。加载的技能作为工具结果追加到对话中；已缓存的前缀保持不变。

项目启用 MiniMax 后，路由仅将选中的官方 Skill 加入当前 Agent 的目录，并通过有日志记录的上下文消息追加其原始指令和独立兼容说明，确认回复会保留选择。关闭项目不接收 MiniMax 指令，也不展示当前 Agent 的参考读取工具。详见[选择规则与兼容性说明](minimax/README.zh.md)。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **故事文本只在回复中** — 智能体在回复中写出故事或广告规格，所以项目不保存它的记录。
