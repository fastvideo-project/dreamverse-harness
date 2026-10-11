/** Schemastery schema of one MCP server spec: the roster validates its config with it, and preset providers theirs. */
import z from '@deepseek-ai/schemastery'

/** One stdio or Streamable HTTP server spec; omitted collections default to empty. */
export const ServerSpec = z.union([
  z.object({
    transport: z.const('stdio').required(),
    command: z.string().min(1).required(),
    args: z.array(String).default([]),
    env: z.dict(String).default({}),
  }),
  z.object({
    transport: z.const('streamable-http').required(),
    url: z.string().min(1).required(),
    headers: z.dict(String).default({}),
  }),
])
