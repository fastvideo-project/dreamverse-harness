# Generation

English | [中文](generation.zh.md)

This page is the reference for DreamVerse generation: the model catalog of `@dv/models` and the checks that `shot.render` applies before it renders.

<a id="model-catalog"></a>
## Model catalog

The model catalog is the `dvModels` service of [`@dv/models`](../../../packages/dv/models/README.md), a capability seam whose Service Providers are provider plugins, such as [`@dv/fastvideo`](../../../packages/dv/fastvideo/README.md), and whose Consumers include `@dv/shot-render`. Each shot renders with the catalog entry that its `modality`, `task`, `provider`, and `model` name; the [`@dv/models` README](../../../packages/dv/models/README.md) defines the keys, the entries, the render request, the agent tools, and the procedures to add a provider, a model, or a server.

The precondition of `shot.render` refuses, for every caller, a model key that is not in the catalog, a missing prompt, params outside the entry's facts, more than one first frame, and a render request that the entry refuses. Each entry's `validateGenerationRequest(request)` owns the model's request rules, such as the accepted media types and counts of the inputs (at least one reference for `fasth3` in task `ref2v`), a first frame that the model does not take, and invalid `extra` values; `shot.render` builds the request, calls it before the record is written and again right before the render, and checks no model rule itself. Each shot of a plan names its own `modality`, `task`, `provider`, and `model`; a shot of task `ref2v` takes its own references, else the plan's, and `continue_previous: true` makes a shot start from the last still of the previous shot. `plan.create` and `plan.update` refuse references in a task other than `ref2v`, and `continue_previous` on shot 1 or in a task other than `ref2v`.
