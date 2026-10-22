# DreamVerse architecture

English | [中文](architecture.zh.md)

This page maps the DreamVerse packages. It describes the goal, the layers, the import direction, the two faces of a host package, and the flow of project data. The [subsystem pages](subsystems/README.md) are the reference for each part, and the [glossary](glossary.md) defines the names. [DreamVerse architecture checks](architecture-checks.md) describes the scripts that check these rules.

## The goal

Each DreamVerse plugin has one job, and each plugin can be added or removed alone. A plugin is one host package. A plugin with a browser half also has one UI package `@dv/ui-<name>`. The bundle `@dv/bundle` composes each plugin package with one row in `packages/bundle/dv/cordis.patch.yml`. A package depends only on layers that know nothing about it. Thus, when you add or remove a plugin, you edit no package below it and no sibling package. The [layers Agent Note](../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-layers.md) records why the packages have this structure.

<a id="layers"></a>
## Layers

The function `layerOf` in [`scripts/dv-architecture.ts`](../../scripts/dv-architecture.ts) infers the layer of each package. No package declares its layer. `layerOf` applies these rules in this order:

1. `project` is the `kernel`, and `packages/bundle/dv` is the `bundle`.
2. The constant `BASE` lists the `base` packages.
3. A package whose `src` calls `dvModels.register(`, and the package `fastvideo-generation-client`, are `provider` packages.
4. `workflow-kit` is the `workflow-lib`, and every other folder `workflow-*` is a `workflow`.
5. The constants `SURFACE` and `UI_CORE` list the `surface` and `ui-core` packages.
6. Every other folder `ui-*` is a `ui` package, and every other package is a `domain` plugin.

When you add a `base`, `surface` or `ui-core` package, add its folder name to `BASE`, `SURFACE` or `UI_CORE`. The diagram shows the ten layers. The browser program compiles the two UI layers, and the host program compiles the other layers. `@dv/bundle` composes the plugins of both programs and imports no package. A solid arrow is a value import, and a dotted arrow is an `import type`. Every import points down.

```mermaid
flowchart TB
  bundle(["bundle<br/>@dv/bundle"])
  subgraph client["Client program: browser code, tsconfig.client.json"]
    direction TB
    ui["ui<br/>@dv/ui-#lt;name#gt;<br/>one per plugin"]
    uicore["ui-core<br/>@dv/ui-kit<br/>@dv/ui-canvas<br/>@dv/ui-history<br/>@dv/ui-shell<br/>@dv/ui-composer"]
  end
  subgraph host["Host program: Node code, tsconfig.host.json"]
    direction TB
    provider["provider<br/>@dv/fastvideo<br/>@dv/fastvideo-generation-client"]
    workflow["workflow<br/>@dv/workflow-story"]
    wlib["workflow-lib<br/>@dv/workflow-kit"]
    surface["surface<br/>@dv/api<br/>@dv/chat-references<br/>@dv/mcp-presets"]
    domain["domain<br/>@dv/character<br/>@dv/location<br/>@dv/style<br/>@dv/shot-plan<br/>@dv/shot-render<br/>@dv/timeline<br/>@dv/inspector"]
    subgraph core["kernel and base: values for every host layer"]
      direction LR
      base["base<br/>@dv/models<br/>@dv/generation<br/>@dv/asset-pool<br/>@dv/ffmpeg<br/>@dv/reference-kit"]
      kernel["kernel<br/>@dv/project"]
    end
  end
  bundle -- "one Cordis row per plugin" --> client
  bundle -- "one Cordis row per plugin" --> host
  ui -- "values from @dv/ui-kit only" --> uicore
  ui -. "ui only: import type<br/>@dv/#lt;x#gt;/types" .-> host
  workflow --> wlib
  workflow --> domain
  wlib -. "import type" .-> domain
  provider -. "import type" .-> domain
  surface -. "import type" .-> domain
  surface --> core
  wlib --> core
  provider --> core
  domain --> core
  workflow --> core
  base --> kernel
```

Each layer has one role:

