---
description: "Standalone MiniMax H3 skill-set plugin: nine discoverable skills, lazy instructions, bounded references and optional template previews."
kind: "package-reference"
---

# @dv/minimax-skills

English | [中文](README.zh.md)

## Use this plugin

Install one package to register all nine pinned MiniMax skills with the existing central skill registry. The Host requires only `skills`; it has no runtime dependency on DreamVerse's project, canvas, image, audio or video plugins. The reference tool and the preview routes activate only when their existing services are present.

The package declares its own `dsh.bundle` patch, so installing it selects the bundle and mounts two plugin rows automatically: this Host plugin and its browser package [`@dv/ui-minimax-skills`](../ui-minimax-skills/README.md). For manual composition, the equivalent rows are:

```yaml
- id: minimax-skills
  name: '@dv/minimax-skills'
- id: ui-minimax-skills
  name: '@dv/ui-minimax-skills'
```

In this workspace, run `pnpm exec tsc -b packages/dv/minimax-skills packages/dv/ui-minimax-skills` followed by `pnpm --filter @dv/ui-minimax-skills run bundle` before mounting the compiled plugins. To install a local distribution, run `pnpm --filter @dv/minimax-skills pack --pack-destination /tmp` and install the resulting archive with `dsh plugin --profile <profile> add <archive>`. The package is prepared for distribution; this change does not publish it to an npm registry.

The normal `tool-skill` integration lists these skills for the model and handles explicit `/name` messages. For example, send `/h3-prompt-writing Write a product-video prompt`. Selecting a template on Home or in the MiniMax Explore tab puts the corresponding `/name ` in the current draft; add requirements and send to invoke it. Selecting a card neither creates a project nor starts generation. Individual SKILL.md imports remain a separate, generic skill-import concern and do not require this package.

## Loading and resources

Plugin activation reads only `assets/catalog.json`, the metadata projected from the pinned skill headers. Listing skills does not read any SKILL.md body. `ctx.skills.get()` loads the requested skill with the existing filesystem provider, then appends this package's DreamVerse compatibility adapter. Other skill bodies and reference files remain unloaded. The standard slash handler injects the selected instructions; normal model selection uses the existing `skill` tool. No separate MiniMax agent or media execution engine is introduced.

When the tool registry is present, `dv_skill_read_reference` reads required `references/` or `agents/` text documents. Pass both `skill` (an exact bundled skill name) and `path` (relative to that skill). The reader checks the active registry winner, resolved path containment and a byte limit; unknown skills, traversal and cross-skill reads are refused. It never executes bundled scripts.

The browser package `@dv/ui-minimax-skills` owns the labels and cards. This plugin serves exactly the packaged preview GIFs through authenticated `GET /api/minimax/previews/<skill>.gif` Connection routes. No web application's public directory or media provider needs MiniMax-specific assets or routes. Removing the plugin removes its catalog, reference tool, preview routes and UI contributions. Previously recorded instructions remain in durable conversation history; use a fresh conversation when verifying a baseline without the plugin.

## Configuration and compatibility

| Field | Default | Behavior |
| --- | --- | --- |
| `referenceMaxBytes` | `1048576` | Maximum bytes returned by one reference read |

A skill runs only when the user sends `/name` or the model loads it through the `skill` tool. The plugin reads and writes no project data. The original integration's regex-based auto routing is replaced by normal metadata-based model discovery.

Official resource provenance is recorded in `assets/SOURCE.json`; the upstream skill files are unchanged. After intentionally updating the pin, regenerate metadata with `pnpm --filter @dv/minimax-skills run catalog:generate`. The plugin's own compatibility adapter is separate from upstream instructions.

## Model Experience

The model receives the standard skill catalog of names and descriptions. It receives a complete MiniMax workflow and compatibility guidance only after loading that skill. Required reference text is returned by the bounded reference tool. Existing generation tools perform all media work and retain their own arguments and approval rules.

### KV Cache effect

Catalog summaries use the existing skill-catalog lifecycle. Loaded instructions and references add context only when requested; installing the package does not inject all nine instruction bodies.

## Known Limitations and Deferred Work

- **Deployment capabilities** — The skills reference MiniMax Hub capabilities that a deployment may not provide. The adapter maps existing DreamVerse tool names and requires the agent to check actual model support and disclose missing capabilities. Installing the package does not install, configure or authorize image/video/audio services, standalone music generation, subtitle rendering or arbitrary Hub edits. Optional template UI uses the generic `dv.templates` Home slot and the DreamVerse Explore slot; headless use needs no browser. No invariant companion is published because the package owns no independent runtime projection; catalog ownership, lazy reads and removal are verified through actual Loader composition tests.
