---
description: "Generation helper of DreamVerse: defineGeneration turns the declaration of one generation primitive into a service with one component key and one operation that writes one record per model call; open it to add a primitive or to call one from a workflow."
kind: "package-reference"
---

# @dv/generation

English | [中文](README.zh.md)

## Summary

Use this package to add a generation primitive, such as image generation, as a short declaration. `defineGeneration(spec)` returns a Cordis service class. The service registers the component key and the task labels of the declaration and, while the model catalog serves one of its tasks, one operation. Each call of the operation is one model call and one record, with the model key, the prompt, the seed and `extra` in its params. Every agent call is GPU-gated. The service also implements `GenerationApi` for workflows. The helper names no primitive.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

A primitive package declares its row of `PrimitiveTypes` and its tasks in `TaskMap` of `@dv/models`, then default-exports `defineGeneration({...})`. Its bundle row mounts the service after `@dv/project` and `@dv/models`, which the service injects.

| `GenerationSpec` field                       | Meaning                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `service`, `component`, `operation`          | The service name, the component key, and the operation name `<component>.<verb>`                                                |
| `primitive`, `tasks`, `label`, `description` | The primitive, every task of the primitive with its label in Chinese and English, the operation label, and the tool description |
| `params`, `inputs`, `outputs`                | The params besides the shared ones, the input roles, and the outputs; a declaration may restate `prompt` to describe it         |
| `seed`, `toolParams`, `prepareToolCall`      | `false` for a model without a seed; tool-only arguments, and the change of an agent call before the check                       |
| `toRequest`, `toOutputs`                     | Build the model request from facts, params and `RequestInput`s, and from the seed for a seeded declaration; import the model result as outputs |
| `summarize`                                  | The one-line record summary                                                                                                     |
| `node`                                       | The canvas nodes of the records: `kind`, the node type key that the browser draws them with, and the layout `column`            |

| `GenerationApi` method         | Behavior                                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `render(call)`                 | Runs the operation through `dvProject.run` with the call's `started_by`; a call with `after` is scheduled                              |
| `check(call, state, chained?)` | `[]` when the call runs, else the first refusal or the model problems as one reason; a `chained` role counts as an input; never writes |
| `parseInputs(raw, state)`      | `dvProject.parseInputs` for the operation                                                                                              |

`importOne(run, file)` imports one output of a running call as an asset named `<record ID, 8 characters>.<mime subtype>`, such as `a1b2c3d4.png`. It throws for a call without a record.

`quotePrompt(prompt, limit)` writes a prompt as one quoted line of a summary: it trims the prompt, cuts it after `limit` characters with `…`, and writes it as a JSON string, which escapes its quotes and line breaks.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The service registers the component, then the task labels with `dvModels.labelTasks`, for as long as it lives, and, while `dvCanvasNodes` of [`@dv/canvas`](../canvas/README.md) is loaded, the operation as the maker of `node.kind` nodes in `node.column`, so a record without a `based_on` in a node makes a node and a rerun joins the node of its version; a second declaration that labels one of the same tasks fails to start. The operation puts the model key and `prompt` before the declaration's params, and `seed` (unless `seed` is `false`) and `extra` after them. It is not deterministic, uses the GPU, and has version `1`. The precondition, which the agent tool also runs, refuses a call with the reasons of `check`; it passes no chained role, so a render never accepts one. `check` reads only the call's project, params and inputs. It resolves the entry with `dvModels.resolve`, resolves each input to its assets, adds each chained role as `{ role, ref: null, resolved_asset: null }`, and builds the request. When every input has an asset, it adds the problems of `validateGenerationRequest`; otherwise `execute` checks the full request before the model runs. `execute` uses the `seed` param or draws one (no seed when `seed` is `false`), builds and validates the request again, renders, and passes the result to `toOutputs`. It adds `seed` to the report.

| File                           | Content                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| [`src/index.ts`](src/index.ts) | `defineGeneration`, `importOne`, `quotePrompt`, `GenerationSpec`, `GenerationApi`, `GenerationCall`, `RequestInput` |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/models`](../models/README.md): `PrimitiveTypes`, `TaskMap`, `resolve`, `whileServing` and `labelTasks`.
- [`@dv/project`](../project/README.md): `OperationSpec`, `run`, and the agent tool of each operation.

-----

<a id="model-experience"></a>
## Model Experience

### Shared params and refusal text of each generation tool

#### What the model sees

The kernel turns each generation operation into the agent tool `dv_<component>_<verb>`. Its params begin with `modality`, `task`, `provider`, `model` and `prompt`, and end with `seed` and `extra`, with the descriptions below; a declaration with `seed: false` has no `seed`. A refused call fails the tool call with the reasons and the sentence `Nothing was generated; change the inputs or params, then call again.` When the entry's `facts()` or `validateGenerationRequest` rejects, the reason reads `Model <modality>/<task>/<provider>/<model> is unavailable: <message>` and the sentence is `Nothing was generated; no change to the call helps while the model is unavailable.` A model problem reads `Model <modality>/<task>/<provider>/<model> cannot generate this: <problems>`. A result report carries `seed`.

##### Shared param descriptions

```markdown
- modality: The modality of a model that dv_models_list lists.
- task: The task of that model, as dv_models_list lists it.
- provider: The provider of that model, as dv_models_list lists it.
- model: The model name, as dv_models_list lists it.
- prompt: The complete prompt; follow the prompt skill that dv_models_list names for the model, if any.
- seed: Fixed seed; omitted, a random seed is drawn and recorded.
- extra: The model's own parameters, as dv_models_get lists them; omit it when the model has none.
```

#### Token effect

About 200 tokens of each generation tool definition (a character count of the seven params divided by four), while the tool registry is mounted and a model serves one of its tasks.

#### KV Cache effect

The text is fixed. The tool appears when the first entry of one of its tasks registers and leaves with the last one, which changes the tool list and invalidates the cached prefix from the tool section on.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Pending and chained inputs are checked late**: when an input is an output of a record that has not finished, or a role is chained, the model checks the request only in `execute`, so its refusal fails the record instead of refusing the call.
- **Fixed operation version**: every generation operation has version `1`; a declaration cannot mark a change of its params.
