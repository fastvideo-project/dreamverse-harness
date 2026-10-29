---
description: "Story workflow of DreamVerse: the dvStory service with the read story.preview, which reports what approving a shot plan version renders and every render refusal, and story.approve, which renders the version and lays its takes on the plan's timeline; open it to change how a plan version is previewed or approved."
kind: "package-reference"
---

# @dv/workflow-story

English | [中文](README.zh.md)

## Summary

Use this package to preview and approve a shot plan version. Its read `story.preview` (tool `dv_story_preview`) lists each shot as rendered or kept and lists every reason a render would be refused. Its write `story.approve` (tool `dv_story_approve`) renders the new or changed shots and lays every take on the plan's timeline. The shots come from `dvShotPlan.shots`, the shot walk of `@dv/workflow-kit` picks the kept takes and schedules the renders, and `dvTimeline` lays out the takes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project`, `@dv/shot-plan`, `@dv/shot-render` and `@dv/timeline`. It has no configuration and registers the component key `story` with its reducer. While the skill registry `skills` of `@deepseek-ai/dsh-skill` is mounted, the plugin serves every `<name>/SKILL.md` of its [`skills/`](skills/) folder as a skill through one `FileSystemSkillProvider` of `@deepseek-ai/dsh-skill-filesystem`, named `workflow-story`; the provider reads no other folder.

```yaml
- id: dv-workflow-story
  name: '@dv/workflow-story'
```

| Operation | Tool | Params | Report |
| --- | --- | --- | --- |
| `story.preview` | `dv_story_preview` | `plan` (required, the PlanId), `version` (default: the latest) | `{plan, version, shots, rendered, problems}`: one line per shot, the number of shots that render, and `Shot <n>: <reason>` per refusal |
| `story.approve` | `dv_story_approve` | `plan` (required), `version` (default: the latest) | `{plan, version, timeline, scheduled}`: the timeline that holds the takes, and the records written: the renders in shot order, then the timeline record |

The labels are 预览分镜计划 / Preview plan and 批准分镜计划 / Approve plan. A rendered shot's line is `shot <n> (<modality>/<task>/<provider>/<model>, <d> s, continues from the previous shot): <first 80 characters of the prompt>`; a kept shot's line is `shot <n>: keeps its take`. An unknown plan or version fails the call with `invalid_params`; a reference that does not parse fails it with the error of `dvShotRender.parseInputs`.

`story.approve` has `confirm: 'always'`: an agent call needs `user_approved: true`, and its refusal text is the head line `Approve plan <p> v<n> "<title>": render <k> of <m> shots and lay every shot on the plan's timeline.` and the preview lines. While `problems` is not empty, every caller is refused before a record, with one error that lists the problems and ends with "Update the plan with dv_plan_update, then call again."

To add a workflow, add `skills/<name>/SKILL.md` with the frontmatter fields `name` and a quoted `description`; the provider serves the file with no code change. Then run `pnpm exec vitest run packages/bundle/dv/tests/skills.spec.ts -u` once to write its snapshot `packages/bundle/dv/tests/expected/skills/<name>.txt`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`story.preview` maps each shot of `dvShotPlan.shots` to render params with `walkShot` and calls `planShots` with `dvShotRender` and `takeFilter`. A done render is a take of the plan when the starter of its chain (`chainStarter`: its own `started_by`, else that of its `based_on` root) is a `story.approve` record of the plan. So a free take, a take of another plan and a take of `plan.approve` are never kept. Each shot that renders goes through `checkShots`: a continuing shot after a kept take carries that take's last still as `first_frame`; after a shot that renders, the role `first_frame` is chained, so the model check waits for that render. Each line comes from `shotLine`.

`story.approve` writes its whole chain inside its own execute. `scheduleShots` renders each shot that keeps no take, each after the render before it, with `first_frame` from the previous take when the shot continues, and the intent `shot <n> of plan <p> v<v>`. Then one `dvTimeline.layout` lays every take on a timeline, with the intent `timeline of plan <p> v<v>`. The `system` actor writes each record in the approving record's surface, session and turn, and each record carries `started_by: {record: <approval>, slot}` (slot null for the timeline). The plan's timeline is the timeline of its newest approval in the `story` slice. `keepTimeline` keeps it only while the starter of the record that `dvTimeline.lastWrite` names for it is a story approval of the plan. After another write, such as the user's edit, the layout creates the next free timeline and leaves the edited one unchanged.

