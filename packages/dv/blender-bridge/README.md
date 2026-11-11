---
description: "Blender component of DreamVerse: the dvBlender service owns the link that the DreamVerse add-on opens from the user's Blender to the harness, the agent tools dv_blender_scene, dv_blender_run and dv_blender_look, the operations blender.render, blender.animation_render and blender.viewport with the canvas nodes they make, and the browser routes that stream the viewport, move its view and serve the add-on."
kind: "package-reference"
---

# @fastvideo/dreamverse-blender-bridge

English | [中文](README.zh.md)

## Summary

Use this package to let the agent work in the user's own Blender. The DreamVerse add-on, which ships in `addon/`, opens a WebSocket from Blender to the harness, so Blender can run on the user's computer (through the same SSH tunnel as the browser) or on the harness's machine. The agent reads the scene, runs Python, looks at the viewport, and renders stills and animations into the project. The browser shows the viewport live in the Blender tab and in a viewport node on the canvas, both of [`@fastvideo/dreamverse-ui-blender`](../ui-blender/README.md), and the opened node moves Blender's view.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a DreamVerse profile; [`@fastvideo/dreamverse-blender`](../blender/README.md) inserts it. The link route needs the DSH web server (`webServer`), the browser routes need the Connection (`connection`), the operations need `dvProject`, the canvas nodes and `blender.viewport` also need the canvas node list (`dvCanvasNodes`), and `dv_blender_look` needs the attachment store (`attachments`); each part exists while its service does.

```yaml
- id: dv-blender
  name: '@fastvideo/dreamverse-blender-bridge'
  config:
    requestTimeoutMs: 60000
```

| Config | Default | Meaning |
| --- | --- | --- |
| `requestTimeoutMs` | 60000 | How long a scene read, a code run or a look waits for Blender |
| `renderTimeoutMs` | 1800000 | How long a render waits for Blender |
| `maxFileBytes` | 536870912 | The most bytes one file from Blender (a look or a render) may hold |
| `pingMs` | 20000 | Interval of the keepalive pings on the link and the viewport stream |

The user connects Blender in three steps that the Blender tab shows: download the add-on (`GET /api/dv/blender/addon.zip`), install it in Blender (Edit → Preferences → Get Extensions → Install from Disk; Blender 4.2 or later), and paste the connection string into the DreamVerse panel of the 3D view's sidebar. The connection string is the page's origin, `#`, and the pairing token, such as `http://127.0.0.1:18094#<token>`; through an SSH tunnel the page's origin is the tunnel's local address, which is also where Blender on the same computer reaches the harness.

| Route | Admission | What it does |
| --- | --- | --- |
| `/dv/blender/ws` (WebSocket upgrade of the web server) | `Authorization: Bearer <pairing token>` and no `Origin` header; HTTP 401 for a wrong token, 403 for a request with `Origin` | The link to Blender; a newer link replaces the older one, which is closed with code 4000 |
| `/dv/blender/view` (WebSocket upgrade of the web server) | The Connection's Host, Origin and browser authentication checks | The viewport: a text message `{type: 'status', linked, state}` at once and at each change, and per frame a text message `{type: 'frame', seq, width, height, mime}` followed by one binary message with the JPEG or PNG. A viewer's text message `{type: 'view', action, …}` moves the view of Blender's main 3D viewport (see below); a message that does not parse is dropped. A WebSocket does not hold one of the browser's few HTTP/1.1 connections to the harness, which a long-lived HTTP stream would |
| `GET /api/dv/blender/status` | The Connection's browser authentication | `{linked, state, token, link_path, viewers}`; `state` is the add-on's `{blender_version, addon_version, file, allow_code}` |
| `POST /api/dv/blender/token` | Same | Replaces the pairing token and closes the link with code 4001; answers the new status |
| `GET /api/dv/blender/addon.zip` | Same | The add-on as a Blender extension zip, read from `addon/` on every download |

