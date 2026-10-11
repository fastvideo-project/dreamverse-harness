---
description: "Add the sidebar's MCP entry and its page, which list MCP servers and add, remove, or reconnect them."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mcp-servers

English | [中文](README.zh.md)

## Summary

This Client plugin adds an **MCP** entry to the sidebar below **Plugins**; it opens the MCP page with the server dashboard. The same dashboard also appears on the [MCP bundle](../../mcp/mcp-bundle/README.md)'s page in Plugins. It mounts the generated `mcpServers` Remote of [`dsh-mcp-servers`](../../mcp/mcp-servers/README.md), follows the roster, and offers **Add server**, **Reconnect**, and **Remove**. Its rows use the plugin page's own row metrics, so the roster reads as part of that page.

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

Switch on **MCP** in Plugins; the **MCP** entry appears in the sidebar at once and disappears when MCP is switched off. Select it to open the MCP page. Each server row shows the name, the launch command or URL, the connection state, and a **Tools** toggle that lists the server's model-facing tool names and descriptions. **Add server** opens a dialog for a stdio server (command, arguments, environment variables) or an HTTP server (URL, headers). A failed server shows its startup error and **Reconnect**.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The plugin registers a `sidebar.panellist` entry and a `main` page under the panel id `mcp` (order 1, after Plugins), and a `plugins.bundle.config` entry keyed by `@deepseek-ai/dsh-mcp-bundle`; all three render the same dashboard. One `follow()` stream per Client plugin feeds a snapshot store that every rendered dashboard reads; a carrier failure keeps the last roster and shows the error. The Remote mount and the UI registration share one disposer, as in the voice input plugin. The Host half is an empty marker.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Plugin manager page](../ui-plugin-manager/README.md) — the page and slots this dashboard renders into.

-----

<a id="model-experience"></a>
## Model Experience

None, as the dashboard only edits the roster and the roster's servers own every model-facing tool.

#### KV Cache effect

No direct effect; see the [roster](../../mcp/mcp-servers/README.md#model-experience).

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The dialog has no edit mode; change a server by removing it and adding it again.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
