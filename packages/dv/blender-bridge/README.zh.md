---
description: "DreamVerse 的 Blender 组件：dvBlender 服务负责 DreamVerse 插件从用户的 Blender 向 harness 打开的连接、智能体工具 dv_blender_scene、dv_blender_run 和 dv_blender_look、操作 blender.render 和 blender.animation_render，以及向浏览器推送视口并提供插件下载的路由。"
kind: "package-reference"
---

# @fastvideo/dreamverse-blender-bridge

[English](README.md) | 中文

## 概要

使用本包让智能体在用户自己的 Blender 里工作。DreamVerse 插件位于 `addon/`，它从 Blender 向 harness 打开一个 WebSocket，所以 Blender 可以运行在用户的电脑上（经由与浏览器相同的 SSH 隧道），也可以运行在 harness 所在的机器上。智能体读取场景、运行 Python、查看视口，并把静帧和动画渲染进项目。浏览器在 [`@fastvideo/dreamverse-ui-blender`](../ui-blender/README.zh.md) 的 Blender 标签页中实时显示视口。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 DreamVerse 配置中挂载本插件；[`@fastvideo/dreamverse-blender`](../blender/README.zh.md) 会插入它。连接路由需要 DSH Web 服务器（`webServer`），浏览器路由需要 Connection（`connection`），渲染操作需要 `dvProject`，`dv_blender_look` 需要附件存储（`attachments`）；每一部分在对应服务存在期间存在。

```yaml
- id: dv-blender
  name: '@fastvideo/dreamverse-blender-bridge'
  config:
    requestTimeoutMs: 60000
```

| 配置 | 默认值 | 含义 |
| --- | --- | --- |
| `requestTimeoutMs` | 60000 | 读取场景、运行代码或查看画面时等待 Blender 的时长 |
| `renderTimeoutMs` | 1800000 | 渲染时等待 Blender 的时长 |
| `maxFileBytes` | 536870912 | Blender 发来的一个文件（查看画面或渲染结果）的最大字节数 |
| `pingMs` | 20000 | 连接和视口流上保活 ping 的间隔 |

用户按 Blender 标签页显示的三步连接 Blender：下载插件（`GET /api/dv/blender/addon.zip`），在 Blender 中安装（编辑 → 偏好设置 → 获取扩展 → 从磁盘安装；需要 Blender 4.2 或更高版本），然后把连接串粘贴到 3D 视图侧栏的 DreamVerse 面板。连接串是页面的源地址、`#` 和配对码，例如 `http://127.0.0.1:18094#<token>`；经由 SSH 隧道时，页面的源地址就是隧道的本地地址，同一台电脑上的 Blender 也从这里连到 harness。

| 路由 | 准入 | 作用 |
| --- | --- | --- |
| `/dv/blender/ws`（Web 服务器的 WebSocket 升级） | `Authorization: Bearer <配对码>` 且没有 `Origin` 请求头；配对码错误回 HTTP 401，带 `Origin` 的请求回 403 | 到 Blender 的连接；新的连接替换旧的连接，旧连接以代码 4000 关闭 |
| `/dv/blender/view`（Web 服务器的 WebSocket 升级） | Connection 的 Host、Origin 和浏览器认证检查 | 视口：立即以及每次变化时发送文本消息 `{type: 'status', linked, state}`，每一帧先发送文本消息 `{type: 'frame', seq, width, height, mime}`，再发送一条包含 JPEG 或 PNG 的二进制消息。WebSocket 不占用浏览器到 harness 为数不多的 HTTP/1.1 连接，而长时间打开的 HTTP 流会占用一个 |
| `GET /api/dv/blender/status` | Connection 的浏览器认证 | `{linked, state, token, link_path, viewers}`；`state` 是插件的 `{blender_version, addon_version, file, allow_code}` |
| `POST /api/dv/blender/token` | 同上 | 更换配对码，并以代码 4001 关闭连接；返回新的状态 |
| `GET /api/dv/blender/addon.zip` | 同上 | Blender 扩展格式的插件 zip，每次下载都从 `addon/` 读取 |

