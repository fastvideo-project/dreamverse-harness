// @vitest-environment jsdom
/**
 * The chat card of a generation tool call, rendered through the kit plugin's `tool.call.toolview` entry in a chat
 * session with the real media plugins.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { DV_HISTORY_FOCUS_EVENT } from '@dv/ui-kit/workspace-events.ts'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { DvClient } from '@dv/ui-kit/api.ts'
import { labelSources } from '../src/client/loaded.ts'
import { fixtureState, record, OPERATIONS, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import type { WireState } from '@dv/ui-kit/types.ts'
import { mountKit } from './take-kind.client.ts'

let runtime: SlotTestRuntime | undefined
let reference: Disposable | undefined

afterEach(async () => {
  reference?.[Symbol.dispose]()
  reference = undefined
  await runtime?.dispose()
  runtime = undefined
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.lang = ''
  publishCurrentProject(null)
})

const LABELLED = [{ ...OPERATIONS[0]!, label: { zh: '渲染镜头', en: 'Render shot' } }]

/**
 * Render the chat card of one `dv_shot_render` call in chat session `s1`.
 * @param phase - the call's phase.
 * @param block - the call block.
 * @returns the card's view, whose `show` re-renders the call at another phase.
 */
async function renderCall(phase: 'start' | 'result', block: object, state?: WireState) {
  vi.stubGlobal('fetch', scriptedFetch({ operations: LABELLED, ...state === undefined ? {} : { state } }).fetch)
  const mounted = await mountKit({
    'tool.call.toolview': { kind: 'keyed', scope: 'session', inject: { hooks: { toolCallArgumentsPartial: () => () => '' } } },
  })
  runtime = mounted.runtime
  const session = await runtime.sessions.add({ id: 's1' })
  const retained = runtime.sessions.retain(session)
  reference = retained
  const owner = (nextPhase: 'start' | 'result', nextBlock: object) => ({
    callId: 'call-2', toolName: 'dv_shot_render', useDisclosure: () => [false, () => {}], openFile: () => {}, loadImage: () => Promise.resolve(''),
    phase: nextPhase, block: nextBlock,
  }) as never
  const slot = runtime.renderSlot('tool.call.toolview', owner(phase, block), {
    entryKey: 'dv_shot_render', session: retained, hookContext: { callId: 'call-2', assistant: undefined },
  })
  return { ...slot, show: (nextPhase: 'start' | 'result', nextBlock: object) => { slot.update(owner(nextPhase, nextBlock)) } }
}

const ARGS = JSON.stringify({ modality: 'video', task: 't2v', provider: 'fastvideo', model: 'fasth3', prompt: 'a lighthouse at dusk' })

