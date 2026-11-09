---
description: "Browser half of the DreamVerse Blender component: the Blender right-Sidebar tab, which shows how to connect the user's Blender with the DreamVerse add-on and then streams its viewport live, the blender.render and blender.animation_render records as takes on the canvas, and the Blender viewport node of the canvas, whose opened editor orbits, pans and zooms Blender's view."
kind: "package-reference"
---

# @fastvideo/dreamverse-ui-blender

English | [中文](README.zh.md)

## Summary

Use this package to show the user's Blender in DreamVerse. It registers the `dv-blender` tab type of the right Sidebar. While no Blender is connected, the tab shows the three connection steps: download the add-on, install it, and paste the connection string. While one is connected, the tab shows its viewport live, with Blender's version and file. It also draws the canvas nodes of kind `blender`, the takes of `blender.render` and `blender.animation_render`, and of kind `blender-viewport`, the Blender viewport node; the bridge registers both kinds with the canvas node list. The routes it reads belong to [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.md).

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

The plugin has no configuration. The guide of the right Sidebar offers the tab as Blender, "Connect Blender and watch its viewport live". The connection string is the page's own origin, `#`, and the pairing token; through an SSH tunnel, the page's origin is the tunnel's local address, which a Blender on the same computer reaches. The tab's buttons copy the string and replace the pairing token, which disconnects the connected Blender. While a Blender is connected and a project is open, the tab's "Put the viewport on the canvas" button runs `blender.viewport` for the open project; a refusal shows under it.

The viewport node is a 16:9 media node of kind `blender-viewport`; the canvas holds at most one. Its card shows the live viewport, letterboxed, and takes no pointer input, so the canvas moves, selects, resizes and opens it like any node. A double click opens its editor, which shows the viewport large and moves Blender's view:

| Input | View change |
| --- | --- |
| Drag | `orbit` |
| Shift-drag or right-drag | `pan` |
| Wheel | `zoom`, one step per wheel line |
| Front, Back, Left, Right, Top, Bottom, Camera | `preset` |
| Frame all, Frame selected | `frame` |

The canvas's own remove button and the Delete key take the node off the canvas (`canvas.node_remove`). The view changes need add-on 0.2.0 or later; with an older add-on, or no connected Blender, the controls are off and the editor says why.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The tab body reads `GET /api/dv/blender/status` once and watches the viewport WebSocket `/dv/blender/view` while it is mounted. Every mounted tab of the page shares one socket, which reopens two seconds after it drops; a long-lived HTTP stream would hold one of the browser's few HTTP/1.1 connections to the harness and stall the page's other requests. A tab watches only while it is on screen and the page is visible. `status` messages switch between the two views, and each frame is decoded with `createImageBitmap` and drawn onto a canvas; while one frame is drawn, only the newest frame that arrives meanwhile waits, so frames never queue up as image loads. The add-on download goes through `fetch`, and a failed download shows its HTTP status. The connection steps and the viewport do not depend on the open project, because one Blender serves the harness; only the place button reads the open project. The tab, the card and the editor each watch through `useLiveView` and draw on their own canvas over the one socket. The bridge sends `status` only when the socket opens and when the link changes, and Blender sends a frame only when its view redraws, so a view that joins the open socket, such as the editor opened from a card, receives the last status and the newest frame at once. The editor gathers drag and wheel movement and sends it over the same socket at most once per animation frame, as fractions of the shown picture, each number limited to ±10; the wheel listener is native and not passive so the page does not scroll. The takes come from one `defineGenerationUi` declaration of [`@dv/ui-generation`](../ui-generation/README.md) with the node type `blender`.

| File | Content |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | The tab type, the tab body registration, the takes, and the viewport node type with its card and editor |
| [`src/client/BlenderPanel.tsx`](src/client/BlenderPanel.tsx) | The panel and its place button |
| [`src/client/viewer.ts`](src/client/viewer.ts) | The `fetch` calls, the `blender.viewport` run, the page's shared viewport socket and the view changes |
| [`src/client/live-view.ts`](src/client/live-view.ts) | `useLiveView`: watching while on screen and drawing the newest frame |
| [`src/client/ViewportNode.tsx`](src/client/ViewportNode.tsx) | The viewport node type, its card and its editor |
| [`src/index.ts`](src/index.ts) | The inert host Loader entry |
| [`tests/plugin.client.spec.tsx`](tests/plugin.client.spec.tsx) | The registrations under the real slot runtime and their removal, the panel's two views and its place button over a fake host half, and the viewport node's type, card and editor |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.md): the link, the routes and the add-on.
- [`@dv/ui-canvas`](../ui-canvas/README.md): the canvas that draws the Blender takes and the viewport node.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the viewport frames reach only the person, and the `blender.render`, `blender.animation_render` and `blender.viewport` records that the takes and the node show reach the model only through the project state and update messages and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the package sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only the opened node moves the view**: the tab and the canvas card show frames only, and the editor moves the view but sends no clicks, selection or edits to Blender.
- **Each move waits for Blender**: the picture changes after a round trip to Blender and one frame, so dragging is as smooth as the stream's frame rate allows.
- **The guide lists the tab only with third-party panels**: the right-Sidebar guide of `@dv/ui-shell` lists the tabs of plugins outside `@dv/` only with its third-party panel support.
