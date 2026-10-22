// @vitest-environment jsdom
/**
 * The chat card of a render call (its tool's name, prompt, status, and the 在历史中查看 link once settled), its slot entry,
 * and the host Loader entry.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createElement, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { WireOperation } from '@dv/ui-kit/types.ts'
import { apply, inject } from '../src/client/index.ts'
import { RenderCard, type RenderCardProps } from '../src/client/RenderCard.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * Render the card of a `dv_shot_render` call with the label `Render shot` and no task labels.
 * @param phase - the call's phase.
 * @param block - the call block.
 * @returns the card element.
 */
function renderCard(phase: RenderCardProps['phase'], block: object): Element | null {
  render(<RenderCard toolName="dv_shot_render" label={['渲染镜头', 'Render shot']} taskLabels={{}} sessionId="s1" callId="call-3" phase={phase} block={block} />)
  return document.querySelector('[data-tool="dv_shot_render"]')
}

/** The props of a tool row that the test passes. */
type RowProps = { toolName: string; sessionId: string; callId: string; phase: 'start'; block: object }

/** The `shot.render` declaration of `GET /api/dv/operations`, with its label. */
const SHOT_RENDER: WireOperation = {
  name: 'shot.render', version: '1', description: 'Render a shot.', label: { zh: '渲染镜头', en: 'Render shot' },
  inputs: {}, params: {}, outputs: [], deterministic: false, resource: 'none', confirm: 'never',
}

describe('RenderCard', () => {
  it('names the render tool and shows the model, the task by its catalog label, and the prompt while the call renders', () => {
    render(
      <RenderCard
        toolName="dv_shot_render" label={['渲染镜头', 'Render shot']} taskLabels={{ t2v: { zh: '文字生成', en: 'From text' } }}
        sessionId="s1" callId="call-1" phase="start"
        block={{ argsRaw: JSON.stringify({ modality: 'video', task: 't2v', provider: 'fastvideo', model: 'fasth3', prompt: 'a lighthouse at dusk' }) }}
      />,
    )
    const card = document.querySelector('[data-tool="dv_shot_render"]')
    expect(card?.textContent).toContain('Render shot')
    expect(screen.getByTestId('dv-composer-render-model').textContent).toBe('fasth3 · From text')
    expect(card?.textContent).toContain('a lighthouse at dusk')
    expect(screen.queryByTestId('dv-composer-open-history')).toBeNull()
  })

  it('shows the rendered video and the history link once the call settled', () => {
    render(
      <RenderCard
        toolName="dv_shot_render" label={['渲染镜头', 'Render shot']} taskLabels={{}} sessionId="s1" callId="call-2" phase="result"
        block={{ argsRaw: '{"model":"fasth3","task":"i2v","prompt":"Picture 1 walks"}', meta: { outputs: [{ role: 'video', asset_id: 'v1.mp4', mime: 'video/mp4' }] } }}
      />,
    )
    // A task without a catalog label shows its name.
    expect(screen.getByTestId('dv-composer-render-model').textContent).toBe('fasth3 · i2v')
    expect(document.querySelector('video')?.getAttribute('src')).toContain('v1.mp4')
    expect(screen.getByTestId('dv-composer-open-history')).toBeTruthy()
  })

  it('reads the arguments that the settled call block carries and marks a failed render as not rendered', () => {
    const card = renderCard('result', { call: { argsRaw: '{"model":"fasth3","prompt":"a red kite"}' }, isError: true })
    expect(screen.getByTestId('dv-composer-render-model').textContent).toBe('fasth3')
    expect(card?.textContent).toContain('a red kite')
    const status = card?.querySelector('[data-failed]')
    expect(status?.textContent).toBe('Not rendered')
    expect(screen.getByTestId('dv-composer-open-history')).toBeTruthy()
  })

  it('shows only the tool name and the status while the call has no readable model, task, or prompt', () => {
    const blocks: object[] = [
      {},
      { argsRaw: 42 },
      { call: null },
      { call: 'pending' },
      { call: {} },
      { argsRaw: '{"model":1,"task":2,"prompt":3}' },
    ]
    for (const block of blocks) {
      const card = renderCard('start', block)
      expect(card?.textContent).toBe('Render shotRendering…')
      expect(screen.queryByTestId('dv-composer-render-model')).toBeNull()
      cleanup()
    }
  })
})

describe('the dv_shot_render row', () => {
  it('registers at the default priority ahead of an operation row at priority 1, and leaves with the plugin', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({
      'tool.call.toolview': { kind: 'keyed', scope: 'session', inject: { hooks: { toolCallArgumentsPartial: () => () => '' } } },
    })
    const entries = () => runtime.slots.entries('tool.call.toolview')
    // The operation row that @dv/ui-composer registers for every operation tool.
    await runtime.mount({
      inject: ['slots'],
      apply: (ctx: Context) => { ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'dv_shot_render', priority: 1 }, () => null)) },
    })
    const plugin = await runtime.mount({ inject, apply })
    await vi.waitFor(() => { expect(entries()).toHaveLength(2) })
    // The slot sorts a key's entries by ascending priority, and the first one renders.
    expect(entries().map(entry => [entry.options.key, entry.options.priority ?? 0])).toEqual([['dv_shot_render', 0], ['dv_shot_render', 1]])

    await plugin.dispose()
    expect(entries().map(entry => entry.options.priority)).toEqual([1])
    await runtime.dispose()
  })

  it('names the call and its task by their names until the operation list and the task labels load', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => Promise.resolve(Response.json(
      input === '/api/dv/operations' ? [SHOT_RENDER] : { t2v: { zh: '文字生成', en: 'From text' } },
    ))))
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({
      'tool.call.toolview': { kind: 'keyed', scope: 'session', inject: { hooks: { toolCallArgumentsPartial: () => () => '' } } },
    })
    const plugin = await runtime.mount({ inject, apply })
    await vi.waitFor(() => { expect(runtime.slots.entries('tool.call.toolview')).toHaveLength(1) })
    const Row = runtime.slots.entries('tool.call.toolview')[0]!.component as ComponentType<RowProps>
    const { container } = render(createElement(Row, {
      toolName: 'dv_shot_render', sessionId: 's1', callId: 'call-4', phase: 'start',
      block: { argsRaw: '{"model":"fasth3","task":"t2v","prompt":"a lighthouse at dusk"}' },
    }))
    expect(container.textContent).toContain('shot.render')
    expect(screen.getByTestId('dv-composer-render-model').textContent).toBe('fasth3 · t2v')

    await vi.waitFor(() => { expect(screen.getByTestId('dv-composer-render-model').textContent).toBe('fasth3 · From text') })
    expect(container.textContent).toContain('Render shot')
    expect(container.textContent).not.toContain('shot.render')

    cleanup()
    await plugin.dispose()
    await runtime.dispose()
  })
})

describe('ui-shot-render apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })
})
