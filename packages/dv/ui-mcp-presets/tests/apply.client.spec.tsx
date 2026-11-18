// @vitest-environment jsdom
/** The plugin's MCP tab in the entry page's 探索 section under the real slot runtime, and its removal on dispose. */
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '@dv/ui-shell/contract'
import { apply, inject } from '../src/client/index.ts'

afterEach(() => {
  cleanup()
  document.documentElement.lang = ''
})

describe('ui-mcp-presets apply', () => {
  it('lists the MCP tab first in 探索 with the locked tool cards while the MCP plugin is off, until the plugin is disposed', async () => {
    document.documentElement.lang = 'zh-CN'
    const runtime = await SlotTestRuntime.create()
    await runtime.root.declare({ 'dv.explore': { kind: 'list', scope: 'root' } }, props => <>{props.renderSlot('dv.explore', {})}</>)
    const plugin = await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()
    expect(runtime.slots.entries('dv.explore').map(entry => entry.options)).toEqual([{ id: 'mcp', order: 0, label: 'MCP' }])
    expect(view.getByRole('button', { name: '开启 MCP' })).toBeTruthy()
    const cards = [...view.container.querySelectorAll('[data-tool][data-state]')]
    expect(cards.map(card => [card.getAttribute('data-tool'), card.getAttribute('data-state')]))
      .toEqual([['blender', 'locked'], ['comfyui', 'locked']])

    await plugin.dispose()
    expect(runtime.slots.entries('dv.explore')).toEqual([])
    expect(view.queryByRole('button', { name: '开启 MCP' })).toBeNull()
    await runtime.dispose()
  })

  it('in English, says a failed switch failed and points to the Plugins page', async () => {
    document.documentElement.lang = 'en'
    const runtime = await SlotTestRuntime.create()
    runtime.remote.provideNamespaces({
      pluginManager: { setBundleEnabled: () => Promise.resolve({ ok: false, error: new Error('bundle missing') }) },
    })
    await runtime.root.declare({ 'dv.explore': { kind: 'list', scope: 'root' } }, props => <>{props.renderSlot('dv.explore', {})}</>)
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()
    fireEvent.click(view.getByRole('button', { name: 'Turn on MCP' }))
    const alert = await view.findByRole('alert')
    expect([alert.textContent, alert.title]).toEqual(['Could not turn on MCP. Try again, or check the Plugins page.', 'bundle missing'])
    await runtime.dispose()
  })
})
