# Where new behavior goes

English | [中文](where-new-behavior-goes.zh.md)

This how-to places new DreamVerse behavior: the principles that decide its owner, the procedure, the lookup table of extension points, and a worked example.

New DreamVerse behavior attaches to an extension point that a package already owns, as DeepSeek Harness behavior does in the "Where new behavior goes" section of the [architecture page](../../architecture.md).

## Principles

1. **Everything has one owner.** Each piece of data, each capability, and each text the agent reads belongs to one plugin, which registers it at an extension point itself.
2. **A plugin says in one sentence what it owns.** A plugin that can only be described as "connects A to B" owns nothing and is split among the owners of A and B.
3. **New behavior attaches to an existing extension point**, chosen from the lookup table below.
4. **Only a swappable capability becomes a capability seam.** A capability with two or more interchangeable implementations gets a Service Definition package and Service Provider packages.
5. **Dependencies point one way:** views → `@dv/api` → `@dv/project` ← components ← workflows; components → base libraries and Service Definition ← Service Provider. No package depends against this direction or names another plugin's operation in code.
6. **Text for the agent goes with its owner**, by this table:

| The text is about                                                                      | It goes in                                                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| How to use one component's tool                                                        | That operation's `description`                                                         |
| A procedure across several components                                                  | A skill in `@dv/bundle` or in the workflow that owns the procedure (`story-directing`) |
| A model's limits and how to write its prompts, such as the reference requirement       | The prompt skill that the model's provider plugin registers for the task               |
| How to choose the model of a shot                                                      | The `video-model-selection` skill of `@dv/models`                                      |
| The project state, which changes every turn                                            | The `dv:project` prompt section of `@dv/project`, through the reducers' `agentSummary` |

## Procedure

When you add something, answer these questions in order:

1. What kind of thing is it: project data, an operation, a swappable capability, a model, text for the agent, a view, or logic attached to the agent loop?
2. Who owns it? When no package owns it, create a component and write the one sentence that says what it owns.
3. Which extension point does it attach to? Use the lookup table.
4. Must it be swappable? If so, make it a capability seam; if not, it is one registration in an ordinary plugin.
5. Does it carry text for the agent? If so, put the text with its owner by the table in the principles.

Then check that the owner's one sentence still holds, that no plugin name of another package is written into code, and that no dependency points against the direction of principle 5.

## Lookup table

| To add                           | Do this                                                                                                                                                                                                                                                                          | Example                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Project data                     | Add it to the owning component's reducer state and summarize it in `agentSummary`                                                                                                                                                                                                | The music of a shot                               |
| An operation                     | `registerOperation` in the owning component; Project derives the tool, the API route, the history, and undo                                                                                                                                                                      | `timeline.clip_split`                             |
| A swappable capability           | A Service Definition package and Service Provider packages; the component that uses it is the Consumer                                                                                                                                                                           | The model catalog, 3D rendering                   |
| A model                          | A provider plugin change; see [Add a provider or a model](../../../packages/dv/models/README.md#add-a-provider-or-a-model)                                                                                                                                                          | `fasth3` of `@dv/fastvideo`                       |
| A generation task                | A `TaskMap` entry that the plugin introducing the task declares ([model keys](../../../packages/dv/models/README.md#model-keys)), plus its label in the `tasks` record of its primitive's declaration; a task with input roles that no primitive has gets its own primitive package | A task that renders from a first and a last frame |
| An output modality               | A `PrimitiveTypes` row ([model keys](../../../packages/dv/models/README.md#model-keys)), with the tasks that run on it and a primitive package that calls `defineGeneration` of `@dv/generation`                                                                                    | Image generation                                  |
| A reference noun                 | Two declarations: `defineReference` of `@dv/reference-kit` and `defineReferenceUi` of `@dv/ui-kit`                                                                                                                                                                               | `@dv/character`                                   |
| A production flow                | A workflow package `@dv/workflow-<key>` and its UI half                                                                                                                                                                                                                          | `@dv/workflow-story`                              |
| Text for the agent               | Place it by the text table in the principles                                                                                                                                                                                                                                     | "Show a plan before rendering"                    |
| A view                           | A `@dv/ui-*` plugin that reads and writes only through `@dv/api` and draws through the registries of `@dv/ui-canvas`, `@dv/ui-history` and `@dv/ui-composer`                                                                                                                     | The canvas                                        |
| Logic attached to the agent loop | The owner of the data registers on a DSH event, such as `agent/pre-step` or `tools/pre-execute`                                                                                                                                                                                  | `dv:` mention expansion                           |

## Example: rendering without reference images

1. Kind: a model for a generation task; the task `t2v` already exists in `TaskMap` of `@dv/models`.
2. Owner: the provider plugin that serves the model; `@dv/fastvideo` serves `fasth3` for task `t2v`.
3. Extension points: `@dv/fastvideo` declares task `t2v` for `fasth3` in its `SERVED` table and registers the entry `video/t2v/fastvideo/fasth3` when its config gives the task a server; `@dv/shot-render` needs no change, because `dv_shot_render` takes every registered entry.
4. Swappable: yes; another provider plugin can register another model for task `t2v`, and the agent chooses between them with `dv_models_list`, `dv_models_get`, and the `video-model-selection` skill.
5. Text: the prompt rules of `fasth3` for task `t2v` are the skill `fasth3-text-prompting` of the provider plugin; "every shot needs a reference" is an input requirement of `fasth3` for task `ref2v` only, which its `schema()` reports and its `validateGenerationRequest` enforces, stated in the skill `fasth3-reference-prompting` and in the refusal of `dv_shot_render`.
