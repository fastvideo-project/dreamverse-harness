# Agent Note: DreamVerse architecture fitness test

Status: implemented

English | [中文](2026-10-17-dv-architecture-fitness-test.zh.md)

## Problem

The DreamVerse packages under `packages/dv` share one goal: each plugin has one goal and can be added or removed alone ([layers](../architecture/2026-10-17-dv-architecture-layers.md)). The code drifted from that goal without a failing check. When a scanner first read the packages, it found 197 rule matches at 127 distinct places. The kernel `@dv/project` declared `CharacterId` and a `bible` property, and its agent text named plans and shots. The UI core held 119 of the matches: `packages/dv/ui-kit/src/client/tool-labels.ts` labeled 23 plugin tools such as `dv_plan_create`, and `packages/dv/ui-canvas/src/client/graph.ts` read `params.plan`, `params.shot` and `components.timeline`. `packages/dv/ui-shell/src/client/views.ts` imported `@dv/ui-canvas/src/client/CanvasView.tsx`. `@dv/shot-plan` named `timeline.create` and `shot.render` and imported `@dv/timeline`. The fastvideo prompting skills named `dv_shot_render`, a tool of a higher layer.

No command showed which package owned a given name. No check measured how far one change reached: the image-generation work changed 7 files in 2 packages outside its own, and the audio-generation work changed 18 files in 3 other packages.

## Decision

`scripts/dv-architecture.ts` scans the DreamVerse packages for rules R1 to R8, and `scripts/dv-architecture.spec.ts` runs the scan as a Vitest test. The root `vitest.config.ts` includes `scripts/**/*.spec.ts`, so `pnpm test` runs it; `pnpm exec vitest run scripts/dv-architecture.spec.ts` runs it alone. The scanner walks the TypeScript syntax tree of each `.ts` and `.tsx` file, so comments never match, and matches skill Markdown as text.

`readScanFiles` reads `packages/dv/*/src/**/*.{ts,tsx}`, `packages/dv/*/skills/**/*.md`, `packages/bundle/dv/skills/**/*.md` and `packages/dv/*/package.json`, and skips every path that contains `/tests/`. It throws when it finds no kernel source, so a narrowed glob cannot pass by scanning nothing. `layerOf` assigns each package its layer from its folder name, through the lists `BASE`, `SURFACE` and `UI_CORE` and the `workflow-` and `ui-` prefixes, and marks a package that calls `dvModels.register(` as a provider.

Every failure line repeats the rule's line from `RULE_STATEMENTS`, and a violation carries its clause letter, such as `R1d`.

## The rules

| Rule | Statement in `RULE_STATEMENTS` | Main matches | What it protects |
| --- | --- | --- | --- |
| R1 | The kernel names no plugin noun and never reads `started_by`. | In `project/src`: (a) `@dv/*` imports; (b) a plugin component key as a literal or a `components.<key>` read; (c) `CharacterId`, `LocationId`, `StyleId`, `bible`; (d) plugin nouns in string text; (e) `started_by` outside `types.ts`, `runner.ts` and `record-store.ts`. | A plugin is added or removed without a kernel edit ([data flow](../architecture/2026-10-17-dv-architecture-data-flow.md)). |
| R2 | Base packages, reference-kit included, name no media type; workflow-kit names no workflow. | (a) `image`, `audio` and every primitive key in `models`, `generation` and `reference-kit`; (b) a workflow key or operation in `workflow-kit`, or more than 300 non-blank lines there. | A primitive or a workflow is added without a base package edit ([generation](../architecture/2026-10-17-dv-architecture-generation.md), [workflows](../architecture/2026-10-17-dv-architecture-workflows.md)). |
| R3 | One owner per component key, reference kind and operation; `defineReference` operations are checked at runtime; a `defineReference` key is one lowercase word and not `proj`, `asset`, `record` or `version`. | A component key claimed twice; a literal operation outside the package of its key; (c) a malformed or reserved `defineReference` key. | Each name leaves with the one package that owns it ([reference nouns](../architecture/2026-10-17-dv-architecture-reference-nouns.md)). |
| R4 | A host package names only operations of its own component key. | A `<key>.<verb>` literal of a key that another package owns; `api` and `chat-references` may name `asset.import` and `asset.place`. | No host package drives another plugin by operation name. |
| R5 | UI core names no plugin noun. | (a) Plugin operation literals; (b) `components.<key>` reads other than `proj` and `asset`; (c) the literals `character`, `location`, `style`, `bible` and `plan`; (d) `params.plan`, `params.plan_version` and `params.shot`; (e, f) plugin tool names in `DV_TOOL_LABELS` and in literals. | UI core draws plugins only through registries ([UI registries](../architecture/2026-10-17-dv-architecture-ui-registries.md)). |
| R6 | No deep import into another package's `src`. | `@dv/<pkg>/src/…` specifiers. | Packages meet only at their exported entries. |
| R7 | Dependencies point down the layers; a `./types` entry reaches no host-only module. | (a) Each `@dv/*` import against the layer table `IMPORTS`; (b) a `./types` entry that reaches `node:*`, `@deepseek-ai/cordis` or `@deepseek-ai/dsh-tools` through imports or `declare module` targets. | The direction of the [layers](../architecture/2026-10-17-dv-architecture-layers.md), and a client face that loads in the browser. |
| R8 | A skill never names a consumer; only the package that owns a reference kind names its tools. | In skill Markdown, provider literals and skill descriptions: (a) a tool of a higher layer; (b) `plan` or `continue_previous` in base and provider text; (c) a workflow tool outside that workflow's skills; (d) a tool other than `dv_models_*` in catalog text; (e) another workflow's `<k>-directing`; (f) a reference noun's tool outside its package. | A skill names only tools that exist wherever its package loads. |