The `story` reducer folds each finished `story.approve` into `approvals` (per plan, oldest first, `{version, record}`) and `timelines` (per plan, the timeline of the newest approval).

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvStory`: `story.preview`, `story.approve`, the plan walk, the preview lines, the problems and the chain |
| [`src/reducer.ts`](src/reducer.ts) | The `story` slice, its reducer and its project summary field |
| [`skills/story-directing/SKILL.md`](skills/story-directing/SKILL.md) | The `story-directing` skill: its frontmatter and body |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/workflow-kit`](../workflow-kit/README.md): `walkShot`, `planShots`, `takeFilter`, `checkShots`, `shotLine`, `scheduleShots` and `keepTimeline`.
- [`@dv/shot-plan`](../shot-plan/README.md): plans, versions and `dvShotPlan.shots`.
- [`@dv/shot-render`](../shot-render/README.md): `render`, `check` and `findTake` of `dvShotRender`.
- [`@dv/timeline`](../timeline/README.md): `layout` and `lastWrite` of `dvTimeline`.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

Two tools in the format `@dv/project` gives every operation tool. `dv_story_preview` has the hint "A read that writes no record." Its description says that the call previews what approving a plan version renders without rendering, names the report fields, tells the agent to show the lines to the user, and to update the plan with `dv_plan_update` and preview again when `problems` is not empty. `dv_story_approve` takes `user_approved`. Its description says that the call renders the new or changed shots and fills the plan's timeline, that the agent calls it only after it showed the preview and the user agreed, and that it then calls `dv_proj_wait` and reads `dv_proj_state`.

#### Token effect

About 450 tokens for the two definitions, fixed while the plugin is mounted.

#### KV Cache effect

The definitions sit in the stable tool section of every agent request; mounting or removing the plugin changes the tool list and invalidates the cached prefix from the tool section on.

### Tool results

#### What the model sees

A `dv_story_preview` call returns one text block: `done: dv_story_preview answered`, the params, and the report. A `dv_story_approve` call without `user_approved: true` is refused with the confirm text and the instruction to ask the user in the conversation, the question in bold; with it, the call returns `done <record>: plan p1 v2 approved` and the report. The project summary of `dv_proj_state` and the other `dv_proj_*` tools carries `story_approvals`: one `{plan, approved_version, timeline}` per approved plan, from its newest approval.

#### Token effect

A preview result is about 60 tokens, plus about 30 per shot line and per problem. An approval result is under 100 tokens plus one ID per scheduled record. `story_approvals` adds about 20 tokens per approved plan.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact.

### Skill

#### What the model sees

The skill catalog lists each workflow skill with its description. When the agent loads `story-directing`, it reads the order of calls: `dv_textnode_write` for the text nodes `story/theme.md`, `story/beats.md` and `story/storyboard.md`, each built from the text that `dv_textnode_read` returns for the stage before it and naming that stage in `from`; a summary and one question in bold, and no generation before the user agrees; then `dv_shot_render` per shot (with `continue_from` for a shot that continues the previous one), `dv_proj_wait` and `dv_timeline_create`. It also tells the agent how to extend, shorten or change a story on a timeline.

#### Token effect

One line in the skill catalog per workflow skill while the plugin is mounted, at most 400 code points (about 70 tokens for `story-directing`); each load adds the body of the skill, under 8192 code points (about 800 tokens for `story-directing`). [`skills.spec.ts`](../../bundle/dv/tests/skills.spec.ts) of `@dv/bundle` checks both limits.

#### KV Cache effect

The catalog entry sits in the stable skill section; mounting or removing the plugin changes the catalog. A loaded skill is appended to the conversation as a tool result; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Takes of `plan.approve`** — a take that `plan.approve` rendered starts at no story approval, so the first story approval of such a plan renders every shot again and lays the takes on the next free timeline.
