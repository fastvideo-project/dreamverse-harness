# DreamVerse architecture checks

English | [中文](architecture-checks.zh.md)

This page is the reference for the scripts that check the [DreamVerse architecture](architecture.md): the fitness test, the owner listing, and the change size check. The [fitness test Agent Note](../../.agents/notes/implemented/process/2026-10-17-dv-architecture-fitness-test.md) records why the checks have this design.

| Check             | Script                                                                                                     | Command                                                   | Fails on                                                                                                                  | Runs automatically in                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Fitness test      | [`scripts/dv-architecture.ts`](../../scripts/dv-architecture.ts), run by `scripts/dv-architecture.spec.ts` | `pnpm exec vitest run scripts/dv-architecture.spec.ts`    | a violation count of rules R1 to R8 that differs from the baseline                                                        | `pnpm test`, and the CI jobs `node 24 / coverage` and `windows node 24 / coverage` through `pnpm run check:ci:coverage` |
| Owner listing     | [`scripts/dv-owners.ts`](../../scripts/dv-owners.ts)                                                       | `pnpm dv:owners`                                          | nothing; it prints one row per owned name                                                                                 | no check                                                                                                                |
| Change size check | [`scripts/dv-blast-radius.ts`](../../scripts/dv-blast-radius.ts)                                           | `pnpm exec tsx scripts/dv-blast-radius.ts --base <sha> …` | a path outside own, wiring and the allow globs (R9), a change that is too large (R10), or a lint finding on an added line | no check; `scripts/dv-architecture.spec.ts` tests only its functions                                                    |

## Fitness test

The fitness test scans the DreamVerse packages for the rules R1 to R8. It compares the violations with the baseline `scripts/dv-architecture.baseline.json`. The root `vitest.config.ts` includes `scripts/**/*.spec.ts`, so every run of the whole Vitest suite runs the fitness test.

`readScanFiles` reads these files and skips every path that contains `/tests/`:

- `packages/dv/*/src/**/*.{ts,tsx}`;
- `packages/dv/*/skills/**/*.md` and `packages/bundle/dv/skills/**/*.md`;
- `packages/dv/*/package.json`, for the `./types` entry of each package.

