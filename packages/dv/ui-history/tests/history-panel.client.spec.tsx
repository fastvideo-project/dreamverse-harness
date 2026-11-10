// @vitest-environment jsdom
/**
 * The History tab under the real slot runtime and a scripted API: the steps with 当前 and greyed later steps, the
 * thumbnails and players that registered rows name, drawn through `dv.media`, folds, selection and the center moves it
 * asks `dvCenter` for, undo, redo, 回到这一步, and empty states.
 */
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { DvClient } from '@dv/ui-kit/api.ts'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import type { HistoryEntry, HistoryQuery, ProjectRecord, WireHistory, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { DV_HISTORY_FOCUS_EVENT, DV_TRAJECTORY_FOCUS_EVENT } from '@dv/ui-kit/workspace-events.ts'
import { asset, fixtureState, OPERATIONS, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as shotRenderApply, inject as shotRenderInject } from '../../ui-shot-render/src/client/index.ts'
import type { HistoryRow } from '../src/client/contract/index.ts'
import { HistoryPanel } from '../src/client/HistoryPanel.tsx'
import { disposeHistories, mountHistory } from './runtime.client.tsx'

/**
 * Open a row's ⋮ menu.
 * @param element - a list row.
 * @returns the labels of the menu's items.
 */
function menuOf(element: HTMLElement): string[] {
  fireEvent.click(within(element).getByTestId('dv-history-step-actions'))
  return within(element).getAllByRole('menuitem').map(item => item.textContent ?? '')
}

// jsdom lays nothing out and has no scrollIntoView; the panel's scroll requests are recorded instead.
Element.prototype.scrollIntoView = vi.fn()

afterEach(async () => { cleanup(); await disposeHistories(); vi.unstubAllGlobals(); vi.useRealTimers() })

const SHOT_RENDER = { inject: [...shotRenderInject], apply: shotRenderApply }
const ENTRIES: HistoryEntry[] = [
  { record: record({ id: 'm1', turn: null, surface: 'timeline', operation: 'timeline.clip_move', params: { clip: 'cl1', to: 2 }, intent: 'move clip 1' }), place: 'current' },
  {
    record: record({
      id: 'g1', turn: 't3', actor: 'agent', session: 's5', tool_call: 'call-g1', operation: 'shot.render', outputs: ['shot1.mp4'],
      intent: 'render the hero', deterministic: false,
      inputs: [{ role: 'reference', ref: { asset: 'ref.png' }, resolved_asset: 'ref.png' }],
    }),
    place: 'before',
  },
  { record: record({ id: 'p1', turn: 't3', actor: 'agent', session: 's5', tool_call: 'call-p1', operation: 'character.create' }), place: 'before' },
]

/** The operations on the wire: the fixture's, a clip move and a starter of a chain, with the labels their packages declare. */
const WIRE_OPERATIONS: WireOperation[] = [
  ...OPERATIONS.map(operation => operation.name === 'shot.render' ? { ...operation, label: { zh: '渲染镜头', en: 'Render shot' } } : operation),
  {
    name: 'timeline.clip_move', version: '2', description: 'Move a clip.', label: { zh: '移动片段', en: 'Move clip' }, inputs: {}, params: {}, outputs: [],
    deterministic: false, resource: 'none',
  },
  {
    name: 'cut.assemble', version: '1', description: 'Assemble a cut.', label: { zh: '拼接成片', en: 'Assemble cut' }, inputs: {}, params: {},
    outputs: [], deterministic: false, resource: 'none',
  },
]

/** The History row of the chain starter `cut.assemble`, with a fold label over its folded media rows. */
const STARTER_ROW: HistoryRow = {
  match: 'cut.assemble',
  fold: count => [`渲染 ${String(count)} 个镜头`, `Render ${String(count)} shots`],
  subject: () => null,
}

type HistoryServer = (query: HistoryQuery, signal: AbortSignal | null) => Promise<WireHistory>

/**
 * A history route over fixed entries: the entries of the query's tool call, else all of them, after the query's
 * `before` record and at most `limit` of them.
 * @param entries - the entries, newest first.
 * @returns the route.
 */
const serveEntries = (entries: HistoryEntry[]): HistoryServer => (query) => {
  const matching = entries.filter(entry => query.tool_call === undefined || entry.record.tool_call === query.tool_call)
  const from = query.before === undefined ? 0 : matching.findIndex(entry => entry.record.id === query.before) + 1
  return Promise.resolve({
    entries: matching.slice(from, from + (query.limit ?? matching.length)),
    assets: [asset('shot1.mp4', 'video/mp4', 'g1', 4), asset('ref.png', 'image/png', null)],
  })
}

/**
 * A history answer that never arrives; the request rejects as a browser's `fetch` does once its signal aborts.
 * @param signal - the request's abort signal.
 * @returns the pending answer.
 */
const neverAnswered = (signal: AbortSignal | null): Promise<WireHistory> => new Promise((_, reject) => {
  signal?.addEventListener('abort', () => { reject(new DOMException('The operation was aborted.', 'AbortError')) })
})

interface MountOptions {
  plugins?: Parameters<typeof mountHistory>[0]
  serve?: HistoryServer
  post?: (path: string, body: unknown) => { status: number; body: unknown }
  hold?: (path: string) => Promise<void>
}

/**
 * Mount the History tab over scripted API routes.
 * @param entries - the history the route serves.
 * @param adjust - changes to the fixture state that `/api/dv/state` serves.
 * @param rows - the history rows registered into `dvHistory` besides the plugins' rows.
 * @param options - the plugins and the answers of the history route, the other POST routes and the GET routes.
 * @returns the rendered tab, the recorded writes, history queries and center moves, the History plugin, and a row lookup.
 */
async function mount(
  entries: HistoryEntry[] = ENTRIES, adjust: (state: WireState) => void = () => {}, rows: readonly HistoryRow[] = [],
  options: MountOptions = {},
) {
  const { plugins = [SHOT_RENDER], serve = serveEntries(entries), post = () => ({ status: 200, body: { record: record({ id: 'b1' }) } }) } = options
  const queries: HistoryQuery[] = []
  const scripted = scriptedFetch({
    operations: WIRE_OPERATIONS,
    // Timeline `t1` of the fixture holds clips cl1 and cl2, assigned by its create record; the clip move m1 is a record
    // of the current state.
    state: () => {
      const state = fixtureState()
      state.components.proj.records = state.components.proj.records.map(item => item.id === 's1' ? { ...item, report: { clips: ['cl1', 'cl2'] } } : item)
      state.components.proj.records.push(record({ id: 'm1', operation: 'timeline.clip_move', params: { clip: 'cl1', to: 2 } }))
      adjust(state)
      return state
    },
    post,
  })
  const fetchImpl: typeof fetch = async (input, init) => {
    if (input !== '/api/dv/history') {
      if (typeof input === 'string' && init?.method !== 'POST') await options.hold?.(input)
      return scripted.fetch(input, init)
    }
    const query = JSON.parse(typeof init?.body === 'string' ? init.body : '') as HistoryQuery
    queries.push(query)
    return new Response(JSON.stringify(await serve(query, init?.signal ?? null)))
  }
  vi.stubGlobal('fetch', fetchImpl)
  const mounted = await mountHistory(plugins)
  const disposers = rows.map(row => mounted.runtime.ctx.dvHistory.rows.register(row))
  const { view } = mounted
  const row = (id: string): HTMLElement => {
    const element = view.container.querySelector(`[data-testid="dv-history-row"][data-record="${id}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`no row ${id}`)
    return element
  }
  return { ...mounted, writes: scripted.writes, queries, row, disposers }
}

const steps = (count: number): HistoryEntry[] => Array.from({ length: count }, (_, at) => ({
  record: record({ id: `r${String(at)}`, operation: 'timeline.clip_move', session: 's5', tool_call: `call-r${String(at)}` }),
  place: at === 0 ? 'current' : 'before',
}))

const focusCall = (toolCall: string): void => {
  window.dispatchEvent(new CustomEvent(DV_HISTORY_FOCUS_EVENT, { detail: { session: 's5', toolCall } }))
}

/**
 * Replace `EventSource` with a stream that the test drives.
 * @returns a function that delivers one frame of an event name to every listener of that name.
 */
function stubEventSource(): (type: string, data: string) => void {
  const listeners = new Map<string, Set<EventListener>>()
  vi.stubGlobal('EventSource', class {
    addEventListener(type: string, listener: EventListener): void { listeners.set(type, (listeners.get(type) ?? new Set()).add(listener)) }
    removeEventListener(type: string, listener: EventListener): void { listeners.get(type)?.delete(listener) }
    close(): void {}
  })
  return (type, data) => {
    act(() => { for (const listener of listeners.get(type) ?? []) listener(new MessageEvent(type, { data })) })
  }
}

const frame = (kind: 'record' | 'update', changed: ProjectRecord): string => JSON.stringify({ kind, record: changed })

const FAILED_RENDER = record({ ...ENTRIES.find(entry => entry.record.id === 'g1')?.record, id: 'g1', status: 'failed' })

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 300) })

const drawn = (element: Element): string[] => [...element.querySelectorAll('[data-media]')]
  .map(media => `${media.getAttribute('data-media') ?? ''}@${media.getAttribute('data-purpose') ?? ''}`)

describe('the History tab', () => {
  it('shows one row per step, newest first, with who, the agent\'s intent, the thumbnail its row names through dv.media, and 当前 on the current step', async () => {
    const { view, row } = await mount()
    await waitFor(() => { expect(view.container.querySelectorAll('[data-testid="dv-history-row"]').length).toBe(3) })
    const ids = [...view.container.querySelectorAll('[data-testid="dv-history-row"]')].map(element => element.getAttribute('data-record'))
    expect(ids).toEqual(['m1', 'g1', 'p1'])
    expect(row('g1').textContent).toContain('render the hero')
    expect(row('g1').textContent).toContain('Agent')
    await waitFor(() => { expect(row('m1').textContent).toContain('Move clip') })
    expect(row('m1').textContent).toContain('You')
    expect(row('m1').textContent).not.toContain('render the hero')
    expect(row('g1').getAttribute('data-actor')).toBe('agent')
    expect(row('m1').querySelector('[data-testid="dv-history-current"]')?.textContent).toBe('Current')
    expect(view.container.querySelectorAll('[data-testid="dv-history-current"]')).toHaveLength(1)
    await waitFor(() => { expect(drawn(row('g1'))).toEqual(['shot1.mp4@thumb']) })
    expect(row('p1').querySelector('[data-testid="dv-history-thumb"]')).toBeNull()
    expect(drawn(row('p1'))).toEqual([])
    // One list: no branch menu and no view switch; redo waits until a step lies after the current one.
    for (const id of ['dv-kit-branch-menu', 'dv-history-view-toggle']) expect(view.queryByTestId(id)).toBeNull()
    await waitFor(() => { expect(view.getByTestId('dv-history-redo')).toHaveProperty('disabled', true) })
  })

  it('draws no thumbnail and no thumbnail column for a row registered without a thumbnail', async () => {
    const { row } = await mount(ENTRIES, () => {}, [{ match: 'shot.render', subject: () => null }], { plugins: [] })
    await waitFor(() => { expect(row('g1').textContent).toContain('Render shot') })
    expect(row('g1').querySelector('[data-testid="dv-history-thumb"]')).toBeNull()
    expect(drawn(row('g1'))).toEqual([])
    expect(row('g1').querySelector<HTMLElement>('[style*="grid-template-columns"]')?.style.gridTemplateColumns).toBe('minmax(0, 1fr) auto')
  })

  it('shows a take\'s still as its thumbnail and plays its video, with the row that the shot render plugin registers', async () => {
    const take: HistoryEntry = { record: record({ id: 'g1', operation: 'shot.render', outputs: ['shot1.mp4', 'still.png'] }), place: 'current' }
    const { row } = await mount([take], (state) => { state.assets.push(asset('still.png', 'image/png', 'g1')) })
    await waitFor(() => { expect(drawn(row('g1'))).toEqual(['still.png@thumb']) })
    fireEvent.click(row('g1'))
    const box = within(row('g1')).getByTestId('dv-history-preview')
    expect(drawn(box)).toEqual(['shot1.mp4@loop'])
    // The box spans the row at most 220 px tall, so the player stays inside it; a take of unknown size gets the full height.
    expect([box.style.width, box.style.height]).toEqual(['100%', '220px'])
  })

  it('names the shot of a take and of its retake, with the row that the shot render plugin registers', async () => {
    const take = record({ id: 'g7', operation: 'shot.render', started_by: { record: 'ap', slot: 7 }, outputs: ['shot1.mp4'] })
    const retake = record({ id: 'g8', operation: 'shot.render', based_on: 'g7' })
    const { row } = await mount([{ record: retake, place: 'current' }, { record: take, place: 'before' }])
    await waitFor(() => { expect(within(row('g7')).getByText('Render shot 7')).toBeTruthy() })
    expect(within(row('g8')).getByText('Render shot 7')).toBeTruthy()
  })

  it('falls back to the empty square when a thumbnail\'s media fails to load', async () => {
    const { row } = await mount()
    const media = await waitFor(() => {
      const found = row('g1').querySelector('[data-media]')
      if (found === null) throw new Error('no thumbnail media')
      return found
    })
    fireEvent.error(media)
    await waitFor(() => { expect(drawn(row('g1'))).toEqual([]) })
    expect(row('g1').querySelector('[data-testid="dv-history-thumb"]')).toBeNull()
  })

  it('folds the renders a starter record started under its row, labeled by the starter row\'s fold, until the toggle opens them', async () => {
    const chain: HistoryEntry[] = [
      {
        record: record({ id: 'g2', actor: 'system', operation: 'shot.render', started_by: { record: 'ap', slot: 2 }, status: 'running' }),
        place: 'current',
      },
      {
        record: record({ id: 'g1', actor: 'system', operation: 'shot.render', started_by: { record: 'ap', slot: 1 }, outputs: ['shot1.mp4'] }),
        place: 'before',
      },
      {
        record: record({ id: 'tl', actor: 'system', operation: 'timeline.create', started_by: { record: 'ap', slot: null } }),
        place: 'before',
      },
      {
        record: record({ id: 'ap', actor: 'agent', operation: 'cut.assemble', report: { scheduled: ['g1', 'g2'] } }),
        place: 'before',
      },
    ]
    const { view, row } = await mount(chain, () => {}, [STARTER_ROW])
    await waitFor(() => { row('ap') })
    expect(view.container.querySelectorAll('[data-testid="dv-history-row"]').length).toBe(1)
    await waitFor(() => { expect(row('ap').textContent).toContain('Assemble cut') })
    const fold = view.getByTestId('dv-history-fold')
    // The timeline record folds too, but only the media records count: two renders, one finished.
    expect(fold.textContent).toContain('Render 2 shots (1/2)')
    fireEvent.click(fold)
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    expect(row('g1').textContent).toContain('Render shot 1')
    expect(row('g2').textContent).toContain('Automatic')
    const folded = [...view.container.querySelectorAll('[data-testid="dv-history-row"]')].map(element => element.getAttribute('data-record'))
    expect(folded).toEqual(['ap', 'tl', 'g1', 'g2'])
    fireEvent.click(fold)
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(view.container.querySelectorAll('[data-testid="dv-history-row"]').length).toBe(1)
  })

  it('labels a fold by its first folded record when the starter\'s row has no fold', async () => {
    const chain: HistoryEntry[] = [
      { record: record({ id: 'g1', actor: 'system', operation: 'shot.render', started_by: { record: 'ap', slot: 1 }, outputs: ['shot1.mp4'] }), place: 'current' },
      { record: record({ id: 'ap', actor: 'agent', operation: 'cut.assemble' }), place: 'before' },
    ]
    const { view } = await mount(chain)
    await waitFor(() => { expect(view.getByTestId('dv-history-fold').textContent).toBe('▸ Render shot 1') })
  })

  it('labels a row with the subject of a registered history row, and drops it once the row is disposed', async () => {
    const { row, disposers, runtime } = await mount(ENTRIES, () => {}, [])
    const dispose = runtime.ctx.dvHistory.rows.register({ match: 'timeline.', subject: () => [' 片段 1', ' clip 1'] })
    await waitFor(() => { expect(row('m1').textContent).toContain('Move clip clip 1') })
    act(() => { dispose() })
    await waitFor(() => { expect(row('m1').textContent).not.toContain('clip 1') })
    expect(disposers).toEqual([])
  })

  it('asks for the steps of the history list', async () => {
    const { queries } = await mount()
    await waitFor(() => { expect(queries.at(0)).toEqual({ project: 'p1', limit: 50 }) })
  })

  it('selecting a render row plays its first output and moves the center to its node, a clip row moves it where its registered row says, and a step after the current one moves nothing', async () => {
    const later = ENTRIES.map(entry => entry.record.id === 'p1' ? { ...entry, place: 'after' as const } : entry)
    // A test-local timeline row: its focus finds the clip move among the records of the current state.
    const timelineRow: HistoryRow = {
      match: 'timeline.', subject: () => null,
      focus: (item, records) => records.some(each => each.id === item.id)
        ? { view: 'timeline', target: { timeline: 't1', clip: String(item.params['clip']) } }
        : null,
    }
    const { row, shown } = await mount(later, () => {}, [timelineRow])
    await waitFor(() => { row('g1') })
    await waitFor(() => { expect(row('m1').textContent).toContain('Move clip') })
    fireEvent.click(row('g1'))
    expect(row('g1').getAttribute('aria-selected')).toBe('true')
    const preview = within(row('g1')).getByTestId('dv-history-preview')
    expect(drawn(preview)).toEqual(['shot1.mp4@loop'])
    fireEvent.click(row('m1'))
    fireEvent.click(row('p1'))
    await waitFor(() => {
      expect(shown).toEqual([{ view: 'canvas', target: { record: 'g1' } }, { view: 'timeline', target: { timeline: 't1', clip: 'cl1' } }])
    })
  })

  it('plays the first output of a selected row whose registered row draws no media, as of an import that no row names', async () => {
    const imported: HistoryEntry = { record: record({ id: 'u1', operation: 'asset.import', outputs: ['ref.png'] }), place: 'current' }
    const { row } = await mount([imported, ...ENTRIES], () => {}, [{ match: 'shot.render', subject: () => null }], { plugins: [] })
    await waitFor(() => { row('g1') })
    fireEvent.click(row('g1'))
    expect(drawn(within(row('g1')).getByTestId('dv-history-preview'))).toEqual(['shot1.mp4@loop'])
    expect(row('g1').textContent).toContain('render the hero')
    fireEvent.click(row('u1'))
    expect(row('u1').querySelector('[data-testid="dv-history-thumb"]')).toBeNull()
    expect(drawn(within(row('u1')).getByTestId('dv-history-preview'))).toEqual(['ref.png@loop'])
  })

  it('undoes and redoes by moving the current position; redo is enabled while a step lies after it', async () => {
    const { view, writes } = await mount(ENTRIES, (state) => { state.tip = 'later' })
    await waitFor(() => { expect(view.getByTestId('dv-history-redo')).toHaveProperty('disabled', false) })
    fireEvent.click(view.getByTestId('dv-history-undo'))
    fireEvent.click(view.getByTestId('dv-history-redo'))
    await waitFor(() => {
      expect(writes).toEqual([
        { path: '/api/dv/undo', body: { project: 'p1' } }, { path: '/api/dv/redo', body: { project: 'p1' } },
      ])
    })
  })

  it('keeps the thumbnail column on a render row that produced nothing, and gives other rows none', async () => {
    const failed: HistoryEntry = {
      record: record({ id: 'f1', operation: 'shot.render', status: 'failed', outputs: [] }), place: 'before',
    }
    const { row } = await mount([failed, ...ENTRIES])
    await waitFor(() => { row('f1') })
    const columns = (id: string): string => row(id).querySelector<HTMLElement>('[style*="grid-template-columns"]')?.style.gridTemplateColumns ?? ''
    expect(columns('f1')).toMatch(/^40px /)
    expect(row('f1').querySelector('[data-testid="dv-history-thumb"]')).toBeNull()
    expect(columns('m1')).toBe('minmax(0, 1fr) auto')
    fireEvent.click(row('f1'))
    expect(row('f1').getAttribute('aria-selected')).toBe('true')
    expect(within(row('f1')).queryByTestId('dv-history-preview')).toBeNull()
  })

  it('shows the error message of a failed or cancelled step under its meta line, and no line without one', async () => {
    const withError = (id: string, status: 'failed' | 'cancelled', message?: string): HistoryEntry => ({
      record: record({ id, operation: 'shot.render', status, outputs: [], error: message === undefined ? undefined : { code: 'operation_failed', message } }), place: 'before',
    })
    const { row } = await mount([withError('f1', 'failed', 'GPU out of memory'), withError('c1', 'cancelled', 'Stopped by you'), withError('f2', 'failed'), ...ENTRIES])
    await waitFor(() => { row('f1') })
    const reasonOf = (id: string): HTMLElement | null => row(id).querySelector<HTMLElement>('[data-testid="dv-history-reason"]')
    expect([reasonOf('f1')?.textContent, reasonOf('f1')?.title, reasonOf('c1')?.textContent, reasonOf('f2'), reasonOf('g1')]).toEqual(['GPU out of memory', 'GPU out of memory', 'Stopped by you', null, null])
  })

  it('greys a render step after the current one with a faded, black-and-white thumbnail', async () => {
    const { row } = await mount(ENTRIES.map(entry => entry.record.id === 'g1' ? { ...entry, place: 'after' as const } : entry))
    const thumb = await waitFor(() => {
      const found = row('g1').querySelector('[data-testid="dv-history-thumb"]')?.parentElement
      if (!(found instanceof HTMLElement)) throw new Error('no thumbnail')
      return found
    })
    expect(thumb.style.opacity).toBe('0.3')
    expect(thumb.style.filter).toBe('grayscale(1)')
  })

  it('greys the steps after the current one and offers 回到这一步 on every other step', async () => {
    const after: HistoryEntry = { record: record({ id: 'a1', operation: 'timeline.rename', params: { timeline: 't1', name: 'x' } }), place: 'after' }
    const { writes, row } = await mount([after, ...ENTRIES])
    await waitFor(() => { row('a1') })
    // The text is greyed; the ⋮ menu is not, so it opens above the next row. Rows other than renders have no thumbnail.
    const dimmed = (id: string): string[] => [...row(id).querySelectorAll<HTMLElement>('[style*="opacity"]')].map(element => element.style.opacity)
    expect(dimmed('a1')).toEqual(['0.3'])
    expect(row('a1').style.opacity).toBe('')
    expect(row('a1').getAttribute('data-place')).toBe('after')
    expect(row('a1').querySelector('[data-testid="dv-history-thumb"]')).toBeNull()
    expect(dimmed('m1')).toEqual(['1'])
    // The current step has no ⋮; a step before it and a step after it both have 回到这一步.
    expect(row('m1').querySelector('[data-testid="dv-history-step-actions"]')).toBeNull()
    expect(menuOf(row('g1'))).toEqual(['Go back to this step'])
    fireEvent.click(within(row('g1')).getByTestId('dv-history-step-back'))
    expect(menuOf(row('a1'))).toEqual(['Go back to this step'])
    fireEvent.click(within(row('a1')).getByTestId('dv-history-step-back'))
    await waitFor(() => {
      expect(writes).toEqual([
        { path: '/api/dv/undo', body: { project: 'p1', to: 'g1' } }, { path: '/api/dv/undo', body: { project: 'p1', to: 'a1' } },
      ])
    })
    // The menu's gesture does not select the row.
    expect(row('g1').getAttribute('aria-selected')).toBe('false')
  })

  it('says what to do when the project has no records', async () => {
    const { view } = await mount([])
    await waitFor(() => { expect(view.getByTestId('dv-history-empty').textContent).toContain('No records yet') })
  })

  it('selects the record a tool call wrote when a dv:history-focus event arrives', async () => {
    const { row } = await mount()
    await waitFor(() => { row('p1') })
    window.dispatchEvent(new CustomEvent(DV_HISTORY_FOCUS_EVENT, { detail: { session: 's5', toolCall: 'call-p1' } }))
    await waitFor(() => { expect(row('p1').getAttribute('aria-selected')).toBe('true') })
  })

  it('selects a row with Enter and with no other key', async () => {
    const { row, shown } = await mount()
    await waitFor(() => { row('g1') })
    fireEvent.keyDown(row('g1'), { key: ' ' })
    expect(row('g1').getAttribute('aria-selected')).toBe('false')
    fireEvent.keyDown(row('g1'), { key: 'Enter' })
    expect(row('g1').getAttribute('aria-selected')).toBe('true')
    expect(shown).toEqual([{ view: 'canvas', target: { record: 'g1' } }])
  })

  it('asks the shell to show a selected agent step\'s tool call in the trajectory, and clicks in the details leave the selection alone', async () => {
    const { row, shown } = await mount()
    await waitFor(() => { row('g1') })
    fireEvent.click(row('g1'))
    const asked: unknown[] = []
    const follow = (event: Event): void => { asked.push((event as CustomEvent).detail) }
    window.addEventListener(DV_TRAJECTORY_FOCUS_EVENT, follow)
    fireEvent.click(within(row('g1')).getByTestId('dv-history-open-trajectory'))
    fireEvent.click(within(row('g1')).getByTestId('dv-history-preview'))
    window.removeEventListener(DV_TRAJECTORY_FOCUS_EVENT, follow)
    expect(asked).toEqual([{ session: 's5', toolCall: 'call-g1' }])
    expect(shown).toEqual([{ view: 'canvas', target: { record: 'g1' } }])
  })

  it('closes the ⋮ menu on Escape and on a press outside it, and keeps it open on other keys and presses inside it', async () => {
    const { row } = await mount()
    await waitFor(() => { row('g1') })
    const menu = (): HTMLElement | null => within(row('g1')).queryByRole('menu')
    const button = (): HTMLElement => within(row('g1')).getByTestId('dv-history-step-actions')
    menuOf(row('g1'))
    fireEvent.keyDown(button(), { key: 'Enter' })
    expect(menu()).not.toBeNull()
    expect(row('g1').getAttribute('aria-selected')).toBe('false')
    fireEvent.keyDown(button(), { key: 'Escape' })
    expect(menu()).toBeNull()
    menuOf(row('g1'))
    fireEvent.pointerDown(within(row('g1')).getByTestId('dv-history-step-back'))
    expect(menu()).not.toBeNull()
    fireEvent.pointerDown(document.body)
    expect(menu()).toBeNull()
  })

  it('shows why undo and 回到这一步 were refused', async () => {
    const { view, row } = await mount(ENTRIES, () => {}, [], {
      post: (_path, body) => ({
        status: 409, body: { error: typeof body === 'object' && body !== null && 'to' in body ? 'Step g1 is gone' : 'Nothing to undo' },
      }),
    })
    await waitFor(() => { row('g1') })
    fireEvent.click(view.getByTestId('dv-history-undo'))
    await waitFor(() => { expect(view.getByText('Nothing to undo')).toBeTruthy() })
    menuOf(row('g1'))
    fireEvent.click(within(row('g1')).getByTestId('dv-history-step-back'))
    await waitFor(() => { expect(view.getByText('Step g1 is gone')).toBeTruthy() })
  })

  it('says why the history could not be read', async () => {
    const { view } = await mount(ENTRIES, () => {}, [], { serve: () => Promise.reject(new TypeError('Failed to fetch')) })
    await waitFor(() => { expect(view.getByTestId('dv-history-panel').textContent).toContain('Failed to load: Failed to fetch') })
  })

  it('lists the steps before the project state and the operation labels arrive', async () => {
    let release = (): void => {}
    const arrived = new Promise<void>((resolve) => { release = resolve })
    const { row, shown } = await mount(ENTRIES, () => {}, [], {
      hold: url => url.startsWith('/api/dv/state') || url.startsWith('/api/dv/operations') ? arrived : Promise.resolve(),
    })
    await waitFor(() => { row('m1') })
    expect(row('m1').textContent).toContain('timeline.clip_move')
    fireEvent.click(row('g1'))
    expect(shown).toEqual([{ view: 'canvas', target: { record: 'g1' } }])
    await act(async () => { release(); await arrived })
    await waitFor(() => { expect(row('m1').textContent).toContain('Move clip') })
  })

  it('loads the steps before the oldest loaded one with 加载更多 while the last page was full', async () => {
    const { view, row, queries } = await mount(steps(53), () => {}, [])
    const listed = (): number => view.container.querySelectorAll('[data-testid="dv-history-row"]').length
    await waitFor(() => { row('r49') })
    expect(listed()).toBe(50)
    fireEvent.click(view.getByTestId('dv-history-more'))
    await waitFor(() => { row('r52') })
    expect(listed()).toBe(53)
    expect(queries.at(-1)).toEqual({ project: 'p1', before: 'r49', limit: 50 })
    expect(view.queryByTestId('dv-history-more')).toBeNull()
  })

  it('starts a project switch from an empty panel, and the previous project\'s unanswered request shows no failure', async () => {
    const { view, row } = await mount(ENTRIES, () => {}, [], {
      serve: (query, signal) => query.project === 'p1' ? neverAnswered(signal) : serveEntries(ENTRIES)(query, signal),
    })
    await waitFor(() => { expect(view.getByTestId('dv-history-panel').textContent).toContain('Loading…') })
    act(() => { publishCurrentProject('p2') })
    await waitFor(() => { row('g1') })
    expect(view.getByTestId('dv-history-panel').textContent).not.toContain('Failed to load')
  })

  it('refreshes how long ago each step was made every half minute', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const recent: HistoryEntry = {
      record: record({ id: 'n1', operation: 'timeline.clip_move', created_at: new Date(Date.now() - 50_000).toISOString() }), place: 'current',
    }
    const { row } = await mount([recent], () => {}, [])
    const time = (): string => within(row('n1')).getByTestId('dv-history-time').textContent ?? ''
    await waitFor(() => { expect(time()).toBe('just now') })
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(time()).toBe('1 min ago')
  })

  it('removes the tab body and its media with the History plugin', async () => {
    const { row, history, view, runtime } = await mount()
    await waitFor(() => { expect(drawn(row('g1'))).toEqual(['shot1.mp4@thumb']) })
    await history.dispose()
    await waitFor(() => { expect(view.container.querySelector('[data-testid="dv-history-panel"]')).toBeNull() })
    expect(runtime.slots.entries('sidebar.right.pane.tab')).toEqual([])
  })
})

describe('dv:history-focus', () => {
  it('opens the fold that holds the focused record', async () => {
    const chain: HistoryEntry[] = [
      {
        record: record({ id: 'g1', actor: 'system', session: 's5', tool_call: 'call-g1', operation: 'shot.render', started_by: { record: 'ap', slot: 1 } }),
        place: 'current',
      },
      { record: record({ id: 'ap', actor: 'agent', operation: 'cut.assemble' }), place: 'before' },
    ]
    const { view, row } = await mount(chain)
    await waitFor(() => { row('ap') })
    focusCall('call-g1')
    await waitFor(() => { expect(row('g1').getAttribute('aria-selected')).toBe('true') })
    expect(view.getByTestId('dv-history-fold').getAttribute('aria-expanded')).toBe('true')
  })

  it('loads further pages until it finds the focused record', async () => {
    const { row, queries } = await mount(steps(53), () => {}, [])
    await waitFor(() => { row('r0') })
    focusCall('call-r52')
    await waitFor(() => { expect(row('r52').getAttribute('aria-selected')).toBe('true') })
    expect(queries).toContainEqual({ project: 'p1', before: 'r49', limit: 50 })
  })

  it('takes a request that arrived while the tab was closed once the panel mounts', async () => {
    focusCall('call-p1')
    const { row } = await mount()
    await waitFor(() => { expect(row('p1').getAttribute('aria-selected')).toBe('true') })
  })

  it('selects nothing for a record that the history list does not hold', async () => {
    const elsewhere: HistoryEntry = { record: record({ id: 'x9', session: 's5', tool_call: 'call-x9', operation: 'timeline.clip_move' }), place: 'before' }
    const { view, row, queries } = await mount(ENTRIES, () => {}, [], {
      serve: (query, signal) => serveEntries(query.tool_call === undefined ? ENTRIES : [elsewhere])(query, signal),
    })
    await waitFor(() => { row('p1') })
    focusCall('call-x9')
    await waitFor(() => { expect(queries).toHaveLength(2) })
    await settle()
    expect(view.container.querySelectorAll('[aria-selected="true"]')).toHaveLength(0)
    expect(queries.filter(query => query.before !== undefined)).toEqual([])
  })

  it('says when the tool call wrote no record, and why the lookup failed', async () => {
    let reachable = true
    const { view, row } = await mount(ENTRIES, () => {}, [], {
      serve: (query, signal) => reachable ? serveEntries(ENTRIES)(query, signal) : Promise.reject(new TypeError('Failed to fetch')),
    })
    await waitFor(() => { row('p1') })
    focusCall('call-none')
    await waitFor(() => { expect(view.getByText('This call wrote no record')).toBeTruthy() })
    reachable = false
    focusCall('call-p1')
    await waitFor(() => { expect(view.getByText('TypeError: Failed to fetch')).toBeTruthy() })
    expect(view.queryByText('This call wrote no record')).toBeNull()
  })
})

describe('the History tab over /dv/events', () => {
  it('changes a row in place on an update event, and reloads the loaded steps once after a burst of other changes', async () => {
    const emit = stubEventSource()
    const { row, queries } = await mount()
    await waitFor(() => { row('g1') })
    emit('ready', '')
    emit('update', frame('update', FAILED_RENDER))
    expect(row('g1').getAttribute('data-status')).toBe('failed')
    expect(queries).toHaveLength(1)
    emit('record', frame('record', record({ id: 'n1', operation: 'timeline.clip_move' })))
    emit('line', 'not json')
    await waitFor(() => { expect(row('g1').getAttribute('data-status')).toBe('done') })
    await settle()
    expect(queries).toEqual([{ project: 'p1', limit: 50 }, { project: 'p1', limit: 50 }])
  })

  it('ignores an update before the first page arrives, and a change before it loads the list', async () => {
    const emit = stubEventSource()
    let first = true
    const { row, queries } = await mount(ENTRIES, () => {}, [], {
      serve: (query, signal) => {
        if (!first) return serveEntries(ENTRIES)(query, signal)
        first = false
        return neverAnswered(signal)
      },
    })
    await waitFor(() => { expect(queries).toHaveLength(1) })
    emit('update', frame('update', FAILED_RENDER))
    emit('record', frame('record', FAILED_RENDER))
    await waitFor(() => { row('g1') })
    expect(row('g1').getAttribute('data-status')).toBe('done')
    expect(queries).toEqual([{ project: 'p1', limit: 50 }, { project: 'p1', limit: 50 }])
  })

  it('keeps the shown steps when a reload fails', async () => {
    const emit = stubEventSource()
    let reachable = true
    const { view, row, queries } = await mount(ENTRIES, () => {}, [], {
      serve: (query, signal) => reachable ? serveEntries(ENTRIES)(query, signal) : Promise.reject(new TypeError('Failed to fetch')),
    })
    await waitFor(() => { row('g1') })
    reachable = false
    emit('record', 'not json')
    await waitFor(() => { expect(queries).toHaveLength(2) })
    await settle()
    expect(view.container.querySelectorAll('[data-testid="dv-history-row"]')).toHaveLength(3)
    expect(view.getByTestId('dv-history-panel').textContent).not.toContain('Failed to load')
  })

  it('drops a pending reload when the tab closes', async () => {
    const emit = stubEventSource()
    const { view, row, queries } = await mount()
    await waitFor(() => { row('g1') })
    emit('record', 'not json')
    view.unmount()
    await settle()
    expect(queries).toHaveLength(1)
  })
})

describe('HistoryPanel', () => {
  it('keeps a page that the previous project answers after a project switch out of the list', async () => {
    const pages: Record<string, HistoryEntry[]> = {
      p1: steps(50), p2: [{ record: record({ id: 'q1', operation: 'timeline.clip_move' }), place: 'current' }],
    }
    let answerLate: (page: WireHistory) => void = () => {}
    const scripted = scriptedFetch({ operations: WIRE_OPERATIONS })
    const fetchImpl: typeof fetch = (input, init) => {
      if (input !== '/api/dv/history') return scripted.fetch(input, init)
      const query = JSON.parse(typeof init?.body === 'string' ? init.body : '') as HistoryQuery
      if (query.before !== undefined) {
        return new Promise((resolve) => { answerLate = (page) => { resolve(new Response(JSON.stringify(page))) } })
      }
      return Promise.resolve(new Response(JSON.stringify({ entries: pages[query.project] ?? [], assets: [] })))
    }
    const client = new DvClient(fetchImpl)
    const panel = (project: string): ReactNode => (
      <HistoryPanel projectId={project} client={client} rows={[]} showInCenter={() => {}} renderFactorySlot={() => null} />
    )
    const view = render(panel('p1'))
    const listed = (): Array<string | null> => [...view.container.querySelectorAll('[data-testid="dv-history-row"]')].map(element => element.getAttribute('data-record'))
    fireEvent.click(await view.findByTestId('dv-history-more'))
    view.rerender(panel('p2'))
    await waitFor(() => { expect(listed()).toEqual(['q1']) })
    await act(async () => { answerLate({ entries: [{ record: record({ id: 'late', operation: 'timeline.clip_move' }), place: 'before' }], assets: [] }) })
    expect(listed()).toEqual(['q1'])
  })
})
