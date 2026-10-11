---
description: "Switch on MCP from the Plugins page and manage MCP servers on its page."
kind: "package-bundle"
---

# @deepseek-ai/dsh-mcp-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle composes the [MCP server roster](../mcp-servers/README.md) and its [dashboard](../../client/ui-mcp-servers/README.md). The installation offers it in the Plugins page's **Official** group, switched off.

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

Open Plugins in the Web sidebar and switch on **MCP**, marked by a plug icon. An **MCP** entry then appears in the sidebar; its page adds, removes, and reconnects MCP servers; every connected server's tools join the tool list of every agent. Switching the bundle off disconnects every server and keeps the saved roster for the next time it is switched on.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

The static `cordis.patch.yml` inserts the `mcp-servers` and `ui-mcp-servers` rows. The roster saves into the `mcp-servers` entry of the profile patch, which outlives the bundle's own selection. No runtime invariant companion is published because this configuration-only package has no runtime state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP client](../mcp-client/README.md) — the plugin the roster mounts once per server.

-----

<a id="model-experience"></a>
## Model Experience

None, as connected servers add their tools and prompt sections through the MCP client.

#### KV Cache effect

No direct effect; see the [roster](../mcp-servers/README.md#model-experience).

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The bundle ships with no preset servers; each server is added on the bundle's page or in the profile patch.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
