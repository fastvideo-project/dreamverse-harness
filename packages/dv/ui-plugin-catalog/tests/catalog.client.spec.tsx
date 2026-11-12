// @vitest-environment jsdom
/**
 * The Marketplace page and its navigator entry under the real slot runtime: the catalog cards with their state in the
 * profile, Install, Turn on and Remove through the plugin manager with their outcomes, the link to DSH's Plugins page,
 * and the removal of the page and the entry on dispose.
 */
import { act, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { CatalogAnswer } from '@dv/plugin-catalog/types'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { apply, inject, MARKETPLACE_PANEL_ID } from '../src/client/index.ts'
import { CATALOG_ROUTE, outcomeOf } from '../src/client/catalog.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.lang = ''
})

const VOICE = '@fastvideo/dreamverse-voice-acting'
const OTHER = '@fastvideo/other'

const CATALOG: CatalogAnswer = {
  plugins: [
    {
      package: VOICE, version: '0.1.0', title: { zh: '配音', en: 'Voice acting' }, description: { zh: '录音并转换。', en: 'Record and convert.' },
      setup: { zh: '需要 Seed-VC 服务器。', en: 'Needs a Seed-VC server.' }, source: 'shipped',
    },
    { package: OTHER, version: '1.0.0', title: { zh: '其他', en: 'Other' }, description: { zh: '另一个。', en: 'Another one.' }, source: 'shipped' },
  ],
  problems: [{ source: 'https://example.com/catalog.json', message: 'the server answered HTTP 500' }],
}

const bundle = (name: string, enabled: boolean, version?: string): BundleInfo => ({
  name, enabled, ...version === undefined ? {} : { version }, installed: true, optional: false, removable: true, rows: [], overrides: [],
})

const change = (fields: Partial<ChangeResult>): ChangeResult => ({ changed: true, application: 'applied', stage: 'install', target: VOICE, ...fields })

/**
 * Mount the plugin with the catalog route stubbed, a plugin manager double and a recording layout, and render its page.
 * @param bundles - the profile's bundles the manager lists first.
 * @returns the runtime, the plugin, the rendered page, the manager double, the fetched routes, the bundle list setter
 * and the selected panels.
 */
async function mountPage(bundles: BundleInfo[]) {
  document.documentElement.lang = 'en'
  const fetched: string[] = []
  vi.stubGlobal('fetch', vi.fn((input: string) => {
    fetched.push(input)
    return Promise.resolve(new Response(JSON.stringify(CATALOG), { headers: { 'content-type': 'application/json' } }))
  }))
  let listed = bundles
  const manager = {
    listBundles: vi.fn(() => Promise.resolve({ ok: true as const, value: listed })),
    installBundle: vi.fn((_spec: string, _options: object) => Promise.resolve({ ok: true as const, value: change({ application: 'restart-required' }) })),
    removeBundle: vi.fn((_name: string) => Promise.resolve({ ok: true as const, value: change({ stage: 'remove' }) })),
    setBundleEnabled: vi.fn((_name: string, _enabled: boolean) => Promise.resolve({ ok: true as const, value: change({ stage: 'enable' }) })),
  }
  const selected: (MainPanelId | null)[] = []
  const runtime = await SlotTestRuntime.create()
  runtime.remote.provideNamespaces({ pluginManager: manager })
  runtime.ctx.provide('layout', { selectPanel: (id: MainPanelId | null) => { selected.push(id) } } as never)
  await runtime.declare({ 'main': { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } })
  const plugin = await runtime.mount({ inject: [...inject], apply })
  const { container, view: page } = runtime.renderSlot('main', {}, { entryKey: MARKETPLACE_PANEL_ID })
  await act(async () => { await runtime.flush() })
  const view = { container, ...page }
  const setListed = (next: BundleInfo[]): void => { listed = next }
  return { runtime, plugin, view, manager, fetched, setListed, selected }
}

/**
 * @param view - the rendered root.
 * @param pkg - a catalog package.
 * @returns the plugin's card.
 */
function card(view: { container: HTMLElement }, pkg: string): HTMLElement {
  return view.container.querySelector(`[data-plugin="${pkg}"]`) as HTMLElement
}

