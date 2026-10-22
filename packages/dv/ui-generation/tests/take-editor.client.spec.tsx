// @vitest-environment jsdom
/**
 * The take editor of a generation kind through the kit plugin's `dv.canvas.editor.claimed` entry, with the real media,
 * asset pool and composer plugins: the player, the model and task line, the `dv.prompt` composer over the take's call,
 * and what the editor asks the canvas host for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { currentLanguage } from '@dv/ui-kit/locale.ts'
import type { ProjectRecord, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { testRef } from '../../ui-canvas/tests/canvas-runtime.client.tsx'
import { fixtureState, OPERATIONS, record, scriptedFetch, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import { claimedOf, CLIP_EXTEND, mountKit, recordingHost } from './take-kind.client.ts'

let runtime: SlotTestRuntime | undefined

beforeEach(() => {
  vi.stubGlobal('fetch', scriptedFetch({ state: withTestRef(fixtureState()) }).fetch)
  // jsdom has no layout: the editor measures its selection.
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
afterEach(async () => {
  await runtime?.dispose()
  runtime = undefined
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.lang = ''
})

/**
 * Open the take editor of one record of a state, as the canvas renders it for the node that the graph builder draws.
 * @param id - the record ID.
 * @param options - the record changes, a record to append, the declarations the canvas passes, and what the host's
 *   `rerun` returns.
 * @returns the editor's view and the recording host.
 */
async function openEditor(id: string, options: {
  edit?: (record: ProjectRecord) => ProjectRecord
  append?: ProjectRecord
  operations?: WireOperation[]
  rerun?: () => Promise<void>
} = {}) {
  const mounted = await mountKit({ 'dv.canvas.editor.claimed': { kind: 'keyed', scope: 'root' } })
  runtime = mounted.runtime
  // The reference noun whose version kind names the take's `hero@1` input.
  await runtime.mount({ inject: [...testRef.inject], apply: testRef.apply })
  const state: WireState = withTestRef(fixtureState())
  const edit = options.edit ?? (record => record)
  state.components.proj.records = [
    ...state.components.proj.records.map(record => record.id === id ? edit(record) : record),
    ...options.append === undefined ? [] : [options.append],
  ]
  const operations = options.operations ?? OPERATIONS
  const node = claimedOf(mounted.canvas, state, operations, currentLanguage()).get(id)
  if (node === undefined) throw new Error(`no node ${id}`)
  const host = recordingHost(options.rerun)
  const slot = runtime.renderSlot('dv.canvas.editor.claimed', { node, state, operations, host }, { entryKey: 'test_take' })
  return { ...slot, host }
}

/** The composer's send button, once the call's check has answered. */
async function sendButton(view: Awaited<ReturnType<typeof openEditor>>['view'], name: string): Promise<HTMLButtonElement> {
  return waitFor(() => {
    const button = view.getByRole<HTMLButtonElement>('button', { name })
    expect(button.disabled).toBe(false)
    return button
  })
}

