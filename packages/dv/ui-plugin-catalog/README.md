---
description: "DreamVerse Marketplace page in the left navigator: the reviewed plugin catalog with Install, Turn on, and Remove through the plugin manager."
kind: "package-reference"
---

# @dv/ui-plugin-catalog

English | [中文](README.zh.md)

## Summary

Use this package to let people install DreamVerse plugins. It registers the 插件市场 / Marketplace entry of the left navigator and the page it opens, which lists the reviewed catalog of [`@dv/plugin-catalog`](../plugin-catalog/README.md): one card per plugin with its description, what it needs besides the install, and its state in the profile. Install, Turn on, and Remove call the [plugin manager](../../boot/plugin-manager/README.md), which installs the package from the npm registry. Without this package, the navigator has no Marketplace entry, and plugins install through DSH's Plugins page or `dsh plugin`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app`, beside `@dv/plugin-catalog`; [`@dv/bundle`](../../bundle/dv/README.md) mounts both. Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-plugin-catalog
  name: '@dv/ui-plugin-catalog'
```

The Host half registers nothing. The browser half registers the page in the `main` slot under the panel id `marketplace` and the navigator entry in `sidebar.panellist` with order 0.5, between 插件 / Plugins (order 0) and MCP (order 1); `@dv/ui-shell` lists it with the other sidebar pages. The page's intro line links to DSH's Plugins page, where installed plugins are managed. A card's state comes from `pluginManager.listBundles()` by package name: 未安装 / Not installed, 已安装 · 已开启 / Installed · On, 已安装 · 已关闭 / Installed · Off, or 已安装 · 未加载 / Installed · Not loaded for a bundle with a load error, whose layer the profile skipped; the list is read again after every `plugin-manager/changed` event. A card shows the package with the catalog's version, and notes when the installed version differs from it. A profile without the plugin manager lists the catalog and says that plugins cannot be installed there.

| Gesture | Request |
| --- | --- |
| 安装 / Install | `pluginManager.installBundle(<package>@<version>, { enabled: true, requestId })` with the exact version of the catalog entry, from the registry the plugin manager is configured with. The card shows 安装中… / Installing…, then 已安装并开启。 / Installed and turned on., or 已安装。重启 harness 后生效。 / Installed. Restart the harness to load it. when the profile applies the change at its next start |
| 开启 / Turn on, on an installed plugin that is off | `pluginManager.setBundleEnabled(<package>, true)`. The card shows 已开启。 / Turned on., or 已开启。重启 harness 后生效。 / Turned on. Restart the harness to load it. when the profile applies the change at its next start |
| 移除 / Remove, then 确认移除 / Confirm remove | `pluginManager.removeBundle(<package>)`; 取消 / Cancel keeps the plugin. Offered only for a bundle that `listBundles()` marks `removable` |

A failed request shows its reason under the card: the plugin manager's error code, or the pnpm failure kind with the path of the pnpm log. An install that pnpm blocked for unapproved package scripts names those packages and links to DSH's Plugins page, which approves scripts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`followCatalog` reads `GET /api/dv/plugins/catalog` once per mount, binds the plugin manager calls through `ctx.inject(['remote', 'remote.pluginManager'])` so the buttons appear only while its Remote is mounted, and selects DSH's Plugins page through the `layout` service for the intro line's link and the script-approval link. One request per package runs at a time; `outcomeOf` turns the plugin manager's `ChangeResult` into the line under the card. The catalog types come from `@dv/plugin-catalog/types` and the slot types from `@deepseek-ai/dsh-client-ui-layout` and `@deepseek-ai/dsh-client-ui-sidebar`, all type-only imports.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The Host half, which registers nothing |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | The type of the CSS Module imports |
| [`src/client/index.ts`](src/client/index.ts) | Registration of the Marketplace page in `main` and its navigator entry in `sidebar.panellist` |
| [`src/client/catalog.ts`](src/client/catalog.ts) | The catalog request, the profile's bundles, and the plugin manager requests with their outcomes |
| [`src/client/CatalogPage.tsx`](src/client/CatalogPage.tsx) | The page, its navigator icon, the cards, and their Chinese and English copy |
| [`src/client/CatalogPage.module.css`](src/client/CatalogPage.module.css) | Styles of the page and the cards |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/plugin-catalog`](../plugin-catalog/README.md) — the catalog, its sources, and how a plugin gets listed.
- [Plugin manager](../../boot/plugin-manager/README.md) — registries, installation, compatibility and script approval.
- [`@dv/ui-shell`](../ui-shell/README.md) — the left navigator that lists the sidebar pages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the page only installs, switches on, and removes bundles; an installed plugin documents its own model effects.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No install progress detail** — the card shows 安装中… / Installing… until the plugin manager answers; the pnpm output and the registry being asked appear only on DSH's Plugins page.
- **No cancel** — an install runs until the plugin manager settles it; DSH's Plugins page can cancel one.
