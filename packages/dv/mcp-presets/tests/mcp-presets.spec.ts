/** The presets follow the MCP roster: offered while it is mounted, withdrawn when it unloads. */
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import McpServers from '@deepseek-ai/dsh-mcp-servers'
import { expect, it } from 'vitest'
import * as McpPresets from '../src/index.ts'

const blender = { title: 'Blender', description: 'Scenes.', spec: { transport: 'stdio' as const, command: 'uvx', args: ['mcp-for-blender@2.1.9'], env: {} } }

it('offers its presets only while the MCP roster is mounted', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const presets = ctx.plugin(McpPresets, { presets: { blender } })
  await presets
  const roster = ctx.plugin(McpServers, { servers: {} })
  await roster
  expect(ctx.get('mcpServers')?.snapshot().presets).toEqual([{ name: 'blender', title: 'Blender', description: 'Scenes.', added: false }])
  await roster.dispose()
  expect(ctx.get('mcpServers')).toBeUndefined()
  const again = ctx.plugin(McpServers, { servers: {} })
  await again
  expect(ctx.get('mcpServers')?.snapshot().presets.map(preset => preset.name)).toEqual(['blender'])
  await presets.dispose()
  expect(ctx.get('mcpServers')?.snapshot().presets).toEqual([])
  await ctx.root.fiber.dispose()
})
