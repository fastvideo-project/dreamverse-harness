---
description: "The dv package group: the DreamVerse packages for video production, from the Project kernel through the components, workflows, and browser API to the interface plugins."
kind: "package-group"
---

# dv/ — DreamVerse video production

English | [中文](README.zh.md)

## Summary

The dv group holds the DreamVerse packages, the project layer for video production inside DeepSeek Harness. `@dv/project` stores every project as records and turns each operation into an agent tool. The components own project data and operations, and the workflows own production flows. The model catalog and its provider plugins serve the video models. `@dv/api` and `@dv/chat-references` connect the browser and the chat to a project, and the `@dv/ui-*` plugins draw it. The [DreamVerse documentation](../../docs/dreamverse/README.md) owns the cross-package rules.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package sits in the layer that `layerOf` of `scripts/dv-architecture.ts` assigns to it, and a package depends only on the layers below it:

| Layer | Package | Role |
|---|---|---|
| kernel | [`project`](project/README.md) | Stores the records of every project with its history list, runs operations, computes state, and turns every operation into an agent tool |
| base | [`models`](models/README.md) | The video model catalog `dvModels` that provider plugins register into |
| base | [`generation`](generation/README.md) | `defineGeneration`, which turns one generation primitive into a service with one operation |
| base | [`asset-pool`](asset-pool/README.md) | The content-addressed asset store, the canvas placements, and the `asset.*` operations |
| base | [`ffmpeg`](ffmpeg/README.md) | Runs ffmpeg commands and ffprobe reads for component operations |
| base | [`reference-kit`](reference-kit/README.md) | `defineReference`, which turns one reference noun declaration into its service |
| provider | [`fastvideo`](fastvideo/README.md) | Registers the model `fasth3` of local FastVideo servers into the catalog for tasks `ref2v` and `t2v` |
| provider | [`fastvideo-generation-client`](fastvideo-generation-client/README.md) | Client for the FastVideo `streaming_v2` generation backend |
| domain | [`character`](character/README.md) | Characters as versioned reference nouns |
| domain | [`location`](location/README.md) | Locations as versioned reference nouns |
| domain | [`style`](style/README.md) | Styles as versioned reference nouns |
| domain | [`shot-plan`](shot-plan/README.md) | Shot plans with numbered versions and the `plan.*` operations |
| domain | [`shot-render`](shot-render/README.md) | Renders one take of a shot with a catalog model through `shot.render` |
| domain | [`timeline`](timeline/README.md) | Timelines, their clips, the `timeline.*` edit operations, and export |
| domain | [`inspector`](inspector/README.md) | The read-only `inspect.image` and `inspect.asset` operations |
| workflow-lib | [`workflow-kit`](workflow-kit/README.md) | The shot walk that workflows use to read a plan version and schedule its renders |
| workflow | [`workflow-story`](workflow-story/README.md) | Previews and approves a shot plan version, renders it, and lays its takes on a timeline |
| surface | [`api`](api/README.md) | The browser API: state reads, operations as the user, undo and redo, and the event stream |
| surface | [`chat-references`](chat-references/README.md) | Expands `dv:` mentions and imports the files that a user attaches in the chat |
| surface | [`mcp-presets`](mcp-presets/README.md) | Offers configured MCP servers (Blender, ComfyUI) for one-step adding |
| ui-core | [`ui-kit`](ui-kit/README.md) | Browser code that the DreamVerse views share |
| ui-core | [`ui-canvas`](ui-canvas/README.md) | The canvas that draws a project's records as nodes linked by asset flow |
| ui-core | [`ui-history`](ui-history/README.md) | The History panel with undo, redo, and 回到这一步 |
| ui-core | [`ui-shell`](ui-shell/README.md) | The entry page, the project workspace, and the 对话 / 轨迹 tabs over the DSH web app |
| ui-core | [`ui-composer`](ui-composer/README.md) | The DreamVerse additions to the DSH chat composer |
| ui | [`ui-asset-pool`](ui-asset-pool/README.md) | The asset pool panel |
| ui | [`ui-character`](ui-character/README.md) | Browser half of `character` |
| ui | [`ui-location`](ui-location/README.md) | Browser half of `location` |
| ui | [`ui-style`](ui-style/README.md) | Browser half of `style` |
| ui | [`ui-shot-plan`](ui-shot-plan/README.md) | Browser half of `shot-plan` |
| ui | [`ui-shot-render`](ui-shot-render/README.md) | Browser half of `shot-render`: the render card in the chat |
| ui | [`ui-timeline`](ui-timeline/README.md) | The timeline editor |
| ui | [`ui-workflow-story`](ui-workflow-story/README.md) | Browser half of `workflow-story` |
| ui | [`ui-mcp-presets`](ui-mcp-presets/README.md) | Browser half of `mcp-presets` |
| ui | [`ui-skills`](ui-skills/README.md) | The Skills page that lists the skills a creator can start |
| — | [`e2e`](e2e/README.md) | Browser stories that drive the shipped profile through Playwright |

The bundle [`@dv/bundle`](../bundle/dv/README.md) under `packages/bundle/dv/` is the `bundle` layer. It composes these packages into the `video-harness` and `video-harness-headless` profiles.

<a id="related-documentation"></a>
## Related documentation

- [DreamVerse documentation](../../docs/dreamverse/README.md) is the index of the architecture page, the subsystem pages, the cookbook, and the glossary.
- [Project subsystem](../../docs/dreamverse/subsystems/project.md) describes the operation record, the history rules, and project state.
- [DreamVerse plugin layers](../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-layers.md) records why the layers and their dependency direction exist.
- [Component template](COMPONENT-TEMPLATE.md) gives the steps that build one component package.
- [`video-harness/`](../video-harness/README.md) holds the live media stream of shot renders.

<a id="dev-note"></a>
## Dev Note

None.