| Operation | Tool | Params | Outputs and report |
| --- | --- | --- | --- |
| `blender.render` | `dv_blender_render` | `frame` (default: the scene's current frame) | output `image`, one `image/png` asset, RGB unless the scene renders a transparent film; report `{width, height, frame, engine}` |
| `blender.animation_render` | `dv_blender_animation_render` | `frame_start`, `frame_end` (default: the scene's range) | output `video`, one `video/mp4` asset with its duration; report `{width, height, frame_start, frame_end, fps, duration_sec, engine}` |
| `blender.viewport` | `dv_blender_viewport` | none | no output; report `{}` |

Both render operations render with the scene camera and the scene's own engine, resolution and frame rate, are not deterministic, and run in the background like every generation; Blender is busy until a render finishes. Each render record makes a take node of kind `blender` in column 2 of the canvas, which shows a running or failed render too. `blender.viewport` puts the viewport on the canvas and needs no connected Blender: its finished record makes the one node of kind `blender-viewport`, and a call while the canvas holds that node is refused (`The Blender viewport is already on the canvas.`). `canvas.node_remove` (`dv_canvas_node_remove`) takes the node off, like any node.

| View change | Fields | What Blender does |
| --- | --- | --- |
| `orbit` | `dx`, `dy` | Turns the view about the world Z axis and the view's X axis (turntable); a drag across the whole picture width turns half a turn |
| `pan` | `dx`, `dy` | Moves the view's center so the scene follows the drag |
| `zoom` | `steps` | Multiplies the view distance by 1.2 per step; positive steps move away |
| `preset` | `preset` | `front`, `back`, `left`, `right`, `top`, `bottom`, or `camera` (the scene camera's view) |
| `frame` | `target` | Fits every object (`all`) or the selection (`selected`) into the view |

`dx` and `dy` are fractions of the shown picture's width (rightward) and height (downward); every number lies within ±10. Orbiting, panning or a standard view leaves the camera view instead of moving the scene camera. A view change never changes the scene, and the add-on answers nothing; the next frame shows the result. Add-on 0.2.0 or later applies view changes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The link speaks JSON text messages and binary messages. The harness sends `request` (`id`, `op`, `params`), `cancel` (`id`, when a request times out or is stopped; from add-on 0.4.0 Blender skips that request if it has not started it, and answers nothing; a started request runs to its end), `stream` (`on`), `frame_ack` (`seq`) and `view` (a view change, unanswered). The add-on sends `hello` and `state` (its state), `response` (`id`, `ok`, `result` or `error`), and binary messages whose 4-byte big-endian header length precedes a JSON header and the payload: `frame` headers carry a viewport frame (from add-on 0.3.0 with `timing`, its draw and encode milliseconds, which the viewers receive too), and `chunk` headers carry a part of the file that the request with that `id` returns, before its `response`. `BlenderLink` keeps the one socket, the add-on's state, the waiting requests with their time limits, and the viewers. It tells the add-on to stream only while a viewer watches, acknowledges each frame after relaying it, and a viewer socket with more than 1 MiB waiting to be sent skips frames. The pairing token lives in the DSH credential store under `dv-blender/pairing-token` while a store is mounted, so it survives a restart.

The add-on keeps every `bpy` call on Blender's main thread: a timer drains the link's messages, every 5 ms while the harness moves the view, every 20 ms while it streams, and every 50 ms otherwise. A `POST_PIXEL` draw handler on the largest 3D view draws that view again into an offscreen buffer at the stream width, with the view's matrices, shading, overlays and color management (the framebuffer active in the handler holds only overlays and UI, because Blender composites the shaded scene after the handlers run), so frames follow redraws and each frame costs one extra viewport draw; a timer encodes them as JPEG through a temporary image and sends them, at most `max fps` per second and with at most two unacknowledged frames, so one frame crosses the network while the next is drawn. While the harness orbits, pans or zooms the view, and for 0.3 s after, frames use the add-on's "while moving" preferences (24 per second, 640 px wide, JPEG quality 50 by default); one frame at the full preferences follows the last move. A look of the camera view draws the scene camera's view into an offscreen buffer in the same handler. A view change sets the main 3D view's `view_rotation`, `view_location`, `view_distance` or `view_perspective` in the timer, or runs `view3d.view_all` or `view3d.view_selected` there; a failed one is printed to Blender's console.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvBlender`: the config, the link and viewport routes and their admission, and the registration of the Fetch routes, tools and operations |
| [`src/link.ts`](src/link.ts) | `BlenderLink`: the socket, the requests and their files, the viewers and the frame acknowledgement |
| [`src/protocol.ts`](src/protocol.ts) | The link messages and their parsers |
| [`src/token.ts`](src/token.ts) | The pairing token |
| [`src/tools.ts`](src/tools.ts) | `dv_blender_scene`, `dv_blender_run` and `dv_blender_look` |
| [`src/render.ts`](src/render.ts) | `blender.render` and `blender.animation_render` |
| [`src/viewport-node.ts`](src/viewport-node.ts) | `blender.viewport` and the canvas registrations of the viewport node and the render takes |
| [`src/routes.ts`](src/routes.ts) | The browser's Fetch routes and the add-on zip |
| [`addon/`](addon/__init__.py) | The Blender add-on: panel and preferences (`__init__.py`), the WebSocket client (`link.py`), the requests (`commands.py`), the viewport stream (`viewport.py`), the view changes (`navigate.py`) and the helpers without `bpy` (`protocol.py`) |
| [`tests/blender-bridge.spec.ts`](tests/blender-bridge.spec.ts) | A Loader composition with the web server and a fake Blender on the link: admission, replacement, the token, the zip, the stream, the view changes, the tools, the renders, the viewport node and the removal on disposal |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@fastvideo/dreamverse-ui-blender`](../ui-blender/README.md): the Blender tab, the Blender takes and the viewport node on the canvas.
- [`@fastvideo/dreamverse-workflow-blender`](../workflow-blender/README.md): the skill that teaches the agent to use these tools.
- [`@dv/mcp-presets`](../mcp-presets/README.md): the Blender MCP preset, which needs Blender on the harness's machine.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

Three plain tools while the tool registry is mounted (`dv_blender_look` also needs the attachment store), and the three operation tools while `dvProject` is mounted, in the format `@dv/project` gives every operation tool. `dv_blender_run` takes `code`; `dv_blender_look` takes `view` (`viewport` or `camera`); `dv_blender_viewport` takes `on`.

##### Verbatim tool descriptions

```markdown
dv_blender_scene: Read the scene of the Blender that the user connected to the harness: the open file, the frame range and frames per second, the render engine and resolution, the active camera, the selection, and every object with its type, parent, location, rotation (degrees), scale, dimensions, visibility and materials. Read it before you change the scene, and again when the user may have changed it.
dv_blender_run: Run Python in the connected Blender, with bpy, mathutils and math imported. The user sees each change in their Blender at once. Make one small change per call. Assign a JSON value to `result` to return it; print() output returns as stdout. A Python error returns its traceback, and the changes made before the error stay. The user can undo a call in Blender with Ctrl+Z.
dv_blender_look: Look at the connected Blender: a PNG of the 3D viewport as the user sees it (`viewport`, the default), or of what the scene camera frames (`camera`), at most 1280 px wide. Look after a visible change to check it.
dv_blender_render: Render one frame of the connected Blender's scene with its scene camera, render engine and resolution, as a PNG image in the project, for use as a still or as the reference image of a shot. Check the framing with dv_blender_look view camera first. Blender is busy until the render finishes.
dv_blender_animation_render: Render a frame range of the connected Blender's scene with its scene camera, render engine, resolution and frame rate, as an MP4 video in the project that the timeline can use as a shot. Rendering many frames takes long; keep ranges short and the resolution modest unless the user asks for more. Blender is busy until it finishes.
dv_blender_viewport: Put the live viewport of the user's Blender on the project canvas as a node. The node shows what Blender's 3D viewport shows, and the user can open it to orbit, pan and zoom the view; it changes nothing in the scene. To take it off the canvas, remove its node with dv_canvas_node_remove.
```

#### Token effect

About 870 tokens for the six definitions, the shared arguments of `@dv/project` included, fixed while the plugin is mounted.

#### KV Cache effect

The definitions sit in the stable tool section of every agent request; mounting or removing the plugin changes the tool list and invalidates the cached prefix from the tool section on. Connecting or disconnecting Blender, and putting the viewport on the canvas, change nothing.

### Tool results

#### What the model sees

`dv_blender_scene` and `dv_blender_run` return the JSON that Blender answers: the scene facts, or `{"stdout": …, "result": …}`. `dv_blender_look` returns the line `A picture of the Blender viewport as the user sees it, <w>x<h> px.` (or `the scene camera's view`) and the picture as an image block. The render tools and `dv_blender_viewport` return the operation tool text of `@dv/project` with the asset line (none for `dv_blender_viewport`) and the report. Every tool fails with "No Blender is connected to the harness. Ask the user to open the Blender tab on the right panel and connect Blender with the DreamVerse add-on, then try again." while no Blender is connected; a Python error returns its traceback; `dv_blender_run` fails without asking Blender while the add-on has code from the harness switched off; `dv_blender_look` fails when the model takes no images.

#### Token effect

A scene read is about 40 tokens per object; a code run returns its output, at most 20000 characters of stdout; a look is one image of at most 1280 px width plus about 20 tokens.

#### KV Cache effect

Each result is appended to the conversation after its call; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One Blender per harness**: a second Blender that connects replaces the first; the link carries no project, so every chat of the harness talks to the same Blender.
- **The browser moves only the view**: the opened viewport node orbits, pans, zooms and switches views; selecting, editing or clicking objects from the browser is not supported, and each move shows after a round trip to Blender and one frame.
- **One viewport node per project**: the node shows the one connected Blender, so two projects that show it show the same viewport.
- **Frame rate**: the add-on encodes frames in Blender's Python on Blender's main thread, so the stream reaches about 5 to 15 frames per second at 1280 px, more at the smaller frames it sends while the view moves; the preferences set the rate, width and JPEG quality at rest and while moving. Each move and each frame crosses the network, so through an SSH tunnel the view follows a drag one round trip late; the Blender controls show the frame rate, that delay, and the add-on's draw and encode times.
- **Model providers that reject WebP**: the harness sends an image that has an alpha channel to the model as WebP once it re-encodes it, and some providers, such as Cerebras, reject WebP. The add-on's looks are RGB PNGs, and its stills are RGB unless the scene renders a transparent film, so they reach such a provider as PNG or JPEG; other images with an alpha channel and WebP uploads still need the harness's request image formats to follow the provider.
- **No Linux arm64 Blender**: Blender publishes no Linux arm64 build, so on an arm64 harness machine Blender runs on another computer.
- **Untested on real Blender in CI**: the tests drive the link with a fake Blender; the add-on's `bpy` code is checked by hand in Blender 5.3.
