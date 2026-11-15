---
description: "Blender workflow skill of DreamVerse: serves skills/blender-scenes/SKILL.md, the procedure for building, checking and rendering a scene in the user's connected Blender, through one FileSystemSkillProvider while the DSH skill registry is mounted."
kind: "package-reference"
---

# @fastvideo/dreamverse-workflow-blender

English | [中文](README.zh.md)

## Summary

Use this package to teach the agent to work in the user's connected Blender: read the scene before changing it, change it in small Python steps, look at the result, and render stills and animations into the project with the tools of [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.md). While the DSH skill registry `skills` is mounted, one `FileSystemSkillProvider` (provider name `workflow-blender`) serves the package's `skills/` folder and no other folder.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin with `@fastvideo/dreamverse-blender-bridge`; [`@fastvideo/dreamverse-blender`](../blender/README.md) inserts both.

```yaml
- id: dv-workflow-blender
  name: '@fastvideo/dreamverse-workflow-blender'
```

The plugin has no configuration. The one skill is `blender-scenes`: what to do while no Blender is connected, reading the scene before a change, one small `dv_blender_run` change per call, looking after each visible change, and rendering stills and short animations into the project.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`apply` registers the provider inside `ctx.inject(['skills'])`, so the skill exists while the registry is mounted and leaves with the plugin. The provider has `includeDefaultRoots: false` and one custom folder, the package's `skills/`.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The plugin: name, empty config and the provider registration |
| [`skills/blender-scenes/SKILL.md`](skills/blender-scenes/SKILL.md) | The Blender procedure |
| [`tests/workflow-blender.spec.ts`](tests/workflow-blender.spec.ts) | A Loader composition with the skill registry: the served files, a user skill folder that it does not read, and the removal on disposal |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@fastvideo/dreamverse-blender-bridge`](../blender-bridge/README.md): the tools and operations that the skill calls.
- [`@dv/workflow-story`](../workflow-story/README.md): the story and ad workflow skills of the same form.

-----

<a id="model-experience"></a>
## Model Experience

### Skill catalog

#### What the model sees

While the skill registry is mounted, the skill catalog lists `blender-scenes` with its description; the agent loads the body with the `skill` tool.

##### Catalog entry

```markdown
- `blender-scenes`: The procedure for building, checking and rendering a 3D scene in the Blender that the user connected to the harness: read the scene, change it in small Python steps, look at the result, and render stills or animations into the project. For requests such as 'build a scene in Blender', 'add a camera move', 'light this set', or 'render this shot from Blender'.
```

#### Token effect

About 80 tokens in the catalog, and about 800 tokens each time the agent loads the skill.

#### KV Cache effect

Mounting or removing the plugin changes the skill list, and `dsh-tool-skill` appends a replacement catalog; a loaded skill body is appended as a tool result. Both leave the cached prefix before them intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **English only**: the skill body is English, like the other DreamVerse workflow skills.