| Layer          | Role                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kernel`       | The `dvProject` Service. Plugins register component keys, operations, reducers and reference kinds with it, as tools register with `ctx.tools`. The kernel is the only writer of project files. It turns every operation into a DSH tool and registers the `dv:project` system-prompt section. It names no plugin.                                        |
| `base`         | Services and libraries for every domain plugin. The model catalog is the `dvModels` Service Definition with `PrimitiveTypes` and `TaskMap`. `defineGeneration` builds the service of a generation primitive, and `defineReference` builds the service of a reference noun. The base layer also stores the assets of a project and runs external programs. |
| `provider`     | Service Providers of the model catalog. A provider plugin registers the models that it serves, and it ships the prompt skill of each model and task. The client of a provider backend, `<name>-generation-client`, is in this layer too.                                                                                                                  |
| `domain`       | Plugins that each own one component key. A domain plugin owns the data of its key, which is a state slice and its reducer. It also owns the operations of its key and the text that the agent reads about them.                                                                                                                                           |
| `workflow-lib` | The parts of a shot walk that carry no policy. This layer names no workflow.                                                                                                                                                                                                                                                                              |
| `workflow`     | A workflow plugin composes domain plugins into a production flow, for example preview, approval, take reuse and timeline choice.                                                                                                                                                                                                                          |
| `surface`      | Packages that serve the user. `@dv/api` and `@dv/chat-references` run the operations of other packages by name, as the user. A view reads and changes a project only through `@dv/api` ([Agent and API](subsystems/agent-and-api.md)).                                                                                                                    |
| `ui-core`      | The frame of the DreamVerse views in the DSH Web Client. UI core holds the center views, the Right-Sidebar tab types, the registries and slots, and the shared wire types. `@dv/ui-kit` is the library that every UI package shares. UI core names no plugin noun.                                                                                        |
| `ui`           | The browser half of one plugin. A UI package registers into the registries and slots of UI core. `@dv/ui-<x>` pairs with the host package `@dv/<x>` when that package exists.                                                                                                                                                                             |
| `bundle`       | The profile layer that composes the plugins ([the bundle and the packages outside the layers](#the-bundle-and-the-packages-outside-the-layers)).                                                                                                                                                                                                          |

<a id="import-direction"></a>
## Import direction

The fitness test checks every `@dv/` import in `src` against this table. A package may always import itself.

| A package in   | May import values from                               | May also `import type` from                                                                                 |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `kernel`       | nothing                                              | nothing                                                                                                     |
| `base`         | `kernel`, `base`                                     | nothing more                                                                                                |
| `provider`     | `kernel`, `base`, its own `<name>-generation-client` | a domain package that merges a row into `PrimitiveTypes`                                                    |
| `domain`       | `kernel`, `base`                                     | nothing more                                                                                                |
| `workflow-lib` | `kernel`, `base`                                     | `domain`                                                                                                    |
| `workflow`     | `kernel`, `base`, `domain`, `workflow-lib`           | nothing more                                                                                                |
| `surface`      | `kernel`, `base`                                     | `domain`                                                                                                    |
| `ui-core`      | `@dv/ui-kit`                                         | nothing more                                                                                                |
| `ui`           | `@dv/ui-kit`                                         | `@dv/<x>/types` of its paired host package, and `import type {}` of a UI-core package that merges `SlotMap` |

A domain plugin never imports another domain plugin, and a component never names the operation of another component. Composition across nouns happens only in a workflow. A workflow reaches each domain plugin through its service in `static inject`. For example, `@dv/workflow-story` injects `dvProject`, `dvShotPlan`, `dvShotRender` and `dvTimeline`, and calls `dvShotPlan.shots`, `dvShotRender.estimate` and `dvTimeline.layout`. A UI package never imports another UI package or a value from a host package. It reads its host package only through types.

## Host face and client face

A host package that its UI package reads has two faces. The host face is the package root (`"."` → `src/index.ts`), and it holds the Cordis plugin and its services. The client face is `exports["./types"]` → `src/types.ts`, and it holds the slice and record types that the browser program compiles. Each face belongs to one program. The diagram shows the two faces of `@dv/character`, and `@dv/ui-character` reads the client face with `import type`.

```mermaid
flowchart TB
  pkg["@dv/character<br/>packages/dv/character/"]
  uichar["@dv/ui-character"]
  hostface["host face: exports #quot;.#quot;<br/>src/index.ts<br/>the Cordis plugin and its services"]
  clientface["client face: exports #quot;./types#quot;<br/>src/types.ts<br/>the slice and record types"]
  hostprog(["host program<br/>root tsconfig.host.json"])
  clientprog(["client program<br/>root tsconfig.client.json"])
  pkg --> hostface
  pkg --> clientface
  uichar -. "import type" .-> clientface
  hostface -- "tsconfig.json" --> hostprog
  clientface -- "tsconfig.client.json" --> clientprog
