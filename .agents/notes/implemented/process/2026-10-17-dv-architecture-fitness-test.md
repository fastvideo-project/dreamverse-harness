# Agent Note: DreamVerse architecture fitness test

Status: implemented

English | [中文](2026-10-17-dv-architecture-fitness-test.zh.md)

## Problem

The DreamVerse packages under `packages/dv` share one goal: each plugin has one goal and can be added or removed alone ([layers](../architecture/2026-10-17-dv-architecture-layers.md)). The code drifted from that goal without a failing check. When a scanner first read the packages, it found 197 rule matches at 127 distinct places. The kernel `@dv/project` declared `CharacterId` and a `bible` property, and its agent text named plans and shots. The UI core held 119 of the matches: `packages/dv/ui-kit/src/client/tool-labels.ts` labeled 23 plugin tools such as `dv_plan_create`, and `packages/dv/ui-canvas/src/client/graph.ts` read `params.plan`, `params.shot` and `components.timeline`. `packages/dv/ui-shell/src/client/views.ts` imported `@dv/ui-canvas/src/client/CanvasView.tsx`. `@dv/shot-plan` named `timeline.create` and `shot.render` and imported `@dv/timeline`. The fastvideo prompting skills named `dv_shot_render`, a tool of a higher layer.

No command showed which package owned a given name. No check measured how far one change reached: the image-generation work changed 7 files in 2 packages outside its own, and the audio-generation work changed 18 files in 3 other packages.

## Decision

`scripts/dv-architecture.ts` scans the DreamVerse packages for the rules R1 to R8, and `scripts/dv-architecture.spec.ts` runs the scan as a Vitest test, so `pnpm test` fails on a regression and names the broken rule in words. The scanner walks TypeScript syntax trees, so comments never match. It compares the violations with a ratchet baseline that counts matches by file, rule and matched text, so a change that removes a violation lowers its entry in the same commit. The checked-in baseline is `{}`, and one exception marker with a fixed reason text suppresses a match on its own line.

`pnpm dv:owners` prints the owner package of each component key, reference kind, operation, skill and UI registration from the facts that the rules read. `scripts/dv-blast-radius.ts` measures one change against a base commit. It fails above 400 counted lines or above 3 existing packages with logic changes, and it weighs moved and deleted lines less than added lines.

The rules, the baseline, the exception marker, the owner listing and the change size check are documented in [DreamVerse architecture checks](../../../../docs/dreamverse/architecture-checks.md).

## Alternatives considered

**Key each baseline entry by file and line.** A change that shifts lines in a file it does not fix would break such an entry, so the key is file, rule and matched text with a count.

**Keep a reader of earlier records behind permanent markers.** The reader would give `@dv/workflow-story` a second goal, reading records of other plugins, and its markers would never leave.

**Exempt `asset` in R1 (b).** `asset` is also the component key of `@dv/asset-pool`, so the exemption would hide `'asset'` literals and `components.asset` reads in the kernel. R1 (b) exempts only `proj`.

**Scan reference kinds statically in R3.** A helper registered kinds with the kind passed as data, so a scan of literal `kind:` values missed them. The runtime `kind_exists` check holds instead.

**Let `defineReference` also claim `<k>.create` and `<k>.update` statically.** No case showed an error that the extra claim catches and the runtime `operation_exists` check misses, and the owner listing derives those rows anyway.

**Scan prose for nouns.** A Chinese word scan of UI core literals also hits product copy that names no registry, and a kind-word scan of skill prose also hits story words such as "the story's characters". Reviewers check those lists.

**Give `dv:owners` a word filter, or mark nodes with a `data-node-owner` DOM attribute.** Rows sort by key, so `grep` already gives one block, and the attribute adds a DOM field and tests that no user goal asks for.

**Limit a change to 250 `src` lines.** The project owner set 400 counted lines as the target, and moved and deleted lines weigh less because a pure move or deletion is quick to review.

**Let any `--allow` glob exempt a package from the logic count.** An unlimited glob lets logic pass as wiring; only `:max` and `:net-delete` keep the count a number.

**Lint the whole repository, or lint with the staged config only.** A green full lint is repository-wide cleanup, and `.oxlintrc.staged.json` sets `typeAware: false`, which passed a type error that the default config flags. `--lint` checks only added lines with the default config.

## Consequences

The packages went from 197 matches to an empty baseline and no marker, and any regression fails `pnpm test` with the broken rule in words. Measured with the change size check, the image-generation work rebuilt on the layers changed 2 test files outside its own packages instead of 7 files, and the audio-generation work changed 12 files of its provider instead of 18 files in 3 packages.

R1 (c), R1 (d) and R5 (c) match fixed names such as `CharacterId`, the word timeline and the literal `plan`, so a noun outside those lists passes them; key-based clauses such as R1 (b) and R5 (b) follow the registered keys. A package gets its layer from its folder name, and a provider from its `dvModels.register(` call.

R3 and the owner listing see only literal operation names. Operations named through constants, such as `APPROVE` in `packages/dv/workflow-story/src/reducer.ts` and `OPERATIONS` in `packages/dv/timeline/src/reducer.ts`, get no row: `pnpm dv:owners` lists 13 operations and omits `story.approve`, `shot.render`, `plan.update` and the timeline operations. No test compares the listing with the runtime owners.

No `package.json` script and no `scripts/run-gates.ts` profile runs the change size check; `scripts/dv-architecture.spec.ts` tests only its functions. A reviewer runs it by hand with arguments chosen per change.
