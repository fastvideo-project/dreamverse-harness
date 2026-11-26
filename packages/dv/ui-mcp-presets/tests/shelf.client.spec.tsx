// @vitest-environment jsdom
/** The tool cards follow the MCP roster through the `mcpServers` Remote and add presets on click. */
import { act, cleanup, fireEvent, type RenderResult } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '@deepseek-ai/dsh-client-ui-mcp-servers/client'
import type { McpServerPhase, McpServersSnapshot } from '@deepseek-ai/dsh-mcp-servers/types'
import { apply, inject } from '../src/client/index.ts'
import { addMcpPreset } from '../src/client/shelf.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.documentElement.lang = ''
})

/** The `$stream` options the shelf passes, as far as the fake reads them. */
interface StreamOptions {
  readonly open: (signal: AbortSignal) => unknown
  readonly ended: (accepted: boolean) => Error
  readonly carrierFailed?: (error: Error) => void
}

/** One opened roster stream: the test sends rosters or a failure; disposal ends it with a rejection. */
interface RosterStream {
  readonly options: StreamOptions
  send(value: McpServersSnapshot): void
  fail(error: Error): void
}

type AddResult = { ok: true } | { ok: false; error: unknown }

/**
 * Open a fake roster stream that yields what the test sends, and rejects once disposed.
 * @param options - the shelf's stream options.
 * @returns the stream the shelf iterates, and its test driver.
 */
function rosterStream(options: StreamOptions): { stream: object; driver: RosterStream } {
  const items: Array<McpServersSnapshot | Error> = []
  let wake = (): void => {}
  let disposed = false
  const stream = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = items.shift()
        if (next instanceof Error) throw next
        if (next !== undefined) { yield { value: next, accept: () => {} }; continue }
        if (disposed) throw new Error('disposed')
        await new Promise<void>((resolve) => { wake = resolve })
      }
    },
    dispose: async () => { disposed = true; wake() },
  }
  const driver: RosterStream = {
    options,
    send: (value) => { items.push(value); wake() },
    fail: (error) => { items.push(error); wake() },
  }
  return { stream, driver }
}

/**
 * Build a roster whose servers have the given phases.
 * @param phases - connection phase by server name.
 * @returns the roster.
 */
function roster(phases: Readonly<Record<string, McpServerPhase>> = {}): McpServersSnapshot {
  return {
    servers: Object.entries(phases).map(([name, phase]) => ({
      name, phase, tools: [], spec: { transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: {} },
    })),
    presets: [],
  }
}

/**
 * Mount the plugin on the MCP page with a fake `mcpServers` Remote whose add requests the test settles.
 * @returns the rendered page and its drivers.
 */
