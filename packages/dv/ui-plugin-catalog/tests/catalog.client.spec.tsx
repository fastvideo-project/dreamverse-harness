// @vitest-environment jsdom
/**
 * The Plugins tab in the entry page's 探索 section under the real slot runtime: the catalog cards with their state in the
 * profile, Install, Turn on and Remove through the plugin manager with their outcomes, and the tab's removal on dispose.
 */
import { act, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { BundleInfo, ChangeResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { CatalogAnswer } from '@dv/plugin-catalog/types'
import type {} from '@dv/ui-shell/contract'
import { apply, inject } from '../src/client/index.ts'
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
 * Mount the plugin with the catalog route stubbed and a plugin manager double.
 * @param bundles - the profile's bundles the manager lists first.
 * @returns the runtime, the rendered root and the manager double.
 */
async function mountTab(bundles: BundleInfo[]) {
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
  const runtime = await SlotTestRuntime.create()
  runtime.remote.provideNamespaces({ pluginManager: manager })
  await runtime.root.declare({ 'dv.explore': { kind: 'list', scope: 'root' } }, props => <>{props.renderSlot('dv.explore', {})}</>)
  const plugin = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  await act(async () => { await runtime.flush() })
  const setListed = (next: BundleInfo[]): void => { listed = next }
  return { runtime, plugin, view, manager, fetched, setListed }
}

/**
 * @param view - the rendered root.
 * @param pkg - a catalog package.
 * @returns the plugin's card.
 */
function card(view: ReturnType<SlotTestRuntime['renderRoot']>, pkg: string): HTMLElement {
  return view.container.querySelector(`[data-plugin="${pkg}"]`) as HTMLElement
}

describe('ui-plugin-catalog', () => {
  it('lists the catalog in 探索 with each plugin\'s state, and leaves when the plugin is disposed', async () => {
    const { runtime, plugin, view, fetched } = await mountTab([bundle(OTHER, false, '0.9.0')])
    expect(runtime.slots.entries('dv.explore').map(entry => entry.options.id)).toEqual(['plugins'])
    expect(fetched).toEqual([CATALOG_ROUTE])
    expect(card(view, VOICE).getAttribute('data-state')).toBe('absent')
    expect(card(view, OTHER).getAttribute('data-state')).toBe('off')
    expect(view.getByText('Needs a Seed-VC server.')).toBeTruthy()
    expect(view.getByText(`${VOICE}@0.1.0`)).toBeTruthy()
    expect(view.getByText('Version 0.9.0 is installed; the catalog lists 1.0.0.')).toBeTruthy()
    expect(view.getByText('Catalog source https://example.com/catalog.json could not be used: the server answered HTTP 500')).toBeTruthy()
    await plugin.dispose()
    expect(runtime.slots.entries('dv.explore')).toEqual([])
    await runtime.dispose()
  })

  it('installs a plugin at its catalog version with its bundle switched on and says when a restart loads it', async () => {
    const { runtime, view, manager, setListed } = await mountTab([])
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
    const { runtime, view, manager } = await mountTab([bundle(VOICE, true), bundle(OTHER, false)])
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
