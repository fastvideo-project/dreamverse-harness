---
description: "The DreamVerse History panel: the steps of a project's history list, one row per action, newest first, with the current position marked, steps after it greyed, folds of started records, output previews, undo and redo, 回到这一步 on a row, and focus of a record on the canvas or the timeline."
kind: "package-reference"
---

# @dv/ui-history

English | [中文](README.zh.md)

## Summary

Use this package to give the web application a History panel beside the chat. The panel works like the History panel of an image editor ([history rules](../../../docs/subsystems/video-harness.md#history-rules)): it is one list of the steps of the open project from every actor, surface, and chat session, newest first. The step at the current position carries 当前 / Current, and the steps after it, which redo brings back, are greyed. Each row shows who did it, when, the status, and a thumbnail; selecting a row plays its output and, for a step at or before the current position, focuses it on the canvas or timeline. The header holds the undo and redo buttons, and each row's ⋮ menu offers 回到这一步 / Go back to this step. These moves write no record; a new step after a move discards the greyed steps. The `dv-history` right-Sidebar tab type shows the panel of the project the shell has open.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app` (which provides the right Sidebar and the client module loader) and `@dv/api` (which serves the routes the panel calls). Mount `@dv/ui-media` too: its `dv.media` Factory draws the thumbnails and the players. Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

The panel asks for the steps of the project's history list, newest first. Each row shows the operation label (`operationLabel` of `@dv/ui-kit`: the operation's `label` in `/api/dv/operations`, else its tool label, else the operation name) with its subject (渲染镜头 1 / Render shot 1, 新建角色「name」), who did it (你 / You, 智能体 / Agent, 自动 / Automatic), how long ago, the status (a failed or cancelled row also shows the record's error message under its meta line, clamped to two lines, the full text on hover), and, on a media row only (a record whose registered `HistoryRow` has `media`), one thumbnail: the asset that the row's `media.thumbnail(record, state)` names, drawn through the `dv.media` Factory at purpose `thumb`, such as a take's preview output, else its first output (`defineGenerationUi` of `@dv/ui-generation`), else an empty square that keeps media rows aligned; other rows are text only. A selected row draws under it its first output through `dv.media` at purpose `loop`, so a video plays muted and looping, as do an import, a still, a cut, and an export. An agent row also shows on its second line the record's own `intent`, the reason the agent gave for the call. The subject comes from the `HistoryRow` registered for the operation (an exact operation name first, then `'<key>.'`), such as the `character.` row of `@dv/ui-character`; else a record with a chain slot names the slot, with ` · <lane>` when the chain has a lane (`chainOf` of `@dv/ui-kit`: the record's `started_by`, else that of its `based_on` root, so a canvas retake keeps its shot number). The loaded records whose `started_by.record` is a row's record fold under that row in log order behind a toggle. The toggle shows the starter row's `fold(count)` over the folded media rows, such as 渲染 n 个镜头 / Render n shots, else the label of the first folded record, and adds the count of finished media rows while some are unfinished. The row of the current position carries 当前 / Current, and the rows after it are greyed: faded text and a black-and-white thumbnail. Every other row ends in a ⋮ button (更多操作 / More actions) whose menu offers 回到这一步 / Go back to this step (`/api/dv/undo` with `to` = that step), which moves the current position to that step, before or after the current one.

```yaml
- id: dv-ui-history
  name: '@dv/ui-history'
```

The Host half registers nothing. The browser half provides the client service `dvHistory` (`DvHistory` of `@dv/ui-history/contract`), registers the `dv-history` tab type (a page the Sidebar's guide offers as "History") and the tab body under its own id `@dv/ui-history`, and opens the tab when a `dv:history-focus` window event arrives. A plugin's UI half names the records of its operations inside `ctx.inject(['dvHistory'], …)` with `ctx.dvHistory.rows.register({ match, subject, label, focus, media, fold })`, whose disposer it keeps; `match` is an operation name or `'<key>.'`, and a second row with the same `match` throws. The optional `focus(record, records)` gets the records of the current state and returns where selecting the record moves the center, a `CenterTarget` of `@dv/ui-shell/contract` (`view`, the `id` of a `dv.center.view` entry, and `target`, the JSON target that the view reads), or null; without `focus`, the target is the record's canvas node (`{ view: 'canvas', target: { record } }`), except that a `proj` record moves nothing. The optional `label(record, { state, operations })` returns the whole action label in place of the operation label and the subject, for a label that reads the project's current state (null while it is not loaded), such as 移动节点 / Moved “{title}” of `@dv/ui-canvas` with the title of the moved node's card; null falls back to the operation label and the subject. The optional `media` marks a media row, and its `thumbnail(record, state)` returns the asset ID of the row's thumbnail or null, and the optional `fold(count)` returns the label of the records folded under the row. `ctx.dvHistory.describe(record, { operations, records })` returns the label that History shows for a record of a media row, reading the records of the current state for the chain of a retake, its operation label and its row's subject, and null for any other record; the media captions of the chat (`@dv/ui-composer`) read it, else the asset's name.

| Gesture | Request or event |
| --- | --- |
| Open the panel, page with "Load more" | `POST /api/dv/history`; 50 entries per page, `before` for the next page |
| Select a row of the current state whose matching `HistoryRow` has a `focus`, such as a Timeline row or a timeline export (the `timeline.` row of `@dv/ui-timeline`) | `ctx.dvCenter.show` with the target that `focus` returns, such as `{ view: 'timeline', target: { timeline, clip } }`; the shell shows the timeline and the editor selects the clip |
| Select any other row of the current state except a `proj` row, such as a render, character, plan, or asset row | `ctx.dvCenter.show({ view: 'canvas', target: { record } })`; the shell shows the canvas and the canvas opens the record's node |
| "Show in trajectory" in a selected agent row | `dv:trajectory-focus` `{session, toolCall}`; the shell opens 轨迹 on that chat session |
| Undo in the header (tooltip 撤销（Ctrl+Z / ⌘Z）) | `POST /api/dv/undo`; a refusal shows the server's message |
| Redo in the header (tooltip 重做（Shift+Ctrl+Z / ⇧⌘Z）), disabled while the current position is the last step | `POST /api/dv/redo` |
| 回到这一步 / Go back to this step in a row's ⋮ menu | `POST /api/dv/undo` `{to}` |

A `dv:history-focus` event `{session, toolCall}` finds the record that tool call wrote, loads pages until its row is loaded, and selects it. Only steps at or before the current position move the center; greyed steps are only selected. A selection moves the center only while `@dv/ui-shell` provides `dvCenter`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`HistoryPanel` reads the project's current state with `useProjectState` for the records of the current state and the rows' thumbnails, reads the operation declarations with `useOperations`, and lists the history through `POST /api/dv/history`. It takes the registered rows as the prop `rows` and the required prop `renderFactorySlot`, the Factory renderer of the slot entry that mounts it, which draws the thumbnails and the players; the tab body passes the rows of its inject `hooks` source and its own Factory renderer. `actionRows` folds each started record under the row of its starter, `actionLabel` names each record, and `centerFocus` decides where a selected row moves the center: nothing for a greyed step, else the `focus` of the matching registered row, else nothing for a `proj` record, else the record's canvas node. A record is a media row when its registered row has a `thumbnail`. A media row has the thumbnail column, plays its first output while selected, and counts in its starter's fold. Each entry's `place` sets the 当前 mark, the grey rows, and the rows that offer 回到这一步. On `/dv/events`, an `update` event replaces the record in the loaded rows, and a `record` or `line` event refetches the loaded window, debounced by 200 ms.

| File | Content |
| --- | --- |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | The type of the CSS Module imports |
| [`src/client/contract/index.ts`](src/client/contract/index.ts) | `@dv/ui-history/contract`: `HistoryRow`, `DvHistory`, the text pair `Text`, and the `dvHistory` service type |
| [`src/client/index.ts`](src/client/index.ts) | The `dvHistory` service, registrations, and the tab opening on `dv:history-focus` |
| [`src/client/definition.ts`](src/client/definition.ts) | The tab type |
| [`src/client/HistoryPanel.tsx`](src/client/HistoryPanel.tsx) | The panel, its header with the undo and redo buttons, rows with their ⋮ menus, preview, and the tab body |
| [`src/client/HistoryPanel.module.css`](src/client/HistoryPanel.module.css) | Styles of the panel |
| [`src/client/rows.ts`](src/client/rows.ts) | Action rows and the folds of started records, the matching registered row, labels with subjects, relative times, and center targets |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [History rules](../../../docs/subsystems/video-harness.md#history-rules) — which changes are steps, and what undo, redo and 回到这一步 do.
- [`@dv/api`](../api/README.md) — the history route and the undo and redo routes.
- [`@dv/project`](../project/README.md) — the history query, undo and redo.
- [`@dv/ui-shell`](../ui-shell/README.md) — `dvCenter` and `CenterTarget`, which move the workspace center to a selected record.
- [`@dv/ui-kit`](../ui-kit/README.md) — the API client, the wire types, the window events, and the tool labels.
- [`@dv/ui-media`](../ui-media/README.md) — the `dv.media` Factory that draws the thumbnails and the players.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the moves of the History panel change the current state, which reaches the model only through the project state and update messages and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the panel sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Window refetch** — every `record` or `line` event refetches the loaded window (up to 200 entries); a long history scrolled far back reloads slowly.
