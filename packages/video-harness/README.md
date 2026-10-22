---
description: "The video-harness package group: the live media stream of shot renders. The other DreamVerse packages live under `packages/dv/`."
kind: "package-group"
---

# video-harness/ — the video agent harness

English | [中文](README.zh.md)

## Summary

This group holds one package, `stream` (`@video-harness/stream`), a Cordis service: while the Shot render operation `shot.render` renders a take, the service sends the take's fMP4 chunks to every browser subscribed to the project over the `/vh/ws` WebSocket route. The Project component, the other components, the model catalog and the provider plugins that register its models, the chat references, the API, the interface plugins, and the browser tests of DreamVerse live under `packages/dv/`, starting with [`@dv/project`](../dv/project/README.md); the bundle is [`@dv/bundle`](../bundle/dv/README.md).

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The [live render stream section](../../docs/dreamverse/subsystems/shots-and-timeline.md#live-render-stream) of the shots and timeline page explains how `shot.render` writes to `stream` and what a browser receives on the `/vh/ws` route.

| Package | Role |
| --- | --- |
| `stream` | `@video-harness/stream`: live fMP4 chunks of shot renders, served to browsers over the `/vh/ws` WebSocket route in the DreamVerse media framing |

<a id="related-documentation"></a>
## Related documentation

- [Shots and timeline](../../docs/dreamverse/subsystems/shots-and-timeline.md) — plans, renders and their takes, the live render stream, and timelines.
- [`@dv/api`](../dv/api/README.md) — the browser API that the interface plugins read state from.

<a id="dev-note"></a>
## Dev Note

None.
