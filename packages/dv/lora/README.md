---
description: "Community-LoRA registry of DreamVerse: the dvLora service that holds the adapters a deployment vouches for, the dv_lora_list and dv_lora_get tools for the agent, and the community-lora runtime skill that says when and how to apply an adapter to a shot."
kind: "package-reference"
---

# @dv/lora

English | [中文](README.zh.md)

## Summary

Use this package to publish the community LoRAs a DreamVerse deployment vouches for, so the agent can choose one for a shot and a video provider can offer it as the render's `extra.lora` parameter. The `dvLora` service holds one entry per adapter: its id, the name and description a creator reads, trigger words, default and allowed strength, the models and tasks it serves, licence and source. The row's config is the whole registry, so the deployment decides which third-party weights it serves. The package registers `dv_lora_list` and `dv_lora_get` and the `community-lora` runtime skill; it renders nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package once, before the video provider that reads it, with the adapters of the deployment. The DreamVerse bundle mounts it as row `dv-lora`:

```yaml
- id: dv-lora
  name: '@dv/lora'
  config:
    adapters:
      - id: fal/MiniMax-H3-Realism-People-LoRA
        displayName: Realism People
        description: Photoreal skin, faces and hands for people in a shot.
        triggerWords: [r34l1sm]
        defaultStrength: 1.0
        minStrength: 0
        maxStrength: 1.5
        targets:
          - model: fasth3
            tasks: [t2v, ref2v]
        license: other (see the source page)
        sourceUrl: https://huggingface.co/fal/MiniMax-H3-Realism-People-LoRA
```

| Field | Default | Meaning |
| --- | --- | --- |
| `adapters` | required | The community LoRAs this deployment publishes; an empty list leaves the registry empty |
| `adapters[].id` | required | The adapter id: the Hugging Face repo id or local path that the render server loads, and the id a render request names |
| `adapters[].displayName` | required | The name the agent and the user read |
| `adapters[].description` | `''` | What the adapter changes in a shot, and what it was trained on |
| `adapters[].triggerWords` | `[]` | The words the prompt must carry for the effect to show |
| `adapters[].defaultStrength` | `0.8` | The strength a request uses when it names the adapter without one |
| `adapters[].minStrength` / `maxStrength` | `0` / `2` | The strength range this deployment serves |
| `adapters[].targets` | required | The models, and the tasks of each, that the adapter is meant for |
| `adapters[].license` | `''` | The licence of the adapter's weights |
| `adapters[].sourceUrl` | `''` | The page the weights come from, for the attribution the licence asks for |

Loading fails when an id repeats, when `minStrength <= defaultStrength <= maxStrength` does not hold, when a target names a task the catalog does not declare, or when an id is empty. The provider [`@dv/fastvideo`](../fastvideo/README.md) reads the registry when it is mounted and narrows a server's allow-list to the adapters this registry publishes for the entry's model and task, so the two rows must agree on the id. The server's own config must allow the same id; a render fails at the server otherwise.

Two rules keep the registry honest. The id is the id the server loads, so it is also what a render request sends; a short nickname in the request would need a mapping that neither row owns. And the strength range is the range this deployment has tried, not the range the adapter's author describes: the registry is the deployment's promise, the server's allow-list is its enforcement.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`DvLora` extends the Cordis `Service` and registers itself as `dvLora`. Its constructor validates the config, freezes one entry per adapter, registers the two tools in the DSH tool registry and one skill in the DSH skill registry; each registration is a `ctx.effect`, so disposing the package removes the tools, the skill, and the service together. A provider reads the service with `ctx.get('dvLora')`, which is `undefined` when the deployment does not mount this package — the parameter then comes from the server's allow-list alone.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `Config`, `LoraDefinition`, the `dvLora` service, the `dv_lora_list` and `dv_lora_get` tools, and the `community-lora` skill registration |
| [`skills/community-lora.md`](skills/community-lora.md) | The skill body: when to apply an adapter, how to name and tune it, why community adapters trained on base H3 need a strength that suits 8-step FastH3, and why step-reduction adapters are not used |
| [`tests/lora.spec.ts`](tests/lora.spec.ts) | A Loader composition with the system prompt, both registries and the package: the registry, the tools, the skill, disposal, and the config refusals |

