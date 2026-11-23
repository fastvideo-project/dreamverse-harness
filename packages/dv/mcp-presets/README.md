---
description: "MCP presets of DreamVerse: offers configured MCP servers (Blender, ComfyUI) for one-step adding while the MCP plugin is on."
kind: "package-reference"
---

# @dv/mcp-presets

English | [中文](README.zh.md)

## Summary

Use this package to choose which MCP servers DreamVerse suggests. While the MCP plugin is on, it offers its configured presets to the [MCP server roster](../../mcp/mcp-servers/README.md) through `ctx.mcpServers.offerPresets()`, and [`@dv/ui-mcp-presets`](../ui-mcp-presets/README.md) shows each one on the MCP page as a card that adds the server in one step. While the MCP plugin is off, the row stays active and offers nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The `dv-mcp-presets` row of [`@dv/bundle`](../../bundle/dv/README.md) configures the presets:

| Field | Default | Meaning |
| --- | --- | --- |
| `presets` | `{}` | Presets by the server name each adds; each has a `title`, a `description`, and a `spec` (a stdio or `streamable-http` server spec, as in the roster) |

DreamVerse offers `blender` (`uvx mcp-for-blender@2.1.9`, which needs a running Blender with the MCP for Blender add-on on port 9876) and `comfyui` (`uvx comfy-mcp@0.10.0`, which drives the ComfyUI at 127.0.0.1:8188). Both start through `uvx`, which must be on the harness PATH.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`apply` waits for the optional `mcpServers` service with `ctx.inject` and offers the presets in an effect of that scope, so switching the MCP plugin off withdraws them and switching it on offers them again. The row declares no required service, so it activates whether or not the MCP plugin is on.

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP server roster](../../mcp/mcp-servers/README.md) — how presets are listed and added.

-----

<a id="model-experience"></a>
## Model Experience

None, as offering a preset adds no server; a person adds it, and the roster's servers own every model-facing tool.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The preset titles and descriptions are English; the MCP page cards of [`@dv/ui-mcp-presets`](../ui-mcp-presets/README.md) carry their own Chinese and English copy for `blender` and `comfyui`.