describe('ui-plugin-catalog', () => {
  it('lists the catalog on its page below the Plugins entry with each plugin\'s state, and leaves when the plugin is disposed', async () => {
    const { runtime, plugin, view, fetched } = await mountPage([bundle(OTHER, false, '0.9.0')])
    const entries = runtime.slots.entries('sidebar.panellist')
    expect(entries.map(entry => [entry.options.id, entry.options.order])).toEqual([[MARKETPLACE_PANEL_ID, 0.5]])
    expect(view.getByRole('heading', { name: 'Marketplace' })).toBeTruthy()
    expect(fetched).toEqual([CATALOG_ROUTE])
    expect(card(view, VOICE).getAttribute('data-state')).toBe('absent')
    expect(card(view, OTHER).getAttribute('data-state')).toBe('off')
    expect(view.getByText('Needs a Seed-VC server.')).toBeTruthy()
    expect(view.getByText(`${VOICE}@0.1.0`)).toBeTruthy()
    expect(view.getByText('Version 0.9.0 is installed; the catalog lists 1.0.0.')).toBeTruthy()
    expect(view.getByText('Catalog source https://example.com/catalog.json could not be used: the server answered HTTP 500')).toBeTruthy()
    await plugin.dispose()
    expect(runtime.slots.entries('sidebar.panellist')).toEqual([])
    expect(runtime.slots.entries('main')).toEqual([])
    await runtime.dispose()
  })

  it('installs a plugin at its catalog version with its bundle switched on and says when a restart loads it', async () => {
    const { runtime, view, manager, setListed } = await mountPage([])
    fireEvent.click(view.getAllByRole('button', { name: 'Install' })[0] as HTMLElement)
    await act(async () => { await runtime.flush() })
    expect(manager.installBundle).toHaveBeenCalledWith(`${VOICE}@0.1.0`, expect.objectContaining({ enabled: true }))
    expect(view.getByText('Installed. Restart the harness to load it.')).toBeTruthy()
    setListed([bundle(VOICE, true)])
    await act(async () => { runtime.remote.emit('plugin-manager/changed', [{ reason: 'install' }]); await runtime.flush() })
    expect(card(view, VOICE).getAttribute('data-state')).toBe('on')
    await runtime.dispose()
  })

  it('removes a plugin only after the confirmation, and turns on a switched-off one', async () => {
    const { runtime, view, manager } = await mountPage([bundle(VOICE, true), bundle(OTHER, false)])
    const voice = card(view, VOICE)
    fireEvent.click(voice.querySelector('button') as HTMLElement)
    expect(manager.removeBundle).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Confirm remove' }))
    await act(async () => { await runtime.flush() })
    expect(manager.removeBundle).toHaveBeenCalledWith(VOICE)
    expect(view.getByText('Removed.')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Turn on' }))
    await act(async () => { await runtime.flush() })
    expect(manager.setBundleEnabled).toHaveBeenCalledWith(OTHER, true)
    await runtime.dispose()
  })

  it('shows a bundle whose layer did not load as not loaded, and offers no Remove for a bundle the manager cannot remove', async () => {
    const { runtime, view } = await mountPage([
      { ...bundle(VOICE, true), error: { code: 'incompatible-version' } }, { ...bundle(OTHER, true), removable: false },
    ])
    expect(card(view, VOICE).getAttribute('data-state')).toBe('error')
    expect(view.getByText('Installed · Not loaded')).toBeTruthy()
    expect(card(view, OTHER).getAttribute('data-state')).toBe('on')
    expect(card(view, OTHER).querySelector('button')).toBeNull()
    await runtime.dispose()
  })
})

describe('the Plugins page link', () => {
  it('opens DSH\'s Plugins page from the intro line', async () => {
    const { runtime, view, selected } = await mountPage([])
    fireEvent.click(view.getByRole('button', { name: 'Plugins' }))
    expect(selected).toEqual(['plugins'])
    await runtime.dispose()
  })
})

describe('outcomeOf', () => {
  it('reads script approval, restart, cancellation and failure from a change', () => {
    expect(outcomeOf(change({ application: 'failed', pendingBuilds: ['esbuild'] }), 'installed', 'installed-restart'))
      .toEqual({ kind: 'scripts', packages: ['esbuild'] })
    expect(outcomeOf(change({ application: 'restart-required' }), 'installed', 'installed-restart')).toEqual({ kind: 'installed-restart' })
    expect(outcomeOf(change({ application: 'cancelled' }), 'installed', 'installed-restart')).toEqual({ kind: 'failed', message: 'cancelled' })
    expect(outcomeOf(change({
      application: 'failed', packageResult: { exitCode: 1, output: '', truncated: false, logPath: '/p/pnpm.log', kind: 'not-found' },
    }), 'installed', 'installed-restart')).toEqual({ kind: 'failed', message: 'not-found (log: /p/pnpm.log)' })
  })
})