The tools return JSON through `defineTool`'s `json` output and use snake_case wire names (`display_name`, `trigger_words`, `default_strength`, `strength_range`, `targets`, `license`, `source_url`) because the agent reads them as JSON. `dv_lora_list` filters by `model` and `task` so the agent can ask for exactly the adapters a shot can use, and `dv_lora_get` names the served ids when the requested one is unknown, so a wrong id costs one call, not one wasted render.

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/fastvideo`](../fastvideo/README.md): the provider that offers `extra.lora` and sends the selection to its server.
- [`@dv/models`](../models/README.md): the model catalog that the targets name.
- [`dsh-tool-skill`](../../skill/tool-skill/README.md): how the agent sees the skill catalog and loads a skill.

-----

<a id="model-experience"></a>
## Model Experience

### The `dv_lora_list` and `dv_lora_get` tools

#### What the model sees

While the tool registry is mounted, the tool catalog lists both tools. Each record holds the adapter's `id`, `display_name`, `description`, `trigger_words`, `default_strength`, `strength_range`, `targets`, `license` and `source_url`, exactly as the config wrote them. The tool schema is generated from `defineTool`; see the generated [tool catalog](../../../docs/tool-catalog.md) for the parameter schemas. An id that the registry does not serve is refused in one sentence that lists the served ids:

##### Refusal of an unknown id

```markdown
dv-lora serves no adapter "nobody/none"; it serves: fal/MiniMax-H3-Realism-People-LoRA. Call dv_lora_list.
```

#### Token effect

About 120 tokens for the two tool schemas in the assembled request while the package is mounted. Each call adds its records: about 120 tokens per adapter in `dv_lora_list`, and about 80 tokens for one `dv_lora_get`.

#### KV Cache effect

The tool schemas are a stable prefix while the package is mounted, so mounting or removing it replaces the tool section once. Call results append as ordinary tool results; they do not invalidate the prefix before them.

### The `community-lora` skill

#### What the model sees

While the skill registry is mounted, the skill catalog lists the entry below. Calling the `skill` tool with `community-lora` returns the body of [`skills/community-lora.md`](skills/community-lora.md): when a shot should use an adapter, how to name it in `extra.lora` and tune its strength, why an adapter trained on 50-step base H3 needs a different strength on 8-step FastH3, and why "turbo" adapters are not used here. Users cannot invoke it with `/community-lora`; only the agent loads it.

##### Catalog entry

```markdown
- `community-lora`: When and how to apply a community LoRA to a shot: choosing an adapter, its trigger words and strength, and why step-reduction adapters are not used on FastH3.
```

#### Token effect

About 40 tokens in the catalog while the package and the skill registry are mounted, and about 900 tokens each time the agent loads the skill.

#### KV Cache effect

Mounting or removing the package changes the skill list, and `dsh-tool-skill` appends a replacement catalog; a loaded skill body is appended as a tool result. Both leave the cached prefix before them intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The registry does not load or verify weights.** It records what the deployment publishes; the render server's allow-list is the enforcement. An adapter that the server cannot load fails at the server, with the loader's message, after the request reaches it.
- **One adapter per shot.** FastVideo's side-branch LoRA layers hold one adapter at a time, and stacking a second adapter is refused. The registry has no field for a stack because no provider supports one.
- **No per-adapter prompt-skill entry.** The skill explains the shared rules; an adapter that needs a long workflow, such as a character-swap adapter trained with guide latents, is not described as usable, because FastVideo has no input path for that conditioning yet.
- **The registry is not the model's licence.** The MiniMax-H3 Community License and each adapter's own licence both apply. The registry records the adapter's licence and source for the attribution, not a legal review.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
