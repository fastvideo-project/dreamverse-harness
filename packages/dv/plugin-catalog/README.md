---
description: "The DreamVerse plugin catalog: the curated list of npm plugins the Marketplace page offers to install, answered at GET /api/dv/plugins/catalog."
kind: "package-reference"
---

# @dv/plugin-catalog

English | [中文](README.zh.md)

## Summary

Use this package to decide which plugins DreamVerse offers to install. It holds [`catalog.json`](catalog.json), the reviewed list of plugin packages on npm, and answers it at `GET /api/dv/plugins/catalog` for the 插件市场 / Marketplace page of the left navigator, which [`@dv/ui-plugin-catalog`](../ui-plugin-catalog/README.md) draws. Installing is the work of the [plugin manager](../../boot/plugin-manager/README.md): the page asks it to install a listed package from the npm registry and switch its bundle on. Without this package, the Marketplace page has no catalog to show.

## Table of Contents

- [Use this package](#use-this-package)
- [Write and list a plugin](#list-a-plugin)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The DreamVerse bundle [`@dv/bundle`](../../bundle/dv/README.md) mounts the plugin; it needs a Connection service, which `dsh-web-app` provides.

```yaml
- id: dv-plugin-catalog
  name: '@dv/plugin-catalog'
  config:
    sources: []
```

| Config | Default | Meaning |
| --- | --- | --- |
| `sources` | `[]` | Further catalogs, read on every request after the shipped one: absolute paths, or https URLs (http only on `127.0.0.1`, `localhost` or `[::1]`). An entry whose package an earlier catalog lists replaces it. A source that is neither fails the plugin at load. A URL source that answers with a redirect is reported as a problem and lists nothing. |
| `sourceTimeoutMs` | `10000` | How long one URL source may take, in milliseconds. |

`GET /api/dv/plugins/catalog` answers `{ plugins, problems }`: `plugins` holds the shipped catalog's entries in file order, then the entries the sources add, each with the `source` that listed it; `problems` holds one `{ source, message }` for each source that could not be read or is malformed, which the Marketplace page shows and the Host logs. A malformed shipped catalog fails the plugin at load.

<a id="list-a-plugin"></a>
## Write and list a plugin

A DreamVerse plugin reaches people as one npm bundle package that the Marketplace page installs; `@fastvideo/dreamverse-voice-acting` and its four plugin packages are the worked example.

1. **Develop in a fork.** Add the plugin's packages under `packages/dv/<name>/` in a fork of this repository, so the `@dv/*` and `@deepseek-ai/*` packages it builds on resolve from the workspace with their types and tests; [`packages/dv/COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md) describes each package's files.
2. **Make a bundle.** One package lists the plugin's packages in `dependencies` and declares `dsh.bundle.patch`, a `cordis.patch.yml` that inserts their plugin entries, so the install switches them on; an entry that needs configuration, such as a server address, ships `disabled: true`, and the README says what to set. [Package and install a plugin](../../../docs/user/develop/basic/publish.md) covers bundles in general.
3. **Declare the harness as peers.** Each `@dv/*` and `@deepseek-ai/*` package the code imports is a `peerDependency`, which resolves from the running harness, and `publishConfig` points the published package at its built `lib/`.
4. **Name and publish.** Publish on npm under your own scope or user name with a package name that starts with `dreamverse-`, such as `@alice/dreamverse-subtitles`; the `@fastvideo` scope holds the DreamVerse team's plugins. Run `pnpm run build`, then `pnpm --filter "<your packages>" publish --access public`.
5. **Try the install.** Install the published version into a DreamVerse profile with `dsh plugin --profile video-harness add <package>@<version>` and use it.
6. **Open a pull request** that adds an entry to [`catalog.json`](catalog.json):

```json
{
  "package": "@alice/dreamverse-subtitles",
  "version": "1.0.0",
  "title": { "zh": "…", "en": "…" },
  "description": { "zh": "…", "en": "…" },
  "setup": { "zh": "…", "en": "…" },
  "homepage": "https://github.com/alice/dreamverse-subtitles"
}
```

`package`, `version`, `title` and `description` are required, and each text needs both `zh` and `en`. `version` is one exact published version, such as `1.0.0`, never a range or a tag: 安装 / Install requests exactly that version, so a later publish reaches people only through another pull request that changes it. `setup` says what the plugin needs besides the install, such as a server, and `homepage` must be an https URL. A package appears at most once. An installed plugin runs inside the harness with its access to the machine and the person's files, so the review reads the code and checks that:

- the package exists on npm at that version, and its name follows step 4;
- `homepage` links the public source of that version, and the published `lib/` is built from it;
- the package is a bundle that inserts its plugins through `dsh.bundle.patch`, and declares the harness packages as peers;
- it installs and loads in a DreamVerse profile, and its README states its setup and its model effects.

To release a new version, publish it and open a pull request that changes `version`; a card whose installed version differs from the catalog says so.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` checks every source's form and reads the shipped catalog with `parseCatalog`, which validates the file with Schemastery and then the package names, exact versions, duplicates, both languages of each text and the homepage scheme. The route handler calls `loadCatalog`, which reads each source again on every request, so an edited source file or hosted catalog shows without a restart, while the shipped catalog is read once at load. The route registers through `ctx.inject(['connection'])` and leaves with the Connection service or the plugin.

| File | Content |
| --- | --- |
| [`catalog.json`](catalog.json) | The reviewed catalog |
| [`src/index.ts`](src/index.ts) | Config, validation, merging, and the route |
| [`src/types.ts`](src/types.ts) | The entry and answer types, which `@dv/ui-plugin-catalog` imports |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/ui-plugin-catalog`](../ui-plugin-catalog/README.md) — the Marketplace page that shows the catalog and installs from it.
- [Plugin manager](../../boot/plugin-manager/README.md) — registries, installation, compatibility and script approval.
- [Package and install a plugin](../../../docs/user/develop/basic/publish.md) — bundles, profiles and `dsh plugin`.

-----

<a id="model-experience"></a>
## Model Experience

None, as the catalog reaches only the browser; an installed plugin documents its own model effects.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Catalog updates need a harness update** — the shipped catalog is read from the checkout at load, so a newly listed plugin appears after `git pull` and a restart; a hosted catalog in `sources` would show new entries at once.
- **No update in the tab** — an entry pins one version and 安装 / Install requests it, but the tab does not upgrade an installed plugin to a newer catalog version; the card notes the difference, and removing and installing again, then restarting, upgrades it.
- **No minimum harness version** — an entry does not say which harness versions the plugin needs; the plugin manager's compatibility check refuses a version that declares an incompatible DSH peer.
