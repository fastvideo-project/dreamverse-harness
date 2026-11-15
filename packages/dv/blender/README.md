---
description: "Installable DreamVerse Blender bundle: install it into a DreamVerse profile, connect your own Blender with the DreamVerse add-on from your computer or from the harness's machine, and pack or publish the packages."
kind: "package-bundle"
---

# @fastvideo/dreamverse-blender

English | [中文](README.zh.md)

## Summary

Use this bundle to connect your own Blender to DreamVerse: you watch its viewport live in a Blender tab, and the agent reads the scene, runs Python in it, looks at the viewport, and renders stills and animations into the project. Installing it into a DreamVerse profile inserts three plugins: [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.md) (the link, the tools, the render operations and the add-on), [`@fastvideo/dreamverse-ui-blender`](../ui-blender/README.md) (the Blender tab and the takes), and [`@fastvideo/dreamverse-workflow-blender`](../workflow-blender/README.md) (the `blender-scenes` skill).

## Table of Contents

- [Use this package](#use-this-package)
  - [1. Install the bundle](#1-install-the-bundle)
  - [2. Connect Blender](#2-connect-blender)
  - [3. Pack or publish the packages](#3-pack-or-publish-the-packages)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

You need a DreamVerse profile, which stacks [`@dv/bundle`](../../bundle/dv/README.md), and Blender 4.2 or later (tested with 5.3) on your computer or on the harness's machine.

<a id="1-install-the-bundle"></a>
### 1. Install the bundle

Install the bundle into the DreamVerse profile, from the registry it is published to, or from the self-contained tarball that [step 3](#3-pack-or-publish-the-packages) packs:

```sh
dsh plugin --profile video-harness add @fastvideo/dreamverse-blender
dsh plugin --profile video-harness add /shared/packs/fastvideo-dreamverse-blender-0.1.0.tgz
```

From a source checkout, run `node --import tsx/esm apps/cli/src/bin.ts` in place of `dsh`. The plugins take their shared DreamVerse and harness packages from the running harness, so pnpm's peer dependency warnings during the install are expected. `dsh plugin --profile video-harness remove @fastvideo/dreamverse-blender` removes the plugins again.

<a id="2-connect-blender"></a>
### 2. Connect Blender

Open the **Blender** tab of the right Sidebar and follow its three steps: download the add-on, install it in Blender (Edit → Preferences → Get Extensions → the menu at the top right → Install from Disk), and paste the connection string into the DreamVerse tab of the 3D view's sidebar (N), then press **Connect**. The tab then shows the viewport live.

Blender connects to the same address as the browser:

- **Blender on your computer, harness on a server**: open the harness through an SSH tunnel, such as `ssh -N -L 18094:127.0.0.1:8094 <server>`, and open `http://127.0.0.1:18094` in the browser. The connection string starts with `http://127.0.0.1:18094`, and Blender on the same computer reaches the harness through the same tunnel; keep the tunnel open while Blender is connected.
- **Blender on the harness's machine**: open the harness at its own address; the connection string starts with it.

The add-on's preferences set whether it reconnects by itself, whether the agent may run Python, and the viewport stream's frame rate, width and JPEG quality. For an address other than this machine, Blender's **Allow Online Access** (Preferences → System) must be on.

<a id="3-pack-or-publish-the-packages"></a>
### 3. Pack or publish the packages

After `pnpm run build`, `bash packages/dv/blender/scripts/pack.sh [destination]` packs one self-contained tarball (default destination `dist/packs`), with the three plugins and the bridge's own dependencies `ws` and `fflate` inside, for `dsh plugin add <tarball>` without a registry. To publish to npm, log in to an account of the `fastvideo` organization and run `pnpm --filter "@fastvideo/dreamverse-blender*" --filter @fastvideo/dreamverse-ui-blender --filter @fastvideo/dreamverse-workflow-blender publish --access public`; pnpm replaces each `workspace:*` range with the real version.

<a id="understand-the-implementation"></a>
## Understand the implementation

The bundle is a `dsh.bundle` package: its `cordis.patch.yml` inserts the three plugins after the DreamVerse bundle, and its `dependencies` name them. Its peer dependency on `@dv/bundle` resolves from the harness.

| File | Content |
| --- | --- |
| [`cordis.patch.yml`](cordis.patch.yml) | The three inserted plugins |
| [`scripts/pack.sh`](scripts/pack.sh) | The self-contained tarball |

<a id="further-exploration"></a>
## Further Exploration

- [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.md): the link, its admission and the add-on.
- [`@dv/mcp-presets`](../mcp-presets/README.md): the Blender MCP preset, for Blender on the harness's machine without the add-on.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the tools and operations of `@fastvideo/dreamverse-blender-bridge` and the `blender-scenes` skill of `@fastvideo/dreamverse-workflow-blender`; the bundle itself adds no model-visible text.

#### KV Cache effect

None of its own; the inserted plugins describe theirs.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One Blender per harness**: every chat of the harness talks to the one connected Blender.
- **The tunnel must stay open**: with Blender on another computer, closing the SSH tunnel disconnects Blender; the add-on reconnects when the tunnel returns.
