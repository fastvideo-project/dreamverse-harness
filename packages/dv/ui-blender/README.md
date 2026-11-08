---
description: "Browser half of the DreamVerse Blender component: the Blender right-Sidebar tab, which shows how to connect the user's Blender with the DreamVerse add-on and then streams its viewport live, and the blender.render and blender.animation_render records as takes on the canvas."
kind: "package-reference"
---

# @fastvideo/dreamverse-ui-blender

English | [中文](README.zh.md)

## Summary

Use this package to show the user's Blender in DreamVerse. It registers the `dv-blender` tab type of the right Sidebar. While no Blender is connected, the tab shows the three connection steps: download the add-on, install it, and paste the connection string. While one is connected, the tab shows its viewport live, with Blender's version and file. It also claims the records of `blender.render` and `blender.animation_render` as the `blender` takes of the canvas. The routes it reads belong to [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin with `@fastvideo/dreamverse-blender-bridge`; [`@fastvideo/dreamverse-blender`](../blender/README.md) inserts both.

```yaml
- id: dv-ui-blender
  name: '@fastvideo/dreamverse-ui-blender'
```

The plugin has no configuration. The guide of the right Sidebar offers the tab as Blender, "Connect Blender and watch its viewport live". The connection string is the page's own origin, `#`, and the pairing token; through an SSH tunnel, the page's origin is the tunnel's local address, which a Blender on the same computer reaches. The tab's buttons copy the string and replace the pairing token, which disconnects the connected Blender.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The tab body reads `GET /api/dv/blender/status` once and watches the viewport WebSocket `/dv/blender/view` while it is mounted. Every mounted tab of the page shares one socket, which reopens two seconds after it drops; a long-lived HTTP stream would hold one of the browser's few HTTP/1.1 connections to the harness and stall the page's other requests. A tab watches only while it is on screen and the page is visible. `status` messages switch between the two views, and each frame is decoded with `createImageBitmap` and drawn onto a canvas; while one frame is drawn, only the newest frame that arrives meanwhile waits, so frames never queue up as image loads. The add-on download goes through `fetch`, and a failed download shows its HTTP status. The body does not depend on the open project, because one Blender serves the harness. The takes come from one `defineGenerationUi` declaration of [`@dv/ui-generation`](../ui-generation/README.md) with the node type `blender`.

| File | Content |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | The tab type, the tab body registration and the takes |
| [`src/client/BlenderPanel.tsx`](src/client/BlenderPanel.tsx) | The panel, its `fetch` calls and the page's shared viewport socket |
| [`src/index.ts`](src/index.ts) | The inert host Loader entry |
| [`tests/plugin.client.spec.tsx`](tests/plugin.client.spec.tsx) | The registrations under the real slot runtime and their removal, and the panel's two views over a fake host half |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.md): the link, the routes and the add-on.
- [`@dv/ui-canvas`](../ui-canvas/README.md): the canvas that draws the Blender takes.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the viewport frames reach only the person, and the `blender.render` and `blender.animation_render` records that the takes show reach the model only through the project state and update messages and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the package sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **View-only viewport**: the tab shows frames; it sends no clicks or drags to Blender.
- **The guide lists the tab only with third-party panels**: the right-Sidebar guide of `@dv/ui-shell` lists the tabs of plugins outside `@dv/` only with its third-party panel support.
