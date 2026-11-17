---
description: "作为右侧栏标签和中央视图的 DreamVerse 时间线编辑器：项目的每条时间线在它的视频轨和音轨上，片段和声音手势变成 `timeline.*` 记录。"
kind: "package-reference"
---

# @dv/ui-timeline

[English](README.md) | 中文

## 概述

使用本包让 web 应用在对话旁边多一个时间线编辑器。它为每条时间线显示一个标签，还显示预览和所选时间线的视频轨与音轨。每条视频轨上的片段都摆在各自的开始时间；预览显示播放头处最上面那条轨道的片段。你可以移动、裁剪、拆分和移除片段与声音，把素材库里的素材拖到轨道上或用轨道的 ＋ 添加。右侧栏的 `dv-timeline` 标签类型把编辑器包在项目栏下；`TimelineView` 是 shell 中间区域的 时间线 / Timeline 视图（`dv.center.view`）。两者都跟随项目的当前状态。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在叠了 `dsh-web-app` 和 `@dv/api` 的 profile 里挂载插件，先用 `pnpm run build` 构建浏览器 bundle。

编辑器还有一条工具栏和一把标尺。每个有素材的片段沿宽度显示它的视频的画面：编辑器每个页面只读一次，每秒读一帧（最多 40 帧，视频更长时间隔更大），每一格与片段等高，宽度按视频的宽高比算出，显示离它所在时间最近的那一帧。视频的帧读完之前，片段重复显示生成这个视频的记录输出的图片，没有时显示视频的首帧。占位片段（渲染仍在进行或已失败）是一个带条纹的块，宽度是渲染计划的时长，显示 渲染中… / Rendering… 或 渲染失败 / Render failed。有片段是占位片段时，导出 / Export 不可用，工具栏在它旁边显示 还有 {count} 个片段没就绪，全部就绪后才能导出 / Export waits until every clip is ready ({count} still rendering)。工具栏的 撤销 / Undo 和 重做 / Redo 图标按钮把项目的当前位置往回或往前移一步（不论这一步是哪个视图做的），不写记录，当前位置是最后一步时 重做 / Redo 不可用。预览下方的控制栏左侧是时间码；中间是后退 5 秒、播放或暂停、前进 5 秒（编辑器获得焦点时，J、L、Shift+← 和 Shift+→ 也能跳 5 秒，空格键播放或暂停）；右侧是播放速度按钮和全屏按钮，播放速度按钮在 0.5×、1×、1.5×、2× 之间循环，并在浏览器标签页的会话内保持所选速度。拖动预览和工具栏之间的分隔线（或在分隔线上按 ArrowUp 和 ArrowDown）可改变轨道区的高度，浏览器把它记在 `localStorage` 键 `dv-timeline-track-height` 下；预览至少保留 160 px，轨道区至少保留工具栏、标尺和第一行轨道。轨道区每一行下面和轨道标题列的右边缘各有一条线。行放不下时轨道区可以滚动，滚动条只在滚动时和滚动停下后 0.8 秒内显示。

每条视频轨的用法都一样。时间线只有一条视频轨时，它叫 视频 / Video；有多条时，从上往下是 视频 1 / Video 1、视频 2 / Video 2……。视频片段自带的声音没有单独的一行：它随片段播放，由轨道标题静音。视频轨和音轨的各行按轨道添加的先后排列（时间线的 `track_order`）；新时间线有一条视频轨，下面是一条音轨。工具栏的 ＋ 添加轨道 / Add track 按钮打开一个菜单，视频轨 / Video track 和 音轨 / Audio track 各写一条 `timeline.track_add`，在最下面加一条空轨；从写入开始到刷新后的状态显示出这条轨之前，两项都不可用。旁边的 轨道层级 / Track layers 按钮从上往下列出视频轨；每条轨的名称下面按播放顺序列出它的片段的素材名，没有片段时显示 空轨道 / Empty track。每条轨的上下箭头各写一条 `timeline.video_track_move`，把它和上面或下面那条轨对调，于是两条轨的片段各自显示在对方那一行；最上面那条的上移箭头和最下面那条的下移箭头不可用，从写入开始到刷新后的状态显示出移动之前，所有箭头都不可用。在菜单或列表外按下，或按 Escape，会关闭它。

