---
description: "Browser half of the DreamVerse story workflow: the canvas chain anchor of story.approve, which hangs the records of an approval off its plan node and reads approved plan versions from the story slice, and the History row that names the plan and version of an approval and labels the renders folded under it."
kind: "package-reference"
---

# @dv/ui-workflow-story

English | [中文](README.zh.md)

## Summary

Use this package to show the records of the story workflow (`@dv/workflow-story`) on the canvas and in the History panel. It registers one chain anchor in `dvCanvas` of `@dv/ui-canvas` and one History row in `dvHistory` of `@dv/ui-history`. The anchor hangs the renders and the timeline record that a `story.approve` record started off the node of its plan, `plan:<PlanId>`, and gives the plan editor the approved versions of a plan. The row names an approval as `批准分镜计划 p1 v2` / `Approve plan p1 v2` and labels the toggle over the records folded under it `渲染 3 个镜头` / `Render 3 shots`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app`, `@dv/api`, `@dv/ui-canvas` and `@dv/ui-history`. Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-workflow-story
  name: '@dv/ui-workflow-story'
```

| Descriptor | Registry | Value |
| --- | --- | --- |
| `storyApprovalAnchor` | `dvCanvas.chainAnchors` | `starter: 'story.approve'`; `anchor` gives `plan:` + the record's `plan` param; `approvedVersions(state, 'plan:<p>')` gives the versions of the approvals of plan `<p>` in the `story` slice, in version order without repeats, and `[]` for any other node |
| `storyApprovalRow` | `dvHistory.rows` | `match: 'story.approve'`; the subject ` <plan> v<version>` from the record's `report`, or none while the record has no report; `fold(n)` gives `渲染 n 个镜头` / `Render n shots`, the label of the toggle over the records that the approval started, where n counts the folded records that History draws as media (the shot renders) |

The Host half registers nothing. The browser half registers the anchor inside `ctx.inject(['dvCanvas'], …)` and the row inside `ctx.inject(['dvHistory'], …)`, so it loads without either service, and each descriptor leaves with its service or with the plugin.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The client state type of `@dv/ui-kit` gives the `story` slice the type `unknown`. `approvedVersions` narrows it with `isStorySlice`, which accepts a slice that holds an `approvals` object, as the `story` reducer of `@dv/workflow-story` writes it: per plan, oldest first, `{version, record}`.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The inert Host Loader entry |
| [`src/client/index.ts`](src/client/index.ts) | `storyApprovalAnchor`, `storyApprovalRow`, and their registrations |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/workflow-story`](../workflow-story/README.md): `story.approve` and the `story` slice.
- [`@dv/ui-canvas`](../ui-canvas/README.md): how the canvas groups the records of an anchored chain and shows plan approval status, and the `ChainAnchor` descriptor type of `@dv/ui-canvas/contract`.
- [`@dv/ui-history`](../ui-history/README.md): how a History row gets its subject, and the `HistoryRow` descriptor type of `@dv/ui-history/contract`.

-----

<a id="model-experience"></a>
## Model Experience

None, as browser-side descriptors of the story workflow; they show its records and write no record.

#### KV Cache effect

None; the package sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Untyped story slice** — the client state type gives the `story` slice the type `unknown`, and `isStorySlice` checks only that the slice holds an `approvals` object; the package reads no client type of `@dv/workflow-story`.
