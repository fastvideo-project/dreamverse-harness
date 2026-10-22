// @vitest-environment jsdom
/**
 * The take editor of a generation kind through the kit plugin's `dv.canvas.editor.claimed` entry, with the real media and asset
 * pool plugins drawing the media: the player, the model and task line, the param fields, the reference chips and what
 * the editor asks the canvas host for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { currentLanguage } from '@dv/ui-kit/locale.ts'
import type { ProjectRecord, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { fixtureState, OPERATIONS, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { claimedOf, mountKit, recordingHost } from './take-kind.client.ts'

let runtime: SlotTestRuntime | undefined

beforeEach(() => { vi.stubGlobal('fetch', scriptedFetch().fetch) })
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
 * @param options - the record changes, the declarations the canvas passes, and what the host's `rerun` returns.
 * @returns the editor's view and the recording host.
 */
async function openEditor(id: string, options: {
  edit?: (record: ProjectRecord) => ProjectRecord
  operations?: WireOperation[]
  rerun?: () => Promise<void>
} = {}) {
  const mounted = await mountKit({ 'dv.canvas.editor.claimed': { kind: 'keyed', scope: 'root' } })
  runtime = mounted.runtime
  const state: WireState = fixtureState()
  const edit = options.edit ?? (record => record)
  state.components.proj.records = state.components.proj.records.map(record => record.id === id ? edit(record) : record)
  const operations = options.operations ?? OPERATIONS
  const node = claimedOf(mounted.canvas, state, operations, currentLanguage()).get(id)
  if (node === undefined) throw new Error(`no node ${id}`)
  const host = recordingHost(options.rerun, state)
  const slot = runtime.renderSlot('dv.canvas.editor.claimed', { node, state, operations, host }, { entryKey: 'test_take' })
  return { ...slot, host }
}

