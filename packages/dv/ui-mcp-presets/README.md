---
description: "DreamVerse's suggested MCP servers on the MCP page: Blender and ComfyUI cards that add their preset to the MCP roster in one click."
kind: "package-reference"
---

# @dv/ui-mcp-presets

English | [中文](README.zh.md)

## Summary

Use this package to show the MCP servers that DreamVerse suggests on the MCP page. It adds a DreamVerse 推荐 / Suggested by DreamVerse section to the `mcp.page.section` slot of the [MCP page](../../client/ui-mcp-servers/README.md), above the server roster, with a card for Blender and a card for ComfyUI. A card adds its preset to the [MCP server roster](../../mcp/mcp-servers/README.md), and an added card shows the server's connection state. The MCP page, and so the section, exists only while the MCP plugin is switched on in Plugins. Without this package, the MCP page suggests no servers.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile that stacks `dsh-web-app`; the section appears once the MCP bundle is switched on. Build the browser bundle first: `pnpm run build` writes `lib/client.js`.

```yaml
- id: dv-ui-mcp-presets
  name: '@dv/ui-mcp-presets'
```

The Host half registers nothing. The presets themselves come from the `dv-mcp-presets` row of [`@dv/mcp-presets`](../mcp-presets/README.md); each card's name must match one of that row's presets.

| Gesture | Request |
| --- | --- |
| Choose a card that is not added | `mcpServers.addPreset(<name>)`; the card shows 添加中… / Adding…, then the server's connection phase. A failure, or no answer within 30 seconds, shows 添加失败，点击重试 / Could not add; click to retry, with the error text as its tooltip |

Until the roster arrives, the cards show 正在读取… / Loading… and cannot be chosen; an added card cannot be chosen.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`followMcpShelf` follows the roster through `ctx.inject(['remote', 'remote.mcpServers'])`, which mounts with the MCP plugin, as the MCP page does. The type of the `mcp.page.section` slot comes from `@deepseek-ai/dsh-client-ui-mcp-servers/client`, a type-only import.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The Host half, which registers nothing |
| [`src/css-modules.d.ts`](src/css-modules.d.ts) | The type of the CSS Module imports |
| [`src/client/index.ts`](src/client/index.ts) | Registration of the section in `mcp.page.section` |
| [`src/client/shelf.ts`](src/client/shelf.ts) | The add requests and the roster stream |
| [`src/client/McpShelf.tsx`](src/client/McpShelf.tsx) | The section, the tool cards, and their Chinese and English copy |
| [`src/client/McpShelf.module.css`](src/client/McpShelf.module.css) | Styles of the section and the cards |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/mcp-presets`](../mcp-presets/README.md) — the presets this package's cards add.
- [MCP server roster](../../mcp/mcp-servers/README.md) — how presets are listed and added.
- [MCP page](../../client/ui-mcp-servers/README.md) — the page and its `mcp.page.section` slot.

-----

<a id="model-experience"></a>
## Model Experience

None, as the cards only add servers to the MCP server roster, and the roster's servers own every model-facing tool.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Fixed tool list** — the cards and their copy are fixed in `src/client/McpShelf.tsx`; a preset added to the `dv-mcp-presets` row needs a card here before the MCP page suggests it.
