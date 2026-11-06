---
description: "The DreamVerse plugin catalog: the curated list of npm plugins the start page offers to install, answered at GET /api/dv/plugins/catalog."
kind: "package-reference"
---

# @dv/plugin-catalog

English | [中文](README.zh.md)

## Summary

Use this package to decide which plugins DreamVerse offers to install. It holds [`catalog.json`](catalog.json), the reviewed list of plugin packages on npm, and answers it at `GET /api/dv/plugins/catalog` for the Plugins tab of the entry page's 探索 / Explore section, which [`@dv/ui-plugin-catalog`](../ui-plugin-catalog/README.md) draws. Installing is the work of the [plugin manager](../../boot/plugin-manager/README.md): the tab asks it to install a listed package from the npm registry and switch its bundle on. Without this package, the Plugins tab has no catalog to show.

## Table of Contents

- [Use this package](#use-this-package)
- [List a plugin](#list-a-plugin)
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
| `sources` | `[]` | Further catalogs, read on every request after the shipped one: absolute paths, or https URLs (http only on `127.0.0.1`, `localhost` or `[::1]`). An entry whose package an earlier catalog lists replaces it. A source that is neither fails the plugin at load. |
| `sourceTimeoutMs` | `10000` | How long one URL source may take, in milliseconds. |

`GET /api/dv/plugins/catalog` answers `{ plugins, problems }`: `plugins` holds the shipped catalog's entries in file order, then the entries the sources add, each with the `source` that listed it; `problems` holds one `{ source, message }` for each source that could not be read or is malformed, which the Plugins tab shows and the Host logs. A malformed shipped catalog fails the plugin at load.

<a id="list-a-plugin"></a>
## List a plugin

A plugin is listed by a pull request that adds an entry to [`catalog.json`](catalog.json):

```json
{
  "package": "@dreamverse/voice-acting",
  "title": { "zh": "配音", "en": "Voice acting" },
  "description": { "zh": "…", "en": "…" },
  "setup": { "zh": "…", "en": "…" },
  "homepage": "https://…"
}
```

`package`, `title` and `description` are required, and each text needs both `zh` and `en`; `setup` says what the plugin needs besides the install, such as a server, and `homepage` must be an https URL. A package appears at most once. The review checks that the package:

- is published on npm under the `@dreamverse` scope, so the registry install that the plugin manager runs finds it;
- is a bundle: its `package.json` declares `dsh.bundle.patch`, which inserts its plugins, so the install can switch it on; `@dreamverse/voice-acting` is the example;
- declares the DreamVerse and DSH packages it uses, such as `@dv/generation` or `@deepseek-ai/cordis`, as `peerDependencies`, which resolve from the running harness, and runs its built `lib/` through `publishConfig`;
- installs and loads in a DreamVerse profile, and the README states its setup.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` checks every source's form and reads the shipped catalog with `parseCatalog`, which validates the file with Schemastery and then the package names, duplicates, both languages of each text and the homepage scheme. The route handler calls `loadCatalog`, which reads each source again on every request, so an edited source file or hosted catalog shows without a restart, while the shipped catalog is read once at load. The route registers through `ctx.inject(['connection'])` and leaves with the Connection service or the plugin.

| File | Content |
| --- | --- |
| [`catalog.json`](catalog.json) | The reviewed catalog |
| [`src/index.ts`](src/index.ts) | Config, validation, merging, and the route |
| [`src/types.ts`](src/types.ts) | The entry and answer types, which `@dv/ui-plugin-catalog` imports |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/ui-plugin-catalog`](../ui-plugin-catalog/README.md) — the Plugins tab that shows the catalog and installs from it.
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
- **No version requirements** — an entry names a package, not a version range or a minimum harness version; the plugin manager installs the newest version and its compatibility check refuses one that declares an incompatible DSH peer.
