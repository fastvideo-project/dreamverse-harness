# Generation

English | [中文](generation.zh.md)

This page is the reference for DreamVerse generation. It describes the model catalog, the generation helper, the Shot render operation, and the provider plugins that serve the models. The model catalog is the `dvModels` service of [`@dv/models`](../../../packages/dv/models/README.md). The generation helper is `defineGeneration` of the library [`@dv/generation`](../../../packages/dv/generation/README.md). Provider plugins, such as [`@dv/fastvideo`](../../../packages/dv/fastvideo/README.md), register model entries into the catalog. [`@dv/shot-render`](../../../packages/dv/shot-render/README.md) consumes the catalog and builds its service with the helper. The story workflow `@dv/workflow-story` calls `dvShotRender` through `GenerationApi`, and [`@dv/api`](../../../packages/dv/api/README.md) serves the task labels of the catalog at `GET /api/dv/tasks`. The [generation Agent Note](../../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-generation.md) records why generation has these parts.

<a id="model-catalog"></a>
## Model catalog

The model catalog is a capability seam. `@dv/models` holds the Service Definition, the provider plugins are its Service Providers, and each primitive package, such as `@dv/shot-render`, is a Consumer. The catalog holds model entries. One entry is one model of one provider that serves one task. The entry key has four fields, written `modality/task/provider/model`, such as `video/ref2v/fastvideo/fasth3`. A model that serves two tasks has two entries. The catalog registers no operation and writes no record.

Two open interfaces in `packages/dv/models/src/types.ts` give the types of an entry:

| Interface        | One row                                                                                      | Row value                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `PrimitiveTypes` | One primitive: one input and output signature of a model call, such as `video`               | `modality`, `facts` (what a request is built from), `request`, `result` of `render`, and `entry` fields |
| `TaskMap`        | One task: which inputs a model uses, such as `t2v` (the prompt only) or `ref2v` (references) | The primitive that the task runs on                                                                     |

