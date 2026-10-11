---
description: "DreamVerse MCP tools in the entry page's Explore section: Blender and ComfyUI cards, with a switch for the MCP plugin while it is off and one-click adding while it is on."
kind: "package-reference"
---

# @dv/ui-mcp-presets

English | [中文](README.zh.md)

## Summary

Use this package to show the MCP tools that DreamVerse suggests in the entry page's 探索 / Explore section. It registers the MCP tab in the `dv.explore` slot of [`@dv/ui-shell`](../ui-shell/README.md), with a card for Blender and a card for ComfyUI. While the MCP plugin is off, a notice row explains what the tools need and offers 开启 MCP / Turn on MCP, and the cards are dimmed. While the MCP plugin is on, a card adds its preset to the [MCP server roster](../../mcp/mcp-servers/README.md), and an added card opens the MCP page. Without this package, 探索 has no MCP tab.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app` and `@dv/ui-shell`. Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-mcp-presets
  name: '@dv/ui-mcp-presets'
```

The Host half registers nothing. The presets themselves come from the `dv-mcp-presets` row of [`@dv/mcp-presets`](../mcp-presets/README.md); each card's name must match one of that row's presets.

| Gesture | Request |
| --- | --- |
| 开启 MCP / Turn on MCP | `pluginManager.setBundleEnabled('@deepseek-ai/dsh-mcp-bundle', true)`; the notice row disappears when the `mcpServers` Remote appears. A failure, or no answer within 30 seconds, shows MCP 开启失败。请重试，或到插件页查看。 / Could not turn on MCP. Try again, or check it in Plugins. with a link to the Plugins page and the error text as its tooltip |
| Choose a card that is not added | `mcpServers.addPreset(<name>)`; the card shows 添加中… / Adding…, then the server's connection phase. A failure shows 添加失败，点击重试 / Could not add; click to retry |
| Choose an added card | Opens the MCP page |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`followMcpShelf` wires the switch through `ctx.inject(['remote', 'remote.pluginManager'])` and follows the roster through `ctx.inject(['remote', 'remote.mcpServers'])`, so the cards unlock when the MCP plugin's Remote mounts and lock again when it unmounts. The page links select the DSH main panel through the `layout` service.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The Host half, which registers nothing |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | The type of the CSS Module imports |
| [`src/client/index.ts`](src/client/index.ts) | Registration of the MCP tab in `dv.explore` |
| [`src/client/shelf.ts`](src/client/shelf.ts) | The MCP plugin switch, the add requests, and the roster stream |
| [`src/client/McpShelf.tsx`](src/client/McpShelf.tsx) | The notice row, the tool cards, and their Chinese and English copy |
| [`src/client/McpShelf.module.css`](src/client/McpShelf.module.css) | Styles of the notice row and the cards |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/mcp-presets`](../mcp-presets/README.md) — the presets this package's cards add.
- [MCP server roster](../../mcp/mcp-servers/README.md) — how presets are listed and added.
- [`@dv/ui-shell`](../ui-shell/README.md) — the entry page and its `dv.explore` slot.

-----

<a id="model-experience"></a>
## Model Experience

None, as the cards only add servers to the MCP server roster, and the roster's servers own every model-facing tool.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Fixed tool list** — the cards and their copy are fixed in `src/client/McpShelf.tsx`; a preset added to the `dv-mcp-presets` row needs a card here before 探索 shows it.