describe('the take editor', () => {
  it('plays the first output muted and looping behind the take\'s still, reads the model and the task label, and composes the take\'s call', async () => {
    document.documentElement.lang = 'en'
    const { container, view } = await openEditor('g1')
    const player = view.getByTestId('dv-take-player').querySelector('video')
    expect([player?.getAttribute('src'), player?.getAttribute('poster'), player?.hasAttribute('controls'), player?.muted, player?.loop])
      .toEqual(['/dv/assets/shot1.mp4', '/dv/assets/shot1-last.png', true, true, true])
    await waitFor(() => { expect(view.getByTestId('dv-canvas-render-mode').textContent).toBe('fasth3 · From references') })
    await waitFor(() => {
      expect(container.querySelector('[data-composer-input]')?.textContent).toBe('hero walks through the rain at night in the city')
    })
    await waitFor(() => { expect(container.querySelector('[data-reference-tile="hero@1"]')?.textContent).toContain('Herov1') })
    expect([...container.querySelectorAll('[data-param-chip]')].map(chip => chip.getAttribute('data-param-chip'))).toEqual(['seed', 'aspect', 'loop'])
  })

  it('draws the player in a box of the full width and 360 px tall for a take whose size is not stored', async () => {
    const { view } = await openEditor('g1')
    const box = view.getByTestId('dv-take-player')
    expect([box.style.width, box.style.height]).toEqual(['100%', '360px'])
  })

  it('names the task in Chinese under <html lang="zh-CN">', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view } = await openEditor('g1')
    await waitFor(() => { expect(view.getByTestId('dv-canvas-render-mode').textContent).toBe('fasth3 · 参考图生成') })
    expect(view.getByText('模型和生成方式')).toBeTruthy()
  })

  it('reruns the take\'s call based on the take, naming a version that fans out to two assets once', async () => {
    document.documentElement.lang = 'zh-CN'
    const twice = { role: 'reference', ref: { test_ref: 'hero', version: 1 }, resolved_asset: 'ref.png' }
    const { view, host } = await openEditor('g1', { edit: record => ({ ...record, inputs: [twice, { ...twice, resolved_asset: 'ref2.png' }] }) })
    fireEvent.click(await sendButton(view, '生成新版本'))
    await waitFor(() => { expect(host.rerun).toHaveBeenCalledTimes(1) })
    expect(host.rerun).toHaveBeenCalledWith({
      operation: 'shot.render', inputs: [{ role: 'reference', ref: 'hero@1' }],
      params: { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'hero walks through the rain at night in the city' },
      intent: '在画布上渲染 shot.render · 第 1 次 的新版本', based_on: 'g1',
    })
  })

  it('sends a param that a chip of the composer changed', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view, host } = await openEditor('g1')
    fireEvent.change(await waitFor(() => view.getByLabelText('aspect')), { target: { value: '9:16' } })
    fireEvent.click(await sendButton(view, '生成新版本'))
    await waitFor(() => { expect(host.rerun.mock.calls[0]?.[0].params).toMatchObject({ aspect: '9:16' }) })
  })

  it('reads the composer\'s sending words and stays disabled while the rerun waits', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view } = await openEditor('g1', { rerun: () => new Promise<void>(() => undefined) })
    fireEvent.click(await sendButton(view, '生成新版本'))
    const button = await waitFor(() => view.getByRole('button', { name: '生成中…' }))
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('shows the error of a refused rerun under the composer and offers the send again', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view, host } = await openEditor('g1', { rerun: () => Promise.reject(new Error('GPU budget exceeded')) })
    fireEvent.click(await sendButton(view, '生成新版本'))
    expect((await view.findByRole('alert')).textContent).toBe('失败：GPU budget exceeded')
    fireEvent.click(await sendButton(view, '生成新版本'))
    await waitFor(() => { expect(host.rerun).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(view.getByRole('alert').textContent).toBe('失败：GPU budget exceeded') })
  })

  it('opens the node of a versioned tile, picks with the held references, previews a picked asset, and drops a removed one from the rerun', async () => {
    document.documentElement.lang = 'zh-CN'
    const { container, view, host } = await openEditor('g1')
    const hero = await waitFor(() => {
      const tile = container.querySelector('[data-reference-tile="hero@1"] button')
      expect(tile?.textContent).toContain('Hero')
      return tile!
    })
    fireEvent.click(hero)
    expect(host.openNode).toHaveBeenCalledWith('test_ref:hero')
    fireEvent.click(view.getByRole('button', { name: '添加素材' }))
    expect(host.pickAssets).toHaveBeenCalledWith(['hero@1'], { versions: true }, expect.any(Function))
    act(() => { host.pickAssets.mock.calls[0]?.[2](['hero@1', 'shot1.mp4']) })
    const asset = await waitFor(() => container.querySelector('[data-reference-tile="shot1.mp4"] button')!)
    fireEvent.click(asset)
    expect(host.preview).toHaveBeenCalledWith('shot1.mp4', asset)
    fireEvent.click(view.getByRole('button', { name: '移除 shot1.mp4' }))
    await waitFor(() => { expect(container.querySelector('[data-reference-tile="shot1.mp4"]')).toBeNull() })
    fireEvent.click(await sendButton(view, '生成新版本'))
    await waitFor(() => { expect(host.rerun.mock.calls[0]?.[0].inputs).toEqual([{ role: 'reference', ref: 'hero@1' }]) })
  })

  it('leaves the model and the task out of the mode line of a take whose params name neither as text', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view } = await openEditor('g1', { edit: record => ({ ...record, params: { ...record.params, model: 7, task: null } }) })
    expect(view.getByTestId('dv-canvas-render-mode').textContent).toBe(' · ')
  })

  it('offers no references for a take whose operation declares no reference input', async () => {
    document.documentElement.lang = 'zh-CN'
    const { container, view } = await openEditor('x1', {
      append: record({ id: 'x1', operation: 'clip.extend', deterministic: false, params: { prompt: 'longer' }, outputs: ['shot1.mp4'] }),
      operations: [...OPERATIONS, CLIP_EXTEND],
    })
    await waitFor(() => { expect(container.querySelector('[data-composer-input]')?.textContent).toBe('longer') })
    expect([view.queryByRole('button', { name: '添加素材' }), view.queryByTestId('dv-prompt-upload')]).toEqual([null, null])
  })

  it('imports an uploaded file through the canvas host and sends it as a reference', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view, host } = await openEditor('g1')
    const upload = await waitFor(() => view.getByTestId('dv-prompt-upload'))
    fireEvent.change(upload, { target: { files: [new File(['x'], 'shot1-last.png', { type: 'image/png' })] } })
    await waitFor(() => { expect(host.importFiles).toHaveBeenCalledTimes(1) })
    fireEvent.click(await sendButton(view, '生成新版本'))
    await waitFor(() => {
      expect(host.rerun.mock.calls[0]?.[0].inputs).toEqual([{ role: 'reference', ref: 'hero@1' }, { role: 'reference', ref: 'shot1-last.png' }])
    })
  })

  it('shows the failure reason of a failed take', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view } = await openEditor('g1', {
      edit: record => ({ ...record, status: 'failed', outputs: [], error: { code: 'operation_failed', message: 'GPU out of memory' } }),
    })
    expect(view.getByRole('note').textContent).toBe('失败原因：GPU out of memory')
    expect(view.queryByTestId('dv-take-player')).toBeNull()
  })

  it('shows no failure banner for a failed take whose failure has no message', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view } = await openEditor('g1', {
      edit: record => ({ ...record, status: 'failed', outputs: [], error: { code: 'operation_failed', message: '' } }),
    })
    expect(view.getByTestId('dv-canvas-render-mode')).toBeTruthy()
    expect([view.queryByRole('note'), view.queryByText(/失败原因/)]).toEqual([null, null])
  })

  it('shows no composer for a take whose operation the declarations do not name', async () => {
    document.documentElement.lang = 'zh-CN'
    const { container, view } = await openEditor('g1', { operations: [] })
    expect(container.querySelector('[data-dv-prompt]')).toBeNull()
    expect(view.queryByRole('button', { name: '生成新版本' })).toBeNull()
  })
})