The catalog declares only the `video` row, with the entry field `gpuSecondsPerVideoSecond`, and the tasks `t2v` and `ref2v`. A primitive package adds its row and its tasks in its own source with `declare module '@dv/models'`. `ModelEntry<T>` takes the facts, request, result, and entry fields of the row that task `T` runs on. `TaskOfPrimitive<P>` is the union of the tasks of primitive `P`, such as `t2v | ref2v` for `video`. The [`@dv/models` README](../../../packages/dv/models/README.md#model-keys) defines each key field, each entry member, the render request, and the render stream.

<a id="catalog-reads"></a>
## Catalog reads

A Consumer reads entries only through its own task list. A Consumer calls these methods of `dvModels`:

- `dvModels.resolve(tasks, params)` returns the entry that the `modality`, `task`, `provider` and `model` params name, if the entry's task is in `tasks`. Otherwise it throws an error that names the key and the tool `dv_models_list`. The [`@dv/models` README](../../../packages/dv/models/README.md#use-this-package) gives the error text.
- `dvModels.whileServing(tasks, start)` calls `start` when the catalog gets its first entry of one of `tasks`. It disposes the registration that `start` returned when the catalog loses the last such entry.
- `dvModels.labelTasks(labels)` keeps the Chinese and English label of each task that a primitive declaration lists. `@dv/api` serves the labels at `GET /api/dv/tasks`, and UI packages show them with `taskLabel` of `@dv/ui-kit`.

The agent reads entries only through two tools:

- The tool `dv_models_list` returns the key, the description, and the prompt-skill name of each entry that matches its optional `modality`, `task` and `provider` arguments.
- The tool `dv_models_get` returns the key, the description, and the `schema()` of one entry. The `schema()` gives the limits, the inputs with their media types and counts, and the params of `extra`.

The two tools name no media type, and the catalog adds nothing to the system prompt.

<a id="define-generation"></a>
## `defineGeneration` and `GenerationApi`

`defineGeneration(spec)` takes the declaration of one primitive, a `GenerationSpec`, and returns a Cordis service class. The service injects `dvProject` and `dvModels`. It registers one component key and the task labels for as long as it lives. It registers one operation through `whileServing`, so the operation and its agent tool exist only while a model serves one of the operation's tasks. The helper names no primitive.

The helper sets the parts of the operation that do not depend on the signature:

- The params are the four key fields and `prompt`, then the params of the declaration, then `seed` and `extra`. A declaration with `seed: false` has no `seed`.
- Every generation operation has `deterministic: false`, `resource: 'gpu'`, `confirm: 'over_gpu_budget'` and `version: '1'`.
- Before any record, the precondition refuses a call with the reasons of `check`. The agent tool runs the same check in `prepareToolCall`, before Project asks the user to agree.
- `execute` resolves the entry, builds the request again, and calls the entry's `validateGenerationRequest` before `render`.
- A record keeps the declaration's estimate as its cost when `toOutputs` reports no cost. The report holds the seed.

The declaration supplies the code that differs. `toRequest` builds the request from the entry's facts, the params, the inputs, and the seed. `toOutputs` imports the result as outputs. `toOutputs` can call the helper `importOne` of `@dv/generation`, which imports one output as an asset of the running record. `estimate` gives the GPU seconds from the params and the entry, and `summarize` gives one line for a record. `confirmText`, `toolParams` and `prepareToolCall` are optional.

The service also implements `GenerationApi` for workflows: `render`, `check`, `estimate`, `findTake` and `parseInputs`. `check` never writes. `check` takes the chained roles, the input roles whose producer the caller schedules before the checked call. A chained role reaches `toRequest` with `ref: null`. The role counts and the prompt citations see the chained role, and the model check waits for `execute`. The [`@dv/generation` README](../../../packages/dv/generation/README.md) defines each `GenerationSpec` field and each `GenerationApi` method. [Adding a generation primitive](../cookbook/adding-a-generation-primitive.md) gives the steps to add a primitive.

<a id="shot-render"></a>
## `shot.render`

`@dv/shot-render` is the primitive package of the `video` primitive. Its service `dvShotRender` is `defineGeneration` of one declaration:

| Field                      | Value                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Component, operation, tool | `shot`, `shot.render`, `dv_shot_render`                                                                                   |
| Primitive and tasks        | `video`; `t2v` (文字生成 / From text) and `ref2v` (参考图生成 / From references)                                          |
| Own params                 | `duration_sec`, `aspect_ratio` and `resolution`                                                                           |
| Inputs                     | `reference` (many, versioned) and `first_frame` (one image)                                                               |
| Outputs                    | `video` and `last_still`                                                                                                  |
| Tool-only argument         | `continue_from`: a render record; `prepareToolCall` adds its output `#1` as the `first_frame` input `{record, output: 1}` |
| Estimate                   | `duration_sec` (5 when the call names none) times the entry's `gpuSecondsPerVideoSecond`                                  |

Before the record is written, for every caller, `shot.render` refuses a call in these conditions:

- The key names no catalog entry of task `t2v` or `ref2v`.
- The prompt is missing.
- The prompt cites an asset that is not in the `reference` input.
- The prompt cites an input role that the call does not have.
- The prompt cites anything other than an asset or an input.
- `aspect_ratio`, `resolution` or `duration_sec` is outside the entry's facts.
- The call has more than one `first_frame` input.
- The entry's `validateGenerationRequest` refuses the render request.

Each entry's `validateGenerationRequest(request)` owns the request rules of its model. For example, these rules refuse a request in these conditions:

- An input has a media type or a count that the model does not accept. For example, `fasth3` takes at least one reference in task `ref2v`.
- The request has a first frame, and the model takes no first frame.
- An `extra` value is not valid for the model.

`shot.render` builds the request and checks no model rule itself. When an input is an output of an unfinished record, the precondition skips the model check, and `execute` runs it before the render. A refusal at that point fails the record. While `@video-harness/stream` is mounted, the video chunks also go to browsers during the render ([live render stream](shots-and-timeline.md#live-render-stream)).

<a id="model-line-skills"></a>
## Model-line skills

The catalog owns the runtime skill `video-model-selection`, the procedure that the agent follows to choose a model for each shot. A provider supplies one prompt skill for each model and task as `ModelEntry.promptSkill`. The catalog registers each prompt skill while its entry is registered, and the provider registers no skill. Only the agent loads these skills; a user cannot call them from the composer. A catalog skill or a provider skill names no operation or tool of a consumer, such as `shot.render` or `dv_shot_render`. It also names no workflow word, such as `plan`. Rule R8 of `scripts/dv-architecture.ts` checks these skills; the [fitness test Agent Note](../../../.agents/notes/implemented/process/2026-10-17-dv-architecture-fitness-test.md) owns the rule.

<a id="providers"></a>
## Providers

Two packages connect the FastVideo backend to the catalog:

| Package                                                                                         | What it registers                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@dv/fastvideo`](../../../packages/dv/fastvideo/README.md)                                     | One catalog entry with provider `fastvideo` for each model and task in its `models` config. It serves model `fasth3` for tasks `ref2v` and `t2v`, with the prompt skills `fasth3-reference-prompting` and `fasth3-text-prompting`. |
| [`@dv/fastvideo-generation-client`](../../../packages/dv/fastvideo-generation-client/README.md) | The `dvFastvideoGeneration` service, the client of one FastVideo streaming_v2 backend. It registers no catalog entry and no tool.                                                                                                  |

The plugin `dv-fastvideo` follows these rules:

- The plugin checks its config when it starts. An unknown model, an unknown task, or a model without tasks stops the plugin.
- The config gives each model and task its own server (`baseUrl`) and its GPU rate (`gpuSecondsPerVideoSecond`).
- For each entry, the plugin builds one client in an isolated `dvFastvideoGeneration` scope.
- The entry reads `facts()` and `schema()` from `GET /v1/streamv2/capabilities` through its client. The [client README](../../../packages/dv/fastvideo-generation-client/README.md#use-this-package) defines how the client caches this answer.
- `render` reads each input asset from `dvAssetPool`. It replaces each citation in the prompt with the label that the model reads, such as `<Picture 1>`. Then it sends one `POST /v1/streamv2/generate`.

The `dv-fastvideo` row of `@dv/bundle` mounts the plugin with one server for each task. No bundle row mounts the client package. To add a provider, a model, or a server, follow the repository skill [`dv-add-model-provider`](../../../.agents/skills/dv-add-model-provider/SKILL.md). None of these changes edits `@dv/models`.

<a id="render-request-path"></a>
## A render request through the catalog

A render request takes the same path for an agent call and for a workflow call. The precondition steps run before the record is written; the render steps run in `execute`.

```text
dv_shot_render (agent)               dvShotRender.render(call) (workflow)
  │                                    │
  └──────────────────┬─────────────────┘
                     ▼
dvProject.run        shot.render: params modality, task, provider, model, prompt, ...
                     │
                     ▼  precondition
dvModels.resolve     tasks ['t2v', 'ref2v'] + params ─► entry video/ref2v/fastvideo/fasth3
                     │                                   no entry: refused, no record
                     ▼
toRequest            entry.facts() + params + inputs + seed ─► RenderRequest
                     │
                     ▼
model check          entry.validateGenerationRequest(request) ─► problems: refused, no record
                     │
                     ▼  pending record, then execute
render               resolve, build, and check again ─► entry.render(request, signal)
                     │
                     ▼
@dv/fastvideo        DvFastvideoGeneration.generateSegment ─► POST /v1/streamv2/generate
                     │
                     ▼
toOutputs            RenderStreamEvent stream ─► assets video and last_still
```
