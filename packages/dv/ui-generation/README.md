---
description: "The browser kit of DreamVerse generation primitives such as shot rendering: defineGenerationUi turns one GenerationUiSpec into the UI plugin that registers the claimed canvas node type of the primitive's takes, their card and take editor, the 重试 action, the chat card of each operation's agent tool, and the History row with a thumbnail."
kind: "package-reference"
---

# @dv/ui-generation

English | [中文](README.zh.md)

## Summary

Use this package to give a generation primitive, such as shot rendering, its whole browser presence from one declaration. The plugin that `defineGenerationUi` returns draws each record of the primitive's operations as a take on the canvas, opens a take editor that reruns the take with an edited prompt, references, and parameters, adds 重试 / Retry to failed takes, draws the chat card of each operation's agent tool call, and shows each record in History with a thumbnail. `@dv/ui-shot-render` is one such declaration.

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
  id: '@dv/ui-shot-render', type: 'take', operations: ['shot.render'], label: ['版本', 'Take'], color: 'var(--dv-node-3)',
  deepenOn: ['first_frame'],
  status: { running: ['渲染中…', 'Rendering…'], failed: ['生成失败', 'Render failed'], done: ['已渲染', 'Rendered'] },
  preview: (record, state) => record.outputs.find(id => state.assets.find(asset => asset.id === id)?.mime.startsWith('image/') === true),
})
```

### The kit API

The kit's entry is [`src/client/generation-kit.tsx`](src/client/generation-kit.tsx). Its descriptors are the types of the canvas contract (`@dv/ui-canvas/contract`, [`src/client/contract/index.ts`](../ui-canvas/src/client/contract/index.ts) of `@dv/ui-canvas`) and the History contract (`@dv/ui-history/contract`).

| Symbol | Meaning |
| --- | --- |
| `defineGenerationUi(spec)` | Returns the `UiPlugin` (`{ inject: [], apply }`) of one generation primitive |
| `GenerationUiSpec` | The declaration. Required: `id` (the registering package), `type` (the node type key, such as `'audio'`), `operations` (the generation operations whose records are the takes), `label` (the Chinese and English type label), `color` (a theme color, such as `var(--dv-node-3)`), and `status` (`StatusWords`). Optional: `column` (default 2), `deepenOn` (input roles that push a take one column right of the node it reads them from), `bodyHeight` (default 117, the 16:9 frame at the 208 px card width), `subject(record)` (the History subject; default none), `bar` (the composer's parameter bar of the kind: the `placeholder` and `send` words, `chips(…)` and `candidates(schema)`; the kit registers it in `dvComposer.paramBars` for each operation while `@dv/ui-composer` is loaded, owned by `id` and with `status.running` as the words while a send runs, so a kind without `bar` still shows its running words), and `preview(outputs)` (the output that stands for a take in small views and that the editor's and the chat card's players show before they play, when it is not the first output; it reads the take's outputs with their MIME types) |
| `StatusWords` | The Chinese and English pairs `running`, `failed`, and `done` |

### What the plugin registers

The plugin registers its canvas parts (the node type, 重试, the card and the take editor) while `dvCanvas` and the slot registry exist, its chat cards while the slot registry exists, and its History rows while `dvHistory` exists, in any load order. The node type registers first among the canvas parts, so a refused node type leaves no other canvas part of the kind; the chat cards and History rows are keyed by tool and operation, so they register while `@dv/ui-canvas` is not loaded. Each registration leaves with its service or with the plugin:

- **The claimed node type.** `dvCanvas.nodeTypes` keys it by `type` and by `op:<operation>` for each operation, so a second type that claims one of the operations throws with the holder's name, such as `registry key "op:shot.render" is already registered by @dv/ui-shot-render`. The canvas builds each claimed node from its record; the kit supplies the title, the meta, the preview, the body height, and the status words. A take of an anchored chain is titled by its slot and lane, such as 镜头 1 · 9:16 / Shot 1 · 9:16; any other take is titled by its operation's label in the interface language, else by the operation name. A take in a group of several adds its number, such as ` · 第 2 次` / ` · take 2`. The meta is the duration of the first timed output, such as `2.5s`.
- **The card body**, the `dv.canvas.card` entry keyed by `type`. It draws the take's preview, else its first output, through `dv.media` at purpose `card` in a frame of the type's body height, 117 px by default; a pending take shows the empty frame under the canvas's running words.
- **The take editor**, the `dv.canvas.editor.claimed` entry keyed by `type`. It plays the first output through `dv.media` at purpose `loop`, with the take's preview as the poster, and shows the failure reason of a failed take whose failure has a message. It shows the model and generation task (the task's label in `GET /api/dv/tasks`, else its name). When `GET /api/dv/operations` declares the take's operation, it then draws the `dv.prompt` composer of [`@dv/ui-composer`](../ui-composer/README.md) over the take's call: the take's operation and params, with `requestInputsOf(record)` of `@dv/ui-kit` as the inputs. The composer chooses the references, the parameter chips, and the words from the operation's inputs and from the parameter bar that the kit registers from the declaration. The composer's host opens the canvas's asset picker with the versioned items (`host.pickAssets(…, { versions: true }, …)`), imports uploaded files as canvas imports (`host.importFiles`), and opens the preview of an asset (`host.preview`) and the editor of another node (`host.openNode`). A send runs `host.rerun` with the edited call, `based_on` set to the take, and an intent that names the take; while the rerun waits, the composer's send button is disabled and reads its sending words, and a refused request shows its error under the composer. A take whose operation the list does not name shows no composer.
- **The 重试 / Retry action**, `<id>:<type>:retry` in `dvCanvas.actions`, order 0, so each kind of one package has its own. It shows only on a failed claimed take of the primitive's operations and runs `host.rerun` with the record's own operation and params, `requestInputsOf(record)` as the inputs (so a version that the record stores once per asset is sent once), and `based_on` the record.
- **The chat card**, one `tool.call.toolview` entry per operation, keyed by the operation's tool name, such as `dv_shot_render` for `shot.render`. It shows the operation's label, the status words of the call's phase, the model and task line, the prompt, the first output through `dv.media` at purpose `loop`, muted behind the output that `preview` picks as the poster, and 在历史中查看 / Show in history once the call settled.
- **The History rows**, one `dvHistory.rows` entry per operation. Each gives `spec.subject` as the subject and marks a media row whose thumbnail is `spec.preview`, else the first output.

The chat card and the take editor read the operation labels and the task labels through the inject `hooks` of [`src/client/loaded.ts`](src/client/loaded.ts): two sources that load `GET /api/dv/operations` and `GET /api/dv/tasks` on the first subscription and stay empty after a failed load, so every reader falls back to names until the next subscription loads again. The take editor reads only the task labels; it reads the declarations from its `operations` owner prop.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`defineGenerationUi` builds the node type, the 重试 action, and the History rows from the spec once, then registers them from `apply` inside one `ctx.inject` block of `dvCanvas` and `slots`, with a nested block of `dvHistory` for the History rows. The canvas computes each take's lineage (its anchored chain and its number in a group) and hands it to the node type's `entry`, so a claimed node cannot disagree with its record. The take editor reads whether the take's operation is declared from the `operations` owner prop that the canvas passes; the `dv.prompt` composer reads the declared params itself, so the kit reads no `@dv/ui-kit/form.ts`.

The specs under `tests/` mount the kit under `SlotTestRuntime` of `@deepseek-ai/dsh-client-test-runtime`, with the real `@dv/ui-media` and `@dv/ui-asset-pool` plugins drawing the media. `tests/take-kind.client.ts` defines the test kind `test_take` that claims `shot.render` and `clip.extend`, mounts the composer stack (`composerStack` of `../ui-composer/tests/composer-stack.client.ts`) that the take editor draws, and defines a recording canvas host. `generation-kit.client.spec.tsx` checks the titles, the meta, the preview, the status words, the card body, the 重试 action, and the removal of every registration on unload. `take-editor.client.spec.tsx` checks the player, the mode line, the composer over the take's call, the rerun request with a fanned-out version sent once, a changed parameter chip, the sending words, the references that the composer opens and picks, a take whose operation declares no `reference` input, and the errors; `generation-card.client.spec.tsx` checks the chat card in a chat session. `plugin-proofs.client.tsx` holds the checks that each primitive's own spec runs on its plugin: it mounts the canvas with the plugin before `@dv/ui-canvas`, finds exactly one node of a record, renders a settled chat card, and lists every injected or owner value that is not JSON data or a function. `plugin-proofs.client.spec.tsx` runs those checks on `@dv/ui-shot-render`.

| File | Content |
| --- | --- |
| [`src/client/generation-kit.tsx`](src/client/generation-kit.tsx) | The spec, the node type, the card body, the 重试 action, the History rows, and the plugin |
| [`src/client/TakeEditor.tsx`](src/client/TakeEditor.tsx) | The take editor |
| [`src/client/GenerationCard.tsx`](src/client/GenerationCard.tsx) | The chat card and `StatusWords` |
| [`src/client/loaded.ts`](src/client/loaded.ts) | The operation and task label sources |
| [`src/client/generation-card.module.css`](src/client/generation-card.module.css) | The chat card styles |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/generation`](../generation/README.md) declares the Host half of a generation primitive.
- [`@dv/ui-canvas`](../ui-canvas/README.md) builds the claimed nodes and renders the card and editor entries.
- [`@dv/ui-composer`](../ui-composer/README.md) draws the take editor's `dv.prompt` composer and holds the parameter bars.
- [`@dv/ui-media`](../ui-media/README.md) draws every output through `dv.media`.
- [`@dv/ui-history`](../ui-history/README.md) draws the History rows.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the records that the take editor's send and the 重试 action write reach the model only through the `dv:project` prompt section and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the kit sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The views read their copy through `@dv/ui-kit` hooks.** `TakeEditor` and `GenerationCard` pick their text with `useText`, and the node type label, the status words, and the 重试 label use `pickText`, which follow `<html lang>`, instead of an inject `hooks` source and the slot's `t`.
- **Each generation plugin loads the labels itself.** `apply` creates its own `DvClient` for the label sources, so each plugin requests `GET /api/dv/operations` and `GET /api/dv/tasks` once, and the chat card reads the operation labels from that copy while the take editor reads the canvas's `operations`.
- **The take titles name shots.** The kit titles an anchored take 镜头 N / Shot N and a numbered take 第 N 次 / take N; `GenerationUiSpec` has no field to change these words.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
