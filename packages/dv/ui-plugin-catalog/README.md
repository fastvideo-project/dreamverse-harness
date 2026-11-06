---
description: "DreamVerse Plugins tab in the entry page's Explore section: the reviewed plugin catalog with Install, Turn on, and Remove through the plugin manager."
kind: "package-reference"
---

# @dv/ui-plugin-catalog

English | [中文](README.zh.md)

## Summary

Use this package to let people install DreamVerse plugins from the entry page. It registers the 插件 / Plugins tab in the `dv.explore` slot of [`@dv/ui-shell`](../ui-shell/README.md), which lists the reviewed catalog of [`@dv/plugin-catalog`](../plugin-catalog/README.md): one card per plugin with its description, what it needs besides the install, and its state in the profile. Install, Turn on, and Remove call the [plugin manager](../../boot/plugin-manager/README.md), which installs the package from the npm registry. Without this package, 探索 has no Plugins tab, and plugins install through DSH's Plugins page or `dsh plugin`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app` and `@dv/ui-shell`, beside `@dv/plugin-catalog`; [`@dv/bundle`](../../bundle/dv/README.md) mounts both. Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-plugin-catalog
  name: '@dv/ui-plugin-catalog'
```

The Host half registers nothing. A card's state comes from `pluginManager.listBundles()` by package name: 未安装 / Not installed, 已安装 · 已开启 / Installed · On, or 已安装 · 已关闭 / Installed · Off; the list is read again after every `plugin-manager/changed` event. A profile without the plugin manager lists the catalog and says that plugins cannot be installed there.

| Gesture | Request |
| --- | --- |
| 安装 / Install | `pluginManager.installBundle(<package>, { enabled: true, requestId })`, from the registry the plugin manager is configured with. The card shows 安装中… / Installing…, then 已安装并开启。 / Installed and turned on., or 已安装。重启 harness 后生效。 / Installed. Restart the harness to load it. when the profile applies the change at its next start |
| 开启 / Turn on, on an installed plugin that is off | `pluginManager.setBundleEnabled(<package>, true)` |
| 移除 / Remove, then 确认移除 / Confirm remove | `pluginManager.removeBundle(<package>)`; 取消 / Cancel keeps the plugin |

A failed request shows its reason under the card: the plugin manager's error code, or the pnpm failure kind with the path of the pnpm log. An install that pnpm blocked for unapproved package scripts names those packages and links to DSH's Plugins page, which approves scripts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`followCatalog` reads `GET /api/dv/plugins/catalog` once per mount, binds the plugin manager calls through `ctx.inject(['remote', 'remote.pluginManager'])` so the buttons appear only while its Remote is mounted, and selects DSH's Plugins page through the `layout` service. One request per package runs at a time; `outcomeOf` turns the plugin manager's `ChangeResult` into the line under the card. The catalog types come from `@dv/plugin-catalog/types` and the slot type from `@dv/ui-shell/contract`, both type-only imports.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The Host half, which registers nothing |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | The type of the CSS Module imports |
| [`src/client/index.ts`](src/client/index.ts) | Registration of the Plugins tab in `dv.explore` |
| [`src/client/catalog.ts`](src/client/catalog.ts) | The catalog request, the profile's bundles, and the plugin manager requests with their outcomes |
| [`src/client/CatalogShelf.tsx`](src/client/CatalogShelf.tsx) | The cards and their Chinese and English copy |
| [`src/client/CatalogShelf.module.css`](src/client/CatalogShelf.module.css) | Styles of the cards |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/plugin-catalog`](../plugin-catalog/README.md) — the catalog, its sources, and how a plugin gets listed.
- [Plugin manager](../../boot/plugin-manager/README.md) — registries, installation, compatibility and script approval.
- [`@dv/ui-shell`](../ui-shell/README.md) — the entry page and its `dv.explore` slot.

-----

<a id="model-experience"></a>
## Model Experience

None, as the tab only installs, switches on, and removes bundles; an installed plugin documents its own model effects.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No install progress detail** — the card shows 安装中… / Installing… until the plugin manager answers; the pnpm output and the registry being asked appear only on DSH's Plugins page.
- **No cancel** — an install runs until the plugin manager settles it; DSH's Plugins page can cancel one.
