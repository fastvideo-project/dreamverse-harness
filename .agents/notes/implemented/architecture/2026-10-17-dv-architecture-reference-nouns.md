# Agent Note: DreamVerse reference nouns — the reference kit and its membership rule

Status: implemented

English | [中文](2026-10-17-dv-architecture-reference-nouns.zh.md)

## Problem

DreamVerse keeps three kinds of item that shots must reproduce: characters, locations and styles. All three lived in one plugin pair. `@dv/story-bible` owned one `bible` slice shaped `{ characters, locations, styles }`, three reference kinds, six operations built from one template per verb (`bible.character_create`, `bible.location_update` and the others) and one `story-bible` skill. `@dv/ui-story-bible` looped over a `KINDS` list of three entries to draw the nouns, and `@dv/api` read `state.components.bible` field by field to collect reference images. A change to one noun, such as a richer character editor, edited both shared packages, and one slice held three nouns that each have their own source of truth.

Before that, the nouns reached further: the kernel `@dv/project` declared `CharacterId`, `LocationId`, `StyleId` and one input-reference arm per noun in `project/src/types.ts`, `@dv/ui-kit` copied the version types, and `@dv/ui-canvas`, `@dv/ui-composer`, `@dv/ui-history` and `@dv/chat-references` each named the three nouns. Adding one reference noun touched the kernel, `ui-kit`, the canvas and the story bible. A noun written as its own plugin pair without a shared library copied the story bible code and differed from it only in text.

## Decision

A **reference noun** is a component whose items have the kit shape: each item has an ID and a list of versions, each version stands for a list of reference images, an input names one version as `<id>@<version>`, and an update supersedes the record that wrote the previous version. The [data flow note](2026-10-17-dv-architecture-data-flow.md) owns reference kinds, `<id>@<version>` parsing, staleness and supersession. This note owns the nouns and the library that they share.

Character, location and style are three reference nouns. Each noun is its own plugin pair with its own slice: `@dv/character` and `@dv/ui-character`, `@dv/location` and `@dv/ui-location`, `@dv/style` and `@dv/ui-style`. Each pair makes one call to each half of a shared library, the **reference kit**, which implements the kit shape once: `defineReference` of the base-layer package `@dv/reference-kit` ([layers note](2026-10-17-dv-architecture-layers.md)) and `defineReferenceUi` of the file `packages/dv/ui-kit/src/client/reference-kit.tsx`. A noun package fills in only what differs between nouns. A noun package never imports another noun package, and every other plugin reads the nouns through the kernel and client registries that the kit fills.

A noun uses the kit only while its items have the kit shape. A noun that needs a different shape stops using the kit and registers directly. The move edits only the noun's two packages, because every other plugin reads nouns through the registries. Character is the noun expected to stop using the kit first, because it is expected to manage more of its own behavior. The kit shape, the two declarations and what they register, the extension points and the membership rules are documented in [DreamVerse reference nouns](../../../../docs/dreamverse/subsystems/reference-nouns.md), and [Adding a reference noun](../../../../docs/dreamverse/cookbook/adding-a-reference-noun.md) gives the steps.

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
