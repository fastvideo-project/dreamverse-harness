# Agent Note: DreamVerse reference nouns — the reference kit and its membership rule

Status: implemented

English | [中文](2026-10-17-dv-architecture-reference-nouns.zh.md)

## Problem

DreamVerse keeps three kinds of item that shots must reproduce: characters, locations and styles. All three lived in one plugin pair. `@dv/story-bible` owned one `bible` slice shaped `{ characters, locations, styles }`, three reference kinds, six operations built from one template per verb (`bible.character_create`, `bible.location_update` and the others) and one `story-bible` skill. `@dv/ui-story-bible` looped over a `KINDS` list of three entries to draw the nouns, and `@dv/api` read `state.components.bible` field by field to collect reference images. A change to one noun, such as a richer character editor, edited both shared packages, and one slice held three nouns that each have their own source of truth.

Before that, the nouns reached further: the kernel `@dv/project` declared `CharacterId`, `LocationId`, `StyleId` and one input-reference arm per noun in `project/src/types.ts`, `@dv/ui-kit` copied the version types, and `@dv/ui-canvas`, `@dv/ui-composer`, `@dv/ui-history` and `@dv/chat-references` each named the three nouns. Adding one reference noun touched the kernel, `ui-kit`, the canvas and the story bible. A noun written as its own plugin pair without a shared library copied the story bible code and differed from it only in text.

## Decision

A **reference noun** is a component whose items have the following shape, called the kit shape in this note:

- Each item has an ID and a list of versions. Every create or update writes the next version and keeps the earlier ones.
- Each version stands for a list of reference images (`references`, asset IDs), with a name and a description.
- An input names one version as `<id>@<version>`, such as `c1@3`, and the runner resolves it to that version's reference images.
- An update supersedes the record that wrote the previous version, so every record made from that version becomes stale.

The [data flow note](2026-10-17-dv-architecture-data-flow.md) owns reference kinds, `<id>@<version>` parsing, staleness and supersession. This note owns the nouns and the library that they share.

Character, location and style are three reference nouns. Each noun is a plugin pair with its own slice: `@dv/character` and `@dv/ui-character`, `@dv/location` and `@dv/ui-location`, `@dv/style` and `@dv/ui-style`. Each host package owns the operations `<k>.create` and `<k>.update` (agent tools `dv_<k>_create` and `dv_<k>_update`), and the `@` menu shows the sections 角色, 场景 and 风格 in that order.

One key names everything of a noun: the component key, the reference kind, the ID param, the operation prefix, the skill name and the canvas node type. Each host package carries a hand-written skill `packages/dv/<k>/skills/<k>/SKILL.md` that names only its own tools. A noun package never imports another noun package: the layer rule of the [fitness test](../process/2026-10-17-dv-architecture-fitness-test.md) rejects a domain package that imports another domain package.

## The two halves of the reference kit

Each noun pair holds one call to each half of a shared library, the **reference kit**, which implements the kit shape once; a noun package fills in only what differs between nouns.

**Host half: `@dv/reference-kit`.** The package `packages/dv/reference-kit` sits in the base layer ([layers note](2026-10-17-dv-architecture-layers.md)). `defineReference(spec)` returns a Cordis service class, and the noun package default-exports a subclass, as `class DvCharacter extends defineReference({...}) {}` in `packages/dv/character/src/index.ts` does. The declaration has seven fields: `service`, `component`, `noun` (`{ zh, en }`), `meaning`, `reference` (the input roles), `skill` and the optional `fields`. The class injects `dvProject` and registers the component key, the reducer `referenceReducer(spec)`, the reference kind of the same name, the operations `<k>.create` and `<k>.update` with labels built from `noun`, and, while the DSH skill registry is mounted, the skill `<k>`. `<k>.create` refuses an ID with `@` or `#` and any ID that `dvProject.kindsWithId` lists, so IDs stay unique across every reference kind. The client face `@dv/reference-kit/types` exports `ReferenceVersion`, `ReferenceSlice` and `ReferenceKey`; a declaration compiles only with a key that the noun merges into both `ComponentStates` and `ReferenceKinds` with a `ReferenceSlice` value. The package names no noun and no media type: the declaration supplies the noun words and the `image` input role.

**UI half: `ui-kit/src/client/reference-kit.tsx`.** The file `packages/dv/ui-kit/src/client/reference-kit.tsx`, imported as `@dv/ui-kit/reference-kit.tsx`, holds `defineReferenceUi(spec)` and `ReferenceEditor`. The declaration has six fields: `id` (the package name, which is also the editor slot key), `key`, `slice`, `label`, `mention` and the optional `editor`. `defineReferenceUi` returns the noun's `NodeType`, `VersionKind`, references in use, `MentionKind` and `HistoryRow`, and `apply(ctx)`, the client plugin body that registers them and the `dv.canvas.editor` entry. `ReferenceEditor`, the default editor body, writes every change as `<key>.update` through `host.run`. The [UI registries note](2026-10-17-dv-architecture-ui-registries.md) owns these registries, and the [client state types note](2026-10-17-dv-architecture-client-state-types.md) owns what a missing slice means. The UI declaration repeats the label pair of the host declaration.

**Extension points.** A noun grows inside the kit through four mechanisms:

- `fields` on the host half: extra version fields, each one param of both operations; an update that omits a field keeps its previous value.
- `children` on the UI half: extra form rows inside `ReferenceEditor` that write through `<key>.update`.
- `editor` on the UI half: a whole editor body in place of `ReferenceEditor`.
- More `<k>.*` operations: the noun's service class registers them in its own constructor, because the class extends the class that `defineReference` returns.

## Who imports the kit

