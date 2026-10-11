/** Types shared by the MCP server roster, its Remote, and the browser dashboard. */

/** Launch a local MCP server as a child process and talk to it over stdio. */
export interface McpStdioServerSpec {
  /** Selects child-process stdio transport. */
  readonly transport: 'stdio'
  /** Executable that starts the server. */
  readonly command: string
  /** Arguments passed to the executable without shell interpolation. */
  readonly args: readonly string[]
  /** Extra environment variables for the child process. */
  readonly env: Readonly<Record<string, string>>
}

/** Connect to an MCP server that already listens on a Streamable HTTP endpoint. */
export interface McpHttpServerSpec {
  /** Selects Streamable HTTP transport. */
  readonly transport: 'streamable-http'
  /** MCP endpoint URL. */
  readonly url: string
  /** Extra headers attached to every MCP request. */
  readonly headers: Readonly<Record<string, string>>
}

/** How the harness reaches one MCP server. */
export type McpServerSpec = McpStdioServerSpec | McpHttpServerSpec

/** Connection progress of one configured server: `failed` carries the startup error. */
export type McpServerPhase = 'connecting' | 'connected' | 'failed'

/** One model-facing tool that a connected server registered. */
export interface McpServerTool {
  /** Public tool name, `mcp__<server>__<tool>`. */
  readonly name: string
  /** Tool description the server published. */
  readonly description: string
}

/** One configured server with its live connection state. */
export interface McpServerView {
  /** Server name; the `<server>` part of every tool name. */
  readonly name: string
  /** Launch or endpoint settings saved in the profile. */
  readonly spec: McpServerSpec
  /** Connection progress. */
  readonly phase: McpServerPhase
  /** Startup error message when `phase` is `failed`. */
  readonly error?: string
  /** Tools the server registered while connected, sorted by name. */
  readonly tools: readonly McpServerTool[]
}

/** A server the deployment offers for one-step adding, with the copy a person reads before adding it. */
export interface McpServerPreset {
  /** Display name. */
  readonly title: string
  /** One sentence on what the server lets the agent do and what it needs. */
  readonly description: string
  /** Launch or endpoint settings saved when the preset is added. */
  readonly spec: McpServerSpec
}

/** One offered preset and whether a server of its name is configured. */
export interface McpPresetView {
  /** Server name the preset adds. */
  readonly name: string
  /** Display name. */
  readonly title: string
  /** One sentence on what the server lets the agent do and what it needs. */
  readonly description: string
  /** Whether a server with this name is configured. */
  readonly added: boolean
}

/** Every configured server and every offered preset, each sorted by name. */
export interface McpServersSnapshot {
  /** Configured servers. */
  readonly servers: readonly McpServerView[]
  /** Offered presets. */
  readonly presets: readonly McpPresetView[]
}
