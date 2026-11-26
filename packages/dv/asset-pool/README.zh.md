---
description: "DreamVerse 的素材库组件：dvAssetPool 服务、带 /dv/assets 路由的内容寻址素材存储、它向画布节点列表注册的素材节点，以及操作 asset.import、asset.grab_still、asset.cut_segment 和 asset.place 及其智能体工具。"
kind: "package-reference"
---

# @dv/asset-pool

[English](README.md) | 中文

## 概述

使用本包把项目的每张图片、每段视频、每个音频和文本文件只保存一次，并且永不修改。素材的 ID 是其字节的 SHA-256，因此引用某个素材的记录永远指向同样的字节。本服务是项目的素材存储，并向 `dvProject` 注册四个操作：`asset.import`，把一个文件或 base64 字节变成素材；`asset.grab_still`，把视频的一帧变成 PNG 静帧；`asset.cut_segment`，把视频中两个时间点之间的部分变成一个带声音的新 MP4 视频；`asset.place`，把素材放到画布上。DSH web server 运行时，本服务在 `/dv/assets/<AssetId>` 提供素材文件。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在 `@dv/project` 和 `@dv/ffmpeg` 之后挂载插件。其他插件注入 `dvAssetPool`。本服务经 `dvProject.registerAssetStore` 注册自己，因此同一文件导入同一项目两次只是一个素材。项目把素材保存在自己的文件夹里，因此复制文件夹就复制了整个项目：`<项目文件夹>/.dreamverse/assets/` 下，字节在 `objects/<sha256>`，`index.jsonl` 里每个素材一行 `Asset`。`asset.import` 经 `dvFfmpeg` 读取图片或视频的像素尺寸和时长，`asset.grab_still` 和 `asset.cut_segment` 经 `dvFfmpeg` 运行，`dvProject` 把这四个操作变成智能体工具 `dv_asset_import`、`dv_asset_grab_still`、`dv_asset_cut_segment` 和 `dv_asset_place`。组件键 `asset` 没有归约函数：本服务在 `ctx.inject(['dvCanvasNodes'], …)` 里向 [`@dv/canvas`](../canvas/README.zh.md) 的 `dvCanvasNodes` 注册：已完成的带 `place: true` 的 `asset.import` 和每次 `asset.place` 产生 kind 为 `asset` 的节点；`asset.place` 也只在该服务加载期间注册。该服务的 `canvas.node_remove` 把素材节点从画布移除，素材仍留在素材库。`proj` 切片的 `created_by` 记着创建每个素材的记录。画布上有哪些素材属于项目内容：每次摆放都是一条记录，因此历史会列出它，撤销能撤回它。

