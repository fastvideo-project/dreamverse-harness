# 素材

[English](assets.md) | 中文

[`@dv/asset-pool`](../../../packages/dv/asset-pool/README.zh.md) 提供 Cordis 服务 `dvAssetPool`。该服务存储每个项目的每个素材，并在 `GET /dv/assets/<AssetId>` 提供素材文件。该服务也拥有组件键 `asset` 及其归约函数和五个操作。[`@dv/ffmpeg`](../../../packages/dv/ffmpeg/README.zh.md) 提供服务 `dvFfmpeg`，它为操作运行 ffmpeg 和 ffprobe。`@dv/project` 通过素材库用 `dvProject.registerAssetStore` 注册的素材存储读写素材库。`@dv/api`、`@dv/chat-references`、`@dv/fastvideo`、`@dv/inspector` 和 `@dv/timeline` 注入 `dvAssetPool`。`@dv/asset-pool`、`@dv/inspector` 和 `@dv/timeline` 注入 `dvFfmpeg`。各包的 README 包含配置、方法和操作参数。

## 素材是什么

素材是一个文件：一张图片、一段视频、一个音频文件或一个文本文件。素材库根据素材字节的哈希得出素材的 ID `AssetId`（[包 README](../../../packages/dv/asset-pool/README.zh.md)）。`@dv/project` 定义 `AssetId`，因为记录要指名素材；素材库再导出它。素材库从不修改素材的字节，因此指名某个素材的记录总是指向同样的字节。两次导入的字节相同时，它们得到同一个素材，素材库保留第一次导入的名称和创建者。

素材库为每个素材存储一个 `Asset`。`Asset` 位于 `packages/dv/asset-pool/src/types.ts`：

| 字段              | 含义                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| `id`              | `AssetId`；也是 `objects/` 下的文件名                                |
| `mime`            | 媒体类型，例如 `image/png` 或 `video/mp4`                            |
| `name`            | 第一次导入的显示名称，例如文件名或 `still.png`                       |
| `size_bytes`      | 文件的字节数                                                         |
| `created_by`      | 在任一项目中最先存储这些字节的记录；在记录之外存储的字节为 null      |
| `created_at`      | 第一次导入的时间，ISO-8601 UTC                                       |
| `width`、`height` | 图片或视频的像素尺寸，未知时为 null                                  |
| `duration_sec`    | 音频或视频的时长（秒），未知时为 null                                |
| `has_audio`       | 视频是否带声音；在 `dvAssetPool.hasAudio` 第一次读取该视频之前不存在 |

`Asset` 的 `created_by` 字段是素材库的事实。在一个项目中，`proj` 切片的 `created_by` 映射指出创建每个素材的记录（[项目状态](project.zh.md#project-state)）。这两个值可以不同。例如，`@dv/api` 的导入路由先以 `created_by: null` 存储字节，然后它的 `asset.import` 记录才运行。

## 文件在哪里

一个素材库服务所有项目。`dvAssetPool` 的 `root` 设置指定它的目录。DreamVerse bundle 把 `root` 设为 `$DV_STATE_ROOT/assets`，与 `dvProject` 的 `projects` 和 `sessions` 目录并列。

| 路径                       | 内容                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `<root>/objects/<AssetId>` | 一个素材的字节。素材库先写 `<AssetId>.partial` 再改名，因此崩溃从不在该 ID 下留下不完整的文件 |
| `<root>/index.jsonl`       | 每个素材一行 `Asset`。同一 ID 的后一行补充媒体信息，素材库启动时以最后一行为准                |

agent（智能体）和聊天卡片从 `dvAssetPool.url` 得到 URL `<publicBaseUrl>/dv/assets/<AssetId>`。

## 操作

`asset` 组件注册五个操作。[包 README](../../../packages/dv/asset-pool/README.zh.md#use-this-package) 给出它们的输入和参数。

| 操作                | 做什么                                                                  | 是否写出素材 |
| ------------------- | ----------------------------------------------------------------------- | ------------ |
| `asset.import`      | 把本机上的一个文件或 base64 字节变为素材；带 `place` 时也把它放到画布上 | 导入的素材   |
| `asset.grab_still`  | 把视频的一帧变为 PNG 静帧                                               | 静帧         |
| `asset.cut_segment` | 把视频在两个时间之间的部分变为带声音的 MP4 视频                         | 片段         |
| `asset.place`       | 把素材放到画布上                                                        | 无           |
| `asset.unplace`     | 把素材从画布上拿下；素材留在素材库中                                    | 无           |

`asset` 切片包含 `placed`，即当前状态中画布上的素材的列表，按放置顺序排列。因为每次放置都是一条记录，撤销会收回一次放置。

三条路径导入文件。每条路径写一条 `asset.import` 记录：

1. agent 调用 `dv_asset_import`。
2. 素材库面板或拖到画布上的文件向 `@dv/api` 发送 `POST /api/dv/assets/import`。来自画布的文件也放到画布上。
3. `@dv/chat-references` 以用户的身份导入用户在聊天中附加的每张图片，并把它放到画布上。

其他操作写出生成的素材。操作把文件写入 `OperationContext.scratchDir`，并调用 `context.importAsset`。运行器把这次调用绑定到正在运行的记录，因此每个生成的素材都以一条记录为创建者。

<a id="imported-and-generated-assets"></a>
## 导入的素材和生成的素材

导入的素材是 `asset.import` 记录的输出。生成的素材是其他任何记录的输出。[历史规则第 4 条](project.zh.md#history-rules) 说明项目显示其中哪些素材。`packages/dv/asset-pool/src/imports.ts` 为列出或放置素材的包实现这条规则：

- `importedAssets(records)` 把项目导入的每个素材映射到输出它的第一条已完成 `asset.import` 记录。它读取项目的每条记录，包括被丢弃的记录。
- `placeable(state, imported, asset)` 对导入的素材以及当前状态中某条记录创建的素材为 true。`asset.place` 以 `invalid_inputs` 拒绝其他素材。

`packages/dv/api/src/wire.ts` 中的 `mentionedAssets` 收集协议状态的 `assets`。这个列表包含当前状态的每个素材、每个导入的素材，以及每个时间线片段的素材。当前状态的素材是其记录的输出和已解析的输入。每个条目是 `Asset`，当项目导入过该素材时，带有该项目第一次导入的 `name` 和 `created_at`。条目还包含 `made_by`。`made_by` 是当前状态中创建该素材的记录的操作；否则，导入的素材为 `asset.import`；否则为 null。

## `@dv/ffmpeg` 为其他包提供什么

`dvFfmpeg` 有两个方法。`run` 对输入路径执行一条 ffmpeg 或 ffprobe 命令，并把声明的输出写入调用方给出的目录。`probe` 读取文件的时长、像素尺寸、视频编码和是否有音频。命令失败，或命令没有写出声明的输出时，抛出带有命令 stderr 的 `FfmpegError`。该服务从不读取素材库或项目。调用它的操作用 `context.importAsset` 导入输出文件，因此每个文件都链接到它的记录。

| 包               | 用 `dvFfmpeg` 做什么                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| `@dv/asset-pool` | 导入时的像素尺寸和时长、`asset.grab_still`、`asset.cut_segment` 和 `hasAudio` |
| `@dv/inspector`  | 素材的媒体信息                                                                |
| `@dv/timeline`   | 时间线的导出                                                                  |
