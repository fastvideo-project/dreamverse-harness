---
description: "DreamVerse 的故事工作流：dvStory 服务及其只读操作 story.preview，报告批准分镜计划某个版本会渲染什么以及每条渲染拒绝，以及 story.approve，渲染该版本并把成片排到计划的时间线上；修改分镜计划版本的预览或批准方式时打开本页。"
kind: "package-reference"
---

# @dv/workflow-story

[English](README.md) | 中文

## 概述

用本包预览并批准分镜计划的某个版本。只读操作 `story.preview`（工具 `dv_story_preview`）把每个镜头列为渲染或保留，并列出渲染会被拒绝的每条原因。写操作 `story.approve`（工具 `dv_story_approve`）渲染新增或改动的镜头，并把每个成片排到计划的时间线上。镜头来自 `dvShotPlan.shots`，`@dv/workflow-kit` 的镜头遍历选出保留的成片并安排渲染，`dvTimeline` 排布成片。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project`、`@dv/shot-plan`、`@dv/shot-render` 和 `@dv/timeline` 之后挂载本插件。它没有配置，注册组件键 `story` 及其 reducer。挂载了 `@deepseek-ai/dsh-skill` 的技能注册表 `skills` 时，插件通过 `@deepseek-ai/dsh-skill-filesystem` 的一个名为 `workflow-story` 的 `FileSystemSkillProvider`，把 [`skills/`](skills/) 文件夹中的每个 `<name>/SKILL.md` 作为技能提供；该提供方不读取其他文件夹。

```yaml
- id: dv-workflow-story
  name: '@dv/workflow-story'
```

| 操作 | 工具 | 参数 | 报告 |
| --- | --- | --- | --- |
| `story.preview` | `dv_story_preview` | `plan`（必填，PlanId），`version`（默认：最新版本） | `{plan, version, shots, rendered, problems}`：每个镜头一行，需要渲染的镜头数，以及每条拒绝的 `Shot <n>: <reason>` |
| `story.approve` | `dv_story_approve` | `plan`（必填），`version`（默认：最新版本） | `{plan, version, timeline, scheduled}`：放置成片的时间线，以及写入的记录：按镜头顺序的渲染，然后是时间线记录 |

两个标签为 预览分镜计划 / Preview plan 和 批准分镜计划 / Approve plan。需要渲染的镜头一行为 `shot <n> (<modality>/<task>/<provider>/<model>, <d> s, continues from the previous shot): <提示词的前 80 个字符>`；保留成片的镜头一行为 `shot <n>: keeps its take`。未知的计划或版本使调用以 `invalid_params` 失败；无法解析的参考使调用以 `dvShotRender.parseInputs` 的错误失败。

`story.approve` 的 `confirm` 为 `'always'`：智能体调用需要 `user_approved: true`，其拒绝文本是标题行 `Approve plan <p> v<n> "<title>": render <k> of <m> shots and lay every shot on the plan's timeline.` 和预览行。只要 `problems` 不为空，每个调用方都在写记录之前被拒绝，错误列出所有问题，并以 "Update the plan with dv_plan_update, then call again." 结尾。

要添加一个工作流，添加带 frontmatter 字段 `name` 和带引号的 `description` 的 `skills/<name>/SKILL.md`；提供方无需修改代码即可提供该文件。然后运行一次 `pnpm exec vitest run packages/bundle/dv/tests/skills.spec.ts -u`，写入它的快照 `packages/bundle/dv/tests/expected/skills/<name>.txt`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`story.preview` 用 `walkShot` 把 `dvShotPlan.shots` 的每个镜头映射为渲染参数，并以 `dvShotRender` 和 `takeFilter` 调用 `planShots`。一条已完成的渲染是该计划的成片，条件是其链的起始记录（`chainStarter`：它自己的 `started_by`，否则为其 `based_on` 根记录的 `started_by`）为该计划的 `story.approve` 记录。所以自由成片、其他计划的成片和 `plan.approve` 的成片从不被保留。每个需要渲染的镜头都经过 `checkShots`：接在保留成片之后的接续镜头以该成片的最后一帧静帧作为 `first_frame`；接在需要渲染的镜头之后时，角色 `first_frame` 标为链上提供，模型检查等到那次渲染再做。每一行来自 `shotLine`。

