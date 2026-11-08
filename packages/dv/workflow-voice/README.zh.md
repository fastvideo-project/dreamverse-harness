---
description: "DreamVerse 的配音工作流技能：在 DSH 技能注册表挂载期间，通过一个 FileSystemSkillProvider 提供 skills/voice-acting/SKILL.md，即对白由用户表演、由 voice.convert 用允许的音色说出的镜头的流程。"
kind: "package-reference"
---

# @fastvideo/dreamverse-workflow-voice

[English](README.md) | 中文

## 概要

使用本包教智能体配音：用户录下一句台词，[`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.zh.md) 用允许的音色把它说出来，用户选一个版本，镜头按视频模型提示词技能中的 `fully_copy` 音频关系，原样把该版本用作音轨。在 DSH 技能注册表 `skills` 挂载期间，一个 `FileSystemSkillProvider`（提供方名称 `workflow-voice`）提供本包的 `skills/` 文件夹，不读取其他文件夹。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

与 `@fastvideo/dreamverse-voice-convert`、一个任务 `a2a` 的提供方（例如 [`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.zh.md)）以及一个参考输入接受音频的视频模型一起挂载本插件；DreamVerse 套件默认不挂载它。

```yaml
- id: dv-workflow-voice
  name: '@fastvideo/dreamverse-workflow-voice'
```

插件没有配置。唯一的技能是 `voice-acting`：录音（每句台词、每个角色一段，最长 15 秒）、音色（只能用 `dv_models_get` 列出的音色）、转换（两到三个版本，由用户选择）、镜头（虚构角色或场景的画面，版本标为 `fully_copy`，`<d>` 中写准确的台词），以及不支持的事项。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`apply` 在 `ctx.inject(['skills'])` 中注册提供方，所以技能在注册表挂载期间存在，并随插件一起移除。提供方设置 `includeDefaultRoots: false`，只有一个自定义文件夹，即本包的 `skills/`。

| 文件 | 内容 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 插件：名称、空配置和提供方注册 |
| [`skills/voice-acting/SKILL.md`](skills/voice-acting/SKILL.md) | 配音流程 |
| [`tests/workflow-voice.spec.ts`](tests/workflow-voice.spec.ts) | 一个带技能注册表的 Loader 组合：提供的文件、不读取的用户技能文件夹，以及卸载时的移除 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.zh.md) 和 [`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.zh.md)：技能调用的工具和模型。
- [`@fastvideo/dreamverse-ui-voice-convert`](../ui-voice-convert/README.zh.md)：用户录制台词的配音标签页。
- [`@dv/workflow-story`](../workflow-story/README.zh.md)：同样形式的故事和广告工作流技能。

-----

<a id="model-experience"></a>
## 模型体验

### 技能目录

#### 模型看到什么

技能注册表挂载期间，技能目录列出 `voice-acting` 及其描述；智能体用 `skill` 工具加载正文。

##### 目录条目

```markdown
- `voice-acting`: The procedure for a shot whose dialogue the user performs: the user's recording of the line, its conversion into an allowed voice with dv_voice_convert, the user's choice of take, and a shot that reuses the chosen take unchanged as its soundtrack. For requests such as 'use my recording as the character's voice', 'I'll voice this line myself' or 'make this line sound like <voice>'.
```

#### Token 影响

目录中约 80 个 token，智能体每次加载技能约 900 个 token。

#### KV 缓存影响

挂载或移除插件会改变技能列表，`dsh-tool-skill` 追加一份替换目录；加载的技能正文作为工具结果追加。两者都不影响它们之前的缓存前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **不能剪切音频**：技能要求用户每个镜头录一句台词，因为没有剪切或拼接音频的操作。
