# Write a DreamVerse plugin

This guide is for developers who want to add a feature to DreamVerse and offer it on the Marketplace page. It covers what a plugin can add, how to lay out its packages, how to package it as one installable bundle, and how to publish and list it.

This guide covers what is specific to DreamVerse. For the harness basics (what a plugin is, adding a tool, configuration, and packaging a bundle), work through the DSH tutorial path first: [your first plugin](../../docs/user/develop/basic/index.md), [add a tool](../../docs/user/develop/basic/tool.md), [plugin configuration](../../docs/user/develop/basic/config.md) and [package and install a plugin](../../docs/user/develop/basic/publish.md); the [Cordis tutorial](../../docs/cordis-tutorial/index.md) goes deeper into lifecycle, services and effects.

The examples come from two kinds of plugins:

- **For the code**, the built-in Text Node component on `main`: [`text-node`](text-node/src/index.ts) registers a component key, a reducer, its operations and a skill, and [`ui-text-node`](ui-text-node/src/client/index.ts) registers a canvas node type with its card and editor. It is small and in every checkout, but it is packaged as part of DreamVerse itself, so do not copy its `package.json`.
- **For the packaging**, the two published third-party-style plugins: **Blender** (`@fastvideo/dreamverse-blender` on npm, source on the `dv-blender` branch under `packages/dv/blender*` and `packages/dv/ui-blender`) and **Voice acting** (`@fastvideo/dreamverse-voice-acting` on npm, source on the `dv-voice-acting` branch). Each is a bundle of its own with published builds, and Blender also shows a right-sidebar tab, WebSocket routes and a tool that returns an image to the model.

## Contents

