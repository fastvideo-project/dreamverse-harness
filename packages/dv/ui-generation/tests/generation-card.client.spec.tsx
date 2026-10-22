// @vitest-environment jsdom
/**
 * The chat card of a generation tool call through the kit plugin's `tool.call.toolview` entry in a chat session: the
 * operation's wire label, the model and task line, the prompt, the kind's status words per phase, the first output
 * drawn by the real media plugins, and the 在历史中查看 link once the call settled.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { DV_HISTORY_FOCUS_EVENT } from '@dv/ui-kit/workspace-events.ts'
import { OPERATIONS, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
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
})

/** The `GET /api/dv/operations` answer: the fixture's `shot.render` with its wire label. */
const LABELLED = [{ ...OPERATIONS[0]!, label: { zh: '渲染镜头', en: 'Render shot' } }]

/**
 * Render the chat card of one `dv_shot_render` call in chat session `s1`.
 * @param phase - the call's phase.
 * @param block - the call block.
 * @returns the card's view, whose `show` re-renders the call at another phase.
 */
async function renderCall(phase: 'start' | 'result', block: object) {
  vi.stubGlobal('fetch', scriptedFetch({ operations: LABELLED }).fetch)
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
    // A task without a catalog label shows its name.
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
