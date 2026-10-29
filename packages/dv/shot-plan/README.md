---
description: "Shot plan component of DreamVerse: the dvShotPlan service, plans with a PlanId and numbered versions, the operations plan.create and plan.update with their agent tools, shots that name a model of the model catalog by its modality, task, provider and model, and the plan state slice."
kind: "package-reference"
---

# @dv/shot-plan

English | [中文](README.zh.md)

## Summary

Use this package to plan a video before anything is rendered. A plan has a `PlanId` (`p1`, `p2`, …) and numbered versions, and each shot names the video model that renders it by its key in the model catalog of [`@dv/models`](../models/README.md): `modality`, `task`, `provider` and `model`. `plan.create` stores version 1 of a new plan and `plan.update` stores the next version. The agent calls them as `dv_plan_create` and `dv_plan_update`. A workflow plugin, such as [`@dv/workflow-story`](../workflow-story/README.md), approves a version and renders its shots. The operations declare the labels that the interface shows in place of their tool names: 新建分镜计划 / Create plan and 修改分镜计划 / Update plan.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project`; the asset pool stores the plan files. A plan version holds the shots, each with its model key (`modality`, `task`, `provider`, `model`), prompt, duration, inputs and the model's own parameters (`extra`), and the references the shots of task `ref2v` share. The plan stores each model key and each `extra` as written; the workflow that approves the plan checks them against the model catalog. The reducer keeps the `plan` slice: every version of every plan.

```yaml
- id: dv-shot-plan
  name: '@dv/shot-plan'
```

The plugin has no configuration fields.

| Operation | Tool | Params | Outputs and report | Confirm |
| --- | --- | --- | --- | --- |
| `plan.create` | `dv_plan_create` | `shots` (each `modality`, `task`, `provider` and `model` (the key of a model that `dv_models_list` lists), `prompt`, `duration_sec?`, `references?` (task `ref2v` only), `continue_previous?` (task `ref2v` only, never on shot 1), `seed?`, `extra?` (the model's own parameters, as `dv_models_get` lists them)), `title?`, `references?` (shared by the shots of task `ref2v`), `aspect_ratio?`, `resolution?`, `seed?` | `plan` (`plan.json`); report `{plan, version: 1}` with the assigned PlanId | `never` |
| `plan.update` | `dv_plan_update` | `plan` (PlanId) and the params of `plan.create`: the complete next version | `plan` (`plan.json`); report `{plan, version}` | `never` |

A `PlanId` is `p<n>`: `plan.create` assigns one more than the highest number any Shot plan record of the project stored in `report.plan`, anywhere in the history list, steps after the current position included, so no two plans of the history list share an ID. A version is numbered from 1, and a shot by its 1-based position in the version, so a shot added after six shots is shot 7. A reference is a version of a registered reference kind (`<id>@<n>`) or an asset ID. The slice `components.plan` is `{plans: Record<PlanId, PlanVersion[]>}`, oldest version first; a `PlanVersion` is the `Plan` fields with `version` and `created_by` (the `plan.create` or `plan.update` record). The service method `get(state, plan, version?)` returns one `PlanVersion` of a project state, and `shots(state, plan, version?)` resolves its shots the way every workflow reads a plan. A `ResolvedShot` holds the shot's 1-based `slot`, the `shot` as written, the plan's `aspect_ratio` and `resolution`, the shot's `seed` else the plan's, its own `extra` when it sets one, the `references` that apply (its own, else the plan's, none for a task other than `ref2v`) and `continuePrevious` (`continue_previous` on a shot of task `ref2v` after slot 1).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`plan.create` and `plan.update` validate their params with the runner, fail a plan without shots, and import the version as `plan.json` through `context.importAsset`; before their record is written, for every caller, they refuse a plan of an unknown PlanId (`plan.update`), a shot with references whose task is not `ref2v`, `continue_previous` on shot 1 or in a task other than `ref2v`, and a prompt that cites the first frame (`dv:input/first_frame`) of a shot that does not continue the previous shot, with one error that names every shot and its problem; they also refuse a reference that names an unknown version of a reference kind (`dvProject.parseReference`). They never read the model catalog: a shot's model key is stored as written, and the preview of the workflow that approves the plan reports a key that the catalog does not serve. Their summary is `plan <PlanId> v<version> with <n> shots`. Both specs set `omitParamsFromResult`, so their model-visible tool result leaves out the params, which the model's own tool call already holds; the logged result value keeps them. The component names no operation of another component.

The reducer ignores records that are not `done`: a finished `plan.create` adds version 1 of the plan its `report.plan` names, and a finished `plan.update` adds the next version of the plan its `plan` param names. Other records, such as a `plan.approve` record of an old log, and records that name an unknown plan apply nothing. The agent summary lists each plan once as `{plan, title, version, shots}`: the latest version and its shot count.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvShotPlan`: the two operations, PlanId assignment, `get` and `shots` |
| [`src/reducer.ts`](src/reducer.ts) | The `plan` reducer |
| [`src/types.ts`](src/types.ts) | `PlanId`, `Plan`, `Shot`, `PlanVersion`, `ResolvedShot`, `PlanState` |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/project`](../project/README.md): operations, scheduled runs, reducers and agent tools.
- [`@dv/models`](../models/README.md): the model catalog that the shots name their models from, with `dv_models_list` and `dv_models_get`.
- [`@dv/shot-render`](../shot-render/README.md): the operation `shot.render` that an approval schedules.
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md): the layout every component follows.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

Two tools, `dv_plan_create` and `dv_plan_update`, in the format `@dv/project` gives every operation tool. The descriptions tell the agent to create a plan only for a separate story, to give each shot a model from `dv_models_list`, a prompt written for it and, in `extra`, the model's own parameters as `dv_models_get` lists them, and to extend, shorten or change a story with `dv_plan_update` on its plan (passing the complete plan, every shot in order); they say that a plan renders nothing by itself and name no approval tool. Both carry the deterministic note.

#### Token effect

About 1,200 tokens for the two definitions, fixed while the plugin is mounted; the shared arguments of `@dv/project` add up to about 200 tokens to each definition.

#### KV Cache effect

The definitions sit in the stable tool section of every agent request; mounting or removing the plugin changes the tool list and invalidates the cached prefix from the tool section on.

### Tool results

#### What the model sees

A `dv_plan_create` call returns one text block such as `done <record>: plan p1 v1 with 2 shots` with the `plan.json` output and the report `{"plan":"p1","version":1}`; a `dv_plan_update` call returns `plan p1 v2 with 2 shots` and the report with the new version. Neither result repeats the plan. A plan that breaks a rule of its tasks is refused before any record with one sentence per problem, such as `continue_previous` on shot 1.

#### Token effect

A create or update result is about 60 tokens for any plan length: the record line, the `plan.json` output line, and the report.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact. A plan reaches the model only through the arguments of the model's own call.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Text-only plans**: the plan is a JSON file; there is no plan editor or preview beyond the record and the canvas node.
- **Model keys are not checked here**: `plan.create` and `plan.update` accept a model key that the catalog does not serve; the agent learns it from the preview of the workflow that approves the plan.
- **Only task `ref2v` takes references**: a shot carries the plan's references only for task `ref2v`, so a task added to `TaskMap` of `@dv/models` that takes references needs a change here.
