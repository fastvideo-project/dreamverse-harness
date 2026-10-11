---
description: "Keep the MCP servers a person adds from the browser and connect each one, so its tools join the model's tool list."
kind: "package-reference"
---

# @deepseek-ai/dsh-mcp-servers

English | [中文](README.zh.md)

## Summary

`dsh-mcp-servers` owns a roster of MCP servers that a person adds and removes from the browser. It saves the roster in its own profile entry through the Settings service and mounts one [`@deepseek-ai/dsh-mcp-client`](../mcp-client/README.md) instance per server on the Host, so each server's tools register as `mcp__<server>__<tool>` beside the native tools. The `mcpServers` Remote serves the roster with each server's connection phase and tool list. The [MCP bundle](../mcp-bundle/README.md) mounts this plugin; the [dashboard](../../client/ui-mcp-servers/README.md) draws it.

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

Switch on **MCP** in the Plugins page, open its page, and choose **Add server**. A stdio server takes a command, one argument per line, and `KEY=VALUE` environment variables; an HTTP server takes a URL and `Name: Value` headers. Saving writes the server into the `servers` field of the `mcp-servers` entry in the profile's `cordis.patch.yml`; the roster connects it at once and shows **Connecting**, **Connected · N tools**, or **Connection failed** with the startup error. **Reconnect** retries a failed server, for example after starting the program it talks to; **Remove** deletes it and withdraws its tools.

The same roster can be written by hand:

```yaml
- id: mcp-servers
  config:
    servers:
      blender:
        transport: stdio
        command: /usr/local/bin/uvx
        args: [mcp-for-blender@2.1.9]
        env: { BLENDER_HOST: 127.0.0.1, BLENDER_PORT: '9876' }
```

| Field | Default | Meaning |
|---|---|---|
| `servers` | `{}` | Servers by name; each is a stdio spec (`command`, `args`, `env`) or a `streamable-http` spec (`url`, `headers`). Live: saving it reconnects servers without reloading the plugin. |
| `toolCallTimeoutMs` | `60000` | Timeout per MCP tool call, passed to every server's client. |

Another plugin can offer presets — servers a person adds in one step — with `ctx.mcpServers.offerPresets({ <name>: { title, description, spec } })`, which returns the disposer that withdraws them; a name already offered fails. The `mcpServers` Remote lists the offered presets with an `added` flag in `snapshot().presets`, and `addPreset(name)` saves a preset's spec under its name. The roster keeps no presets of its own, so the presets a deployment offers live outside the profile entry that Settings rewrites. DreamVerse offers its presets through [`@dv/mcp-presets`](../../dv/mcp-presets/README.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Maintainer details — click to expand</summary>

`servers` is a volatile config field. `addServer` and `removeServer` call `settings.replace()` on the plugin's own entry; the Loader then emits `loader/volatile-update`, and one serialized reconciliation disposes the client of each removed or edited server before mounting new ones, so a reused name is free before its next client reserves it. Each client mounts with `failOnStartupError: true`; the settled fiber decides the reported phase, and the startup error message is kept for display. A server's tools are read from the global tool registry by their `mcp__<server>__` prefix, and `tools/change` wakes `follow()` observers.

Remote method names avoid the members of the browser's Remote namespace service (`remove`, `has`, and others); a clashing name makes the browser contribution fail to mount.

No runtime invariant companion is published because the roster's only state is the config the Loader owns and the client fibers it derives from that config.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [MCP client](../mcp-client/README.md) — transport, tool naming, and the protocol features a server can use.
- [MCP resources](../mcp-resources/README.md) — resource tools shared by every connected server.

-----

<a id="model-experience"></a>
## Model Experience

### Server tools and instructions

#### What the model sees

Each connected server contributes the tools and the `mcp:<server>` instructions section that its [MCP client](../mcp-client/README.md#model-experience) publishes, named `mcp__<server>__<tool>`. A server that is connecting or failed contributes nothing. The roster itself adds no tool and no prompt text.

#### Token effect

Tool and instruction tokens grow with each connected server, as the MCP client describes; an empty roster adds none.

#### KV Cache effect

Adding, removing, or reconnecting a server changes the tool list and its `mcp:<server>` section, which invalidates the cached prefix from the first changed tool schema or section onward.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Environment variables and headers are saved in the profile as plain text; a server that needs a secret stores it there until the roster uses the credentials service.
- A server that fails at startup stays failed until **Reconnect**; reconnection after a lost connection follows the MCP client's own policy.
- Editing a saved server means removing it and adding it again.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer details — click to expand</summary>

None.

</details>