```yaml
- id: dv-asset-pool
  name: '@dv/asset-pool'
  config:
    publicBaseUrl: https://demo.example
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `publicBaseUrl` | `''` | agent 和聊天卡片显示的素材 URL 的前缀，例如隧道源地址；为空时保持相对路径 |

| 操作 | 工具 | 输入和参数 | 输出 |
| --- | --- | --- | --- |
| `asset.import` | `dv_asset_import` | 参数 `path`（本机上的文件）或 `base64`（字节）、`mime`（必填）、`name`（默认：文件名）、`place`（为 true 时同时把素材放到画布上） | `asset` |
| `asset.grab_still` | `dv_asset_grab_still` | 输入 `video`，参数 `at`：`first`、`last`（默认）或以秒计的时间 | `still`（PNG） |
| `asset.cut_segment` | `dv_asset_cut_segment` | 输入 `video`，参数 `in_sec` 和 `out_sec`（都必填，从视频开头起的秒数）；不满足 `0 <= in_sec < out_sec` 时返回 `invalid_params`；区间内没有视频帧时记录失败 | `segment`（MP4，带声音、像素尺寸和时长） |
| `asset.place` | `dv_asset_place` | 输入 `asset`（一个或多个）；素材既不是项目的任何记录（包括被丢弃的记录）导入的、也不是当前状态中某一步生成的时返回 `invalid_inputs`，全部素材已在画布上（即已有画布节点显示它）时返回 `invalid_params` | 无 |

| 方法 | 行为 |
| --- | --- |
| `importAsset(project, bytes \| {path}, {mime, name, durationSec?, width?, height?}, createdBy)` | 按哈希把字节保存到项目文件夹，并在那里追加一行索引；同一项目中的相同内容返回已有 ID，保留第一个素材；项目不存在或其文件夹里没有 `.dreamverse/records.jsonl` 时，在写入任何东西之前抛出 `unknown_project` |
| `get(asset)` | `Asset`：`id`、`mime`、`name`、`size_bytes`、`created_by`、`created_at`、`width`、`height`、`duration_sec`，以及 `hasAudio` 读过视频之后的 `has_audio` |
| `hasAudio(asset)` | 素材是否有声音：音频为 true，图片和其他文件为 false，视频取存储的 `has_audio`；第一次读取视频时用 ffprobe 检查并把结果追加到索引 |
| `mediaType(asset)` | 素材 MIME 类型的顶层类型，例如 `video/mp4` 的 `video`；其他包向素材库查询，而不自己读取 MIME 类型 |
| `path(asset)` / `read(asset)` | 存储文件的绝对路径，或其字节 |
| `has(asset)` | 是否有项目文件夹持有该素材 |
| `url(asset)` | `<publicBaseUrl>/dv/assets/<AssetId>` |
| `grabStill(video, at, dir)` | 把视频的一帧写成 `dir` 中的 `still.png` 并返回其路径；由操作导入 |

读取只需素材 ID，在持有这些字节的任一项目文件夹里找到它们。对没有任何项目文件夹持有的素材，`get`、`hasAudio`、`mediaType`、`path` 和 `read` 抛出代码为 `unknown_asset` 的 `ProjectError`。`GET /dv/assets/<AssetId>` 返回文件及其媒体类型、`Accept-Ranges: bytes`、作为强 ETag 的素材 ID，以及 `Cache-Control: public, max-age=31536000, immutable, no-transform`；`no-transform` 让 web server 不做 gzip，因此同一 ETag 下的每个响应都是文件本身的字节，字节范围也按这些字节计算。列出该 ETag 或 `*` 的 `If-None-Match` 得到 304。文件大小取自打开的文件；打不开或读不出大小的文件会写入日志并关闭，文件不存在时返回 404，其他情况返回 500。`range-parser` 读成一个字节范围的 `Range` 头（重叠或相邻的范围先合并）得到 206 和这些字节，因此浏览器可以从文件中间开始播放声音或视频；比文件更长的后缀表示整个文件。没有任何范围落在文件内的 `Range` 得到 416，包括末字节在首字节之前的范围。分开的多个范围、其他单位、格式错误的值、不等于该 ETag 的 `If-Range`，以及空文件的任何范围，都得到整个文件。`HEAD` 返回与整文件 `GET` 相同的头且没有正文。`/dv/assets` 下其他路径或方法返回 404。客户端取消请求（无论在传输前还是传输中）或读取失败时，文件都会关闭；在文件打开前取消请求的客户端得不到响应，发出头之后读取失败会写入日志，正文在那里中断。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`importAsset` 先把字节写到项目 `.dreamverse/assets/` 目录里的 `objects/<sha>.partial`，再改名到位，因此崩溃不会在哈希名下留下写了一半的对象。索引每个素材一行 `Asset` JSON，在对象文件存在之后追加。服务第一次需要某个文件夹时重放它的索引，跳过对象文件缺失的行。读取先在已读过的文件夹里查找；都没有该素材时，它读取 `dvProject.listProjects()` 中尚未读过的项目文件夹（例如启动后加入的复制文件夹），再查找一次。两个项目中的相同字节是同一 ID 下的两个文件，读取可能返回其中任一文件。`asset.import` 用 ffprobe（`dvFfmpeg.probe`）读取条目还不知道的图片或视频的宽、高和时长，以及音频文件的时长；文件头里没有时长的视频（浏览器录制的 WebM 文件）用 `-progress pipe:1` 解码一遍，最后一个 `out_time` 就是它的时长，没有时长的音频文件也这样解码。音频文件的宽和高保持为 null，因为它的视频流是封面图。`describe` 把更新后的条目追加到导入项目的索引，重放时同一 ID 以最后一行为准。探测失败时这些值保持为 null，导入不会因此失败。`grabStill` 对第一帧或给定时间直接定位；对最后一帧，它先探测视频，尝试在视频流结尾前做输入定位，再尝试保留最后一帧的完整解码，因为来自流式后端的分片 MP4 头部没有可靠的时长。`asset.cut_segment` 运行 ffmpeg，把 `-ss` 和 `-to` 放在 `-i` 之后，用 libx264 重新编码视频、用 AAC 重新编码音频，因此片段在准确的帧上开始和结束，与 `@dv/deliver` 的片段裁剪相同。它探测片段，文件里没有视频流时（区间从视频结尾之后开始）记录失败，否则带着像素尺寸和时长导入片段。路由通过 `ctx.inject` 注册在 `webServer` 上，因此插件在没有 web server 的组合中也能工作。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvAssetPool`：项目文件夹中的存储、索引重放、路由、五个操作、`mediaType` 和 `grabStill` |
| [`src/imports.ts`](src/imports.ts) | `importedAssets(records)`：项目对每个导入素材的第一条已完成 `asset.import` 记录；`placeable(state, imported, asset)`：`asset.place` 的规则；`@dv/api` 和 `@dv/chat-references` 都使用这两个函数 |
| [`src/types.ts`](src/types.ts) | `Asset`，即 `index.jsonl` 的一行，以及 `StillAt` |

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/project`](../project/README.zh.md)：操作、智能体工具和素材存储的注册。
- [`@dv/ffmpeg`](../ffmpeg/README.zh.md)：`grabStill` 和 `asset.cut_segment` 使用的 ffmpeg 执行器。
- [`COMPONENT-TEMPLATE.md`](../COMPONENT-TEMPLATE.md)：本组件遵循的布局。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到什么

四个工具 `dv_asset_import`、`dv_asset_grab_still`、`dv_asset_cut_segment` 和 `dv_asset_place`（最后一个在 `@dv/canvas` 加载期间才有），采用 `@dv/project` 给每个操作工具的格式。`dv_asset_import` 的描述是 "Bring a file into the asset pool: a path on this machine, or base64 bytes. Returns the asset ID to reference later."，参数为 `path`、`base64`、`mime`（必填）、`name` 和 `place`（"Also put the asset on the canvas."）。`dv_asset_grab_still` 的描述是 "Grab one frame of a video as a PNG still, to look at it or to use it as a reference." 和 "Runs on the CPU."，接受输入 `video` 和参数 `at`（`'first'`、`'last'` 或以秒计的时间；默认 last）。`dv_asset_cut_segment` 的描述是 "Cut the part of a video between two times into a new video asset with its sound, for example to use it as a reference." 和 "Runs on the CPU."，接受输入 `video` 和必填参数 `in_sec`、`out_sec`（从视频开头起的秒数）。这三个描述都以 "Repeating a call with the same inputs and params reuses the earlier result." 结尾。`dv_asset_place` 的描述是 "Put assets of the project on the canvas, where the user sees each one as a node. The assets must come from a record in the current state of the project."，接受输入 `asset`。

#### Token 影响

五个定义约 1,400 个 token，插件挂载期间固定不变；`@dv/project` 的共享参数让每个定义多约 200 个 token。

#### KV Cache 影响

这些定义位于每次智能体请求中固定的工具部分；挂载或移除插件会改变工具列表，使缓存前缀从工具部分起失效。

### 工具结果

#### 模型看到什么

一次调用返回一个文本块：`done <record>: <summary>`（`imported face.png`、`still at last`、`segment 1–2 s`、`placed 2 asset(s) on the canvas`），每个输出一行，带素材 ID（其字节的 SHA-256）、媒体类型和 `/dv/assets/<AssetId>` URL，以及参数。挂载了附件服务时，图片输出还以图片块到达。

#### Token 影响

每次调用约 80 个 token 的文本，大部分是 64 个字符的素材 ID 和 URL。带 `base64` 的 `dv_asset_import` 调用会在回显的参数里重复这些字节，因此其结果的开销约等于其参数再来一遍。每个图片块按模型对一张图片的计费计算。

#### KV Cache 影响

结果在调用之后追加到对话中；已缓存的前缀保持不变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不删除**：项目中未被引用的素材留在磁盘上；垃圾回收延后到项目可以删除时再做。
- **索引不压缩**：第一次读取文件夹时重放其索引的每一行；素材很多的项目打开较慢。
- **移除的项目在重启前仍可读取**：服务保留它读过的每个文件夹，因此在服务器重启之前，按 ID 仍能读取已移除项目的素材。