`readScanFiles` throws when it finds no source file of `@dv/project`, so a narrowed glob cannot pass because it scans nothing. The scanner walks the TypeScript syntax tree of each `.ts` and `.tsx` file, so a comment never matches. It matches skill Markdown as text. `layerOf` gives each package its layer, as [Layers](architecture.md#layers) describes.

### Rules

Each failure line repeats the statement of its rule from `RULE_STATEMENTS` in [`scripts/dv-architecture.ts`](../../scripts/dv-architecture.ts). A violation carries its clause letter, such as `R1d`. R3 reports clauses (a) and (b) as `R3` and clause (c) as `R3c`.

| Rule | Main matches                                                                                                                                                                                                                                                                                                                                                                                   | What it protects                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| R1   | In `project/src`: (a) `@dv/*` imports; (b) a plugin component key as a literal or a `components.<key>` read; (c) `CharacterId`, `LocationId`, `StyleId` and a `bible` property; (d) the words character, location, style, plan, shot, timeline and clip in string text; (e) `started_by` outside `types.ts`, `runner.ts` and `record-store.ts`.                                                | You add or remove a plugin without a kernel edit ([project data](architecture.md#project-data)). |
| R2   | (a) `image`, `audio` and every primitive key in `models`, `generation` and `reference-kit`, and also `video`, `shot` and `plan` in `generation`; (b) a workflow key or operation in `workflow-kit`, or more than 300 non-blank lines there.                                                                                                                                                    | You add a primitive or a workflow without a base package edit.                                   |
| R3   | (a) A component key that two packages claim; (b) a literal operation outside the package of its key; (c) a malformed or reserved `defineReference` key.                                                                                                                                                                                                                                        | Removing a package removes each name that it owns.                                               |
| R4   | A `<key>.<verb>` literal of a key that another package owns. `api` and `chat-references` may name `asset.import` and `asset.place`.                                                                                                                                                                                                                                                            | No host package drives another plugin by operation name.                                         |
| R5   | (a) Plugin operation literals; (b) `components.<key>` reads other than `proj` and `asset`; (c) the literals `character`, `location`, `style`, `bible` and `plan`; (d) `params.plan`, `params.plan_version` and `params.shot`; (e) plugin tool names in `DV_TOOL_LABELS`; (f) plugin tool names in literals.                                                                                    | UI core draws plugins only through registries.                                                   |
| R6   | `@dv/<pkg>/src/…` specifiers.                                                                                                                                                                                                                                                                                                                                                                  | Packages meet only at their exported entries.                                                    |
| R7   | (a) Each `@dv/*` import against the [import table](architecture.md#import-direction) `IMPORTS`; (b) a `./types` entry that reaches `node:*`, `@deepseek-ai/cordis` or `@deepseek-ai/dsh-tools` through imports or `declare module` targets.                                                                                                                                                    | The direction of the layers, and a client face that loads in the browser.                        |
| R8   | In skill Markdown, provider literals and skill descriptions: (a) a tool of a higher layer; (b) `plan` or `continue_previous` in base and provider text; (c) a workflow tool outside that workflow's skills; (d) any tool in a skill description, and a tool other than `dv_models_*` in catalog text; (e) another workflow's `<k>-directing`; (f) a reference noun's tool outside its package. | A skill names only tools that exist wherever its package loads.                                  |

The runtime of `@dv/project` checks what R3 does not scan. `packages/dv/project/src/runner.ts` refuses a second component key (`component_exists`), a second operation (`operation_exists`), and an operation name without its `<component>.` prefix. `packages/dv/project/src/reducers.ts` refuses a second reference kind (`kind_exists`). The spec pins each clause with the fixtures in `scripts/fixtures/dv-architecture/` and with inline cases.

### Baseline

`scripts/dv-architecture.baseline.json` maps the key `<file> <rule> <matched text>` to a count. The key holds no line number. `compareBaseline` fails in three cases:

1. a key that the baseline does not hold;
2. more matches than the count of a key;
3. fewer matches than the count of a key.

Each failure line gives the key, the found count, the baseline count, the lines of the matches, and the statement of the rule. When a change removes a violation, lower its count in the same commit.

### Exception marker

A TypeScript line may end with the one exception marker `// dv-arch-allow R<k>: temporary exception`. The marker suppresses the matches of every clause of `R<k>` on its own line. Any other marker text, and a marker that suppresses no match, fail as a `marker` violation.

<a id="owner-listing"></a>
## Owner listing

`pnpm dv:owners` runs `scripts/dv-owners.ts`, which prints the rows of `listOwners` as a table with the columns `what`, `name`, `package`, `where` and `extra`. `listOwners` reads the facts that the R3 walk collects (`collectFacts`), so the listing and the rules see the same declarations. The rows come from these declarations:

- component key claims (`registerComponent('<k>')` and `component: '<k>'`);
- literal operation declarations;
- `defineReference` and `defineReferenceUi` calls;
- variables typed as the UI registry entries `NodeType`, `VersionKind`, `MentionKind` and `HistoryRow`;
- skill files.

The rows sort by key, so `pnpm dv:owners | grep character` prints the rows of `@dv/character` and `@dv/ui-character` as one block. The listing finds only operation names that a declaration writes as string literals. An operation whose name comes from a constant or a parameter has no row.

## Change size check

`scripts/dv-blast-radius.ts` checks one change against a base commit:

```text
pnpm exec tsx scripts/dv-blast-radius.ts --base <sha> [--own <dir or glob>]... [--allow <glob>[:max=<n>][:net-delete]]... [--max-lines <n>] [--lint]
```

The script reads the changed paths from `scripts/change-scope.ts`: committed, staged, unstaged and untracked files. It prints the paths outside own and wiring (`X` lines), the limits of each allow glob, the counted lines, and the packages with logic changes. The last line is `PASS` or `FAIL`, and a failure sets exit code 1.

### R9: paths and limits

Each changed path must be own, wiring, or matched by an `--allow` glob. An own path starts with an `--own` directory or matches an `--own` glob. Wiring paths are always allowed and never counted:

- the root TypeScript configs, the lockfile, and the composition and documentation files of `packages/bundle/dv/` (the constant `WIRING` in [`scripts/dv-blast-radius.ts`](../../scripts/dv-blast-radius.ts) lists them);
- every file under `docs/dreamverse/` (`DOCS_WIRING`);
- the `README.md`, `package.json` and `tsconfig.json` of a package that does not exist at the merge base;
- the baseline file, when it exists at the merge base.

`:max=<n>` caps the added plus deleted lines of the files that the glob matches. `:net-delete` fails when these files gain lines. The baseline file always carries `:net-delete`. Each R9 failure line starts with `R9:`.

### R10: size

The check counts the lines of the change with these weights:

- An added line counts 1.
- A deleted line counts 0.5.
- A deleted non-blank line whose trimmed text is added in another file counts 0.
- Tests, spec files, `pnpm-lock.yaml`, `README.zh.md`, `*.i18n.yaml` and wiring paths count 0.
- A package that does not exist at the merge base counts only its `src/` and `skills/` lines.

The check fails above 400 counted lines, or above the cap of `--max-lines <n>`. It also fails above 3 existing packages with logic changes. A package has logic changes when it has more than 2 changed `src` lines. At least one of its changed `src` files must also be outside every limited glob. Each R10 failure line starts with `R10:`.

### Lint

`--lint` runs the default oxlint config through `scripts/run-oxlint.ts` on the changed `.ts` and `.tsx` files. The type-aware rules read the host build, so run `tsc -b tsconfig.host.json` first. The check fails only on a finding on an added line, and each failure line starts with `lint:`.

No `package.json` script and no `scripts/run-gates.ts` profile runs the change size check. A reviewer runs it by hand and chooses the arguments for each change.