The runtime covers what R3 leaves out: `packages/dv/project/src/runner.ts` refuses a second component key (`component_exists`), a second operation (`operation_exists`) and an operation name without its `<component>.` prefix, and `packages/dv/project/src/reducers.ts` refuses a second reference kind (`kind_exists`). The spec pins each clause with the 24 fixtures in `scripts/fixtures/dv-architecture/` and inline cases.

## Baseline and exception marker

`scripts/dv-architecture.baseline.json` maps `<file> <rule> <matched text>` to a count. The key holds no line number, so moved code changes nothing. `compareBaseline` fails on a missing key, on more matches than the count and on fewer matches, so a change that removes a violation lowers its entry in the same commit. The checked-in baseline is `{}`.

A TypeScript line may end with the one exception marker `// dv-arch-allow R<k>: <reason>`, where the reason is the fixed text that `RULE_STATEMENTS.marker` quotes. The marker suppresses matches of `R<k>` on its own line. Any other marker text and any marker that suppresses nothing fail as a `marker` violation. No file under `packages/` carries the marker.

## Owner listing

`pnpm dv:owners` runs `scripts/dv-owners.ts`, which prints the rows of `listOwners`. `listOwners` reads the facts of the R3 walk (`collectFacts`), so the listing and the rules see the same declarations. Rows come from component claims, literal operation declarations, `defineReference` and `defineReferenceUi` calls, variables typed as a UI registry entry, and skill files. Rows sort by key, so `pnpm dv:owners | grep character` prints the nine rows of `@dv/character` and `@dv/ui-character` as one block.

## Change size check

`scripts/dv-blast-radius.ts` checks one change against a base commit:

```
pnpm exec tsx scripts/dv-blast-radius.ts --base <sha> [--own <dir or glob>]... [--allow <glob>[:max=<n>][:net-delete]]... [--max-lines <n>] [--lint]
```

It reads the changed paths, untracked files included, from `scripts/change-scope.ts`. A path must be own, wiring or matched by an `--allow` glob. Wiring is the fixed list `WIRING` (root tsconfig files, `pnpm-lock.yaml`, bundle registration files), every file under `docs/dreamverse/`, plus the `README.md`, `package.json` and `tsconfig.json` of a package absent at the merge base and the baseline file once it exists there. `:max=<n>` caps the added plus deleted lines of the matched files, and `:net-delete` fails when they gain lines; the baseline file always carries `:net-delete`.

An added line counts 1, a deleted line 0.5, and a deleted line whose trimmed text is added in another file 0. Tests, spec files, `pnpm-lock.yaml`, `README.zh.md` and `*.i18n.yaml` count 0, and a package that does not exist at the merge base counts only `src/` and `skills/`. The check fails above 400 counted lines, or the cap of `--max-lines <n>`, and above 3 existing packages with logic changes: more than 2 changed `src` lines, some outside every limited glob. `--lint` runs the default oxlint config, which needs the host build, and fails only on findings on added lines. Failure lines start with `R9:` for paths and limits and `R10:` for size.

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