describe('the chat card of a generation call', () => {
  it('plays its completed record while the surrounding batch tool result is still pending', async () => {
    document.documentElement.lang = 'en'
    const state = fixtureState()
    state.components.proj.records.push(record({ id: 'finished', operation: 'shot.render', session: 's1',
      tool_call: 'call-2', outputs: ['shot1.mp4', 'shot1-last.png'], status: 'done' }))
    publishCurrentProject('p1')
    const { container, view } = await renderCall('start', { argsRaw: ARGS }, state)
    await waitFor(() => { expect(container.textContent).toContain('Generated') })
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/dv/assets/shot1.mp4')
    expect(view.queryByRole('progressbar')).toBeNull()
    expect(view.getByRole('button', { name: 'Show in history' })).toBeTruthy()
  })

  it('shows queued progress, then follows a record event to its own failure without waiting for the batch', async () => {
    document.documentElement.lang = 'en'
    const listeners = new Map<string, EventListener>()
    class FakeEventSource {
      constructor(readonly url: string) {}
      addEventListener(type: string, listener: EventListener): void { listeners.set(type, listener) }
      removeEventListener(type: string): void { listeners.delete(type) }
      close(): void {}
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    const state = fixtureState()
    const pending = record({ id: 'pending', operation: 'shot.render', session: 's1', tool_call: 'call-2', status: 'pending' })
    state.components.proj.records.push(pending)
    publishCurrentProject('p1')
    const { container, view } = await renderCall('start', { argsRaw: ARGS }, state)
    await waitFor(() => { expect(view.getByRole('progressbar').getAttribute('aria-label')).toBe('Queued') })
    expect(view.getByRole('progressbar').hasAttribute('value')).toBe(false)
    pending.status = 'failed'
    listeners.get('record')?.(new MessageEvent('record', { data: 'changed' }))
    await waitFor(() => { expect(container.textContent).toContain('Not generated') })
    expect(view.queryByRole('progressbar')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
  })

  it('keeps queued progress for a non-error tool result while its record is pending', async () => {
    document.documentElement.lang = 'en'
    const state = fixtureState()
    state.components.proj.records.push(record({ id: 'pending', operation: 'shot.render', session: 's1', tool_call: 'call-2', status: 'pending' }))
    publishCurrentProject('p1')
    const { container, view } = await renderCall('result', { argsRaw: ARGS }, state)
    await waitFor(() => { expect(view.getByRole('progressbar').getAttribute('aria-label')).toBe('Queued') })
    expect(container.textContent).toContain('Queued')
    expect(view.queryByRole('button', { name: 'Show in history' })).toBeNull()
  })

  it('does not mistake another session’s record for this call', async () => {
    document.documentElement.lang = 'en'
    const state = fixtureState()
    state.components.proj.records.push(record({ id: 'other', operation: 'shot.render', session: 'another',
      tool_call: 'call-2', outputs: ['shot1.mp4'], status: 'done' }))
    publishCurrentProject('p1')
    const { container, view } = await renderCall('start', { argsRaw: ARGS }, state)
    await waitFor(() => { expect(container.textContent).toContain('Render shot') })
    expect(view.getByRole('progressbar')).toBeTruthy()
    expect(container.querySelector('video')).toBeNull()
  })

  it('does not mistake another tool call’s record in this session for this call', async () => {
    document.documentElement.lang = 'en'
    const state = fixtureState()
    state.components.proj.records.push(record({ id: 'other', operation: 'shot.render', session: 's1',
      tool_call: 'call-9', outputs: ['shot1.mp4'], status: 'done' }))
    publishCurrentProject('p1')
    const { container, view } = await renderCall('start', { argsRaw: ARGS }, state)
    await waitFor(() => { expect(container.textContent).toContain('Render shot') })
    expect(view.getByRole('progressbar')).toBeTruthy()
    expect(container.querySelector('video')).toBeNull()
  })

  it('does not mistake another operation’s record of this call for this call', async () => {
    document.documentElement.lang = 'en'
    const state = fixtureState()
    state.components.proj.records.push(record({ id: 'other', operation: 'timeline.create', session: 's1',
      tool_call: 'call-2', outputs: ['shot1.mp4'], status: 'done' }))
    publishCurrentProject('p1')
    const { container, view } = await renderCall('start', { argsRaw: ARGS }, state)
    await waitFor(() => { expect(container.textContent).toContain('Render shot') })
    expect(view.getByRole('progressbar')).toBeTruthy()
    expect(container.querySelector('video')).toBeNull()
  })

  it('names the call and its task by their names until GET /api/dv/operations and GET /api/dv/tasks answer, then by their labels', async () => {
    document.documentElement.lang = 'en'
    const { container, view } = await renderCall('start', { argsRaw: ARGS })
    expect(view.getByTestId('dv-composer-render-model').textContent).toBe('fasth3 · t2v')
    expect(container.textContent).toContain('shot.render')
    await waitFor(() => { expect(view.getByTestId('dv-composer-render-model').textContent).toBe('fasth3 · From text') })
    expect(container.textContent).toContain('Render shot')
    expect(container.textContent).not.toContain('shot.render')
    expect(container.textContent).toContain('a lighthouse at dusk')
    expect(container.textContent).toContain('Generating…')
    expect(view.queryByTestId('dv-composer-open-history')).toBeNull()
  })

  it('plays the first output once the call settled, reads the done words, and 在历史中查看 asks History for the call', async () => {
    document.documentElement.lang = 'zh-CN'
    const { container, view, show } = await renderCall('start', { argsRaw: '{"model":"fasth3","task":"i2v","prompt":"Picture 1 walks"}' })
    await waitFor(() => { expect(container.textContent).toContain('渲染镜头') })
    expect(container.textContent).toContain('生成中…')
    show('result', { call: { argsRaw: '{"model":"fasth3","task":"i2v","prompt":"Picture 1 walks"}' }, meta: { outputs: [{ role: 'video', asset_id: 'v1.mp4', mime: 'video/mp4' }] } })
    expect(view.getByTestId('dv-composer-render-model').textContent).toBe('fasth3 · i2v')
    const video = container.querySelector('video')
    expect([video?.getAttribute('src'), video?.hasAttribute('controls')]).toEqual(['/dv/assets/v1.mp4', true])
    expect(container.textContent).toContain('已生成')
    const focused: unknown[] = []
    const listener = (event: Event): void => { focused.push((event as CustomEvent).detail) }
    window.addEventListener(DV_HISTORY_FOCUS_EVENT, listener)
    fireEvent.click(view.getByRole('button', { name: '在历史中查看' }))
    window.removeEventListener(DV_HISTORY_FOCUS_EVENT, listener)
    expect(focused).toEqual([{ session: 's1', toolCall: 'call-2' }])
  })

  it('plays a settled call\'s first output muted, with controls, behind the still that the kind picks as the poster', async () => {
    const outputs = [{ role: 'video', asset_id: 'v1.mp4', mime: 'video/mp4' }, { role: 'still', asset_id: 'v1.png', mime: 'image/png' }]
    const { container } = await renderCall('result', { call: { argsRaw: ARGS }, meta: { outputs } })
    const video = container.querySelector('video')
    expect([video?.getAttribute('src'), video?.muted, video?.hasAttribute('controls'), video?.getAttribute('poster')])
      .toEqual(['/dv/assets/v1.mp4', true, true, '/dv/assets/v1.png'])
  })

  it('reads the failed words for a call that settled as an error, with the arguments of the settled call block', async () => {
    document.documentElement.lang = 'en'
    const { container, view } = await renderCall('result', { call: { argsRaw: '{"model":"fasth3","prompt":"a red kite"}' }, isError: true })
    expect(view.getByTestId('dv-composer-render-model').textContent).toBe('fasth3')
    expect(container.textContent).toContain('a red kite')
    expect(container.textContent).toContain('Not generated')
    expect(container.querySelector('video')).toBeNull()
    expect(view.getByRole('button', { name: 'Show in history' })).toBeTruthy()
  })

  it('plays the tool result\'s outputs when its done record names outputs that the project does not hold', async () => {
    document.documentElement.lang = 'en'
    const state = fixtureState()
    state.components.proj.records.push(record({ id: 'finished', operation: 'shot.render', session: 's1',
      tool_call: 'call-2', outputs: ['missing.mp4'], status: 'done' }))
    publishCurrentProject('p1')
    const { container } = await renderCall('result',
      { call: { argsRaw: ARGS }, meta: { outputs: [{ role: 'video', asset_id: 'v1.mp4', mime: 'video/mp4' }] } }, state)
    await waitFor(() => { expect(container.textContent).toContain('Generated') })
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/dv/assets/v1.mp4')
  })

  it('reads Cancelled without progress for a cancelled record', async () => {
    document.documentElement.lang = 'en'
    const state = fixtureState()
    state.components.proj.records.push(record({ id: 'cancelled', operation: 'shot.render', session: 's1', tool_call: 'call-2', status: 'cancelled' }))
    publishCurrentProject('p1')
    const { container, view } = await renderCall('start', { argsRaw: ARGS }, state)
    await waitFor(() => { expect(container.textContent).toContain('Cancelled') })
    expect(view.queryByRole('progressbar')).toBeNull()
    expect(view.getByRole('button', { name: 'Show in history' })).toBeTruthy()
  })

  it('shows only the name and the status while the call has no readable model, task or prompt', async () => {
    document.documentElement.lang = 'en'
    const { container, view, show } = await renderCall('start', {})
    await waitFor(() => { expect(container.textContent).toBe('Render shotGenerating…') })
    for (const block of [{ argsRaw: 42 }, { call: null }, { call: 'pending' }, { call: {} }, { argsRaw: '{"model":1,"task":2,"prompt":3}' }]) {
      show('start', block)
      expect(container.textContent).toBe('Render shotGenerating…')
      expect(view.queryByTestId('dv-composer-render-model')).toBeNull()
    }
  })
})

describe('the chat assets source of the kit', () => {
  it('shares one project stream between listeners and keeps updating the listener that remains', async () => {
    const opened: string[] = []
    let closed = 0
    class FakeEventSource {
      constructor(readonly url: string) { opened.push(url) }
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void { closed += 1 }
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    const state = fixtureState()
    publishCurrentProject('p1')
    const { chatAssets } = labelSources(new DvClient(scriptedFetch({ state }).fetch)).hooks
    const first = chatAssets.subscribe(() => {})
    let updates = 0
    const second = chatAssets.subscribe(() => { updates += 1 })
    await waitFor(() => { expect(chatAssets.getSnapshot().project).toBe('p1') })
    expect(opened).toEqual(['/dv/events?project=p1'])
    first()
    expect(closed).toBe(0)
    const seen = updates
    publishCurrentProject(null)
    expect(chatAssets.getSnapshot().project).toBeNull()
    expect(updates).toBe(seen + 1)
    second()
    expect(closed).toBe(1)
  })

  it('stops following once when a listener unsubscribes twice', async () => {
    let closed = 0
    class FakeEventSource {
      constructor(readonly url: string) {}
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void { closed += 1 }
    }
    vi.stubGlobal('EventSource', FakeEventSource)
    publishCurrentProject('p1')
    const { chatAssets } = labelSources(new DvClient(scriptedFetch({ state: fixtureState() }).fetch)).hooks
    const unsubscribe = chatAssets.subscribe(() => {})
    await waitFor(() => { expect(chatAssets.getSnapshot().project).toBe('p1') })
    unsubscribe()
    unsubscribe()
    expect(closed).toBe(1)
  })
})
