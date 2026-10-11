/** Roster edits saved through Settings connect and disconnect real stdio MCP servers. */
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it, vi } from 'vitest'
import McpServers from '../src/index.ts'
import type { McpServerSpec } from '../src/types.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

const fixtureServer = fileURLToPath(new URL('../../mcp-client/tests/fixture-server.ts', import.meta.url))
const fixture: McpServerSpec = { transport: 'stdio', command: process.execPath, args: [fixtureServer], env: {} }

let ctx: Context | undefined
afterEach(async () => { await ctx?.root.fiber.dispose(); ctx = undefined })

/** Mount the roster behind Loader with a settings stub that replaces its live entry config, as profile writes do. */
async function mounted() {
  const root = new Context()
  ctx = root
  await root.plugin(SystemPrompt)
  await root.plugin(ToolRuntime)
  const live = await liveConfig(root, McpServers, { servers: {} })
  const roster = root.get('mcpServers')!
  root.effect(() => roster.offerPresets({ fixture: { title: 'Fixture', description: 'Test tools.', spec: fixture } }))
  const writes: object[] = []
  root.provide('settings', { replace: async (_entry: string, section: Record<string, unknown>) => {
    writes.push(section)
    await live.replace({ ...live.entry.options.config as Record<string, unknown>, ...section })
  } } as never)
  return { roster, tools: root.tools, writes }
}

it('connects an added server, lists its tools, and withdraws them on removal', async () => {
  const { roster, tools, writes } = await mounted()
  await roster.addServer('fixture', fixture)
  expect(writes).toEqual([{ servers: { fixture } }])
  await vi.waitFor(() => { expect(roster.snapshot().servers).toMatchObject([{ name: 'fixture', phase: 'connected' }]) }, { timeout: 15_000 })
  const [server] = roster.snapshot().servers
  expect(server?.tools.map(tool => tool.name)).toContain('mcp__fixture__add')
  expect(tools.get('mcp__fixture__add')).toBeDefined()

  await expect(roster.addServer('fixture', fixture)).rejects.toThrow('already exists')
  await roster.removeServer('fixture')
  await vi.waitFor(() => { expect(roster.snapshot().servers).toEqual([]) })
  await vi.waitFor(() => { expect(tools.get('mcp__fixture__add')).toBeUndefined() })
}, 30_000)

it('reports a server that cannot start as failed and keeps it in the roster', async () => {
  const { roster } = await mounted()
  await roster.addServer('missing', { transport: 'stdio', command: '/nonexistent/mcp-server', args: [], env: {} })
  await vi.waitFor(() => { expect(roster.snapshot().servers).toMatchObject([{ name: 'missing', phase: 'failed' }]) }, { timeout: 15_000 })
  expect(roster.snapshot().servers[0]?.error).toBeTruthy()
}, 30_000)

it('rejects names that cannot form tool names', async () => {
  const { roster, writes } = await mounted()
  await expect(roster.addServer('has space', fixture)).rejects.toThrow('must match')
  expect(writes).toEqual([])
})

it('adds an offered preset under its own name and marks it added', async () => {
  const { roster, writes } = await mounted()
  expect(roster.snapshot().presets).toEqual([{ name: 'fixture', title: 'Fixture', description: 'Test tools.', added: false }])
  await roster.addPreset('fixture')
  expect(writes).toEqual([{ servers: { fixture } }])
  expect(roster.snapshot().presets[0]?.added).toBe(true)
  await vi.waitFor(() => { expect(roster.snapshot().servers).toMatchObject([{ name: 'fixture', phase: 'connected' }]) }, { timeout: 15_000 })
  await expect(roster.addPreset('missing')).rejects.toThrow('does not exist')
}, 30_000)

it('withdraws presets when their offer is disposed and refuses a name offered twice', async () => {
  const { roster } = await mounted()
  expect(() => roster.offerPresets({ fixture: { title: 'Again', description: '', spec: fixture } })).toThrow('already offered')
  const withdraw = roster.offerPresets({ other: { title: 'Other', description: '', spec: fixture } })
  expect(roster.snapshot().presets.map(preset => preset.name)).toEqual(['fixture', 'other'])
  withdraw()
  expect(roster.snapshot().presets.map(preset => preset.name)).toEqual(['fixture'])
})