一条视频轨上有片段的地方，这个片段盖住它下面的所有视频轨；轨道上的空隙处显示下面那条轨。每条视频轨的标题在名称下方一行有三个按钮。喇叭按钮通过 `timeline.mute` 把这条轨上片段自带的声音静音或取消静音；静音轨道的片段会调暗，预览播放它的片段时不出声，导出时也不包含这些声音。删除按钮写一条 `timeline.video_track_remove`，删除这条轨及其片段，它下面的视频轨编号各减一。＋ 打开素材选择窗口，把选中的视频加在这条轨最后一个片段之后，空轨上则加在播放头处。静音、删除轨道、移动轨道或添加轨道的写入进行期间，直到刷新后的状态显示出结果，所有轨道的喇叭和删除按钮都不可用；项目没有时间线时，标题上的按钮都不可用。

片段摆在它的开始时间，宽度就是播放时长。片段的标签、悬停提示和裁剪手柄的名称，轨道层级 / Track layers 列表，声音的横栏，视频轨 ＋ 的素材选择窗口，以及 添加声音 / Add sound 对话框，都按 `@dv/ui-kit/canvas-nodes.ts` 的 `assetLabel` 显示素材：素材的画布节点有名称时显示该名称，否则显示素材自己的名称，所以在画布上重命名素材的节点后，时间线里也显示新名称。只有节点的主素材单独显示节点的名称；节点较早的一次生成结果或第二个输出显示节点的名称再加它自己的名称，例如 `Opening · shot1.mp4`。项目里没有的素材显示它的 ID。拖动片段即在时间上移动它，并把它移到离松手那一行最近的视频轨（距离相同时取拖动方向上的那条）；占位片段的移动方式相同，移动成功后被移动的片段处于选中状态。拖动有素材的片段的边缘即裁剪，裁剪开头时开始时间跟着移动，其余部分留在原处；占位片段没有裁剪手柄。点击片段选中它，同一时刻只选中一个片段或一个声音。Delete 或 Backspace，或工具栏的 删除片段 / Delete clip 按钮移除选中的片段。工具栏的拆分按钮在播放头处拆分选中的片段，没有选中任何东西时拆分预览在播放头处显示的那个片段；只有这个片段有素材、播放头在片段内且离两端都超过 0.05 秒时它才可用。把素材库里的视频拖到一条视频轨上，就把它加到这条轨的松手处。任何编辑都不移动别的片段，所以空隙不会被合上；添加、移动或裁剪会让片段与同一轨道上的另一个片段重叠时，服务器拒绝这次写入，拒绝的原因显示在编辑器上方，直到下一次写入成功。

预览显示并播放播放头处编号最小的视频轨上的片段，这条轨静音时不出声。每个有素材的片段在预览里都有自己的 `<video>` 元素；其他片段的元素保持暂停并隐藏。最上面的片段是占位片段时，预览显示它的状态，例如 视频 上的片段：渲染中… / Clip on Video: Rendering…；没有片段播放的地方，预览没有画面。播放头按播放速度跟着时钟走，直到所有视频轨中最后一个片段的结尾，预览显示的片段还在加载时它停下等待。到了这个结尾，在那里结束的片段继续显示，停在它的最后一帧。片段的元素只有在编号更小的轨道上的片段没有把这个片段全部盖住、并且播放头在片段内或片段在播放头之后 5 秒内开始时才加载整个文件；其他元素只加载元数据。

