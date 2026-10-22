---
description: "Browser half of the DreamVerse shot render: the video takes of shot.render on the canvas with their card, editor and Retry action, the chat card of a dv_shot_render call, and the History row of shot.render records, declared with defineGenerationUi."
kind: "package-reference"
---

# @dv/ui-shot-render

English | [中文](README.zh.md)

## Summary

Use this package to show the takes of the shot render operation `shot.render` (of `@dv/shot-render`) on the DreamVerse canvas and in the History panel, and the calls of its agent tool `dv_shot_render` as chat cards. The package is one `defineGenerationUi` declaration of [`@dv/ui-generation`](../ui-generation/README.md): the kit supplies the take card and editor, the 重试 / Retry action, the chat card, and the History row; the declaration supplies the label 版本 / Take, the status words, the first-frame column rule, the reference rule of a text render, and the still that stands for a take.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app` (which provides the chat and the UI slots), `@dv/api` (which serves `GET /api/dv/operations` and `GET /api/dv/tasks`), and the UI core that owns the surfaces this package fills: `@dv/ui-canvas` (the `dvCanvas` registries and the `dv.canvas.card` and `dv.canvas.editor.claimed` slots), `@dv/ui-history` (`dvHistory`), and `@dv/ui-media` (the `dv.media` Factory that draws every asset). Each registration waits for its service through `ctx.inject`, so a profile without one of these packages leaves out only that surface. Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-shot-render
  name: '@dv/ui-shot-render'
```

The Host half registers nothing. The browser half registers the following entries, all through `defineGenerationUi`. A take is a current record of `shot.render`, whose outputs are the video and its last still (`video`, `last_still`).

| Registration | Value |
| --- | --- |
| `dvCanvas.nodeTypes` | The node type `take` (keys `take` and `op:shot.render`), labeled 版本 / Take, colored `var(--dv-kind-take)`, in column 2. It claims the current records of `shot.render`, so the canvas draws each one as a take node; a take whose `first_frame` input it reads from another node sits one column right of that node (`deepenOn: ['first_frame']`). While a take runs, its node shows 渲染中… / Rendering…; a failed take shows 生成失败 / Render failed |
| `dvCanvas.actions` | `@dv/ui-shot-render:retry`, 重试 / Retry on a failed take: it reruns the take's operation with the take's inputs and params and `based_on` set to the take |
| `dv.canvas.card` key `take` | The take's last still (its image output), else its first output, drawn through `dv.media` at purpose `card` in a 16:9 frame |
| `dv.canvas.editor.claimed` key `take` | The take editor of `@dv/ui-generation`: the video through `dv.media` at purpose `loop` with the still as its poster, the model and generation task, the params that `shot.render` declares, reference chips unless the take's task is `t2v`, and 渲染新版本 / Render new take |
| `tool.call.toolview` key `dv_shot_render` | The chat card, at the default priority 0. `@dv/ui-composer` registers a row for every operation tool at priority 1 and a row for every `DV_TOOL_LABELS` tool at priority 0.5, so the card renders in their place |
| `dvHistory.rows` match `shot.render` | The History row: no subject, and the take's last still as the thumbnail, else its first output |

| Chat card part | Value |
| --- | --- |
| Title | `operationLabel('shot.render', …)` of `@dv/ui-kit`: the operation's label in `GET /api/dv/operations` (渲染镜头 / Render shot), else `shot.render` |
| Model line (`data-testid="dv-composer-render-model"`) | The call's `model` and its `task` by its label in `GET /api/dv/tasks`, else by its name, joined by ` · ` (for example `fasth3 · 参考图生成` / `fasth3 · From references` for task `ref2v`) |
| Prompt | The call's `prompt` |
| Status | 渲染中… / Rendering… until the call settles, then 已渲染 / Rendered, or 生成失败 / Render failed for a failed call |
| Media | The first output in the result's presentation metadata, the video, drawn through `dv.media` at purpose `player` |
| 在历史中查看 / Show in history (`data-testid="dv-composer-open-history"`) | On a settled call; dispatches `dv:history-focus` `{session, toolCall}`, and the History panel selects the record that the call wrote |

The card shows what it has while the arguments stream. Until the two lists load, or when a read fails, the title falls back as the table says and the model line shows the task name.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/client/index.ts` exports the `inject` and `apply` of one `defineGenerationUi` call and merges `take: null` into `NodeDataMap` of `@dv/ui-canvas/contract`, so a take node carries no plugin data. The declaration's `references` rule turns the reference chips off for task `t2v`, and its `preview` picks the image output, which the kit uses as the card's media, the editor's poster, the History thumbnail, and the frame of a plan's frame grid. The kit reads `GET /api/dv/operations` and `GET /api/dv/tasks` once, on the first subscription of the chat card or the take editor (`loadedOnce` of `@dv/ui-kit`); the parsed arguments, the outputs, and the history link come from `@dv/ui-kit/tool-rows.tsx`.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The inert Host Loader entry |
| [`src/client/index.ts`](src/client/index.ts) | The `defineGenerationUi` declaration of `shot.render` takes |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/shot-render`](../shot-render/README.md): the `shot.render` operation and its agent tool.
- [`@dv/ui-generation`](../ui-generation/README.md): `defineGenerationUi`, the take card and editor, and the chat card.
- [`@dv/ui-canvas`](../ui-canvas/README.md): the canvas node contract that the take node type fills.
- [`@dv/ui-composer`](../ui-composer/README.md): the tool rows and the tool names in the chat.

-----

<a id="model-experience"></a>
## Model Experience

None, as browser-side canvas nodes and a tool card; it shows the calls and results of `dv_shot_render`, and its 重试 / Retry and 渲染新版本 / Render new take write `shot.render` records as user canvas writes, which reach the model only through [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the package sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Composer test IDs** — the chat card's model line keeps the test ID `dv-composer-render-model` from `@dv/ui-composer`, and the history link is the shared `HistoryLink` of `@dv/ui-kit`, whose test ID `dv-composer-open-history` the e2e story `history.e2e.ts` selects on tool rows.
