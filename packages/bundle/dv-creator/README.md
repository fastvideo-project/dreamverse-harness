---
description: "The DreamVerse Creator profile layer over @dv/bundle: the DreamVerse Creator preset, the preset chooser with DreamVerse and DreamVerse Creator, and live reload of the checkout's packages/dv."
kind: "package-bundle"
---

# @dv/bundle-creator

English | [中文](README.zh.md)

## Summary

Use this bundle to edit DreamVerse plugins from a DreamVerse chat. `scripts/video-harness/setup-profile.sh` stacks it over [`@dv/bundle`](../dv/README.md) as profile `video-harness-creator`, and `scripts/video-harness/launch.sh creator` runs that profile from source. A chat that uses the DreamVerse Creator preset has the DreamVerse persona, video tools and skills, and the [Creator mode](../../../docs/user/develop/practice/dynamic-cordis.md) tools: files, shell, Cordis inspection, Plugin Manager, and the plugin-development skills. A saved edit to a DreamVerse plugin under `packages/dv` reaches the running server and the open page without a restart.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Build the checkout once, then start creator mode. It takes the same environment and arguments as `launch.sh web`:

```sh
pnpm run build
scripts/video-harness/launch.sh creator --trusted-host <public host>   # chat page on DV_PORT (default 8092)
```

The command starts two processes: the `video-harness-creator` server and the browser bundle watcher `pnpm run dev:web --skip-build --no-serve`. When one process exits, or when you press Ctrl+C, the command stops both.

New chats use the DreamVerse preset. To use DreamVerse Creator, open Settings → Agent presets and select DreamVerse Creator; chats that you create after that use it. Then ask the agent for a change, for example "change the empty-canvas text of packages/dv/ui-canvas to …". The agent edits the source in the checkout, and the change appears in the open page without a page load.

The `video-harness-creator` profile has its own profile patch, so the preset selection and other Settings changes do not change `launch.sh web`. Both profiles use the same `DSH_HOME`, projects, and sessions. A DreamVerse Creator chat does not resume in `launch.sh web`, because that profile has no `dreamverse-creator` preset.

<a id="understand-the-implementation"></a>
## Understand the implementation

[`cordis.patch.yml`](cordis.patch.yml) changes the rows of the bundles below it and inserts no row:

- `preset-dreamverse-creator`, which `@dv/bundle` ships off, is on. The four presets of `dsh-web-app` are off, so the chooser lists DreamVerse and DreamVerse Creator.
- `agent-preset-registry` keeps DreamVerse as the default and turns the chooser on. This layer is below the profile patch, so Settings writes to this profile's patch are accepted.
- `hmr` watches `packages/dv` of the checkout that the profile links. It polls every 500 ms, the same interval as `pnpm run dev:web`, because network mounts deliver no inotify events. It skips `lib`, which holds the browser bundles that the watcher writes.

Host HMR replaces a changed host module under `packages/dv` and the plugins that import it in the same server process. The browser bundle watcher rebuilds the `lib/client.js` of a changed browser plugin, and the web server sends the rebuilt bundle to the open page. [`tests/creator.spec.ts`](tests/creator.spec.ts) checks the preset roster, the chooser policy, the profile bundles, and the `hmr` row as it evaluates from a profile directory.

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/bundle`](../dv/README.md), which ships the DreamVerse Creator preset
- [Configure persistent plugins from a prompt](../../../docs/user/develop/practice/dynamic-cordis.md)
- [`@deepseek-ai/dsh-hmr`](../../boot/hmr/README.md)
- [DreamVerse packages](../../../docs/subsystems/video-harness.md)

<a id="model-experience"></a>
## Model Experience

Indirectly, through the DreamVerse Creator preset of `@dv/bundle`, which owns the persona, tools, and skills that a DreamVerse Creator chat sends.

#### KV Cache effect

None of its own. A host HMR reload of a plugin that contributes tools or prompt text can change the prefix of later requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The agent writes without approval only in the chat's project directory. A write to the checkout and every shell command ask for approval. Reads are not limited: the agent can read every file that the server's user can read, including environment files with keys. Web fetches need no approval, so a read file can leave the machine.
- An approved write to a loaded module under `packages/dv` runs as code in the server process within about a second, outside the shell sandbox. Approve a write there as you would approve a shell command.
- Every user of the page can select DreamVerse Creator. Start creator mode only for people whom you trust with shell access on the server.
- Host HMR covers modules under `packages/dv` only. An edit to a bundle `cordis.patch.yml` or a `SKILL.md` file takes effect after a plugin reload through Plugin Manager or a restart.
- A host HMR watch that fails reports no error; the edit then needs a restart.
- The DreamVerse editor shows no preset chooser; Settings → Agent presets is the only place to select DreamVerse Creator.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