每条音轨的标题显示它的名称，没有名称时显示 声音 {n} / Sound {n}；名称下方一行是它的按钮。双击标题，或在其右键菜单中选 重命名 / Rename，会打开名称输入框：按 Enter 或离开输入框时保存，按 Esc 取消；同一菜单中的 删除音轨 / Delete track，或标题上的删除按钮，删除该音轨及其声音；新时间线的 声音 1 / Sound 1 也能删除，删除后没有音轨。标题上的喇叭按钮通过 `timeline.mute` 把该音轨静音或取消静音，预览中静音音轨的声音不出声并调暗。项目没有时间线时，喇叭按钮不可用。工具栏 ＋ 添加轨道 / Add track 菜单里的 音轨 / Audio track 添加一条空音轨。每条轨道的 ＋ 都在它的标题里，删除按钮的右边。每条音轨的 ＋ 打开 添加声音 / Add sound 对话框，它显示新声音的开始位置，并列出 上传本地音频 / Upload local audio 和项目的音频素材（最新的在前）；上传会先把所选文件导入素材库，再添加它。新声音从所在音轨最后一个声音结束处开始，空音轨上则从播放头处开始。把音频素材拖到一条音轨上，就把它加到松手处。从添加开始到新声音显示出来之前，各音轨的 ＋ 不可用，拖进来的声音也不会添加。每个声音是一个与其播放时长等宽的块，显示它所播放的那段素材的波形，波形上方的一条横栏显示素材的名称。拖动声音即在时间上移动它，上下拖动整行则把它移到离松手那一行最近的音轨（距离相同时取拖动方向上的那条）；拖动边缘即裁剪，裁剪开头时开始时间跟着移动，其余部分留在原处，最早到时间线开头，最晚到素材结尾。点一个声音会选中它；按 Delete 或 Backspace、点工具栏的 删除声音 / Delete sound 按钮，或在其右键菜单中选 删除 / Delete，会移除它；播放头在声音内时，工具栏的拆分按钮或右键菜单里的 在播放头处拆分 / Split at playhead 会在播放头处拆分它。预览播放时，每个声音从它的入点开始，按播放速度与画面同步播放。时间线有声音时，工具栏在 导出 旁边显示 导出暂不包含声音 / Export does not include sounds yet。

在轨道区右键，会在指针处打开编辑器自己的菜单，而不是浏览器的菜单。在片段上，菜单选中这个片段，并有 在播放头处拆分 / Split at playhead（片段有素材且播放头在片段内时可用）和 删除 / Delete；在视频轨标题上，有 静音 / Mute 或 取消静音 / Unmute、上移 / Move up 和 下移 / Move down（与 轨道层级 / Track layers 的箭头相同）、删除视频轨 / Delete video track；在音轨标题上，有静音项、重命名 / Rename 和 删除音轨 / Delete track；在声音上，有 在播放头处拆分 / Split at playhead 和 删除 / Delete。在轨道的空白处，菜单有 在这里添加视频 / Add a video here 或 在这里添加声音 / Add a sound here，打开标题为 选一个素材放到 {time} / Pick an asset to place at {time} 的素材选择窗口或 添加声音 / Add sound 对话框，加在指针下的时间；还有 添加视频轨 / Add video track 和 添加音轨 / Add audio track，在最下面加一条空轨。每一项写的记录与对应的按钮相同，对应按钮不可用时它也不可用。在菜单外按下或按 Escape 会关闭菜单；在片段上按右键不会开始拖动。

```yaml
- id: dv-ui-timeline
  name: '@dv/ui-timeline'
```

