# Where new behavior goes

English | [中文](where-new-behavior-goes.zh.md)

This how-to places new DreamVerse behavior. It gives the principles that decide the owner, the procedure, the lookup table of extension points, and a worked example.

New DreamVerse behavior attaches to an extension point that a package already owns. DeepSeek Harness behavior follows the same rule, in the "Where new behavior goes" section of the [architecture page](../../architecture.md).

## Principles

1. Everything has one owner. Each piece of data, each capability, and each text that the agent reads belongs to one plugin. That plugin registers it at an extension point.
2. A plugin says in one sentence what it owns. When the only description of a plugin is "connects A to B", the plugin owns nothing. Split it among the owners of A and B.
3. New behavior attaches to an existing extension point. Choose the extension point from the lookup table.
4. Only a swappable capability becomes a capability seam. A capability with two or more interchangeable implementations gets a Service Definition package and Service Provider packages.
5. Dependencies point one way. The [import table](../architecture.md#import-direction) of the architecture page gives the layers that each layer may import. A component never names the operation of another component in code.
6. Text for the agent goes with its owner, by this table:

| The text is about                                                                      | It goes in                                                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| How to use one component's tool                                                        | That operation's `description`                                                         |
| A procedure across several components                                                  | A skill in `@dv/bundle` or in the workflow that owns the procedure (`story-directing`) |
| A model's limits and how to write its prompts, such as the reference requirement       | The prompt skill that the model's provider plugin registers for the task               |
| How to choose the model of a shot                                                      | The `video-model-selection` skill of `@dv/models`                                      |
| The project state, which changes every turn                                            | The `dv:project` prompt section of `@dv/project`, through the reducers' `agentSummary` |

## Procedure

When you add something, answer questions 1 to 5 in order, and then do step 6:

1. What kind of thing is it? Find its row in the "To add" column of the lookup table.
2. Who owns it? When no package owns it, create a component and write the one sentence that says what it owns.
3. Which extension point does it attach to? The "Do this" column of its row in the lookup table gives it.
4. Must it be swappable? If so, make it a capability seam. If not, it is one registration in an ordinary plugin.
5. Does it carry text for the agent? If so, put the text with its owner by the table in the principles.
6. Verify the placement. Check that the one sentence of the owner still holds. Run `CI=true pnpm exec vitest run scripts/dv-architecture.spec.ts`. The test passes, so the change adds no violation beyond the baseline `scripts/dv-architecture.baseline.json`. Then run `pnpm dv:owners`. The listing gives a row to each component key, each skill, and each operation name that a declaration writes as a string literal. It also gives rows to each `defineReference`, `defineGeneration` and `defineReferenceUi` declaration. Each `NodeType`, `VersionKind`, `MentionKind` and `HistoryRow` descriptor gets a row too. Find the rows of the names that you added, with their owner in the `package` column. The [owner listing section](../architecture-checks.md#owner-listing) of the architecture checks gives the limits of the listing.

## Lookup table

| To add                           | Do this                                                                                                                                                                                                                                                                          | Example                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Project data                     | Add it to the owning component's reducer state and summarize it in `agentSummary`                                                                                                                                                                                                | The music of a shot                               |
| An operation                     | `registerOperation` in the owning component; Project derives the tool, the history, and undo, and `POST /api/dv/operation` runs any registered operation from a view                                                                                                             | `timeline.clip_split`                             |
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
3. Extension points: `@dv/fastvideo` declares task `t2v` for `fasth3` in its `SERVED` table. It registers the entry `video/t2v/fastvideo/fasth3` when its config gives the task a server. `@dv/shot-render` needs no change, because `dv_shot_render` takes every registered entry.
4. Swappable: yes; another provider plugin can register another model for task `t2v`, and the agent chooses between them with `dv_models_list`, `dv_models_get`, and the `video-model-selection` skill.
5. Text: the prompt rules of `fasth3` for task `t2v` are the skill `fasth3-text-prompting` of the provider plugin. The rule "every shot needs a reference" is an input requirement of `fasth3` for task `ref2v` only. The `schema()` of `fasth3` reports it, and its `validateGenerationRequest` enforces it. The skill `fasth3-reference-prompting` and the refusal of `dv_shot_render` state it.