```

A client face has four parts:

1. the `./types` export in `package.json`;
2. a `tsconfig.client.json` beside the host `tsconfig.json`, which includes only `src/types.ts` and references the client configs of the faces that it imports;
3. a path entry `@dv/<pkg>/types` in `tsconfig.base.json`;
4. a reference to that `tsconfig.client.json` in the root `tsconfig.client.json`.

A `src/types.ts` imports and augments only client faces, such as `declare module '@dv/project/types'`. It never imports the bare `@dv/project`. The fitness test follows every module that a `./types` entry reaches. The test fails when one of these modules imports `node:*`, `@deepseek-ai/cordis` or `@deepseek-ai/dsh-tools`. A package has a client face when its `package.json` declares the `./types` export. The [DreamVerse package table](../../packages/dv/README.md#packages) lists the packages.

<a id="project-data"></a>
## Project data

Project data moves in one direction. Three writers call `dvProject.run`: an agent tool call, a view through `@dv/api`, and the service of a plugin. `dvProject.run` appends a record to the project's `records.jsonl` file. Every registered reducer then computes its slice of `ProjectState.components`, and the agent and the views read these slices.

```mermaid
flowchart TB
  agent["agent tool call"]
  view["view<br/>POST /api/dv/operation"]
  plugin["plugin service<br/>ctx.dv#lt;Name#gt;.#lt;method#gt;"]
  run(["dvProject.run"])
  records[("#lt;project#gt;/records.jsonl")]
  reducers["every registered reducer<br/>record by record,<br/>in registration order"]
  components["ProjectState.components<br/>one slice per<br/>registered reducer"]
  summary["project summary<br/>dv_proj_* tools<br/>dv:project prompt section"]
  wire["WireState<br/>GET /api/dv/state"]
  views["canvas, timeline, history, asset pool"]
  agent -- "operation" --> run
  view -- "operation" --> run
  plugin -- "operation" --> run
  run -- "record line and update lines" --> records
  records -- "records" --> reducers
  reducers -- "slices" --> components
  components --> summary
  components --> wire
  wire --> views
```

Views and the agent never edit a slice. They write only by running an operation. [Project](subsystems/project.md) owns the records, the operations, the history rules and the project state. [The project summary and the wire state](subsystems/project.md#the-project-summary-and-the-wire-state) describes how a view reads the wire state again after a change.

## Operations and agent tools

Components register their operations with `dvProject.registerOperation` and their reducers with `dvProject.registerReducer`. Each operation is also an agent tool, and one call of that tool becomes one record. [Operations](subsystems/project.md#operations) gives the form of an operation name and of its tool name. The [components table](glossary.md#components-and-packages) of the glossary lists the operations of each component.

An operation declares a resource class (`none`, `cpu` or `gpu`) and a confirmation policy (`never`, `always` or `over_gpu_budget`). [Confirmation in the conversation](subsystems/project.md#confirmation-in-the-conversation) describes the confirmation policies.

A plan approval belongs to a workflow plugin. [Workflows](subsystems/workflows.md) owns the workflow contract and the approval chain.

<a id="the-bundle-and-the-packages-outside-the-layers"></a>
## The bundle and the packages outside the layers

[`@dv/bundle`](../../packages/bundle/dv/README.md) in `packages/bundle/dv/` is the profile layer. Its `cordis.patch.yml` holds one row for each plugin package. The libraries `@dv/generation`, `@dv/reference-kit`, `@dv/workflow-kit`, `@dv/fastvideo-generation-client` and `@dv/ui-kit` have no row. `scripts/video-harness/setup-profile.sh` stacks the bundle on `dsh-base` plus `dsh-web-app` as the profile `video-harness`, and on `dsh-base` plus `dsh-headless` as `video-harness-headless`. The bundle also ships the `video-directing` skill, the planning procedure across components, which the `skill-filesystem` rows read.

Two packages are outside the ten layers:

- [`@dv/e2e`](../../packages/dv/e2e/README.md) in `packages/dv/e2e/` holds the browser stories. Each story boots the `video-harness` profile with fake services and drives Chromium. The package has no `src`, so no import rule applies to it.
- [`@video-harness/stream`](../../packages/video-harness/README.md) in `packages/video-harness/stream/` sends the video chunks of a render to the browsers ([live render stream](subsystems/shots-and-timeline.md#live-render-stream)). The fitness test scans only `packages/dv/` and `packages/bundle/dv/`, so no rule checks this package.