Host 半边不注册任何东西。浏览器半边注册 `dv-timeline` 标签类型（侧栏指南页以"时间线"提供）、中英文的 `dvTimeline` locale 命名空间，以及以自身 id `@dv/ui-timeline` 为键的标签主体。只要 `@dv/ui-shell` 的中间区域服务 `dvCenter` 存在，它就把 `TimelineView` 注册为 `dv.center.view` 条目 `timeline`（顺序 1，标签为标签类型的 时间线 / Timeline），编辑中间区域所有者属性 `projectId` 指定的项目，为所有者属性 `session` 指定的对话写入记录，并应用所有者属性 `request`。在同一作用域里，它还注册 `dv.media.preview.action` 插槽的条目 `dv.timeline.insert`，即 `@dv/ui-media` 的 `dvMedia.preview` 打开的素材预览里的一个按钮：打开的项目的视频素材显示按钮 插入片段，点击后以该素材调用 `dvCenter.show({ view: 'timeline', target: { insert } })`，由打开项目的时间线视图插入它，并关闭预览。只要 `@dv/ui-canvas` 的画布服务 `dvCanvas` 存在，它还以同一 id 在 `dvCanvas.recordsInUse` 注册一个 `@dv/ui-canvas/contract` 的 `RecordsInUse`：其 `uses` 对每条时间线每条视频轨上的每个片段列出该片段等待的或排布时所用的渲染（`source.record`），否则列出片段素材的生成记录，于是画布画出时间线播放的版本；其 `badges` 在每个有入点或出点的片段的素材上加 已裁剪 / Trimmed 标记。在同一作用域里，它在 `dvCanvas.nodeTypes` 注册节点类型 `timeline`，用于 [`@dv/timeline`](../timeline/README.zh.md) 的 `timeline.place` 生成的节点，并在 `dvCanvas.addMenu` 注册 时间线 / Timelines 分区（顺序 1）：它按显示名称列出项目的每条时间线，选中一条就用一条 `timeline.place` 记录把它放到画布上；已有节点显示的时间线指向那个节点。时间线节点的标题是时间线的名称，meta 是时间线的时长，例如 `7.0s`；它的卡片（`dv.canvas.card` 条目 `timeline`）放着这条时间线的 `TimelineEditor`，使用 `card` 选项：没有时间线标签和轨道区调整大小，工具栏末尾是 打开编辑器 / Open editor（在 时间线 视图中显示这条时间线）；节点被选中时，编辑器的预览出现在节点上方，宽度与节点相同，比例取最上面一条有带素材片段的视频轨上最早那个带素材片段的宽高比（尺寸未知时为 16:9），和编辑器的播放头同步播放。预览随节点在两个方向上一起放大：宽度等于节点宽度；节点比默认 640 × 390 的比例更高时，宽度为 高度 × 640 / 390，并在节点上方居中；画面下方有显示播放头的进度条，按下即可把播放头移到那里。编辑器和预览的文字与控件随节点变大而放大，倍数取 宽度 / 480 和 高度 / 290 中较小的那个，至少为 1，所以默认大小的节点按面板大小的 4 / 3 绘制，两个方向都拉大的节点绘制得更大。在编辑器的控件上按下（按钮和滑块、刻度尺、片段、声音和轨道标题）会选中节点，操作留给编辑器；在卡片其他地方按下（包括预览）会移动节点，只点不拖则选中节点。编辑器保留自己的按键（例如对选中片段按 Delete）和自己的右键菜单；在其他地方右键打开画布的节点菜单。它的菜单在编辑器里打开，指针距离按画布缩放换算，轨道区用滚轮或触控板上下左右滚动，不显示滚动条。写入被拒绝时，错误显示在编辑器上方，直到下一次写入成功。它的 `uses` 列出每条视频轨上片段的素材、声音的素材以及每个占位片段等待的渲染，所以画布从这些素材和渲染所在的节点各画一条线，并在时间线节点被选中时给这些节点加轮廓和外发光、让其他节点变淡。`dvCenter` 存在时，双击调用 `dvCenter.show({ view: 'timeline', target: { timeline, clip: null } })`。在画布上重命名该节点时，通过类型的 `NodeType.rename` 写入 `timeline.rename {timeline, name}`，意图与标签重命名相同，所以节点和时间线的标签显示同一个名称，在任一处重命名都会显示在另一处；名称为空时不写入。时间线被删除的节点显示 这条时间线已删除 / This timeline was deleted，没有片段的时间线的预览显示 这条时间线还没有片段，从素材库拖入或点 ＋ 插入 / This timeline has no clips yet. Drag one in from the asset pool or click ＋. 只要 `@dv/ui-history` 的历史服务 `dvHistory` 存在，它就在 `dvHistory.rows` 注册 `@dv/ui-history/contract` 的 `HistoryRow` `timeline.`：它不给时间线记录的名称加主体，它的 `focus` 返回带记录的时间线和片段的中间区域目标 `{ view: 'timeline', target: { timeline, clip } }`。时间线是记录的 `timeline` 参数，否则是其 `clip` 或 `sound` 参数所属的时间线（每个片段和每个声音属于分配它的记录的时间线；拆分片段得到的片段属于被拆分片段的时间线），否则对没有该参数的 `timeline.create` 为 `t1`；片段是 `clip` 参数，否则是记录分配的第一个片段。找不到时间线的记录不定位。`@dv/ui-composer` 提供 `dvMentions` 时，它还注册提及类型 `clip`（ID 为 `@dv/ui-timeline`，分组 片段 / Clips，order 为 0，所以 `@` 菜单把片段列在其他每个类型之前）：每条时间线的每个片段按它在所在视频轨上的开始时间编号，轨道 0 上的显示为 时间线 1 · 片段 2 / Timeline 1 · Clip 2（未命名的时间线），其他视频轨上的显示为 时间线 1 · 视频 2 · 片段 1 / Timeline 1 · Video 2 · Clip 1，带生成片段素材的记录的提示词的前 40 个字符（占位片段取它等待的渲染），缩略图为该记录输出的图片，没有时为片段自己的素材。`TimelineView` 应用中间区域交给它的请求后取走该请求。请求 `{ timeline, clip }` 选中该时间线；带 `clip` 时，编辑器显示该时间线后选中那个片段，并把播放头移到片段开头。请求 `{ insert }` 在视图读到状态后插入该素材：用 `timeline.clip_add` 放到所选时间线（否则第一条）的轨道 0 上，从这条轨最后一个片段结束处开始；状态里没有时间线时为 `timeline.create`，新建包含该片段的 `t1`，视图随后选中它。两种形式都不是的请求不改变任何东西。