Only the six noun packages import the kit from `src`: the three host packages import `@dv/reference-kit`, and the three UI packages import `@dv/ui-kit/reference-kit.tsx`. Beyond them, only tests, `scripts/dv-architecture.ts` and its fixtures, the root tsconfig files and `pnpm-lock.yaml` refer to the kit in code; `packages/dv/COMPONENT-TEMPLATE.md`, `docs/dreamverse/architecture.md`, the package READMEs and the Agent Notes document it.

Every other plugin sees only what the kit registers. `@dv/chat-references` expands `dv:<kind>/<id>` for each kind in `dvProject.listReferenceKinds()`. The runner resolves `c1@3` through the registered reference kind. `@dv/api` collects reference images from the resolved inputs of records in `mentionedAssets`. `@dv/ui-canvas`, `@dv/ui-composer` and `@dv/ui-history` draw from the `dvCanvas`, `dvMentions` and `dvHistory` registries. No plugin depends on the kit at runtime, and a noun can bypass it: `packages/dv/COMPONENT-TEMPLATE.md` shows the direct `registerComponent`, `registerReducer`, `registerReferenceKind` and `registerOperation` calls that components of other shapes, such as `@dv/shot-plan` and `@dv/timeline`, make themselves.

## Kit membership

A noun stays on the kit only while its items have the kit shape.

- **No option for one noun.** The kit adds no option, branch, default or token that only one noun uses. A noun grows only through the four extension points.
- **Leaving the kit.** A need that changes the version shape, the create or update semantics, or what `<id>@<version>` resolves to moves the noun off the kit. Its two packages then register with `dvProject` and the canvas registries directly. The move edits only those two packages, because every other plugin reads nouns through the kernel and canvas registries.
- **Two nouns or none.** The kit keeps at least two nouns. When only one noun is left, the kit folds back into that noun.
- **Expected first case.** Character is the noun expected to leave first, because it is expected to manage more of its own behavior.

| A noun needs                                                          | Mechanism                                                      | Stays on the kit |
| --------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------- |
| More version fields and form rows                                     | `fields`, `children`                                           | yes              |
| A different editor, such as a character portrait panel                | `editor`                                                       | yes              |
| More operations, such as training a LoRA or checking face consistency | the constructor of the noun's service class                    | yes              |
| A different version meaning, or a different `<id>@<version>` result   | direct registration with `dvProject` and the canvas registries | no               |

## Why the UI half lives in ui-kit

The host half is its own package, while the UI half is one file of `@dv/ui-kit`, because of the import rule of the [fitness test](../process/2026-10-17-dv-architecture-fitness-test.md): a UI-layer package may import `@dv/ui-kit`, its paired host package's `./types` with `import type`, and the slot declarations of UI core packages, and nothing else. The placement reflects the size of the change and makes no claim that reference nouns belong with the rest of `@dv/ui-kit`. As part of UI core, the file falls under the rule that UI core names no plugin noun.

## Alternatives considered

**A package `@dv/reference-kind` with `defineReferenceKind` and `defineReferenceKindUi`.** It lost because one call registers six things and `defineReferenceKind` reads like a thin wrapper of `registerReferenceKind`. `pnpm dv:owners` meets the search need behind the name by printing the kind row under the noun's package ([fitness test](../process/2026-10-17-dv-architecture-fitness-test.md)).

**A ten-field host declaration with `plural`, `idExample` and `describe`.** It lost because only the key, the Chinese noun name and the meaning differed among the three story bible nouns. The ID example and the description texts were the same for all three and interpolate the key, so the kit derives the summary field `<k>s` and keeps one text.

**A skill generated from the declaration.** It lost because a skill holds advice that differs by noun: the character skill keeps descriptions to wardrobe and mood and never facial features, and the style skill speaks of looks such as film grain. A generator needs one declaration field for each such line, which grows the kit. The kit only loads the noun's `skill.file`.

**A UI declaration that reads the noun words from the host declaration.** It lost because a UI package may import its host package only with `import type`, so it cannot read `noun` at runtime. The UI declaration repeats one label pair instead.

**A separate `@dv/ui-reference-kit` package.** It lost on the size of the change: the noun UI packages may not import another UI-layer package, so the package needs another layer in `scripts/dv-architecture.ts`, while a file in `@dv/ui-kit` needs no rule change.

## Consequences

A noun costs two declarations. `@dv/character` has 46 non-blank `src` lines and `@dv/ui-character` has 23; location and style have the same sizes. In a trial build, a fourth noun `prop` on the kit edited only its own two packages, `prop` and `ui-prop`, and no shared package. A second trial gave character a `traits` field and its own editor through `fields`, `children` and `editor`, and changed only `character` and `ui-character`.

A kit change reaches every noun at once. A bug fix in the kit fixes all three nouns, and an option for one noun would burden all three. No automated check enforces the membership rule; review enforces it.

Mounting a noun still edits wiring outside its pair: the bundle files under `packages/bundle/dv/`, the path aliases in `tsconfig.base.json` and the noun lists of the `docs/dreamverse/` pages.

The UI half shares a package with unrelated code: `@dv/ui-kit/src/client` holds 22 modules and 2404 lines, among them the `/api/dv` client, the wire types and the timeline geometry, and 14 UI packages depend on `@dv/ui-kit`.

Known gaps:

- `defineReferenceUi` colors every card `var(--dv-kind-character)`, so location and style cards share the character color. The UI core noun rule ([R5](../process/2026-10-17-dv-architecture-fitness-test.md)) does not catch it, because the rule matches whole string literals and the noun sits inside a CSS string.
- `ReferenceEditor` writes the input role `reference`, so a noun whose declaration names a different input role needs its own `editor`.
- The kit has no delete operation: an item stays in the project once created, and an update can only change it.
