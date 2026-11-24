// @vitest-environment jsdom
/** The plugin's section of the MCP page under the real slot runtime, and its removal on dispose. */
import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '@deepseek-ai/dsh-client-ui-mcp-servers/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  document.documentElement.lang = ''
})

describe('ui-mcp-presets apply', () => {
  it('adds the suggested servers to the MCP page, with cards waiting for the roster, until the plugin is disposed', async () => {
    document.documentElement.lang = 'en'
    const runtime = await SlotTestRuntime.create()
    await runtime.root.declare({ 'mcp.page.section': { kind: 'list', scope: 'root' } }, props => <>{props.renderSlot('mcp.page.section', {})}</>)
    const plugin = await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()
    expect(runtime.slots.entries('mcp.page.section').map(entry => entry.options)).toEqual([{ id: 'dv-mcp-presets' }])
    expect(view.getByRole('region', { name: 'Suggested by DreamVerse' })).toBeTruthy()
    const cards = [...view.container.querySelectorAll<HTMLButtonElement>('[data-tool][data-state]')]
    expect(cards.map(card => [card.getAttribute('data-tool'), card.getAttribute('data-state'), card.disabled]))
      .toEqual([['blender', 'loading', true], ['comfyui', 'loading', true]])
    expect(view.queryByRole('button', { name: /Turn on MCP/u })).toBeNull()

    await plugin.dispose()
    expect(runtime.slots.entries('mcp.page.section')).toEqual([])
    expect(view.queryByRole('region', { name: 'Suggested by DreamVerse' })).toBeNull()
    await runtime.dispose()
  })

  it('titles the section in Chinese', async () => {
    document.documentElement.lang = 'zh-CN'
    const runtime = await SlotTestRuntime.create()
    await runtime.root.declare({ 'mcp.page.section': { kind: 'list', scope: 'root' } }, props => <>{props.renderSlot('mcp.page.section', {})}</>)
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()
    expect(view.getByRole('heading', { level: 2 }).textContent).toBe('DreamVerse 推荐')
    await runtime.dispose()
  })

  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })
})