| 手势 | 记录 |
| --- | --- |
| 拖动片段边缘 | `timeline.clip_trim {clip, in_sec, out_sec}`（`clip` 是片段 ID）；未设置的一端不写；占位片段没有可拖的边缘 |
| 拖动片段 | `timeline.clip_move {clip, start_sec}`，拖到另一条视频轨上松手时带 `track`；在原来的轨道、原来的时间松手时不发送任何东西 |
| 选中片段或什么都没选时点拆分，或在片段的右键菜单里选 在播放头处拆分 / Split at playhead | `timeline.clip_split {clip, at_sec}`，`at_sec` 是播放头在片段素材内的时间；什么都没选时，拆分的是预览在播放头处显示的片段 |
| 对选中的片段按 Delete 或 Backspace、点工具栏的 删除片段 / Delete clip，或在其右键菜单中选 删除 / Delete | `timeline.clip_remove {clip}` |
| 把素材库里的视频拖到视频轨上 | `timeline.clip_add {timeline, asset, track, start_sec}`，`start_sec` 为放下的位置；非视频素材不发送任何东西，并显示 视频轨道只接受视频。音频请拖到声音轨道上。 / The video track takes videos only. Drag audio onto a sound track. |
| 在视频轨标题上点 ＋，再选一个视频 | `timeline.clip_add {timeline, asset, track, start_sec}`，`start_sec` 为这条轨最后一个片段结束处，空轨上为播放头处 |
| ＋ 新建、重命名、删除标签 | `timeline.create {timeline, assets: []}`（不带名称，标签显示 时间线 {n} / Timeline {n}）、`timeline.rename {timeline, name}`、`timeline.delete {timeline}` |
| 在音轨上点 ＋，再选一个音频素材或 上传本地音频 / Upload local audio | `timeline.sound_add {timeline, asset, start_sec, track}`；上传时先通过 `/api/dv/assets/import`（`surface: asset_pool`）导入文件 |
| 把素材库里的音频素材拖到音轨上 | `timeline.sound_add {timeline, asset, start_sec, track}`，`start_sec` 为放下的位置；另一次添加声音还在进行时，或项目没有时间线时，这次拖放不发送任何东西；非音频素材不发送任何东西，并显示 声音轨道只接受音频。 / A sound track takes audio only. 编辑器从拖动数据的 `application/x-dv-asset-mime` 值读取媒体类型。 |
| 对选中的声音按 Delete 或 Backspace、点工具栏的 删除声音 / Delete sound，或在其右键菜单中选 删除 / Delete | `timeline.sound_remove {sound}`（`sound` 是声音 ID） |
| 选中声音后点拆分，或在声音的右键菜单里选 在播放头处拆分 / Split at playhead | `timeline.sound_split {sound, at_sec}`，`at_sec` 是播放头在声音素材内的时间 |
| 拖动声音或它的边缘 | `timeline.sound_move {sound, start_sec}`，拖到另一条音轨那一行松手时带 `track`；拖动边缘发送 `timeline.sound_trim {sound, in_sec, out_sec}`，未设置的一端省略 |
| 重命名音轨 | `timeline.sound_track_rename {timeline, track, name}`；名称为空或未改变时不发送 |
| 删除音轨 / Delete track | `timeline.sound_track_remove {timeline, track}` |
| ＋ 添加轨道 / Add track 菜单里的 视频轨 / Video track 或 音轨 / Audio track | `timeline.track_add {timeline, kind: video \| sound}` |
| 轨道层级 / Track layers 里一条视频轨的上下箭头，或其标题右键菜单里的 上移 / Move up、下移 / Move down | `timeline.video_track_move {timeline, track, to}`，`to` 是 `track` 的上一条或下一条 |
| 视频轨或音轨标题上的喇叭按钮，或右键菜单里的静音项 | `timeline.mute {timeline, target: video_track \| sound, track, muted}` |
| 视频轨标题上的删除按钮，或其右键菜单里的 删除视频轨 / Delete video track | `timeline.video_track_remove {timeline, track}` |
| 视频轨右键菜单里的 在这里添加视频 / Add a video here，再选一个视频 | `timeline.clip_add {timeline, asset, track, start_sec}`，`start_sec` 是右键处的时间 |
| 音轨右键菜单里的 在这里添加声音 / Add a sound here，再选一个音频素材 | `timeline.sound_add {timeline, asset, start_sec, track}`，`start_sec` 是右键处的时间 |
| 导出 | 一次 `timeline.export {timeline}` 调用；链接打开导出的视频 |
| 对选中的过期片段点"仍然保留" | 对创建该片段素材的记录调用 `POST /api/dv/stale/accept`（`proj.stale_accept`） |