| 操作 | 工具 | 参数 | 输出和报告 |
| --- | --- | --- | --- |
| `blender.render` | `dv_blender_render` | `frame`（默认：场景的当前帧） | 输出 `image`，一个 `image/png` 素材；报告 `{width, height, frame, engine}` |
| `blender.animation_render` | `dv_blender_animation_render` | `frame_start`、`frame_end`（默认：场景的帧范围） | 输出 `video`，一个带时长的 `video/mp4` 素材；报告 `{width, height, frame_start, frame_end, fps, duration_sec, engine}` |

两个操作都用场景相机以及场景自己的引擎、分辨率和帧率渲染，结果不确定，并像所有生成一样在后台运行；渲染结束前 Blender 处于忙碌状态。

-----

<a id="understand-the-implementation"></a>
## 理解实现

连接上传送 JSON 文本消息和二进制消息。harness 发送 `request`（`id`、`op`、`params`）、`stream`（`on`）和 `frame_ack`（`seq`）。插件发送 `hello` 和 `state`（自身状态）、`response`（`id`、`ok`、`result` 或 `error`），以及二进制消息：4 字节大端的头部长度之后是 JSON 头部和载荷；`frame` 头部携带一帧视口画面，`chunk` 头部携带对应 `id` 请求返回的文件的一部分，在该请求的 `response` 之前发送。`BlenderLink` 保存唯一的套接字、插件的状态、带时限的等待中请求，以及观看者。它只在有观看者时让插件推流，转发每一帧后确认该帧，待发送数据超过 1 MiB 的观看者套接字会跳过帧。挂载了 DSH 凭据存储时，配对码保存在其中的 `dv-blender/pairing-token` 下，所以重启后不变。

