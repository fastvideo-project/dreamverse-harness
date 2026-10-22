# DreamVerse documentation

English | [中文](README.zh.md)

The DreamVerse packages are the project layer for video production inside DeepSeek Harness. They live under `packages/dv/` and in the [`packages/video-harness/`](../../packages/video-harness/README.md) group. These pages document the rules that cross these packages. They follow the tiers of the DeepSeek Harness documentation. The pages are an architecture map, a page about the architecture checks, one reference page per subsystem, how-to guides in `cookbook/`, and a glossary. Each package README owns its configuration and service API. The DeepSeek Harness [architecture page](../architecture.md) owns the Harness facts that these pages build on.

| Page                                                                                   | Owns                                                                                                                                |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md)                                                     | The goal, the ten layers and their packages, the import direction, the host and client faces, and the one direction of project data |
| [architecture-checks.md](architecture-checks.md)                                       | The scripts that check the layers: the fitness test, the owner listing and the change size check                                    |
| [subsystems/README.md](subsystems/README.md)                                           | The reference page of each DreamVerse subsystem                                                                                     |
| [cookbook/where-new-behavior-goes.md](cookbook/where-new-behavior-goes.md)             | How to choose the owner and the extension point of new DreamVerse behavior                                                          |
| [cookbook/adding-a-reference-noun.md](cookbook/adding-a-reference-noun.md)             | How to add a reference noun on the reference kit: two packages, the wiring and the checks                                           |
| [cookbook/adding-a-generation-primitive.md](cookbook/adding-a-generation-primitive.md) | How to add a generation primitive with `defineGeneration` and serve its tasks from a provider                                       |
| [cookbook/adding-a-workflow.md](cookbook/adding-a-workflow.md)                         | How to add a workflow package and its UI half on `@dv/workflow-kit`                                                                 |
| [glossary.md](glossary.md)                                                             | The names that code, records, tools, and interface copy use, each with one meaning                                                  |
