---
description: "The browser kit of DreamVerse generation primitives such as shot rendering: defineGenerationUi turns one GenerationUiSpec into the UI plugin that registers the canvas node type of the primitive's nodes, their card and node editor, the 重试 action, the chat card of each operation's agent tool, and the History row with a thumbnail."
kind: "package-reference"
---

# @dv/ui-generation

English | [中文](README.zh.md)

## Summary

Use this package to give a generation primitive, such as shot rendering, its whole browser presence from one declaration. The plugin that `defineGenerationUi` returns draws the primitive's canvas nodes, each with every version of one generation, opens a node editor that reruns a version with an edited prompt, references, and parameters, adds 重试 / Retry to a node whose newest version failed, draws the chat card of each operation's agent tool call, and shows each record in History with a thumbnail. `@dv/ui-shot-render` is one such declaration.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add `@dv/ui-generation` to the `devDependencies` of a primitive's UI package and import `@dv/ui-generation/generation-kit.tsx`; the `./*` export maps to `src/client/*`, and the primitive package's client bundle inlines the kit. The kit has no Loader row: its Host half (`src/index.ts`) exports nothing. The primitive package exports the plugin, as `@dv/ui-shot-render` does (its `apply` also registers its parameter bar of `@dv/ui-composer`):

```ts ignore-check
export const { inject, apply } = defineGenerationUi({
  id: '@dv/ui-shot-render', type: 'shot', operations: ['shot.render'], label: ['镜头', 'Shot'], color: 'var(--dv-node-3)',
  status: { running: ['渲染中…', 'Rendering…'], failed: ['生成失败', 'Render failed'], done: ['已渲染', 'Rendered'] },
  preview: outputs => outputs.find(output => output.mime.startsWith('image/'))?.id,
  bar: shotRenderBar,
})
```

### The kit API

The kit's entry is [`src/client/generation-kit.tsx`](src/client/generation-kit.tsx). Its descriptors are the types of the canvas contract (`@dv/ui-canvas/contract`, [`src/client/contract/index.ts`](../ui-canvas/src/client/contract/index.ts) of `@dv/ui-canvas`) and the History contract (`@dv/ui-history/contract`).

| Symbol | Meaning |
| --- | --- |
| `defineGenerationUi(spec)` | Returns the `UiPlugin` (`{ inject: [], apply }`) of one generation primitive |
| `GenerationUiSpec` | The declaration. Required: `id` (the registering package), `type` (the node type key, such as `'audio'`, the kind that the host primitive's `node` declares), `operations` (the generation operations of the kind, for the chat cards, the History rows and the parameter bars), `label` (the Chinese and English type label), `color` (a theme color, such as `var(--dv-node-3)`), and `status` (`StatusWords`). Optional: `fallbackRatio` (the frame aspect ratio, width ÷ height, of a node whose shown asset has an unknown width or height, such as an audio node; default 16:9), `subject(record)` (the History subject; default none), `bar` (the composer's parameter bar of the kind: the `placeholder` and `send` words, `chips(…)` and `candidates(schema)`; the kit registers it in `dvComposer.paramBars` for each operation while `@dv/ui-composer` is loaded, owned by `id` and with `status.running` as the words while a send runs, so a kind without `bar` still shows its running words), and `preview(outputs)` (the output that stands for a node in small views and that the editor's and the chat card's players show before they play, when it is not the first output; it reads the version's outputs with their MIME types) |
| `StatusWords` | The Chinese and English pairs `running`, `failed`, and `done` |

### What the plugin registers

The plugin registers its canvas parts (the node type, 重试, the card and the node editor) while `dvCanvas` and the slot registry exist, its chat cards while the slot registry exists, and its History rows while `dvHistory` exists, in any load order. The node type registers first among the canvas parts, so a refused node type leaves no other canvas part of the kind; the chat cards and History rows are keyed by tool and operation, so they register while `@dv/ui-canvas` is not loaded. Each registration leaves with its service or with the plugin:

- **The node type.** `dvCanvas.nodeTypes` keys it by `type`, so a second type with the same key throws with the holder's name, such as `registry key "shot" is already registered by @dv/ui-shot-render`. The canvas draws the nodes of kind `type` from the node list of `@dv/canvas`; the kit supplies, for one version, the title, the meta, the preview, the sizing, and the status words. A node is titled by its version's operation label in the interface language, else by the operation name, so every version of a node has one title; the canvas adds the version count to the meta. The meta is the duration of the first timed output, such as `2.5s`.
- **The card body**, the `dv.canvas.card` entry keyed by `type`. It draws the shown asset of the newest version, its preview, else its first output, through `dv.media` at purpose `card`, with `play` set while the node is selected and its editor is closed, so a video plays with its controls then. A generation node is a media node: its `sizing` is `mediaSizing` of `@dv/ui-kit/frame.ts` on the shown asset with no fixed bars, at the asset's aspect ratio clamped between 3:4 and 16:9, or at the type's `fallbackRatio` when the asset's width or height is unknown or the version has no outputs. The body fills the frame the canvas sizes, so the picture scales with the frame. A shown asset of known size fills it bare; any other node, such as an audio waveform or a pending version under the canvas's running words, paints `CARD_SURFACE`.
- **The node editor**, the `dv.canvas.editor` entry keyed by `type`, which shows the version that the editor's version strip selects, the newest by default. It plays the version's first output through `dv.media` at purpose `loop`, with the version's preview as the poster, and shows the failure reason of a failed version whose failure has a message. It shows the model and generation task (the task's label in `GET /api/dv/tasks`, else its name). When `GET /api/dv/operations` declares the version's operation, it then draws the `dv.prompt` composer of [`@dv/ui-composer`](../ui-composer/README.md) over the version's call: its operation and params, with `requestInputsOf(record)` of `@dv/ui-kit` as the inputs. The composer chooses the references, the parameter chips, and the words from the operation's inputs and from the parameter bar that the kit registers from the declaration. The composer's host opens the canvas's asset picker with the versioned items (`host.pickAssets(…, { versions: true }, …)`), imports uploaded files as canvas imports (`host.importFiles`), and opens the preview of an asset (`host.preview`) and the editor of another node (`host.openNode`). A send runs `host.rerun` with the edited call, `based_on` set to the version, and the intent 在画布上生成 {title} 的新版本 / Generate a new version of {title} from the canvas, so the new record becomes the newest version of the same node; while the rerun waits, the composer's send button is disabled and reads its sending words, and the composer shows a refused request's error. A version whose operation the list does not name shows no composer.
- **The 重试 / Retry action**, `<id>:<type>:retry` in `dvCanvas.actions`, order 0, so each kind of one package has its own. It shows only on a node whose newest version failed and is a record of the primitive's operations and runs `host.rerun` with the record's own operation and params, `requestInputsOf(record)` as the inputs (so a version that the record stores once per asset is sent once), and `based_on` the record.
- **The chat card**, one `tool.call.toolview` entry per operation, keyed by the operation's tool name, such as `dv_shot_render` for `shot.render`. It shows the operation's label, the status words of the call's phase, the model and task line, the prompt, the first output through `dv.media` at purpose `loop`, muted behind the output that `preview` picks as the poster, and 在历史中查看 / Show in history once the call settled.
- **The History rows**, one `dvHistory.rows` entry per operation. Each gives `spec.subject` as the subject and marks a media row whose thumbnail is `spec.preview`, else the first output.

