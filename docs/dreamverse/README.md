# DreamVerse documentation

English | [中文](README.zh.md)

The DreamVerse packages are the project layer for video production inside DeepSeek Harness. These pages own the vocabulary and the cross-package rules of these packages under `packages/dv/` and of the [`packages/video-harness/`](../../packages/video-harness/README.md) group: the layers and their roles, the model catalog, the operation record, the [history rules](subsystems/project.md#history-rules), how views and the agent write, confirmation in the conversation, project state, what the agent reads, staleness, [where new behavior goes](cookbook/where-new-behavior-goes.md), and the [glossary](glossary.md) of the names that code, records, tools, and interface copy use. Each package README owns its configuration and service API. The DeepSeek Harness [architecture page](../architecture.md) owns the Harness facts that these pages build on.

| Page                                                                       | Owns                                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)                                         | The layers of the DreamVerse packages, their roles, and the direction of their dependencies |
| [glossary.md](glossary.md)                                                 | The names that code, records, tools, and interface copy use, each with one meaning          |
| [subsystems/README.md](subsystems/README.md)                               | The reference page of each DreamVerse subsystem                                             |
| [cookbook/where-new-behavior-goes.md](cookbook/where-new-behavior-goes.md) | How to choose the owner and the extension point of new DreamVerse behavior                  |
