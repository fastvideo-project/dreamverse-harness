---
description: "Workflow skills of DreamVerse: one FileSystemSkillProvider serves each skills/<name>/SKILL.md, such as story-directing and ad-making, as a skill; open it to add or change a workflow's order of calls."
kind: "package-reference"
---

# @dv/workflow-story

English | [中文](README.zh.md)

## Summary

Use this package to give the DreamVerse agent its workflows. Each workflow is one skill file `skills/<name>/SKILL.md` that holds the order of calls of the workflow, such as `story-directing` (a story rendered shot by shot onto a timeline) and `ad-making` (a short product ad). The default registers no operation or tool; the optional MiniMax integration adds a restricted reference-document reader.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a composition with the skill registry `skills` of `@deepseek-ai/dsh-skill`. By default, the plugin serves every `<name>/SKILL.md` of its [`skills/`](skills/) folder through one `FileSystemSkillProvider` named `workflow-story`; that provider reads no other folder. The Web project creation menu selects one MiniMax skill or explicitly off; this immutable project choice takes precedence. Optional `minimaxSkillsMode` (`off`, `manual`, `auto`; default `off`) and `minimaxSkill` supply defaults for projects without a saved choice, from `DV_MINIMAX_SKILLS_MODE` and `DV_MINIMAX_SKILL`. See the [MiniMax integration](minimax/README.md).

```yaml
- id: dv-workflow-story
  name: '@dv/workflow-story'
```

To add a workflow, add `skills/<name>/SKILL.md` with the frontmatter fields `name` and a quoted `description`; the provider serves the file with no code change. Then run `pnpm exec vitest run packages/bundle/dv/tests/skills.spec.ts -u` once to write its snapshot `packages/bundle/dv/tests/expected/skills/<name>.txt`. A skill names a `dv_*` tool of a package outside this package's `dependencies` only on a line that starts with "If `<tool>` is in your tool list" (rule R8g of `scripts/dv-architecture.ts`).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`apply` waits for `skills` and registers the provider as an effect, so the skills leave with the plugin or with the registry. The `dependencies` of `package.json` name the packages whose tools the skills call without a guard: `@dv/project` (`dv_proj_*`), `@dv/shot-render` (`dv_shot_render`) and `@dv/timeline` (`dv_timeline_*`).

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The plugin: the skill provider over `skills/` |
| [`skills/story-directing/SKILL.md`](skills/story-directing/SKILL.md) | The `story-directing` skill |
| [`skills/ad-making/SKILL.md`](skills/ad-making/SKILL.md) | The `ad-making` skill |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/shot-render`](../shot-render/README.md): `dv_shot_render` and its `continue_from` argument.
- [`@dv/timeline`](../timeline/README.md): `dv_timeline_create`, `dv_timeline_update` and `dv_timeline_export`.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

By default the tool list is unchanged. Enabling MiniMax adds `dv_minimax_read_reference`; execution requires a selected skill and is limited to that Agent's selected skill documents.

#### Token effect

No tokens by default; enabling MiniMax adds one reference-reader tool definition.

#### KV Cache effect

The tool section is unchanged by default. Enabling MiniMax changes it once; routing does not change the tool definitions.

### Tool results

#### What the model sees

By default no tool result comes from this package. The optional reference reader returns the requested original document as text.

#### Token effect

No tokens by default; reference reads append the document's text when requested.

#### KV Cache effect

Optional reference results append to the conversation without changing earlier history.

### Skill

#### What the model sees

The skill catalog lists each workflow skill with its description. When the agent loads `story-directing`, it reads the order of calls: `dv_textnode_write` for the text nodes `story/theme.md`, `story/beats.md` and `story/storyboard.md`, each built from the text that `dv_textnode_read` returns for the stage before it and naming that stage in `from`; a summary and one question in bold, and no generation before the user agrees; then, for each shot in story order, `dv_shot_render` and `dv_proj_wait`, where before a shot that continues the previous one the agent inspects the previous shot's ending with `dv_asset_grab_still` (and `dv_inspect_asset` and `dv_inspect_image` when they are in its tool list) and renders the shot with `continue_from`, and after that shot it reviews the boundary between the two shots and, for a failed boundary, proposes one repair and waits for the user; then `dv_timeline_create`. It also tells the agent how to extend, shorten or change a story on a timeline.

#### Token effect

One line in the skill catalog per workflow skill while the plugin is mounted, at most 400 code points (about 60 tokens for `story-directing`); each load adds the body of the skill, under 8192 code points (about 1800 tokens for `story-directing`). [`skills.spec.ts`](../../bundle/dv/tests/skills.spec.ts) of `@dv/bundle` checks both limits.

#### KV Cache effect

The catalog entry sits in the stable skill section; mounting or removing the plugin changes the catalog. A loaded skill is appended to the conversation as a tool result; the cached prefix stays intact.

When MiniMax is enabled for a project, routing adds only the selected official skill to the Agent's catalog and appends its original instructions with separate compatibility notes as a logged context message. Confirmations retain it. Off projects receive neither MiniMax skill instructions nor the scoped reference reader. See the [selection and compatibility rules](minimax/README.md).

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Story text lives in the reply** — the agent writes the story or the ad spec in its reply, so the project keeps no record of it.
