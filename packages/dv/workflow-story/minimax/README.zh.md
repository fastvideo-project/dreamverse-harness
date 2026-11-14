# 可选 MiniMax H3 Skills

[English](README.md) | 中文

本集成复用现有 DreamVerse Web 对话、Agent、Skill 注册表和媒体后端，不增加 UI 或生成后端。官方 [MiniMax H3 Skills](https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills) 原样保存在 `skills/`，包括中文说明、references 和元数据。[SOURCE.json](SOURCE.json) 固定上游版本；独立的 [compatibility.md](compatibility.md) 说明 DreamVerse 工具映射。

## 启动

Web 用户直接在首页的“视频类型”或“新建项目”对话框选择即可，无需设置环境变量。默认选项关闭 MiniMax Skills；选择后创建项目，首条消息加载对应 Skill。选择随项目保存，刷新和新建会话都会沿用，工作区顶部显示当前类型；需要换 Skill 时新建项目。项目选择优先于下面的环境变量，网页不选类型时即使环境变量是 `manual` 或 `auto` 也关闭。以下启动变量仅作为没有项目级选择记录的旧项目/API 项目的默认配置。

在仓库根目录运行：

```bash
# 自动选择，通过现有 Web 界面使用。
DV_MINIMAX_SKILLS_MODE=auto scripts/video-harness/launch.sh web

# 指定一个完整 Skill 名称。
DV_MINIMAX_SKILLS_MODE=manual DV_MINIMAX_SKILL=3d-animation-short-generator scripts/video-harness/launch.sh web

# 原有行为；未设置开关时也是这个默认值。
DV_MINIMAX_SKILLS_MODE=off scripts/video-harness/launch.sh web
```

使用同一端口重启前，先停止原进程。默认本机地址为 `http://localhost:8092`，现有 `DV_PORT` 和主机设置继续生效。也可在 `DV_ENV_FILE` 中配置，启动命令显式传入的值优先于文件值。`DV_MINIMAX_SKILLS_MODE` 默认是 `off`。`manual` 要求 `DV_MINIMAX_SKILL` 是官方完整名称，缺失或无效名称会导致激活失败；`auto` 和 `off` 忽略该名称。无效模式会导致配置校验失败。旧的 `DV_MINIMAX_SKILLS_ENABLED` 变量不再使用。

## 选择规则

自动路由依据官方描述和视频类别，按固定优先级匹配中英文创作意图，不区分英文大小写。请求中的完整 Skill 名称优先于关键词，手动模式的指定名称优先于两者。当前 Agent 的目录和上下文只加入选中的官方 Skill，其他 DreamVerse 技能与工具继续可用。不匹配的首次请求或明确新请求沿用原流程；确认、创作信息补充、修改和素材回复保留已选流程，取消或明确切换话题会清除选择。这是保守的关键词匹配，不是语义分类；有歧义时使用手动模式或完整 Skill 名称。重开会话时，若上下文仍包含选择记录即可继续；压缩后记录已不存在时需重新指明名称。

| 完整名称 | 自动触发示例 |
| --- | --- |
| `h3-prompt-writing` | 帮我写 H3 视频提示词 |
| `handdrawn-live-video-generator` | 做手绘发光动画与实拍融合视频 |
| `minimalist-product-ad-generator` | 做苹果风产品广告 |
| `brand-promo-video-generator` | 做品牌宣传片 |
| `3d-animation-short-generator` | 制作 3D 动画短片 |
| `music-video-subtitle-generator` | 制作带歌词字幕的音乐视频 |
| `papercraft-stop-motion-explainer` | 制作纸艺定格解说视频 |
| `paper-collage-explainer-generator` | 制作纸张拼贴解说视频 |
| `co-op-game-intro-generator` | 制作合作游戏介绍视频 |

服务端日志记录 `MiniMax skill: <name>; mode=...; revision=...; session=...`、逐技能能力检查、成功读取的参考文件，以及带会话和调用 ID 的工具执行结果。操作标签覆盖规划材料、确认、图片／视频／音频请求和时间线拼接。这些标签记录实际工具操作，不推断语义阶段已完成；生成请求提交成功不代表后台任务成功。完整调用、返回错误和任务状态保留在现有会话日志中，摘要日志不复制提示词、凭据或原始工具参数。

原始指令、来源版本和能力检查结果作为 `dv-minimax-skill` 上下文消息保存。启用项目在首次模型请求前注册当前 Agent 专用的 `dv_minimax_read_reference`；关闭项目不展示该工具。它只能读取当前 Agent 所选 Skill 的文档。不增加日志服务或工作流引擎。

## 手工对比

开启后，在现有 Web 界面新建 Project，例如输入：`帮我做一个15秒的手绘发光动画与实拍融合视频，场景是厨房水槽。` 按 Skill 要求逐步确认，按需提供参考素材，通过已配置的后端生成视频。随后停止 Harness、关闭开关并重启，用相同提示词、素材和模型设置新建另一个 Project，手工比较两次输出。关闭开关不会删除旧对话中已经保存的 Skill 指令，因此 baseline 必须使用新的 Project 和对话。

## 兼容性限制

选中 Skill 不代表完整支持 MiniMax Hub。可用任务、尺寸、时长和模型由现有模型目录决定；默认 UniServe `fasth3/ref2v` 路由需要参考素材。图片及音频服务需预先配置并可访问。Agent 使用现有提问工具或聊天回复保留确认节点。

现有工具覆盖图片与视频生成、画布文本及媒体、片段裁剪和时间线拼接。逐技能检查验证当前 Agent 的工具注册情况，不调用付费服务，也不证明服务可达；Agent 仍须在生成前检查模型能力。Hub 画布分组、独立音乐生成、节拍分析、音轨替换、转录、字幕烧录和通用媒体分析没有映射。时间线导出的重新编码兜底会丢失音频。例如 3D 短片要求匹配 BGM 和最终音频合成，仅靠此集成不能完成该完整交付。缺失的必要能力必须在付费生成前说明，停止或与用户明确约定有限交付／前期制作材料，不能声称完整流程已完成。本集成不会自动生成视频或评估画质。
