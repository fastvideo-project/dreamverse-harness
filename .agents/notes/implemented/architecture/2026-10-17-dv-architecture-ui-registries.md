# Agent Note: DreamVerse UI registries — UI core draws what UI plugins register

Status: implemented

English | [中文](2026-10-17-dv-architecture-ui-registries.zh.md)

## Problem

The shared browser packages named the plugin nouns, so a plugin's interface could not be added or removed alone. `@dv/ui-canvas` drew story-bible nodes through `BibleKind` and `bibleItems` (`ui-canvas/src/client/graph.ts`), held the plan editor (`PlanHeader`, `PlanShots`), and deep-imported `AssetsPanel` and `Preview` from `@dv/ui-asset-pool`. `@dv/ui-history` folded renders under an approval through `scheduledBy`, which read the report of `plan.approve`, and named records in a `switch` with `plan.*` arms. `@dv/ui-composer` built the `@` menu by reading `state.components.timeline` and `state.components.bible`. `@dv/ui-shell` deep-imported the canvas and timeline views (`ui-shell/src/client/views.ts`). `@dv/ui-kit` fixed `RENDER_OPERATION = 'shot.render'` as the one operation whose records are takes. Adding one reference noun touched `ui-canvas`, `ui-history`, `ui-composer` and `ui-kit`, and an image or audio operation drew no take until the kit learned its name.

## Decision

The browser half of DreamVerse splits into UI core and UI plugins; [layers](2026-10-17-dv-architecture-layers.md) lists the packages and allowed imports of each layer. UI core is `@dv/ui-kit`, `@dv/ui-canvas`, `@dv/ui-history`, `@dv/ui-shell` and `@dv/ui-composer`; it draws only what plugins register and names no plugin noun ([R5](../process/2026-10-17-dv-architecture-fitness-test.md)). A UI plugin is a package `packages/dv/ui-<name>` with a `./client` entry, paired with the host package `<name>` when that package exists. `@dv/ui-kit` is a library: it registers nothing, and each consumer bundles the modules it imports. How a UI half types its own slice is in [client state types](2026-10-17-dv-architecture-client-state-types.md).

Each registry is a Cordis service that the UI-core package which reads it provides at the top level of its `apply`, never inside an effect, because other plugins register into it from their own fibers. A registry holds one owner per key. A UI half registers each descriptor as a `scope.effect` inside `ctx.inject`, so the plugin loads without the service, and its descriptors leave when the service or the plugin leaves. A UI half changes project data only by running an operation ([data flow](2026-10-17-dv-architecture-data-flow.md)). "Type" names a canvas node type and "kind" names a reference kind of the kernel or a mention kind; the name `NodeEntry` for a drawn node also keeps it apart from the generation parameter `seed`.

The registries, the slots, the descriptor types, and the canvas, history and mention rules are documented in [User interface](../../../../docs/dreamverse/subsystems/ui.md).

## Alternatives considered

**One `DvUi` service in `@dv/ui-kit` holding every registry.** It lost because ui-kit has no client plugin entry, while a DSH client registry is a service that a plugin provides at `apply` top level. Keeping the slot types in ui-shell or ui-canvas lost too, because it would make one UI-core package import another.

**A module-level registry object in ui-kit.** It lost because every bundle that imports ui-kit gets its own copy, so the canvas copy that the shell draws would not reach the registries that plugins fill.

**A plugin's UI half as a `./client` entry of its host package.** It lost to a separate `ui-<name>` package, because a package with both a host face and a client face needs three tsconfig files.

**Grouping takes only by `started_by.record`, without chain anchors.** It hung every take off one plan node even when two approvals started them, and it hid the shot-4 take of a second approval once a fourth plan version reused the takes of the first. Only a workflow knows which starters belong to one plan node, so the workflow registers the anchor.

**Takes in use as an optional method of the node type.** The timeline reports takes in use but draws no node, and every field of a node type is required, so `takesInUse` is its own registry.

**A per-plugin card slot (`dv.canvas.node`) and node claims.** No plugin registered a card or a claim, so the slot was an extension point that nothing used and no test covered.

**Telling takes apart by record outputs, or by a kernel `resource` field on records.** An output test hides a pending take until it finishes. A kernel field helps only records written after it, and no stored record held one (0 of 2178), so the operation declaration decides and record facts are the fallback.

**An editor slot owner of only `{ node, state }`.** An entry that imports only ui-kit would then drop 添加素材 and the asset preview, or copy the picker and the preview; `EntryEditorHost` lends callbacks and no React nodes.

**Renaming `VersionKind` and `MentionKind` to `…Type`.** `VersionType.kind` would mix the two words, and keeping the names left about 130 changed lines out of the rename.

**A `data-node-owner` attribute on each card.** The owners listing of the [fitness test](../process/2026-10-17-dv-architecture-fitness-test.md) maps a `data-node-type` value to its package, and the attribute adds a DOM field and test lines that no user goal asks for.

## Consequences

A plugin's interface is added or removed with its own package. A hand-written UI half that registers a node type, a version kind, takes in use, a history row and a mention kind for a `prop` noun edited no UI-core file; an ad workflow's UI half that hangs a second chain off the same plan node edited no file outside its own package. The [reference nouns](2026-10-17-dv-architecture-reference-nouns.md) note gives the cost of a noun built on `defineReferenceUi`.

The registries cost indirection and runtime failure modes:

- A key clash is a runtime error: `register` throws when two plugins claim one node type `id`, starter operation, reference kind or history `match`, and no type check catches it.
- The canvas reads plugin data only through descriptors, so a plan shows as approved only through a registered `ChainAnchor` with `approvedVersions`.
- The canvas tab body in the right Sidebar renders no slot: there an entry editor shows only its header, the asset picker lists only the version items, and an asset chip opens no preview.
- `@dv/ui-kit/src/client/types.ts` copies the host wire types by hand, so a field added on the host is added to the kit by hand.
- The three noun node types share the color `var(--dv-kind-character)`, because the ui-shell theme (`ui-shell/src/client/theme.ts`) defines no location or style token.
- The locale key `node.takeKind` in `ui-canvas/src/client/locales.ts` keeps the word "kind" for the label of a take card.