async function mountShelf() {
  document.documentElement.lang = 'en'
  const runtime = await SlotTestRuntime.create()
  const streams: RosterStream[] = []
  const requests: Array<{ name: string; settle: (result: AddResult) => void; reject: (failure: unknown) => void }> = []
  const face = {
    addPreset: (name: string) => new Promise<AddResult>((resolve, reject) => { requests.push({ name, settle: resolve, reject }) }),
    follow: vi.fn(),
  }
  Object.assign(runtime.remote, {
    mcpServers: face,
    $stream: (options: StreamOptions) => {
      const { stream, driver } = rosterStream(options)
      streams.push(driver)
      return stream
    },
  })
  const provide = (): () => void => runtime.ctx.provide('remote.mcpServers', face as never)
  let unprovide = provide()
  await runtime.root.declare({ 'mcp.page.section': { kind: 'list', scope: 'root' } }, props => <>{props.renderSlot('mcp.page.section', {})}</>)
  await runtime.mount({ inject: [...inject], apply })
  const view: RenderResult = runtime.renderRoot()
  const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }) }
  const card = (tool: string): HTMLButtonElement => view.container.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`)!
  const shelf = {
    runtime, view, face, streams, requests, flush, card,
    state: (tool: string) => card(tool).getAttribute('data-state'),
    status: (tool: string) => card(tool).querySelector('span[data-state]')!.textContent,
    stream: () => streams.at(-1)!,
    /** Send a roster on the current stream and let the cards render it. */
    send: async (value: McpServersSnapshot) => { shelf.stream().send(value); await flush() },
    click: async (tool: string) => { fireEvent.click(card(tool)); await flush() },
    /** Dispose the `remote.mcpServers` service, as when the MCP plugin turns off. */
    unmount: async () => { unprovide(); await flush() },
    remount: async () => { unprovide = provide(); await flush() },
  }
  await flush()
  return shelf
}

describe('ui-mcp-presets shelf', () => {
  it('waits for the roster, then adds a tool and shows its connection phase', async () => {
    const shelf = await mountShelf()
    expect([shelf.state('blender'), shelf.status('blender'), shelf.card('blender').disabled]).toEqual(['loading', 'Loading…', true])

    await shelf.send(roster())
    expect([shelf.state('blender'), shelf.status('blender'), shelf.card('blender').disabled]).toEqual(['available', 'Add', false])

    await shelf.click('blender')
    expect(shelf.requests.map(request => request.name)).toEqual(['blender'])
    expect([shelf.state('blender'), shelf.status('blender'), shelf.card('blender').disabled]).toEqual(['adding', 'Adding…', true])
    expect(shelf.state('comfyui')).toBe('available')

    await shelf.send(roster({ blender: 'connecting' }))
    shelf.requests[0]!.settle({ ok: true })
    await shelf.flush()
    expect([shelf.state('blender'), shelf.status('blender'), shelf.card('blender').disabled]).toEqual(['connecting', 'Added · Connecting…', true])
    await shelf.send(roster({ blender: 'connected' }))
    expect([shelf.state('blender'), shelf.status('blender')]).toEqual(['connected', 'Added · Connected'])
    await shelf.send(roster({ blender: 'failed' }))
    expect([shelf.state('blender'), shelf.status('blender')]).toEqual(['failed', 'Added · Connection failed'])
    await shelf.runtime.dispose()
  })

  it('offers a retry with the error as the card title after an add fails', async () => {
    const shelf = await mountShelf()
    await shelf.send(roster())
    await shelf.click('blender')
    shelf.requests[0]!.settle({ ok: false, error: new Error('preset not offered') })
    await shelf.flush()
    expect([shelf.state('blender'), shelf.status('blender'), shelf.card('blender').title, shelf.card('blender').disabled])
      .toEqual(['error', 'Could not add; click to retry', 'preset not offered', false])
    expect([shelf.state('comfyui'), shelf.card('comfyui').title]).toEqual(['available', ''])

    await shelf.click('blender')
    expect(shelf.requests.map(request => request.name)).toEqual(['blender', 'blender'])
    expect([shelf.state('blender'), shelf.card('blender').title]).toEqual(['adding', ''])
    shelf.requests[1]!.reject('host unreachable')
    await shelf.flush()
    expect([shelf.state('blender'), shelf.card('blender').title]).toEqual(['error', 'host unreachable'])
    await shelf.runtime.dispose()
  })

  it('reports a timeout when the Host does not answer an add in 30 s', async () => {
    const shelf = await mountShelf()
    await shelf.send(roster())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await shelf.click('blender')
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999) })
    expect(shelf.state('blender')).toBe('adding')
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect([shelf.state('blender'), shelf.card('blender').title]).toEqual(['error', 'timed out'])
    await shelf.runtime.dispose()
  })

  it('sends one request per tool while its add is in flight, and none without the Remote', async () => {
    const shelf = await mountShelf()
    await shelf.send(roster())
    await act(async () => { addMcpPreset('blender'); addMcpPreset('blender') })
    expect(shelf.requests.map(request => request.name)).toEqual(['blender'])
    await shelf.unmount()
    await act(async () => { addMcpPreset('comfyui') })
    expect(shelf.requests.map(request => request.name)).toEqual(['blender'])
    await shelf.runtime.dispose()
  })

  it('returns the cards to loading when the Remote is disposed, and follows the roster again when it returns', async () => {
    const warn = vi.spyOn(console, 'warn')
    const shelf = await mountShelf()
    await shelf.send(roster({ blender: 'connected' }))
    await shelf.click('comfyui')
    await shelf.unmount()
    expect([shelf.state('blender'), shelf.state('comfyui')]).toEqual(['loading', 'loading'])
    expect(warn).not.toHaveBeenCalled()

    await shelf.remount()
    expect(shelf.streams).toHaveLength(2)
    expect(shelf.state('comfyui')).toBe('loading')
    await shelf.send(roster())
    expect([shelf.state('blender'), shelf.state('comfyui')]).toEqual(['available', 'available'])
    await shelf.runtime.dispose()
  })

  it('keeps a new add in flight when an add from before a remount settles', async () => {
    const shelf = await mountShelf()
    await shelf.send(roster())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await shelf.click('blender')
    await shelf.click('comfyui')
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    await shelf.unmount()
    await shelf.remount()
    await shelf.send(roster())
    await shelf.click('blender')
    await shelf.click('comfyui')
    expect(shelf.requests.map(request => request.name)).toEqual(['blender', 'comfyui', 'blender', 'comfyui'])

    shelf.requests[1]!.settle({ ok: true })
    await shelf.flush()
    expect([shelf.state('comfyui'), shelf.card('comfyui').disabled]).toEqual(['adding', true])
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect([shelf.state('blender'), shelf.card('blender').disabled, shelf.card('blender').title]).toEqual(['adding', true, ''])
    await shelf.runtime.dispose()
  })

  it('opens the roster through mcpServers.follow and warns when the stream fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const shelf = await mountShelf()
    const { options } = shelf.stream()
    const signal = new AbortController().signal
    options.open(signal)
    expect(shelf.face.follow).toHaveBeenCalledWith(signal)
    expect(options.ended(true).message).toBe('MCP tools stream ended')
    expect(() => { options.carrierFailed?.(new Error('carrier lost')) }).not.toThrow()

    const failure = new Error('invalid roster')
    shelf.stream().fail(failure)
    await shelf.flush()
    expect(warn).toHaveBeenCalledWith('ui-mcp-presets: MCP roster stream failed', failure)
    await shelf.runtime.dispose()
  })
})
