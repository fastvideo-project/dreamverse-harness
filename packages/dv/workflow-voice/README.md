---
description: "Voice workflow skill of DreamVerse: serves skills/voice-acting/SKILL.md, the procedure for a shot whose dialogue the user performs and voice.convert speaks in an allowed voice, through one FileSystemSkillProvider while the DSH skill registry is mounted."
kind: "package-reference"
---

# @fastvideo/dreamverse-workflow-voice

English | [中文](README.zh.md)

## Summary

Use this package to teach the agent voice acting: the user records a line, [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.md) speaks it in an allowed voice, the user picks a take, and the shot reuses the take unchanged as its soundtrack with the `fully_copy` audio relationship of the video model's prompt skill. While the DSH skill registry `skills` is mounted, one `FileSystemSkillProvider` (provider name `workflow-voice`) serves the package's `skills/` folder and no other folder.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin with `@fastvideo/dreamverse-voice-convert`, a provider of task `a2a` such as [`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.md), and a video model whose references take audio; the DreamVerse bundle does not mount it.

```yaml
- id: dv-workflow-voice
  name: '@fastvideo/dreamverse-workflow-voice'
```

The plugin has no configuration. The one skill is `voice-acting`: the recording (one per line and character, at most 15 seconds), the voice (only the voices that `dv_models_get` lists), the conversion (two or three takes, the user's choice), the shot (a picture of a fictional character or the place, the take marked `fully_copy`, the exact words in `<d>`), and what is not available.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`apply` registers the provider inside `ctx.inject(['skills'])`, so the skill exists while the registry is mounted and leaves with the plugin. The provider has `includeDefaultRoots: false` and one custom folder, the package's `skills/`.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The plugin: name, empty config and the provider registration |
| [`skills/voice-acting/SKILL.md`](skills/voice-acting/SKILL.md) | The voice-acting procedure |
| [`tests/workflow-voice.spec.ts`](tests/workflow-voice.spec.ts) | A Loader composition with the skill registry: the served files, a user skill folder that it does not read, and the removal on disposal |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.md) and [`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.md): the tool and the model that the skill calls.
- [`@fastvideo/dreamverse-ui-voice-convert`](../ui-voice-convert/README.md): the Voice tab where the user records the line.
- [`@dv/workflow-story`](../workflow-story/README.md): the story and ad workflow skills of the same form.

-----

<a id="model-experience"></a>
## Model Experience

### Skill catalog

#### What the model sees

While the skill registry is mounted, the skill catalog lists `voice-acting` with its description; the agent loads the body with the `skill` tool.

##### Catalog entry

```markdown
- `voice-acting`: The procedure for a shot whose dialogue the user performs: the user's recording of the line, its conversion into an allowed voice with dv_voice_convert, the user's choice of take, and a shot that reuses the chosen take unchanged as its soundtrack. For requests such as 'use my recording as the character's voice', 'I'll voice this line myself' or 'make this line sound like <voice>'.
```

#### Token effect

About 80 tokens in the catalog, and about 900 tokens each time the agent loads the skill.

#### KV Cache effect

Mounting or removing the plugin changes the skill list, and `dsh-tool-skill` appends a replacement catalog; a loaded skill body is appended as a tool result. Both leave the cached prefix before them intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No audio cutting**: the skill asks the user to record one line per shot, because no operation cuts or joins audio.