`story.approve` 在自己的 execute 内写完整条链。`scheduleShots` 渲染每个不保留成片的镜头，每次渲染排在前一次之后；镜头接续时以前一个成片作为 `first_frame`，意图为 `shot <n> of plan <p> v<v>`。然后一次 `dvTimeline.layout` 把每个成片排到一条时间线上，意图为 `timeline of plan <p> v<v>`。`system` 行为者在批准记录的界面、会话和轮次中写每条记录，每条记录带 `started_by: {record: <批准>, slot}`（时间线记录的 slot 为 null）。计划的时间线是 `story` 切片中其最新一次批准的时间线。只有当 `dvTimeline.lastWrite` 为该时间线给出的记录，其起始记录是该计划的一次故事批准时，`keepTimeline` 才保留它。若之后有其他写入，例如用户的编辑，排布会创建下一个空闲时间线，并保持被编辑的时间线不变。

`story` reducer 把每条已完成的 `story.approve` 折叠进 `approvals`（按计划，最早的在前，`{version, record}`）和 `timelines`（按计划，最新一次批准的时间线）。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvStory`：`story.preview`、`story.approve`、计划遍历、预览行、问题和链 |
| [`src/reducer.ts`](src/reducer.ts) | `story` 切片、其 reducer 及其项目摘要字段 |
| [`skills/story-directing/SKILL.md`](skills/story-directing/SKILL.md) | `story-directing` 技能：它的 frontmatter 和正文 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/workflow-kit`](../workflow-kit/README.zh.md)：`walkShot`、`planShots`、`takeFilter`、`checkShots`、`shotLine`、`scheduleShots` 和 `keepTimeline`。
- [`@dv/shot-plan`](../shot-plan/README.zh.md)：计划、版本和 `dvShotPlan.shots`。
- [`@dv/shot-render`](../shot-render/README.zh.md)：`dvShotRender` 的 `render`、`check` 和 `findTake`。
- [`@dv/timeline`](../timeline/README.zh.md)：`dvTimeline` 的 `layout` 和 `lastWrite`。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

两个工具，采用 `@dv/project` 为每个操作工具提供的格式。`dv_story_preview` 带提示 "A read that writes no record."。其描述说明该调用在不渲染的情况下预览批准计划某个版本会渲染什么，列出报告字段，要求智能体把这些行展示给用户，并在 `problems` 不为空时用 `dv_plan_update` 更新计划后再次预览。`dv_story_approve` 接受 `user_approved`。其描述说明该调用渲染新增或改动的镜头并填充计划的时间线，智能体只在展示预览且用户同意之后才调用它，然后调用 `dv_proj_wait` 并读取 `dv_proj_state`。

#### Token 影响

两个定义约 450 个 token，插件挂载期间固定不变。

#### KV Cache 影响

定义位于每次智能体请求的稳定工具段；挂载或移除插件会改变工具列表，使工具段及其后的缓存前缀失效。

### 工具结果

#### 模型看到什么

`dv_story_preview` 调用返回一个文本块：`done: dv_story_preview answered`、参数和报告。不带 `user_approved: true` 的 `dv_story_approve` 调用被拒绝，返回确认文本以及在对话中以粗体向用户提问的指示；带上它时，调用返回 `done <record>: plan p1 v2 approved` 和报告。`dv_proj_state` 及其他 `dv_proj_*` 工具的项目摘要带有 `story_approvals`：每个已批准的计划一条 `{plan, approved_version, timeline}`，取自其最新一次批准。

#### Token 影响

预览结果约 60 个 token，每个镜头行和每条问题另加约 30 个。批准结果少于 100 个 token，每条已安排的记录另加一个 ID。`story_approvals` 每个已批准的计划约增加 20 个 token。

#### KV Cache 影响

每个结果在调用之后追加到对话；缓存前缀保持不变。

### 技能

#### 模型看到什么

技能目录列出每个工作流技能及其描述。智能体加载 `story-directing` 时，读到调用顺序：`dv_plan_create` 或 `dv_plan_update`，然后 `dv_story_preview`（`problems` 不为空时用 `dv_plan_update` 修改后再次预览），给出镜头表格并以粗体提一个问题，下一轮用 `user_approved: true` 调用 `dv_story_approve`，然后调用 `dv_proj_wait`。它还告诉智能体如何延长、缩短或修改由计划生成的故事。

#### Token 影响

插件挂载期间，每个工作流技能在技能目录中占一行，最多 400 个码点（`story-directing` 约 70 个 token）；每次加载追加该技能的正文，少于 8192 个码点（`story-directing` 约 800 个 token）。`@dv/bundle` 的 [`skills.spec.ts`](../../bundle/dv/tests/skills.spec.ts) 检查这两个上限。

#### KV Cache 影响

目录条目位于稳定的技能部分；挂载或移除插件会改变目录。加载的技能作为工具结果追加到对话中；已缓存的前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **`plan.approve` 的成片** — `plan.approve` 渲染的成片不以任何故事批准为起始记录，所以这样的计划第一次故事批准会重新渲染每个镜头，并把成片排到下一个空闲时间线上。
