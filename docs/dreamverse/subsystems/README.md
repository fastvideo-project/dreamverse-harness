# DreamVerse subsystems

English | [中文](README.zh.md)

Each page documents the records, types, and rules that one part of the DreamVerse packages owns. The rows follow the layers of the [architecture page](../architecture.md). They start at the kernel and go through the base, domain and workflow packages to the agent, the API and the UI packages. The [glossary](../glossary.md) defines the names that these pages use. Each page links the package READMEs that implement its part.

| Page | Owns |
|---|---|
| [project.md](project.md) | `@dv/project`: the operation record, the record log, the history rules, components, operations, input references, how an operation runs, confirmation in the conversation, project state, the project summary and the wire state, staleness, and deterministic reuse |
| [generation.md](generation.md) | The model catalog, `defineGeneration` and `GenerationApi`, `shot.render`, model-line skills, and the providers |
| [assets.md](assets.md) | `@dv/asset-pool` and `@dv/ffmpeg`: what an asset is, where the files are, the asset operations, imported and generated assets, and the ffmpeg runner |
| [reference-nouns.md](reference-nouns.md) | The reference nouns (`@dv/character`, `@dv/location`, `@dv/style` and their UI packages) and the reference kit: the kit shape, `defineReference`, `defineReferenceUi`, the extension points, and the kit membership rule |
| [shots-and-timeline.md](shots-and-timeline.md) | Plans, renders and takes, the live render stream of `@video-harness/stream`, timelines and clips, takes in use, export, and the inspector |
| [workflows.md](workflows.md) | `@dv/workflow-kit`, `@dv/workflow-story` and `@dv/ui-workflow-story`: the workflow contract, the approval chain and `started_by`, the shot walk, and the story workflow |
| [agent-and-api.md](agent-and-api.md) | What the agent reads, chat references, the `@dv/api` routes, the agent path and the HTTP path, and `@dv/mcp-presets` |
| [ui.md](ui.md) | UI core and UI plugins: the `dvCanvas`, `dvHistory` and `dvMentions` registries, the slots of the shell and the canvas, the wire types, the views, and the History panel |
