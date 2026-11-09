// @vitest-environment jsdom
/**
 * The canvas as a right-Sidebar tab body and as the workspace center's 画布 view: both render an occurrence of the
 * `dv.canvas` Component Factory, so the tab draws the same card bodies, the same editor bodies and the same picker as
 * the center.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { PROJECT } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { zh } from '../src/client/locales.ts'
import { forgetCanvasStorage, mountCanvas } from './canvas-runtime.client.tsx'
import type { Surface } from './canvas-runtime.client.tsx'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  forgetCanvasStorage()
})

describe('canvas tab body and center view', () => {
  it('draw the same nodes with the same card bodies', async () => {
    const { runtime, view } = await mountCanvas({ surfaces: ['center', 'tab'] })
    const cards = (surface: Surface): Array<[string | null, string]> =>
      [...view.getByTestId(surface).querySelectorAll('[data-node-id]')].map(card => [card.getAttribute('data-node-id'), card.innerHTML])
    await waitFor(() => { expect(cards('tab').map(([id]) => id)).toEqual(['e1', 'g1', 'g2']) })
    expect(within(view.getByTestId('tab')).getByTestId('dv-canvas-body')).toBeTruthy()
    const tab = cards('tab')
    expect(tab.find(([id]) => id === 'e1')?.[1]).toContain('参考')
    expect(tab.find(([id]) => id === 'g2')?.[1]).toContain(`<img src="${assetUrl('shot2-last.png')}"`)
    expect(cards('center')).toEqual(tab)
    await runtime.dispose()
  })

  it('opens a node in the tab with its kind\'s editor body, and the editor\'s picker lists the asset pool tiles', async () => {
    const { runtime, view, open } = await mountCanvas({ surfaces: ['tab'] })
    const take = await open('g1', 'tab')
    expect(await waitFor(() => within(take).getByRole('button', { name: '渲染新版本' }))).toBeTruthy()
    fireEvent.click(within(take).getByRole('button', { name: '添加素材' }))
    const picker = await view.findByTestId('dv-canvas-asset-picker')
    await waitFor(() => { expect(picker.querySelector('[data-asset-id="shot1.mp4"]')).not.toBeNull() })
    await runtime.dispose()
  })

  it('names the center view 画布', async () => {
    const { runtime } = await mountCanvas({ kinds: [] })
    const label = runtime.slots.entries('dv.center.view').find(entry => entry.options.id === 'canvas')?.options.label
    expect(typeof label === 'function' ? label() : label).toBe(zh['type.label'])
    await runtime.dispose()
  })

  it('opens no node for a center request whose record is no record ID', async () => {
    const { runtime, view, node } = await mountCanvas({ request: { value: { record: 7 }, take: () => {} } })
    await waitFor(() => { node('g1') })
    await act(() => new Promise((resolve) => { setTimeout(resolve, 20) }))
    expect(view.queryByTestId('dv-canvas-node-editor')).toBeNull()
    await runtime.dispose()
  })

  it('tells a tab without projects to ask the agent for one', async () => {
    const { runtime, view } = await mountCanvas({ surfaces: ['tab'], projects: [] })
    await waitFor(() => { expect(view.getByTestId('tab').textContent).toContain(zh['empty.projects']) })
    await runtime.dispose()
  })

  it('writes from a tab beside no chat session carry no session', async () => {
    const failG1 = (state: FixtureState): void => {
      const records = state.components.proj.records
      state.components.proj.records = records.map(entry => entry.id === 'g1' ? { ...entry, status: 'failed' as const, outputs: [] } : entry)
      const g1 = state.components.canvas.nodes['g1']
      if (g1 !== undefined) g1.versions = ['g1']
    }
    const { runtime, node, server } = await mountCanvas({ surfaces: ['tab'], edit: failG1 })
    const retry = await waitFor(() => within(node('g1', 'tab')).getByRole('button', { name: '重试' }))
    fireEvent.click(retry)
    await waitFor(() => { expect(server.writes.some(write => write.path === '/api/dv/operation')).toBe(true) })
    const body = server.writes.find(write => write.path === '/api/dv/operation')?.body
    expect(body).toMatchObject({ project: 'p1', surface: 'canvas', based_on: 'g1' })
    expect(body).not.toHaveProperty('session')
    await runtime.dispose()
  })

  it('draws a project switched to before the earlier project\'s layout arrived with its own viewport only', async () => {
    const second = { ...PROJECT, id: 'p2', title: 'Second' }
    const { runtime, view, node, server } = await mountCanvas({
      surfaces: ['tab'], projects: [PROJECT, second], holdLayout: true, layout: { viewport: { x: 333, y: 0, zoom: 1 } },
    })
    await waitFor(() => { node('g1', 'tab') })
    fireEvent.change(within(view.getByTestId('tab')).getByRole('combobox', { name: zh['bar.project'] }), { target: { value: 'p2' } })
    server.releaseLayout('p2')
    const layer = (): string => view.getByTestId('tab').querySelector<HTMLElement>('div[style*="transform"]')?.style.transform ?? ''
    await waitFor(() => { expect(layer()).toMatch(/scale/u) })
    const fitted = layer()
    server.releaseLayout('p1')
    await act(() => new Promise((resolve) => { setTimeout(resolve, 20) }))
    expect(layer()).toBe(fitted)
    expect(fitted).not.toContain('translate(333px')
    await runtime.dispose()
  })
})