插件的所有 `bpy` 调用都在 Blender 主线程上进行：一个定时器取出连接收到的消息。最大的 3D 视图上的 `POST_PIXEL` 绘制回调在 Blender 绘制时复制该区域的像素，所以画面跟随重绘，不需要再渲染一次；随后一个定时器通过一张临时图像把它编码成 JPEG 并发送，每秒最多 `max fps` 帧，同时最多有一帧未被确认。查看相机视图时，同一个回调把场景相机的视图画进离屏缓冲区。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvBlender`：配置、连接路由和视口路由及其准入，以及 Fetch 路由、工具和操作的注册 |
| [`src/link.ts`](src/link.ts) | `BlenderLink`：套接字、请求及其文件、观看者和帧确认 |
| [`src/protocol.ts`](src/protocol.ts) | 连接消息及其解析 |
| [`src/token.ts`](src/token.ts) | 配对码 |
| [`src/tools.ts`](src/tools.ts) | `dv_blender_scene`、`dv_blender_run` 和 `dv_blender_look` |
| [`src/render.ts`](src/render.ts) | `blender.render` 和 `blender.animation_render` |
| [`src/routes.ts`](src/routes.ts) | 浏览器的 Fetch 路由和插件 zip |
| [`addon/`](addon/__init__.py) | Blender 插件：面板和偏好设置（`__init__.py`）、WebSocket 客户端（`link.py`）、请求处理（`commands.py`）、视口流（`viewport.py`）和不依赖 `bpy` 的辅助函数（`protocol.py`） |
| [`tests/blender-bridge.spec.ts`](tests/blender-bridge.spec.ts) | 一个带 Web 服务器、在连接上使用假 Blender 的 Loader 组合：准入、替换、配对码、zip、视口流、工具、渲染以及卸载时的移除 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`@fastvideo/dreamverse-ui-blender`](../ui-blender/README.zh.md)：Blender 标签页和画布上的 Blender 版本。
- [`@fastvideo/dreamverse-workflow-blender`](../workflow-blender/README.zh.md)：教智能体使用这些工具的技能。
- [`@dv/mcp-presets`](../mcp-presets/README.zh.md)：Blender MCP 预设，它要求 Blender 与 harness 在同一台机器上。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

工具注册表挂载期间有三个普通工具（`dv_blender_look` 还需要附件存储），`dvProject` 挂载期间还有两个操作工具，格式与 `@dv/project` 给所有操作工具的格式相同。`dv_blender_run` 接受 `code`；`dv_blender_look` 接受 `view`（`viewport` 或 `camera`）。

##### 工具描述原文

```markdown
dv_blender_scene: Read the scene of the Blender that the user connected to the harness: the open file, the frame range and frames per second, the render engine and resolution, the active camera, the selection, and every object with its type, parent, location, rotation (degrees), scale, dimensions, visibility and materials. Read it before you change the scene, and again when the user may have changed it.
dv_blender_run: Run Python in the connected Blender, with bpy, mathutils and math imported. The user sees each change in their Blender at once. Make one small change per call. Assign a JSON value to `result` to return it; print() output returns as stdout. A Python error returns its traceback, and the changes made before the error stay. The user can undo a call in Blender with Ctrl+Z.
dv_blender_look: Look at the connected Blender: a PNG of the 3D viewport as the user sees it (`viewport`, the default), or of what the scene camera frames (`camera`), at most 1280 px wide. Look after a visible change to check it.
dv_blender_render: Render one frame of the connected Blender's scene with its scene camera, render engine and resolution, as a PNG image in the project, for use as a still or as the reference image of a shot. Check the framing with dv_blender_look view camera first. Blender is busy until the render finishes.
dv_blender_animation_render: Render a frame range of the connected Blender's scene with its scene camera, render engine, resolution and frame rate, as an MP4 video in the project that the timeline can use as a shot. Rendering many frames takes long; keep ranges short and the resolution modest unless the user asks for more. Blender is busy until it finishes.
```

#### Token 影响

五个定义共约 750 个 token（含 `@dv/project` 的共享参数），插件挂载期间固定不变。

#### KV 缓存影响

定义位于每个智能体请求的稳定工具段；挂载或移除插件会改变工具列表，使从工具段开始的缓存前缀失效。连接或断开 Blender 不改变任何内容。

### 工具结果

#### 模型看到什么

`dv_blender_scene` 和 `dv_blender_run` 返回 Blender 回答的 JSON：场景信息，或 `{"stdout": …, "result": …}`。`dv_blender_look` 返回一行 `A picture of the Blender viewport as the user sees it, <w>x<h> px.`（或 `the scene camera's view`）以及作为图像块的画面。渲染工具返回 `@dv/project` 的操作工具文本，包含素材行和报告。没有连接 Blender 时，每个工具都以 "No Blender is connected to the harness. Ask the user to open the Blender tab on the right panel and connect Blender with the DreamVerse add-on, then try again." 失败；Python 错误返回其回溯；插件关闭了来自 harness 的代码时，`dv_blender_run` 不询问 Blender 直接失败；模型不接受图像时，`dv_blender_look` 失败。

#### Token 影响

读取场景每个物体约 40 个 token；运行代码返回其输出，stdout 最多 20000 个字符；查看画面是一张宽度最多 1280 像素的图像，另加约 20 个 token。

#### KV 缓存影响

每个结果在其调用之后追加到对话中；缓存前缀保持不变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **每个 harness 一个 Blender**：第二个连接的 Blender 会替换第一个；连接不带项目，所以 harness 的所有对话都使用同一个 Blender。
- **视口只能查看**：Blender 标签页显示画面；不支持在浏览器中旋转视图或选择物体。
- **帧率**：插件在 Blender 的 Python 中编码画面，所以宽 1280 像素时视口流约为每秒 5 到 15 帧；偏好设置可以调整帧率、宽度和 JPEG 质量。
- **没有 Linux arm64 版 Blender**：Blender 不发布 Linux arm64 版本，所以 harness 在 arm64 机器上时，Blender 运行在另一台电脑上。
- **CI 不在真实 Blender 上测试**：测试用假 Blender 驱动连接；插件的 `bpy` 代码在 Blender 5.3 中手动检查。