每条记录都带 `surface: 'timeline'`、视图旁边的对话（存为记录的 `session`；记录是项目当前位置之后的一步），以及一句用 DSH 界面语言说明手势的意图。`TimelineView` 显示打开项目的中间区域字段 `timeline` 指定的时间线，否则显示第一条时间线；用户在那里选中或新建的时间线经所有者属性 `note` 设置该字段，因此 shell 把它写进 URL，会话切换器的封面也跟随它。标签主体为每个项目保留自己的所选时间线，不影响中间区域。`TimelineView` 通过 `@dv/ui-kit/locale.ts` 跟随 `<html lang>`；切换时间线标签会停止播放，并重置预览和播放头。点一个片段会选中它，不发送任何请求。素材选择窗口和 添加声音 / Add sound 对话框在打开它们的 ＋ 右边打开，与那一行对齐；从轨道右键菜单打开时，开在右键的位置；在轨道区下半部分时往上打开，并且不超出轨道区。＋ 的选择窗口打开时获得焦点。用关闭按钮、焦点在窗口里、在 ＋ 上或在包含窗口的元素上时按 Esc、点击窗口外面或用 Tab 移出窗口来关闭它时，不插入素材。添加声音 / Add sound 对话框打开时同样获得焦点，用同样的方式关闭，不添加声音。素材没有时长时片段按五秒画，占位片段按它等待的渲染的 `duration_sec` 参数画，没有该参数时按五秒画；声音的素材没有时长时，按其 `<audio>` 元素测出的时长画，测不出时按五秒画。轨道延伸到最后一个片段或声音的结束处，取较晚者。

