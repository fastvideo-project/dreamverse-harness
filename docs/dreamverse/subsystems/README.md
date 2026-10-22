# DreamVerse subsystems

English | [中文](README.zh.md)

One page per DreamVerse subsystem: the records, types, and rules that one part of the DreamVerse packages owns. The [architecture page](../architecture.md) maps how the parts depend on each other, and the [glossary](../glossary.md) defines the names that these pages use. Each page links the package READMEs that implement its part.

| Page | Owns |
|---|---|
| [project.md](project.md) | `@dv/project`: the operation record, the history rules, how an operation runs, confirmation in the conversation, project state, staleness, and deterministic reuse |
| [generation.md](generation.md) | The model catalog of `@dv/models` and the checks that `shot.render` applies before it renders |
| [agent-and-api.md](agent-and-api.md) | What the agent reads (tools, the `dv:project` prompt section, chat references, and skills), the `@dv/api` routes, and the interface packages |
| [ui.md](ui.md) | The History panel of `@dv/ui-history` and its links to the agent's trajectory |