describe('the take editor', () => {
  it('plays the first output muted and looping behind the take\'s still, reads the model and the task label of GET /api/dv/tasks, and shows the prompt and the declared params', async () => {
    document.documentElement.lang = 'en'
    const { container, view } = await openEditor('g1')
    const player = view.getByTestId('dv-take-player').querySelector('video')
    expect([player?.getAttribute('src'), player?.getAttribute('poster'), player?.hasAttribute('controls'), player?.muted, player?.loop])
      .toEqual(['/dv/assets/shot1.mp4', '/dv/assets/shot1-last.png', true, true, true])
    await waitFor(() => { expect(view.getByTestId('dv-canvas-render-mode').textContent).toBe('fasth3 · From references') })
    expect(view.getByLabelText<HTMLTextAreaElement>('Prompt').value).toBe('hero walks through the rain at night in the city')
    expect([...container.querySelectorAll('label')].map(label => label.textContent)).toEqual(['Prompt', 'Seed', 'aspect', 'loop', 'extra'])
  })

  it('names the task in Chinese under <html lang="zh-CN">', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view } = await openEditor('g1')
    await waitFor(() => { expect(view.getByTestId('dv-canvas-render-mode').textContent).toBe('fasth3 · 参考图生成') })
    expect(view.getByText('模型和生成方式')).toBeTruthy()
  })

  it('renders a new take of the edited prompt based on the take, keeping the model key params and the references', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view, host } = await openEditor('g1')
    fireEvent.change(view.getByLabelText('提示词'), { target: { value: 'hero runs' } })
    fireEvent.click(view.getByRole('button', { name: '渲染新版本' }))
    expect(host.rerun).toHaveBeenCalledWith({
      operation: 'shot.render', inputs: [{ role: 'reference', ref: 'hero@1' }],
      params: { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'hero runs' },
      intent: '在画布上渲染 shot.render · 第 1 次 的新版本', based_on: 'g1',
    })
  })

  it('starts no render while the required prompt is empty, and sends a checked boolean param', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view, host } = await openEditor('g1')
    fireEvent.change(view.getByLabelText('提示词'), { target: { value: ' ' } })
    fireEvent.click(view.getByRole('button', { name: '渲染新版本' }))
    expect(view.getByRole('alert').textContent).toBe('失败：prompt is required.')
    expect(host.rerun).not.toHaveBeenCalled()
    fireEvent.change(view.getByLabelText('提示词'), { target: { value: 'hero runs' } })
    fireEvent.click(view.getByLabelText('loop'))
    fireEvent.click(view.getByRole('button', { name: '渲染新版本' }))
    expect(host.rerun.mock.calls[0]?.[0].params).toEqual({
      modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'hero runs', loop: true,
    })
  })

  it('reads the running words and stays disabled while the rerun waits', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view } = await openEditor('g1', { rerun: () => new Promise<void>(() => undefined) })
    fireEvent.click(view.getByRole('button', { name: '渲染新版本' }))
    const button = view.getByRole('button', { name: '生成中…' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('shows the error of a refused rerun and offers 渲染新版本 again', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view, host } = await openEditor('g1', { rerun: () => Promise.reject(new Error('GPU budget exceeded')) })
    fireEvent.click(view.getByRole('button', { name: '渲染新版本' }))
    expect((await view.findByRole('alert')).textContent).toBe('失败：GPU budget exceeded')
    const button = view.getByRole('button', { name: '渲染新版本' })
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    expect(host.rerun).toHaveBeenCalledTimes(2)
  })

  it('names each reference chip through the host, opens the node of a versioned item, and draws its asset', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view, host } = await openEditor('g1')
    const chip = view.getByRole('button', { name: '查看 Hero' })
    expect(chip.querySelector('img')?.getAttribute('src')).toBe('/dv/assets/ref.png')
    fireEvent.click(chip)
    expect(host.openNode).toHaveBeenCalledWith('test_ref:hero')
    expect(host.preview).not.toHaveBeenCalled()
  })

  it('添加素材 asks the host\'s picker with the held references; picked ones join the chips and the next rerun, × removes one', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view, host } = await openEditor('g1')
    fireEvent.click(view.getByRole('button', { name: '＋ 添加素材' }))
    expect(host.pickAssets).toHaveBeenCalledWith(['hero@1'], { versions: true }, expect.any(Function))
    act(() => { host.pickAssets.mock.calls[0]?.[2](['hero@1', 'villain@2', 'shot1.mp4']) })
    expect(view.getAllByRole('button', { name: /^查看 / }).map(button => button.textContent)).toEqual(['Hero', 'Villain', 'shot1.mp4'])

    const asset = view.getByRole('button', { name: '查看 shot1.mp4' })
    fireEvent.click(asset)
    expect(host.preview).toHaveBeenCalledWith('shot1.mp4', asset)

    fireEvent.click(view.getByRole('button', { name: '移除 Villain' }))
    expect(view.queryByRole('button', { name: '查看 Villain' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: '渲染新版本' }))
    expect(host.rerun.mock.calls[0]?.[0].inputs).toEqual([{ role: 'reference', ref: 'hero@1' }, { role: 'reference', ref: 'shot1.mp4' }])
  })

  it('names a picked reference that neither a versioned item nor an asset of the state shows by its text, and opens nothing for it', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view, host } = await openEditor('g1')
    fireEvent.click(view.getByRole('button', { name: '＋ 添加素材' }))
    act(() => { host.pickAssets.mock.calls[0]?.[2](['gone.png']) })
    const chip = view.getByRole('button', { name: '查看 gone.png' })
    expect(chip.querySelector('img, video')).toBeNull()
    fireEvent.click(chip)
    expect([host.openNode.mock.calls, host.preview.mock.calls]).toEqual([[], []])
  })

  it('leaves the model and the task out of the mode line of a take whose params name neither as text', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view } = await openEditor('g1', { edit: record => ({ ...record, params: { ...record.params, model: 7, task: null } }) })
    expect(view.getByTestId('dv-canvas-render-mode').textContent).toBe(' · ')
  })

  it('offers no reference chips for a take that the kind\'s references rule refuses', async () => {
    document.documentElement.lang = 'zh-CN'
    const { view } = await openEditor('g1', { edit: record => ({ ...record, params: { ...record.params, task: 't2v' } }) })
    await waitFor(() => { expect(view.getByTestId('dv-canvas-render-mode').textContent).toBe('fasth3 · 文字生成') })
    expect(view.queryByRole('button', { name: '查看 Hero' })).toBeNull()
    expect(view.queryByRole('button', { name: '＋ 添加素材' })).toBeNull()
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

  it('shows no params and no 渲染新版本 for a take whose operation the declarations do not name', async () => {
    document.documentElement.lang = 'zh-CN'
    const { container, view } = await openEditor('g1', { operations: [] })
    expect(container.querySelector('textarea, input, select')).toBeNull()
    expect(view.queryByRole('button', { name: '渲染新版本' })).toBeNull()
  })
})