DOM 带测试 ID `dv-timeline-body`、`dv-timeline-editor`、`dv-timeline-viewer`、`dv-timeline-viewer-empty`、`dv-timeline-viewer-placeholder`、`dv-timeline-time`、`dv-timeline-exported`、`dv-timeline-export-waiting`、`dv-timeline-export-no-sounds`、`dv-timeline-ruler`、`dv-timeline-track-area` 和 `dv-timeline-playhead`；片段画面的每一格带 `data-filmstrip-frame`（帧的序号），每个片段块带 `data-clip`（片段 ID）、`data-clip-status`（`ready`、`rendering` 或 `failed`）和 `data-clip-stale`，每个声音块及其 `<audio>` 元素带 `data-sound`（声音 ID），每条音轨带 `data-sound-track`，其标题带 `data-sound-track-head`（音轨编号），每条视频轨的轨道带 `data-video-track`，其标题带 `data-video-track-head`（视频轨编号，最上面一条为 0），每个片段在预览里的 `<video>` 元素带 `data-track-clip`（片段 ID），每个标签带 `data-timeline`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

`TimelineBody` 持有来自 `@dv/ui-kit/useView.ts` 的视图会话，在 `TimelineEditor` 上方画项目栏。`TimelineView` 自己读取项目的当前状态。`placeClips` 按 `@dv/timeline` 的归约函数的方式摆放一条时间线的片段：每个片段从它的 `start_sec` 开始播放，同一轨道上前一个片段结束得更晚时从那里开始；占位片段取它等待的渲染计划的时长，状态里没有素材时长的片段取 `@dv/ui-kit/timeline.ts` 的 `FALLBACK_CLIP_SECONDS`。`topClipAt` 选出预览在某个时间显示的片段，即编号最小的轨道上的那个；`trackRows` 把时间线的 `track_order` 变成轨道区的各行。每个有素材的片段在预览画面里有一个 `<video data-track-clip>` 元素。`useTrackClipPlayback` 让正在显示的片段的元素跟着播放头：播放器暂停时暂停，否则按播放速度播放，与播放头相差超过 0.25 秒时重新定位；其他元素保持暂停。`trackClipPreload` 只在编号更小的轨道上的片段没有把这个片段全部盖住（`coveredClips`，编辑器在片段每次变化时算一次）、并且播放头在片段内或片段在播放头之后 5 秒内开始时，才让元素加载整个文件。`useTimelinePlayer(timelineId, span, rate, stalled)` 按播放速度跟着时钟移动播放头，直到 `span`（所有轨道中最后一个片段的结尾），`stalled` 返回 true 时停住播放头；编辑器传入的函数对正在显示的片段的元素调用 `clipStalled`，浏览器正从网络加载文件、且当前帧之后没有数据时它为 true。声音块的波形来自 `@dv/ui-kit/waveform.ts` 的 `clipPeaks` 和 `useAudioEnvelope`。`placeSounds` 摆放所显示时间线的声音；每个声音有一个隐藏的 `<audio>` 元素，播放器的位置、播放状态或速度改变时，`useSoundPlayback` 播放、暂停或定位每个元素，元素与播放头相差超过 0.25 秒时重新定位。每次编辑都是一次 `DvClient.runOperation` 调用，标签主体和中央视图在调用之后重新拉取状态。

