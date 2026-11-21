# Contribute a DreamVerse model provider

English | [中文](adding-a-dreamverse-provider.zh.md)

Use this guide to make a video, image, or speech model available to DreamVerse Harness users, or to keep an existing provider current. A provider is a plugin that registers one `ModelEntry` per model and task into the model catalog; the agent, the pickers, and the shot, image, and audio pipelines then use the model without further changes.

## 1. Choose a path

- **First-party (recommended).** Contribute a plugin under `packages/dv/<provider>` in this repository. The plugin builds and ships with DreamVerse, reuses the shared packages directly, and runs in the same CI. The contributor keeps its maintenance guide current ([section 8](#8-maintain-first-party-support)).
- **Out-of-repo.** Publish your own package that users install into their profile with `dsh plugin add`. It works for a host-side provider, with the gaps listed in [section 10](#10-ship-a-provider-outside-this-repository).

Before you start, collect what the plugin needs from the provider: the limits of each model and task (durations, aspect ratios, resolutions, input counts and media types), the model parameters, a stable model ID, how media goes in and out, the error format, how a job is cancelled and whether cancelling stops billing, and how requests are authenticated. When an item is missing, say so in the PR instead of inventing a value. For video, do not invent frame rates or pixel sizes that the provider does not publish; duration-based clouds supply exact `durationsSec`.

## 2. Pick a template

| Integration style | Template | What to copy |
| --- | --- | --- |
| Managed HTTP API with asynchronous jobs | [`@dv/openrouter`](../../packages/dv/openrouter/README.md) | Key resolution, `redirect: 'error'`, submit once then poll, catalog-driven aliases, image and speech output normalization. |
| Vendor SDK that ships only for another language | [`@dv/reactor`](../../packages/dv/reactor/README.md) | The subprocess bridge: one JSON request on stdin, a scrubbed environment, a bounded session, a fake SDK in tests. |
| Self-hosted OpenAI-compatible image or audio server | [`@dv/vllm-omni`](../../packages/dv/vllm-omni/README.md) | One server per model, a served-model check, refusing unsupported sizes before rendering. |
| Self-hosted video server | [`@dv/fastvideo`](../../packages/dv/fastvideo/README.md) with limits in configuration, [`@dv/uniserve`](../../packages/dv/uniserve/README.md) with limits read from the server | Whole-clip requests, and worker routing for several servers in `@dv/fastvideo`. |

Worked examples of the documentation this guide asks for: the [Reactor maintenance guide](providers/reactor.md) and the [OpenRouter maintenance guide](providers/openrouter.md).

## 3. Reuse what exists

Do not reimplement these. Read the owning README for details.

| Need | Use |
| --- | --- |
| Entry type, facts, schema, request validation, stream events, prompt skills | [`@dv/models`](../../packages/dv/models/README.md): `ModelEntry`, `RenderModelFacts`, `RenderRequest`, `RenderStreamEvent`, `promptSkill`. |
| Registering entries from configured aliases | `@dv/models`: `syncModelEntries`, `syncModelEntriesAsync`, `assertModelAlias` ([registration helpers](../../packages/dv/models/README.md#share-model-registration-code)). |
| Reading input media | [`@dv/asset-pool`](../../packages/dv/asset-pool/README.md): `get`, `path`, `mediaType`, `hasAudio`, `read`. Never read raw asset IDs. |
| Probing and the last frame | [`@dv/ffmpeg`](../../packages/dv/ffmpeg/README.md): `probe`, `lastFrame`, `run`. |
| Prompt citations | [`@dv/project`](../../packages/dv/project/README.md): `replacePromptCitations`, `citedAsset`, `citedInput`. Never write a citation URI by hand. |
| Secrets | [`@deepseek-ai/dsh-credentials`](../../packages/credentials/credentials/README.md): `credentialRef`, `isCredentialRefName`, and `ctx.credentials.resolve` on the host. |
| Environment for a child process | [`@deepseek-ai/dsh-subprocess`](../../packages/subprocess/subprocess/README.md): `scrubbedParentEnv`. |
| Discovery routes for the browser | `ctx.inject(['connection'], ...)` and `connection.fetch.register`, as in the OpenRouter and Reactor catalog routes. |
| Consuming the entries | [`@dv/shot-render`](../../packages/dv/shot-render/README.md), [`@dv/image-generate`](../../packages/dv/image-generate/README.md), [`@dv/audio-generate`](../../packages/dv/audio-generate/README.md). Providers `import type` the image and audio request types and never import the consumers. |

The layering check in [dv-architecture.ts](../../scripts/dv-architecture.ts) lets a provider value-import only `@dv/project` and the base packages (`models`, `generation`, `asset-pool`, `canvas`, `ffmpeg`, `reference-kit`, `hardware`), and never another provider. Run `pnpm exec vitest run scripts/dv-architecture.spec.ts` and check that it reports nothing for your package.

## 4. Implement the plugin

Follow [adding a package](adding-a-package.md) for the manifest, `tsconfig`, and registrations. Export `name`, `inject`, `Config`, and `apply`; inject `dvModels` and the services you read (`dvAssetPool`, `dvFfmpeg`, `credentials`).

- **Stable IDs.** The provider ID is a lowercase name without `/`. The model of an entry is a local alias; the provider's native ID is configuration.
- **Configuration.** Every deployment-varying value is a validated `Config` field: base URL, timeouts, the model list, the credential reference. A `DEFAULT_*` constant is not configurability. Make `models` `.volatile()` so edits reach the live registry. Check aliases with `assertModelAlias` and the credential reference with `isCredentialRefName`, so a bad value fails the plugin load. A dormant installation (`models: {}`) makes no network call.
- **Registration.** Build entries per alias and task, and register them with `syncModelEntries` or `syncModelEntriesAsync`. A fixed entry uses `ctx.effect(() => ctx.dvModels.register(entry), label)`. Every contribution is an effect, so unloading disposes it.
- **Entry contract.** The JSDoc of [ModelEntry](../../packages/dv/models/src/types.ts) owns the semantics of `facts`, `schema`, `validateGenerationRequest`, and `render`. Refuse a bad request with one agent-facing sentence per problem before any paid call. Strip citations from the prompt with `replacePromptCitations`.
- **Hosting and placement.** Set `hosting` on every entry: `managed` when the provider operates the servers, `self-hosted` when the user runs the server. Set `workerRouting: true` only when the render accepts an explicit `worker`. The agent reads both from `dv_models_list` and follows the [placement rules](../../packages/dv/models/skills/video-model-selection.md) of the `video-model-selection` skill, so a managed model renders without device checks.
- **Output.** A video render yields `last_frame`, `video_start`, `chunk`, and `done` in that order, with the last frame from `dvFfmpeg.lastFrame`. An image entry returns PNG bytes and the pixel size, and a speech entry returns a WAV clip with its duration; convert other formats with `dvFfmpeg`.
- **Secrets.** Resolve the key on the host for each operation, never cache it, and keep only its reference name in `Config`. Never put a key in argv, a child environment, a log, or an error. Pass it to a subprocess on stdin and start the child with `scrubbedParentEnv()`. Send authenticated requests with `redirect: 'error'`, and never log signed URLs.
- **Account status.** A provider that needs a credential implements its account check through `registerAccountRoute` from `@dv/models`, which serves `GET /api/dv/<provider>/account` for the saved key and `POST` with `{ "key": "..." }` to verify a candidate key before it is stored, both with `Cache-Control: no-store` and never echoing the key. The check reports `needs-setup` with an actionable message when the host lacks a local runtime that renders need, such as an SDK. Its catalog route answers 503 without a key, 401 when the provider refuses it, and 502 otherwise, through `catalogMissingKey` and `catalogFailure`. See the [account-status route](../../packages/dv/models/README.md#share-the-account-status-route).
- **Cancellation and billing.** Pass the abort signal to every request and reject with `signal.reason`. When the provider has no cancellation route, declare `cancellation: 'monitoring_only'` in the schema and say in the description that stopping does not cancel the paid job. Send a paid request once and never retry it automatically.
- **Failure.** A misconfiguration fails loudly at load or at the earliest point it can be resolved. A configured model that the provider no longer offers is skipped and named, not silently dropped.

## 5. Test and record evidence

- Cover every `src` file to 100% (`pnpm run test:coverage` is the CI gate). Check one package with `pnpm exec vitest run <tests> --coverage --coverage.include=<src file>`.
- Add a real composition test that boots the real bundle row through `bootBundle` in `packages/bundle/dv/tests/` ([Reactor example](../../packages/bundle/dv/tests/reactor.spec.ts)), and replace only the vendor: a fake HTTP server ([OpenRouter](../../packages/dv/openrouter/tests/openrouter.spec.ts), [vLLM-Omni](../../packages/dv/vllm-omni/tests/fixture.ts)) or a fake SDK on the interpreter path ([Reactor fixture](../../packages/bundle/dv/tests/fixtures/reactor/reactor_sdk.py)). Own the ports and temporary directories and tear them down ([testing policy](../testing.md)).
- Cover registration and disposal, configuration refusals, `facts` and `schema` from the provider, one case per refusal sentence, render event order, provider errors, and abort.
- Pin model-visible tool schemas with owner-local expected files under `tests/expected/`, as [`packages/bundle/dv/tests/expected/tools`](../../packages/bundle/dv/tests/expected/tools) does. Update a keyless recorded-session snapshot when session-visible output changes ([when a snapshot is required](../testing.md)).
- A paid live test is opt-in: name it `*.e2e.ts`, gate it on an environment variable, and skip it without a key, as [reactor-live.e2e.ts](../../packages/bundle/dv/tests/reactor-live.e2e.ts) does with `DV_REACTOR_LIVE_TEST=1`.

## 6. Write the documentation

- A package README in English and Chinese from the `package-reference` template of [dsh-doc](../../.agents/skills/dsh-doc/SKILL.md), including the Model Experience section: the entry descriptions, prompt skills, and refusal sentences the model sees. Link this guide and the maintenance guide under Further Exploration.
- A maintenance guide `docs/cookbook/providers/<provider>.md` and `.zh.md`, linked from both READMEs. `pnpm run verify-provider-maintenance-guides` fails for a provider package without one.
- Re-record each pair with `pnpm run verify-translation-pairing --write <file>`, then run `pnpm run test:docs`.

## 7. Wire the provider into the bundle

- Add a row `dv-<provider>` with an empty `models` map to [cordis.patch.yml](../../packages/bundle/dv/cordis.patch.yml), and the dependency to the bundle `package.json`.
- Add the `@dv/<provider>` entries to `tsconfig.base.json` paths and a reference to `tsconfig.host.json`.
- Add the plugin to `PLUGINS` in [bundle.ts](../../packages/bundle/dv/tests/bundle.ts) and cover the row in `composition.spec.ts`.

<a id="settings-card"></a>
### Settings card

A first-party provider that needs an API key contributes a client package, `@dv/ui-<provider>`, that registers a `CloudModelSettings` entry on `ctx.dvCloudModels` ([`@dv/ui-kit/cloud-model-settings.ts`](../../packages/dv/ui-kit/src/client/cloud-model-settings.ts)). The entry names the provider (`id`, `name`, `domain`, `keyUrl`, `logo`, `media`) and gives its operations: `account` reads `GET /api/dv/<provider>/account`, `verify` posts a candidate key to the same route without storing it, `load` stores a verified key and reads `GET /api/dv/<provider>/catalog`, and `removeKey` deletes the key. `@dv/ui-shell` draws the entry on **Settings → Models**, so the provider needs no page of its own and no provider name in shared UI: display names come from the entry. Mount the package in the bundle like `dv-ui-reactor` in [cordis.patch.yml](../../packages/bundle/dv/cordis.patch.yml). [`@dv/ui-reactor`](../../packages/dv/ui-reactor/README.md) is the template.

## 8. Maintain first-party support

The contributor, or the vendor the contributor represents, owns the provider after it merges: name a contact in the PR and keep the maintenance guide current. The repository has no code owners file, so reviewers rely on that contact for provider questions. Update the provider in the same PR as the change that triggers it:

- The provider adds, renames, or retires a model.
- The API or SDK version changes, or a field the plugin reads changes.
- A limit changes: durations, sizes, input counts, media types.
- Cancellation or billing behavior changes.

How to make each change:

- **Model mapping.** Catalog-driven providers map aliases to native IDs in configuration and need no code change for a model that fits an existing task. Providers with bundled profiles change the profile table. The maintenance guide names the file.
- **Version pins.** Record the supported SDK or API version in the README setup and the maintenance guide. To bump it, run the provider tests and a live smoke on the new version, then update both documents.
- **Retiring a model.** Saved projects keep the media already rendered. A render request that names a removed alias is refused with an unknown-model error, and the agent chooses another model. While the provider still serves the model, note the retirement and the replacement in the entry description. Remove the alias from the bundle defaults and the maintenance guide once the provider stops serving it. A catalog-driven provider reports a configured model that its catalog lacks instead of failing.
- **Evidence in the PR.** Provider and bundle test results; the live smoke for the changed model and task with the model ID, version, and result; changed limits or billing behavior; and the updated READMEs and guide in both languages.

## 9. Open the pull request

- Fork the repository and open a focused PR against the default branch. For a larger change, open an issue first ([contribution guide](../../CONTRIBUTING.md)).
- Fill in the PR template: motivation, changes, and testing with proof.
- Apply exactly one `kind/*` label (`kind/feature` or `kind/bug-fix`) and the material `area/*` labels, such as `area/video` and `area/web`.
- Run the smallest checks that cover the diff ([dsh-pre-push-checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md)) and report only what you ran.
- Keep keys, signed media URLs, and private deployment details out of the diff, tests, and logs.
- A change that alters visible GUI behavior includes a GIF recorded from the PR's real flow ([record-browser-gif](../../.agents/skills/record-browser-gif/SKILL.md)).

## 10. Ship a provider outside this repository

A package outside this repository mounts its plugin through a bundle patch, and users install it into their profile.

1. Publish a package with `"type": "module"`, a plugin that exports `name`, `inject`, `Config`, and `apply`, `@deepseek-ai/cordis` as a peer dependency, and `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`. The patch inserts one row, for example `- insert: [{ id: dv-acme, name: '@acme/dreamverse-provider', config: { models: {} } }]`. See [publishing a plugin](../user/develop/basic/publish.md).
2. A user runs `scripts/video-harness/setup-profile.sh` from a DreamVerse checkout with `DSH_HOME` set, then `pnpm dsh plugin --profile video-harness add <package, tarball, or github:owner/repo#sha>`, then restates `models` in `profiles/video-harness/cordis.patch.yml`. `pnpm dsh --profile video-harness --dump-config` shows the inserted row. Adding and removing a tarball package leaves the `@dv/bundle` link that `setup-profile.sh` creates.
3. The user supplies the key through the credential store or the environment variable that `credentialRef` names.

Gaps today:

- The `@dv/*` packages are private, export TypeScript source, and carry no versioning promise. Type-check against a DreamVerse checkout, or write JavaScript with your own minimal interfaces, and expect to follow repository changes.
- DreamVerse runs from a source checkout with the source launcher, so users need a checkout.
- A package outside the repository has no documented way to add a browser settings page. Users set the key through the credential store or the environment.
- Install with `dsh plugin add`, not an absolute path in a patch: a plugin loaded by path may load its own copies of the harness packages.
- There is no provider directory. Share the package in the [FastVideo Slack](https://join.slack.com/t/fastvideo/shared_invite/zt-4heayzk81-lOkgpvJRoceuZjNP7pXxJA) or on [Discord](https://discord.gg/dqc2J2yNQ), or contribute it as a first-party provider.
