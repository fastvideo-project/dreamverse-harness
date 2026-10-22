# Add a reference noun

English | [中文](adding-a-reference-noun.zh.md)

## Summary

This guide adds a reference noun to DreamVerse. A reference noun is a kind of item, such as a prop, that keeps reference images as versions that a shot names as `<id>@<version>`. You copy the location noun into two packages, change its words, register the packages, and mount them in the bundle. The agent then gets the tools `dv_<k>_create` and `dv_<k>_update` and the skill `<k>`. The canvas, the `@` menu and the History panel show the items. Outside the two noun packages, the guide edits only the bundle `@dv/bundle`, the TypeScript configs, `pnpm-lock.yaml`, one check script and the documentation. The guide uses the key `prop` as its example.

## Table of Contents

- [Before you start](#before-you-start)
- [Files that the guide creates or changes](#files-that-the-guide-creates-or-changes)
- [1. Create the host package](#1-create-the-host-package)
- [2. Create the UI package](#2-create-the-ui-package)
- [3. Register the packages in the TypeScript configs](#3-register-the-packages-in-the-typescript-configs)
- [4. Mount the noun in the bundle](#4-mount-the-noun-in-the-bundle)
- [5. Update the documentation](#5-update-the-documentation)
- [6. Run the architecture checks](#6-run-the-architecture-checks)
- [Further Exploration](#further-exploration)

<a id="before-you-start"></a>
## Before you start

Make sure that the noun fits the reference kit. Each item has an ID and a list of versions. Each version stands for a list of reference images, and an update writes the next version. If the noun needs another version meaning, the [kit membership rules](../subsystems/reference-nouns.md#kit-membership) do not allow the noun to use the kit. In that case, register the noun directly, as `packages/dv/COMPONENT-TEMPLATE.md` shows, and do not use this guide.

Choose these values:

- The key `<k>`, one lowercase word of letters and digits, such as `prop`. The key names the component, the reference kind, the ID param, the operations, the skill and the canvas node type. The keys `proj`, `asset`, `record` and `version` are reserved.
- The noun in Chinese and in English, such as 道具 and `prop`.
- The `@` menu order, the next free number. Character is 1, location is 2 and style is 3.

Run every command from the repository root, after `pnpm install`. Set the key, its capitalized form and the Chinese noun once in your shell:

```sh
k=prop
K=Prop
zh=道具
```

<a id="files-that-the-guide-creates-or-changes"></a>
## Files that the guide creates or changes

The file tree shows each file and the step that creates or changes it.

```text
packages/dv/
├── <k>/                                          step 1: copy of location/
├── ui-<k>/                                       step 2: copy of ui-location/
└── README.md, README.zh.md                       step 5: package map rows
docs/dreamverse/                                  step 5: noun lists
packages/bundle/dv/
├── cordis.patch.yml                              step 4: two rows
├── package.json                                  step 4: two dependencies
└── tests/composition.spec.ts                     step 4: plugin map, noun order
scripts/verify-package-readme-model-experience.ts step 5: one entry
tsconfig.base.json                                step 3: three paths
tsconfig.host.json                                step 3: one reference
tsconfig.client.json                              step 3: two references
pnpm-lock.yaml                                    steps 1, 2 and 4: pnpm install
```

<a id="1-create-the-host-package"></a>
## 1. Create the host package

The host package `@dv/<k>` is one `defineReference` declaration of `@dv/reference-kit`. Copy the location package and replace its noun words:

```sh
cp -r packages/dv/location packages/dv/$k
rm -rf packages/dv/$k/node_modules packages/dv/$k/lib
mv packages/dv/$k/skills/location packages/dv/$k/skills/$k
mv packages/dv/$k/tests/location.spec.ts packages/dv/$k/tests/$k.spec.ts
grep -rl -i location packages/dv/$k | xargs perl -pi -e "s/location/$k/g; s/Location/$K/g"
grep -rl 场景 packages/dv/$k | xargs perl -pi -e "s/场景/$zh/g"
```

Then rewrite the text that still describes a place:

1. In `src/index.ts`, set `meaning`, the `skill.description` and `skill.whenToUse` texts, and the JSDoc lines.
2. In `src/types.ts`, change the JSDoc lines and the ID example `l1`.
3. In `skills/<k>/SKILL.md`, write how the agent creates and updates the items. Name only the tools `dv_<k>_create` and `dv_<k>_update`.
4. In `tests/<k>.spec.ts`, change the skill sentence that the skill test expects, so that it matches `SKILL.md`.
5. In `package.json`, change `description`.
6. In `README.md` and `README.zh.md`, describe the noun and its limitations. Keep the headings and the line count of the two files equal.

To add version fields, form rows, an editor or more operations, use the [extension points](../subsystems/reference-nouns.md#extension-points) of the kit.

Run `pnpm install --no-frozen-lockfile`. It links the dependencies of the package and adds the package to `pnpm-lock.yaml`.

Verify: run `CI=true pnpm exec vitest run packages/dv/$k`. All tests pass.

<a id="2-create-the-ui-package"></a>
## 2. Create the UI package

The UI package `@dv/ui-<k>` is one `defineReferenceUi` declaration of `@dv/ui-kit/reference-kit.tsx`. Copy the location UI package and replace its noun words:

```sh
cp -r packages/dv/ui-location packages/dv/ui-$k
rm -rf packages/dv/ui-$k/node_modules packages/dv/ui-$k/lib
mv packages/dv/ui-$k/tests/ui-location.client.spec.tsx packages/dv/ui-$k/tests/ui-$k.client.spec.tsx
grep -rl -i location packages/dv/ui-$k | xargs perl -pi -e "s/location/$k/g; s/Location/$K/g"
grep -rl 场景 packages/dv/ui-$k | xargs perl -pi -e "s/场景/$zh/g"
```

Then set the `@` menu order:

1. In `src/client/index.ts`, set `mention.order`.
2. In `tests/ui-<k>.client.spec.tsx`, change the order `2` in the mention test name and in its expected list.
3. In `README.md` and `README.zh.md`, change the order `2` in the Summary.
4. In `package.json`, check `description`.

Run `pnpm install --no-frozen-lockfile`.

Verify: run `CI=true pnpm exec vitest run packages/dv/ui-$k`. All tests pass.

<a id="3-register-the-packages-in-the-typescript-configs"></a>
## 3. Register the packages in the TypeScript configs

Each package needs a path alias and a project reference. Add these lines after the matching `style` lines:

| File                   | Add                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig.base.json`   | `"@dv/<k>": ["./packages/dv/<k>/src/index.ts"]`, `"@dv/<k>/types": ["./packages/dv/<k>/src/types.ts"]` and `"@dv/ui-<k>": ["./packages/dv/ui-<k>/src/index.ts"]` |
| `tsconfig.host.json`   | `{ "path": "./packages/dv/<k>" }`                                                                                                                                   |
| `tsconfig.client.json` | `{ "path": "./packages/dv/<k>/tsconfig.client.json" }` and `{ "path": "./packages/dv/ui-<k>" }`                                                                     |

Verify: run `CI=true pnpm run typecheck`. The command exits with code 0. It checks the host program, which includes the test files, and then the browser program.

<a id="4-mount-the-noun-in-the-bundle"></a>
## 4. Mount the noun in the bundle

The bundle `@dv/bundle` mounts both packages. Edit these files:

1. In `packages/bundle/dv/cordis.patch.yml`, add the row `dv-<k>` with `name: '@dv/<k>'` after the row `dv-style`. Add the row `dv-ui-<k>` with `name: '@dv/ui-<k>'` after the row `dv-ui-style`. Add the noun to the comment that lists the skills that plugins register.
2. In `packages/bundle/dv/package.json`, add `"@dv/<k>": "workspace:*"` and `"@dv/ui-<k>": "workspace:*"` to `dependencies`.
3. In `packages/bundle/dv/tests/composition.spec.ts`, import the default export of `@dv/<k>` and add it to `PLUGINS`. The boot test fails for a bundle row whose package has no entry in `PLUGINS`.
4. In the same file, update the test that checks the noun order. Change its name, the noun pattern and the expected list. Change the row that must come just before `dv-ui-shot-plan` to `dv-ui-<k>`.
5. Run `pnpm install --no-frozen-lockfile`.

Verify: run `CI=true pnpm exec vitest run packages/bundle/dv`. All tests pass.

<a id="5-update-the-documentation"></a>
## 5. Update the documentation

Each package README and each DreamVerse page is a bilingual pair with a consistency record. The UI README uses the short Model Experience sentence, which needs an audited entry.

1. In `scripts/verify-package-readme-model-experience.ts`, add an entry for `packages/dv/ui-<k>` to `SENTENCE_MODEL_EXPERIENCE`, after the entry of `packages/dv/ui-style`.
2. Add one row for `<k>` and one row for `ui-<k>` to the package map in `packages/dv/README.md` and `packages/dv/README.zh.md`.
3. Run `git grep -n -E '@dv/(ui-)?style\b' -- docs/dreamverse ':!*.zh.md'`. The command prints the lines of the DreamVerse pages that list the nouns. In each of these lines, add `<k>` after `style`. In a table of nouns or of skills, add one row. Make the same change in the `.zh.md` page.
4. Record the README pairs:

   ```sh
   CI=true pnpm run verify-translation-pairing --write packages/dv/$k/README.md packages/dv/ui-$k/README.md packages/dv/README.md
   ```

5. Record each page that you changed in item 3 with `CI=true pnpm run verify-translation-pairing --write <English path>`.

Verify: run `CI=true pnpm run verify-package-readme-model-experience`, `CI=true pnpm run verify-translation-pairing` and `CI=true pnpm run verify-md-links`. The three commands exit with code 0.

<a id="6-run-the-architecture-checks"></a>
## 6. Run the architecture checks

The fitness test `scripts/dv-architecture.ts` checks the imports, the operation names and the skill texts of every DreamVerse package. The script `dv:owners` prints the package that owns each name.

Verify:

1. Run `CI=true pnpm exec vitest run scripts/dv-architecture.spec.ts`. All tests pass.
2. Run `CI=true pnpm run dv:owners | grep $k`. The output has nine rows. The package `<k>` owns the component, the kind, the operations `<k>.create` and `<k>.update`, and the skill. The package `ui-<k>` owns the node type, the version kind, the mention kind and the History row `<k>.`.

<a id="further-exploration"></a>
## Further Exploration

- [Reference nouns](../subsystems/reference-nouns.md): the reference kit, its two halves and its extension points.
- [Where new behavior goes](where-new-behavior-goes.md): how to choose an extension point.
- [Reference nouns Agent Note](../../../.agents/notes/implemented/architecture/2026-10-17-dv-architecture-reference-nouns.md): why the kit exists and when a noun stops using it.
- [`packages/dv/COMPONENT-TEMPLATE.md`](../../../packages/dv/COMPONENT-TEMPLATE.md): the layout and the checks of every DreamVerse component.