| 文件 | 内容 |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | 注册 |
| [`src/client/InsertClipAction.tsx`](src/client/InsertClipAction.tsx) | 素材预览的 插入片段 操作（`dv.media.preview.action`） |
| [`src/client/definition.ts`](src/client/definition.ts) | 标签类型 |
| [`src/client/TimelineBody.tsx`](src/client/TimelineBody.tsx) | 标签主体：项目栏和编辑器 |
| [`src/client/TimelineView.tsx`](src/client/TimelineView.tsx) | 中央视图：状态、写入、中间区域字段 `timeline`，以及历史和 插入片段 的请求 |
| [`src/client/selection.ts`](src/client/selection.ts) | 标签主体为每个项目所选的时间线，以及中央视图请求的读取 |
| [`src/client/TimelineEditor.tsx`](src/client/TimelineEditor.tsx) | 编辑器：标签、预览、工具栏、标尺、轨道、手势 |
| [`src/client/timelines.ts`](src/client/timelines.ts) | `timelinesOf(state)`（`timeline` 切片中的时间线，`@dv/timeline` 未加载时为 `[]`）、片段摆放（`placeClips`）、某个时间显示的片段（`topClipAt`）、上面的轨道是否把片段全部盖住（`coveredAbove`）、轨道区的各行（`trackRows`）、声音摆放、时间码、`videoAssets(state)`（＋ 提供的视频素材，最新的在前），以及 `audioAssets(state)`（添加声音 / Add sound 对话框提供的音频素材，最新的在前） |
| [`src/client/sound-playback.ts`](src/client/sound-playback.ts) | 声音与播放器同步的预览播放 |
| [`src/client/track-clip-playback.ts`](src/client/track-clip-playback.ts) | 片段的 `<video>` 元素与播放器同步的预览播放：`useTrackClipPlayback`、`clipStalled` 和 `trackClipPreload` |
| [`src/client/records-in-use.ts`](src/client/records-in-use.ts) | 画布的 `RecordsInUse`：片段记录和裁剪标记 |
| [`src/client/canvas-node.tsx`](src/client/canvas-node.tsx) | `timeline` 节点类型及其重命名写入、它的卡片，以及画布添加菜单的分区 |
| [`src/client/history-row.ts`](src/client/history-row.ts) | 时间线记录的 `HistoryRow`：每个片段所属的时间线和选中记录的定位 |
| [`src/client/mention.ts`](src/client/mention.ts) | 对话输入框 `@` 菜单的片段提及类型 |
| [`src/client/filmstrip.ts`](src/client/filmstrip.ts) | 按固定间隔读出视频的帧，每个页面只读一次，第一帧画好就先给出；片段块把它们显示成一格一格 |
| [`src/client/player.ts`](src/client/player.ts) | 预览的播放头：`useTimelinePlayer`，按播放速度走的时钟，正在显示的片段加载时等待 |
| [`src/client/locales.ts`](src/client/locales.ts) | `dvTimeline` 词典 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@dv/api`](../api/README.zh.md) — 每个手势背后的路由。
- [`@dv/ui-kit`](../ui-kit/README.zh.md) — 客户端、轨道几何、波形和 hook。
- [`@dv/timeline`](../timeline/README.zh.md) — 编辑器调用的 `timeline.*` 操作，包括导出调用的 `timeline.export` 操作。
- [`@dv/ui-shell`](../ui-shell/README.zh.md) — 工作区中间区域、`dvCenter` 和 `dv.center.view` 插槽。
- [`@dv/ui-media`](../ui-media/README.zh.md) — 素材预览及其 `dv.media.preview.action` 插槽。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@dv/project`；其手势写下的记录只经由 [`@dv/project`](../project/README.zh.md) 的项目状态消息、项目更新消息以及 `dv_proj_*` 和操作工具到达模型。

#### KV Cache 影响

无；时间线不向模型发送任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **片段自带的声音不画出来** — 视频片段自带的声音随片段播放，由轨道标题静音，但没有哪一行显示它的波形或让人编辑它；字幕没有泳道。
- **导出不含声音** — `@dv/timeline` 的 `timeline.export` 不包含任何声音；工具栏的提示说明了这一点。
- **声音只随画面播放** — 预览只在某条视频轨上有就绪片段时才能播放，并且只播到所有视频轨中最后一个片段的结尾：没有就绪片段的时间线无法播放，超出这个结尾的声音在那里停止。
- **声音没有音量控制** — 预览以原音量播放每个声音；声音不能调音量，也不能淡入淡出。
- **片段不吸附，重叠在松手后才被拒绝** — 拖动的片段不会吸附到相邻的片段；会与同一轨道上另一个片段重叠的拖动照原样发送，由服务器拒绝，原因显示在编辑器上方。
- **波形在浏览器里解码** — 声音块为其声音画波形（`@dv/ui-kit/waveform.ts`）时，会下载这个声音的整个媒体文件，用 Web Audio API 解码其音频，一次解码一个素材，并在本次页面加载内按素材缓存在内存里；音频解码期间、解码失败时、媒体没有音轨时，声音块保持纯色块。媒体文件取不到时（网络错误或 5xx 状态），结果不进缓存：声音块在 2 秒、8 秒、30 秒后各重试一次，下次挂载时从头再试。