1. [What a plugin can add](#1-what-a-plugin-can-add)
2. [Publishing to the Marketplace](#2-publishing-to-the-marketplace)
3. [Set up a fork](#3-set-up-a-fork)
4. [Lay out the packages](#4-lay-out-the-packages)
5. [Write the host plugin](#5-write-the-host-plugin)
6. [Write the browser plugin](#6-write-the-browser-plugin)
7. [Write the workflow skills](#7-write-the-workflow-skills)
8. [Keep the agent's view small and exact](#8-keep-the-agents-view-small-and-exact)
9. [Make the bundle](#9-make-the-bundle)
10. [Test it](#10-test-it)
11. [Publish and list it](#11-publish-and-list-it)
12. [Checklist](#12-checklist)

## 1. What a plugin can add

DreamVerse is a set of Cordis plugins on DeepSeek Harness, and a third-party plugin uses the same registries as the built-in ones. Every registration goes through `ctx.effect(...)`, so turning the plugin off removes it again.

| You want to add | Register it with | Example |
| --- | --- | --- |
| A project action that the agent and the canvas can run, whose result is a record with assets (a render, an import, an edit) | `ctx.dvProject.registerOperation(spec)`; DreamVerse also registers the agent tool `dv_<name>` for it | `textnode.write`, `shot.render` |
| An agent tool that reads or acts outside the project (no record) | `ctx.tools.register(defineTool({...}))` from `@deepseek-ai/dsh-tools` | `dv_models_list`, `dv_models_get` |
| A video, image or audio model in the model pickers | `ctx.dvModels` (see the `dv-add-model-provider` skill in `.claude/skills` and `packages/dv/models/README.md`) | `@dv/openrouter`, `@dv/uniserve` |
| Instructions the agent loads for a task | a `skills/<name>/SKILL.md` folder served by a `FileSystemSkillProvider` | `story-directing`, `ad-making` (`workflow-story`) |
| HTTP routes for your browser code | `ctx.connection.fetch.register(route)` | `/api/dv/openrouter/catalog`, `/api/dv/plugins/catalog` |
| A WebSocket | `ctx.webServer.registerUpgrade({...})` | `/vh/ws` (`packages/video-harness/stream`) |
| A tab in the right sidebar | `ctx.sidebarRightTabs.register(definition)` plus a `sidebar.right.pane.tab` slot body | the History and Timeline tabs |
| A canvas node type with its card and editor | `ctx.dvCanvas.nodeTypes.register(...)` plus `dv.canvas.card` and `dv.canvas.editor` slot bodies | the text node (`ui-text-node`) |
| Canvas takes for your operation's records | `defineGenerationUi({...})` from `@dv/ui-generation/generation-kit.tsx` | the shot, image and audio takes (`ui-shot-render`, `ui-image-generate`, `ui-audio-generate`) |

Rule of thumb: if the result belongs in the project (it should show on the canvas, in the asset pool, in history, and be undoable), make it an operation; if it only reads or controls something outside the project, make it a plain tool.

## 2. Publishing to the Marketplace

1. You publish your packages to npm; one of them is a **bundle** (section 9) that switches your plugins on.
2. You open a pull request that adds the bundle to the reviewed catalog (section 11). A plugin runs inside the harness with the user's access to their machine and files, so the review reads your code.
3. Once it is merged, people see a card for it on the Marketplace page, with no harness update; Install adds the pinned version of your bundle to their profile, and the plugins load at the next start of the harness.

## 3. Set up a fork

Develop in a fork of this repository. Inside the workspace, the `@dv/*` and `@deepseek-ai/*` packages you build on resolve from source with their types, and you can run the harness, the tests and the checks against your code.

1. Fork and clone the repository, then run `pnpm install` at the root (Node `^22.19` or `>=24`).
2. Run `pnpm run build` once.
3. Start DreamVerse from the checkout: `scripts/video-harness/setup-profile.sh` creates the `video-harness` profile in `$DSH_HOME`, and `scripts/video-harness/launch.sh web` starts it. Read the head of `launch.sh` for the environment it reads (agent model, projects folder, provider keys); its defaults point at the DreamVerse team's cluster, so set your own.
4. Read [`docs/subsystems/video-harness.md`](../../docs/subsystems/video-harness.md) for the DreamVerse words (project, record, operation, asset, take, canvas node); keep [`docs/cordis-primer.md`](../../docs/cordis-primer.md) at hand as the Cordis reference.

## 4. Lay out the packages

Put each package under `packages/dv/<dir>/`. A typical plugin has up to four packages; leave out the ones you do not need.

```
packages/dv/subtitles/              the bundle: package.json + cordis.patch.yml + README, no code
packages/dv/subtitles-core/         the host plugin: operations, tools, routes (Node)
packages/dv/ui-subtitles/           the browser plugin: tabs, canvas nodes, takes (React)
packages/dv/workflow-subtitles/     the workflow skills: skills/<name>/SKILL.md and a small provider plugin
```

Name your packages under your own npm scope, such as `@alice/subtitles`, `@alice/subtitles-core`, `@alice/ui-subtitles` and `@alice/workflow-subtitles`; the `@fastvideo` scope holds the DreamVerse team's plugins. Each code package follows the file rules of [`COMPONENT-TEMPLATE.md`](COMPONENT-TEMPLATE.md) section 2: `src/index.ts`, `src/types.ts` with types only, tests in `tests/`, a `tsconfig.json` that extends `../../../tsconfig.base.json`, and `.ts` in relative imports. Register each package in the shared files as section 4 of the template lists (`tsconfig.base.json` paths and the `tsconfig.host.json` or `tsconfig.client.json` references), but do not add your plugin to `packages/bundle/dv`: your own bundle switches it on.

## 5. Write the host plugin

The host plugin runs in the harness process. Write it as a `Service` class (default export) when other code calls its methods, or as a function plugin (named exports `name`, `inject`, `Config`, `apply`, and no default export) when nothing does; never mix the two forms in one module.

```ts
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@dv/project'

export interface Config { serverUrl: string; timeoutMs: number }
export const Config: z<Config> = z.object({
  serverUrl: z.string().required().description('The subtitle server, such as http://gpu-host:8030.'),
  timeoutMs: z.natural().min(1).default(120_000).description('How long one request may take.'),
})

declare module '@deepseek-ai/cordis' { interface Context { dvSubtitles: DvSubtitles } }

export default class DvSubtitles extends Service {
  static Config = Config

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'dvSubtitles')
    // Register only while the project kernel is mounted, so the plugin also loads without it.
    ctx.inject(['dvProject'], (scope) => {
      scope.effect(() => scope.dvProject.registerOperation(burnOperation(config)), 'dvSubtitles subtitles.burn')
    })
  }
}
```

- **Configuration.** Every value that differs between installations (a server address, a timeout, a limit) is a `Config` field with a schema default or `required()`; users set it in their profile's `cordis.patch.yml`. Do not hide tunables in constants. Validate settings at load so a wrong value fails loudly.
- **Optional services.** Wrap registrations that need another plugin's service in `ctx.inject([...], scope => ...)`, as above, so your plugin loads and unloads cleanly when that service comes and goes. Read an optional service once with `ctx.get('name')`.
- **Operations.** Write an `OperationSpec` of `@dv/project`; the field table in [`COMPONENT-TEMPLATE.md`](COMPONENT-TEMPLATE.md) section 3 and the JSDoc in `packages/dv/project/src/operation-types.ts` describe every field. The operation name is `<your component key>.<verb>`; register your component key with `registerComponent` first if the operation keeps state. `execute` creates files only through `context.importAsset`, and throws to fail the record with your message. A rule that every caller must meet goes in `precondition`, which the runner checks for agent, canvas and API calls alike. `packages/dv/text-node/src/index.ts` registers a component, a reducer and its operations this way. If your operation runs a generation model, `importOne` of `@dv/generation` imports its output as a take, as `blender.render` does.
- **Plain tools.** Register them as [add a tool](../../docs/user/develop/basic/tool.md) shows, inside `ctx.inject(['tools'], ...)`, and name them `dv_<area>_<verb>`. A tool that returns an image to the model saves it with the `attachments` service and returns an image content block; see `packages/dv/blender-bridge/src/tools.ts` on the `dv-blender` branch.
- **Routes.** Register browser routes inside `ctx.inject(['connection'], ...)`; the harness checks the browser session for you.

## 6. Write the browser plugin

The browser plugin is a separate package with a client entry. Its `package.json` declares the client face and the browser services it needs:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": {
    "client": {
      "inject": ["@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-client-ui-sidebar-right"],
      "platform": "web"
    }
  },
  "scripts": { "bundle": "tsdown" }
}
```

`src/index.ts` is the host half and is usually an empty `apply`; `src/client/index.ts` is the browser half, bundled to `lib/client.js` by `tsdown` (copy `tsdown.config.ts` from `packages/dv/ui-text-node`). Its `apply(ctx)` registers what the page shows:

```ts
export const inject = ['slots', 'sidebarRightTabs']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.sidebarRightTabs.register(subtitlesTab), 'ui-subtitles: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: SUBTITLES_ID }, SubtitlesPanel,
  )), 'ui-subtitles: tab body')
}
```

- **Tabs.** A `SidebarRightTabDefinition` gives the tab's `id`, `kind`, title and a `guide` entry, so the tab appears in the right-sidebar guide; the slot body under the same key draws its content. `packages/dv/ui-history/src/client/index.ts` registers one with its body.
- **Canvas nodes.** Register a node type in `ctx.dvCanvas.nodeTypes` inside `ctx.inject(['dvCanvas'], ...)`, with `dv.canvas.card` and `dv.canvas.editor` slot bodies under the node type's key, as `packages/dv/ui-text-node/src/client/index.ts` does. The contract is in `packages/dv/ui-canvas/src/client/contract/index.ts`.
- **Takes.** For an operation that produces images, video or audio, one `defineGenerationUi({ id, type, operations, label, color, status })` call of `@dv/ui-generation/generation-kit.tsx` draws its records as takes on the canvas, with their running, failed and done states.
- **Copy.** Every string the user sees has a Chinese and an English text, through `pickText(zh, en)` of `@dv/ui-kit/locale.ts` or the typed dictionaries; the repository's `verify-client-ui-i18n` check refuses hard-coded copy. Use the theme's CSS variables (`var(--dv-...)`) so your UI follows light and dark mode.
- **Talking to the host.** Call your own routes with `fetch` on relative URLs; the page's session cookie authenticates them.

## 7. Write the workflow skills

A skill is a Markdown file the agent loads when a task needs it: the procedure, the rules and the order of tool calls for one kind of request. Ship skills in their own `workflow-*` package, which lists the packages whose tools its skills call in `dependencies`.

```
packages/dv/workflow-subtitles/
  skills/subtitle-burning/SKILL.md
  src/index.ts
```

`SKILL.md` starts with YAML front matter; `name` (kebab-case, the folder name) and `description` are required. The description is in the skill list of every request, so it says when to use the skill in one or two sentences, such as `description: "How to add burned-in subtitles to a timeline export: ... For requests such as 'add subtitles' or 'caption this video'."`.

`src/index.ts` serves exactly the package's `skills/` folder while the skill registry is mounted, as `packages/dv/workflow-story/src/index.ts` does on `main`:

```ts
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import z from '@deepseek-ai/schemastery'

export const name = 'workflow-subtitles'
export type Config = Record<string, unknown>
export const Config: z<Config> = z.object({})

export function apply(ctx: Context): void {
  ctx.inject(['skills'], (child) => {
    child.effect(() => child.skills.registerProvider(control => new FileSystemSkillProvider(child, control, {
      providerName: 'workflow-subtitles', includeDefaultRoots: false,
      customSkillDirs: [fileURLToPath(new URL('../skills', import.meta.url))],
    })), 'workflow-subtitles skills')
  })
}
```

Add `skills/**/*.md` to the package's `files` so the skills are published.

## 8. Keep the agent's view small and exact

Everything you register that the agent sees costs tokens in every request and steers what the agent does: tool names and descriptions, parameter descriptions, model descriptions, skill descriptions, and tool results.

- Write descriptions for the model, in the words of the task: what the tool does, what it needs, and what it returns. Leave out implementation words such as routes, sockets or class names.
- Keep always-visible text short (a tool or skill description is one or two sentences); put the procedure in a skill, which the agent loads only when it needs it.
- Make errors actionable: say what was wrong and what to do, such as "No Blender is connected; ask the user to connect it in the Blender tab."
- Say what your plugin cannot do where the agent will see it, so the agent tells the user instead of trying.
- Document the agent-visible text in your package README's Model Experience section (copy the format from `packages/dv/inspector/README.md`).

## 9. Make the bundle

[Package and install a plugin](../../docs/user/develop/basic/publish.md) explains bundles, profiles and how their patches stack; this section covers what a DreamVerse bundle adds. The bundle package has no code. Its `package.json` lists your plugin packages in `dependencies`, declares the DreamVerse bundle `@dv/bundle` as a peer, and points `dsh.bundle.patch` at its patch file:

```json
{
  "name": "@alice/subtitles",
  "version": "1.0.0",
  "type": "module",
  "description": "Burned-in subtitles for DreamVerse timeline exports.",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/alice/subtitles.git" },
  "publishConfig": { "access": "public" },
  "exports": { "./cordis.patch.yml": "./cordis.patch.yml", "./package.json": "./package.json" },
  "files": ["cordis.patch.yml", "README.md"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "@alice/subtitles-core": "workspace:*",
    "@alice/ui-subtitles": "workspace:*",
    "@alice/workflow-subtitles": "workspace:*"
  },
  "peerDependencies": { "@dv/bundle": "workspace:*" }
}
```

`cordis.patch.yml` inserts one row per plugin. A plugin that cannot work before the user sets something, such as a server address, ships `disabled: true`, and your README says what to set:

```yaml
- insert:
    - id: subtitles
      name: '@alice/subtitles-core'
      disabled: true          # set config.serverUrl in the profile patch, then remove this line
      config:
        serverUrl: ''
    - id: ui-subtitles
      name: '@alice/ui-subtitles'
    - id: workflow-subtitles
      name: '@alice/workflow-subtitles'
```

Rules for every published code package:

- **Harness packages are peers.** Each `@dv/*` and `@deepseek-ai/*` package your code imports is a `peerDependency` (and a `devDependency` for the workspace), so it resolves from the user's running harness instead of a second copy. Your own third-party libraries, such as `ws`, are ordinary `dependencies`.
- **Publish the build, not the source.** `exports` points at `src/` for the workspace; `publishConfig` replaces it with `lib/` for the published package, and `files` lists only `lib/`, your README and any data files (skills, add-ons). Copy the `publishConfig` and `files` blocks of the Blender packages.
- **Keep versions in step.** `pnpm pack` and `pnpm publish` turn each `workspace:*` range into the real version, so publish all your packages together.

## 10. Test it

- **A Loader composition test per host plugin.** Boot a test-only `cordis.yml` with the DreamVerse kernel and your plugin through the Loader, fake only outside services (your server, a model), and assert what the user and the agent see: the record of each operation, its assets, the tool results, and that disposing your plugin removes its operations and tools. Copy `packages/dv/inspector/tests/inspector.spec.ts`; run it from `packages/dv` with `../../node_modules/.bin/vitest run --config vitest.config.ts <dir>`.
- **A client test per browser plugin** for each state of your tab or node, as `packages/dv/ui-text-node/tests/text-node.client.spec.tsx` does.
- **Typecheck and lint** from the repository root (`pnpm run typecheck`, `pnpm run lint`), and rebuild your browser plugin's bundle with `tsdown` after each change to it.
- **A real install.** Pack your bundle (`pnpm --filter "@alice/*" pack`, or a script that puts your plugins inside the bundle tarball as `packages/dv/blender/scripts/pack.sh` does) and install it into a fresh DreamVerse profile with `dsh plugin --profile video-harness add <absolute path of the .tgz>`. Restart the harness, open your tab, and run each operation from the canvas and through the agent.

## 11. Publish and list it

1. Run `pnpm run build`, then `pnpm --filter "@alice/*" publish --access public`.
2. Install the published version into a DreamVerse profile with `dsh plugin --profile video-harness add @alice/subtitles@1.0.0` and use it once more.
3. Open a pull request that adds your entry to [`packages/dv/plugin-catalog/catalog.json`](plugin-catalog/catalog.json): `package`, one exact `version`, `title` and `description` in both Chinese and English, and optionally `setup` (what the plugin needs besides the install, such as a server) and an https `homepage` with your public source. The [catalog README](plugin-catalog/README.md#list-a-plugin) lists the field rules and what the review checks.
4. To release a new version, publish it and open a pull request that changes `version`; Install always requests the pinned version.

## 12. Checklist

- [ ] Each feature uses the matching registry from section 1, and every registration is inside `ctx.effect`.
- [ ] Every installation-specific value is a validated `Config` field; a plugin that needs one ships `disabled: true` in the bundle patch.
- [ ] Agent-visible descriptions are short, task-worded and say what the plugin cannot do; errors say what to do.
- [ ] Every user-visible string has Chinese and English text.
- [ ] Harness packages are peers; `publishConfig` and `files` publish `lib/` only.
- [ ] A Loader composition test covers each operation and tool, and disposal removes them.
- [ ] The packed bundle installs with `dsh plugin add` into a fresh profile and works after a restart.
- [ ] Each package README states its setup, its model experience and its known limitations.
- [ ] The catalog pull request pins one exact, published version and links the public source of that version.
