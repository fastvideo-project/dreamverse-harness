---
description: "Browser half of the DreamVerse shot render: the shot nodes of shot.render on the canvas with their card, editor and Retry action, the chat card of a dv_shot_render call, and the History row of shot.render records, declared with defineGenerationUi, and the parameter bar of shot.render in the node editor's composer."
kind: "package-reference"
---

# @dv/ui-shot-render

English | [中文](README.zh.md)

## Summary

Use this package to show the shots of the shot render operation `shot.render` on the DreamVerse canvas and in the History panel, and the calls of its agent tool `dv_shot_render` as chat cards. The package is a `defineGenerationUi` declaration of [`@dv/ui-generation`](../ui-generation/README.md) and a parameter bar: the kit supplies the shot card and editor, the 重试 / Retry action, the chat card, and the History row; the declaration supplies the label 镜头 / Shot, the status words, and the version's preview still; the bar supplies the editor's chips and words.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app` (which provides the chat and the UI slots), `@dv/api` (which serves `GET /api/dv/operations` and `GET /api/dv/tasks`), and the UI core that owns the surfaces this package fills: `@dv/ui-canvas` (the `dvCanvas` registries and the `dv.canvas.card` and `dv.canvas.editor` slots), `@dv/ui-history` (`dvHistory`), `@dv/ui-media` (the `dv.media` Factory that draws every asset), and `@dv/ui-composer` (`dvComposer` and the `dv.prompt` composer that the node editor draws). Each registration waits for its service through `ctx.inject`, so a profile without one of these packages leaves out only that surface. Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-shot-render
  name: '@dv/ui-shot-render'
```

The Host half registers nothing. The browser half registers the following entries, all through `defineGenerationUi`. A shot node is a node of kind `shot` in the node list of [`@dv/canvas`](../canvas/README.md), which `@dv/shot-render` makes from `shot.render` records; each version is a `shot.render` record, whose outputs are the video and its last still (`video`, `last_still`).

| Registration | Value |
| --- | --- |
| `dvCanvas.nodeTypes` | The node type `shot` (key `shot`, the kind that `@dv/shot-render` registers), labeled 镜头 / Shot, colored `var(--dv-node-3)`. While the newest version runs, its node shows 渲染中… / Rendering…; a node whose newest version failed shows 生成失败 / Render failed |
| `dvCanvas.actions` | `@dv/ui-shot-render:shot:retry`, 重试 / Retry on a node whose newest version failed: it reruns that version's operation with its inputs and params and `based_on` set to it, so the new version joins the node |
| `dv.canvas.card` key `shot` | The newest version's last still (its image output), else its first output, drawn through `dv.media` at purpose `card` in a 16:9 frame |
| `dv.canvas.editor` key `shot` | The node editor of `@dv/ui-generation` at the version that the editor's version strip selects: the video through `dv.media` at purpose `loop` with the still as its poster, the model and generation task, and the `dv.prompt` composer of `@dv/ui-composer` over the version's call, with this package's parameter bar |
| `dvComposer.paramBars` key `shot.render` | `shotRenderBar` of `src/client/param-bar.ts`, the declaration's `bar`, which the kit registers while `@dv/ui-composer` is loaded. Under the selected video model's `schema()`, its chips are 画幅 / Aspect ratio over `aspect_ratios`, 清晰度 / Resolution over `resolutions`, and 时长 / Duration over the whole seconds from the `min` to the `max` of `duration_sec`, which write `aspect_ratio`, `resolution`, and `duration_sec`. Its `@` filter takes the media types of the schema's `reference` input, listed or keyed, and its `max`. A schema that the catalog does not know gives no chip and no filter, so the node editor shows the declared params' chips and offers every media type. Its words are 描述画面，输入 @ 引用素材 / Describe the shot; type @ to cite an item, 渲染新版本 / Render new take, and the kind's running words 渲染中… / Rendering… |
| `tool.call.toolview` key `dv_shot_render` | The chat card, at the default priority 0. `@dv/ui-composer` registers a row for every operation tool at priority 1 and a row for every `DV_TOOL_LABELS` tool at priority 0.5, so the card renders in their place |
| `dvHistory.rows` match `shot.render` | The History row: no subject, and the record's last still as the thumbnail, else its first output |

| Chat card part | Value |
| --- | --- |
| Title | `operationLabel('shot.render', …)` of `@dv/ui-kit`: the operation's label in `GET /api/dv/operations` (渲染镜头 / Render shot), else `shot.render` |
| Model line (`data-testid="dv-composer-render-model"`) | The call's `model` and its `task` by its label in `GET /api/dv/tasks`, else by its name, joined by ` · ` (for example `fasth3 · 参考图生成` / `fasth3 · From references` for task `ref2v`) |
| Prompt | The call's `prompt` |
| Status | 渲染中… / Rendering… until the call settles, then 已渲染 / Rendered, or 生成失败 / Render failed for a failed call |
| Media | The first output in the result's presentation metadata, the video, drawn through `dv.media` at purpose `loop`: muted, looping, with controls, behind the image output as the poster |
| 在历史中查看 / Show in history (`data-testid="dv-composer-open-history"`) | On a settled call; dispatches `dv:history-focus` `{session, toolCall}`, and the History panel selects the record that the call wrote |

The card shows what it has while the arguments stream. Until the two lists load, or when a read fails, the title falls back as the table says and the model line shows the task name.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/client/index.ts` exports the `inject` and the `apply` of one `defineGenerationUi` call, whose `bar` is the parameter bar. A text model, such as `fasth3` for task `t2v`, has no `reference` input in its schema, so the bar's filter names no media type and the node editor offers no reference. The declaration's `preview` picks the image output, which the kit uses as the card's media, the poster of the editor and of the chat card, and the History thumbnail. The kit reads `GET /api/dv/operations` and `GET /api/dv/tasks` on the first subscription of the chat card or the node editor, and again on the next one after a failed read (`loadedOnce` of `@dv/ui-kit`); the parsed arguments, the outputs, and the history link come from `@dv/ui-kit/tool-rows.tsx`.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The inert Host Loader entry |
| [`src/client/index.ts`](src/client/index.ts) | The `defineGenerationUi` declaration of the `shot` nodes, with the parameter bar |
| [`src/client/param-bar.ts`](src/client/param-bar.ts) | The parameter bar of `shot.render` |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/shot-render`](../shot-render/README.md): the `shot.render` operation and its agent tool.
- [`@dv/ui-generation`](../ui-generation/README.md): `defineGenerationUi`, the node card and editor, and the chat card.
- [`@dv/ui-canvas`](../ui-canvas/README.md): the canvas node contract that the `shot` node type fills.
- [`@dv/ui-composer`](../ui-composer/README.md): the tool rows and the tool names in the chat, and the `dv.prompt` composer that draws the parameter bar.

-----

<a id="model-experience"></a>
## Model Experience

None, as browser-side canvas nodes and a tool card; it shows the calls and results of `dv_shot_render`, and its 重试 / Retry and 渲染新版本 / Render new take write `shot.render` records as user canvas writes, which reach the model only through [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the package sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Composer test IDs** — the chat card's model line keeps the test ID `dv-composer-render-model` from `@dv/ui-composer`, and the history link is the shared `HistoryLink` of `@dv/ui-kit`, whose test ID `dv-composer-open-history` the e2e story `history.e2e.ts` selects on tool rows.