The chat card and the node editor read the operation labels and the task labels through the inject `hooks` of [`src/client/loaded.ts`](src/client/loaded.ts): two sources that load `GET /api/dv/operations` and `GET /api/dv/tasks` on the first subscription and stay empty after a failed load, so every reader falls back to names until the next subscription loads again. The node editor reads only the task labels; it reads the declarations from its `operations` owner prop.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`defineGenerationUi` builds the node type, the 重试 action, and the History rows from the spec once, then registers them from `apply` inside one `ctx.inject` block of `dvCanvas` and `slots`, with a nested block of `dvHistory` for the History rows. The host's node list holds every version of a node, and the canvas hands the node type's `entry` one version, so a drawn node cannot disagree with its records. The node editor reads whether the version's operation is declared from the `operations` owner prop that the canvas passes; the `dv.prompt` composer reads the declared params itself, so the kit reads no `@dv/ui-kit/form.ts`.

The specs under `tests/` mount the kit under `SlotTestRuntime` of `@deepseek-ai/dsh-client-test-runtime`, with the real `@dv/ui-media` and `@dv/ui-asset-pool` plugins drawing the media. `tests/take-kind.client.ts` defines the test kind `test_take` for `shot.render` and `clip.extend`, mounts the composer stack (`composerStack` of `../ui-composer/tests/composer-stack.client.ts`) that the node editor draws, and defines a recording canvas host. `generation-kit.client.spec.tsx` checks the titles, the meta, the preview, the status words, the card body, the 重试 action, and the removal of every registration on unload. `take-editor.client.spec.tsx` checks the player, the mode line, the composer over the version's call, the rerun request with a fanned-out version sent once, a changed parameter chip, the sending words, the references that the composer opens and picks, a version whose operation declares no `reference` input, and the errors; `generation-card.client.spec.tsx` checks the chat card in a chat session. `plugin-proofs.client.tsx` holds the checks that each primitive's own spec runs on its plugin: it mounts the canvas with the plugin before `@dv/ui-canvas`, finds exactly one node of a record, renders a settled chat card, and lists every injected or owner value that is not JSON data or a function. `plugin-proofs.client.spec.tsx` runs those checks on `@dv/ui-shot-render`.

| File | Content |
| --- | --- |
| [`src/client/generation-kit.tsx`](src/client/generation-kit.tsx) | The spec, the node type, the card body, the 重试 action, the History rows, and the plugin |
| [`src/client/TakeEditor.tsx`](src/client/TakeEditor.tsx) | The node editor |
| [`src/client/GenerationCard.tsx`](src/client/GenerationCard.tsx) | The chat card and `StatusWords` |
| [`src/client/loaded.ts`](src/client/loaded.ts) | The operation and task label sources |
| [`src/client/generation-card.module.css`](src/client/generation-card.module.css) | The chat card styles |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/generation`](../generation/README.md) declares the Host half of a generation primitive.
- [`@dv/ui-canvas`](../ui-canvas/README.md) draws the nodes of the node list and renders the card and editor entries; [`@dv/canvas`](../canvas/README.md) holds the node list.
- [`@dv/ui-composer`](../ui-composer/README.md) draws the node editor's `dv.prompt` composer and holds the parameter bars.
- [`@dv/ui-media`](../ui-media/README.md) draws every output through `dv.media`.
- [`@dv/ui-history`](../ui-history/README.md) draws the History rows.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the records that the node editor's send and the 重试 action write reach the model only through the project state and update messages and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the kit sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The views read their copy through `@dv/ui-kit` hooks.** `TakeEditor` and `GenerationCard` pick their text with `useText`, and the node type label, the status words, and the 重试 label use `pickText`, which follow `<html lang>`, instead of an inject `hooks` source and the slot's `t`.
- **Each generation plugin loads the labels itself.** `apply` creates its own `DvClient` for the label sources, so each plugin requests `GET /api/dv/operations` and `GET /api/dv/tasks` once, and the chat card reads the operation labels from that copy while the node editor reads the canvas's `operations`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
