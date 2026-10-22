# Agent Note: DreamVerse plugin layers and dependency direction

Status: implemented

English | [中文](2026-10-17-dv-architecture-layers.zh.md)

## Problem

The DreamVerse packages under `packages/dv/` let a contributor add an operation inside one plugin, but the nouns and the order of the production flow were written into shared packages, so a change to either edited packages that the change was not about:

- The kernel `@dv/project` fixed its component keys in the set `COMPONENT_KEYS` (`proj`, `asset`, `bible`, `plan`, `shot`, `timeline`, `inspect`) in `project/src/shared.ts`, and its agent tools text and its `<id>@<version>` parser named the character, location and style versions of the story bible. Adding one reference noun edited the kernel, `@dv/ui-kit` and `@dv/story-bible`.
- The canvas fixed its node kinds in the type `CanvasNodeKind = 'bible' | 'asset' | 'plan' | 'take'` (`ui-canvas/src/client/graph.ts`), and `@dv/ui-kit`, `@dv/ui-history` and `@dv/ui-composer` named the story bible in their wire types, history rows and `@` mention menu.
- `@dv/shot-plan` held three things: the plan data, the approve → render → timeline flow (its `plan.approve` operation ran `shot.render` and `timeline.create` by name), and the policy that reuses an earlier take. The flow had no package of its own, and the skill text described it a second time.
- The prompt skills of the FastVideo provider named the consumer tool `dv_shot_render` (`fastvideo/src/fasth3.ts`), so a provider knew the plugin above it.
- Adding image generation (#51) and audio generation (#59) as plugins, after a refactor of the model catalog, still edited 6 and 4 files of `@dv/models` and edited `@dv/ui-kit` besides the new primitive and provider packages.

The architecture fitness test `scripts/dv-architecture.ts`, run against the code before the change, reports 197 violation matches in 127 distinct entries: 119 where a UI-core package names a plugin noun, 55 where the kernel names one, 13 where a skill names a layer above its own, 4 dependencies that point up, 3 imports into another package's `src`, and 3 host packages that name another plugin's operation.

## Decision

Each DreamVerse plugin has one goal, and each plugin can be added or removed alone. A plugin is one host package, plus one UI package `ui-<name>` when it has a browser half, and the bundle composes it with one row per package in `packages/bundle/dv/cordis.patch.yml`. Ten layers and their one dependency direction serve that goal: a package depends only on layers that know nothing about it, so adding or removing a plugin edits no package below it and no sibling.

`layerOf` in the fitness test infers the layer of each package from its folder name, and for a provider from a `dvModels.register(` call, so no package declares its layer. A host package that its UI package reads also publishes a client face `./types`, which the browser program compiles. A face imports and augments only other faces, so the browser program never compiles host code.

The layers, the import table and the two faces are documented in [DreamVerse architecture](../../../../docs/dreamverse/architecture.md), and the scripts that check them in [DreamVerse architecture checks](../../../../docs/dreamverse/architecture-checks.md).

### The other DreamVerse architecture notes

- [Data flow](2026-10-17-dv-architecture-data-flow.md): the kernel `@dv/project` and the one-direction flow from records to views.
- [Generation](2026-10-17-dv-architecture-generation.md): the model catalog, `@dv/generation` and how a new primitive is added.
- [Workflows](2026-10-17-dv-architecture-workflows.md): each workflow is a component in its own package `@dv/workflow-<key>`, and the shot walk, which holds no policy, is the library `@dv/workflow-kit`.
- [UI registries](2026-10-17-dv-architecture-ui-registries.md): UI core draws only what UI packages register in its registries and slots, and names no plugin noun.
- [Reference nouns](2026-10-17-dv-architecture-reference-nouns.md): `character`, `location` and `style` on the shared reference kit, and its membership rule.
- [Client state types](2026-10-17-dv-architecture-client-state-types.md): the `ComponentStates` merges and the partial wire view.
- [Fitness test](../process/2026-10-17-dv-architecture-fitness-test.md): `scripts/dv-architecture.ts` runs the layer rules as a test against a ratchet baseline, `pnpm dv:owners` prints the owner of each registration, and `scripts/dv-blast-radius.ts` limits the size of one change.
- [Documentation tree](../process/2026-10-22-dreamverse-docs-tree.md): the `docs/dreamverse/` tree that holds the mechanics of these notes.

## Alternatives considered

**A generic step engine in place of workflow plugins.** One engine would run any configured sequence of steps, so a second flow would need no package. It lost because only one workflow existed, and the decision builds no generic step engine before two workflows exist. The `workflow-kit` limits (no workflow key, at most 300 non-blank `src` lines) keep the library from growing into one.

**No workflow library: copy the shot walk, or let one workflow import another.** It lost because the direction table forbids a workflow to import another workflow, and a copied walk fails the repository duplicate check (6 lines and 60 tokens). The `workflow-lib` layer holds the walk that both may import.

**A typed `OperationMap` for calls by operation name.** Plugins would merge their params into one map, and `dvProject.run` would type every call by operation name. It lost because a service wraps `run` inside the plugin that owns the operation and knows its params, surfaces call operations by name as the user and the runner validates their params, and no added plugin needed the map.

**A dual-face package for the UI half.** A host package would ship its browser half itself, as a `./client` entry with a `dsh.client` manifest. It lost because no DreamVerse host package had a client half, and a package with both halves needs three tsconfig files (a host leaf, a client leaf and a solution-only root) besides its `tsdown.config.ts` and `dsh.client` manifest.

**A split host config for the client face.** Each package with a `./types` face would also move its host program into `tsconfig.host.json` under a solution-only root, the layout of other dual-face packages in the repository. It lost because it adds a `tsconfig.host.json` reference in 12 DreamVerse packages and checks nothing that the unsplit form misses; `tsconfig.json` stays the host config.

**`./types` files that import the bare host package.** A `src/types.ts` would import types from, and augment, `@dv/project` directly. It lost because `@dv/project` resolves to `project/src/index.ts`, which imports `node:crypto` and the Cordis host, so a UI package that read any face compiled host code in the browser program and failed its type check. Faces import and augment only other faces, and the fitness test follows each face to enforce it.

**Plugin types copied by hand into `@dv/ui-kit`.** `ui-kit/src/client/types.ts` held copies of the plugin slice types, so the browser program never touched host packages. It lost because every copy names a plugin in UI core and drifts from its owner; each host package publishes its own `./types` face, and the `ComponentStates` of `@dv/ui-kit` declares only the `proj` and `asset` slices.

## Consequences

**What the layers buy.** The fitness test reports 0 violations on the shipped tree, and its baseline file `scripts/dv-architecture.baseline.json` is `{}`, against the 197 matches before the change. A change to one noun, one primitive or one workflow therefore stays in the packages of that plugin; the measured cost of each such addition is in the note that owns it: [reference nouns](2026-10-17-dv-architecture-reference-nouns.md), [generation](2026-10-17-dv-architecture-generation.md) and [workflows](2026-10-17-dv-architecture-workflows.md).

**More packages.** `packages/dv/` holds 36 packages, against 24 before the change. `story-bible` is gone; `character`, `location`, `style`, `generation`, `reference-kit`, `workflow-kit` and `workflow-story` and the UI packages `ui-character`, `ui-location`, `ui-style`, `ui-shot-plan`, `ui-shot-render` and `ui-workflow-story` are added. A plugin with a browser half is two packages and two bundle rows.

**The layer lists are code.** A new base, surface or UI-core package must be added to `BASE`, `SURFACE` or `UI_CORE` in `scripts/dv-architecture.ts`. Any other package is classified by its folder name (`workflow-*`, `ui-*`), by a `dvModels.register(` call, or as a domain plugin, and is checked by that layer's imports.

**Surfaces read domain slices.** A surface may read the slice type of any domain plugin, and no rule scans these reads. `api/src/wire.ts`, `api/src/summaries.ts` and `chat-references/src/expand.ts` read the `timeline` slice; [client state types](2026-10-17-dv-architecture-client-state-types.md) records what this leaves open on the host side.
