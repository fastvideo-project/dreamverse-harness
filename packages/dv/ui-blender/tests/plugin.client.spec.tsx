// @vitest-environment jsdom
/**
 * What `@fastvideo/dreamverse-ui-blender` registers: the Blender takes on the canvas, the Blender right-Sidebar tab type
 * and its body under the real slot runtime, and their removal with the plugin; and the panel's two states over a fake
 * host half: the connection steps while no Blender is connected, the live viewport while one is.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { tabInfoFactory } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { BLENDER_ID, BlenderPanel, applyWith, blenderDefinition, inject, type BlenderSource, type BlenderState, type BlenderStatus, type ViewFrame } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

const SLOTS = {
  'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
  'dv.canvas.card': { kind: 'keyed', scope: 'root' },
  'dv.canvas.editor.claimed': { kind: 'keyed', scope: 'root' },
} as const

type FrameProps = ComposedProps<'root', never, keyof typeof SLOTS, undefined, object>

const STATE: BlenderState = { blender_version: '5.3.0', addon_version: '0.1.0', file: 'shot.blend', allow_code: true }

/** A host half whose stream the test drives. */
class FakeSource implements BlenderSource {
  addonFailure: Error | null = null

  addon(): Promise<Blob> {
    return this.addonFailure === null ? Promise.resolve(new Blob(['zip'], { type: 'application/zip' })) : Promise.reject(this.addonFailure)
  }

  origin = 'http://127.0.0.1:18094'
  token = 'tok-1'
  watchers = 0
  private listener: Parameters<BlenderSource['watch']>[0] | null = null

  status(): Promise<BlenderStatus> {
    return Promise.resolve({ linked: false, state: null, token: this.token, link_path: '/dv/blender/ws', viewers: this.watchers })
  }

  regenerate(): Promise<BlenderStatus> {
    this.token = 'tok-2'
    return this.status()
  }

  watch(listener: Parameters<BlenderSource['watch']>[0]): () => void {
    this.watchers += 1
    this.listener = listener
    listener.status(false, null)
    return () => {
      this.watchers -= 1
      this.listener = null
    }
  }

  link(state: BlenderState | null): void {
    act(() => { this.listener?.status(state !== null, state) })
  }

  frame(frame: ViewFrame): void {
    act(() => { this.listener?.frame(frame) })
  }
}

const runtimes: SlotTestRuntime[] = []
const sessions: Disposable[] = []

afterEach(async () => {
  cleanup()
  for (const session of sessions.splice(0)) session[Symbol.dispose]()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  vi.unstubAllGlobals()
})

/** Mount the plugin with the canvas and the tab registry, and draw its tab body in chat session s5. */
async function mount(source: BlenderSource) {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const tabs = new SidebarRightTabRegistry(runtime.ctx)
  runtime.ctx.provide('sidebarRightTabs', tabs as never)
  runtime.ctx.provide('dvCanvas', createDvCanvas())
  const reference: { current: SessionReference | undefined } = { current: undefined }
  await runtime.root.declare(SLOTS, ({ renderSlot, SessionProvider }: FrameProps) => (
    reference.current === undefined
      ? null
      : (
        <SessionProvider session={reference.current}>
          <div data-testid="tab">{renderSlot('sidebar.right.pane.tab', {}, { entryKey: BLENDER_ID, hookContext: {} as never })}</div>
        </SessionProvider>
      )
  ))
  const handle = await runtime.mount({ inject: [...inject], apply: applyWith(source) })
  const retained = runtime.sessions.retain(await runtime.sessions.add({ id: 's5' }))
  sessions.push(retained)
  reference.current = retained
  const view = runtime.renderRoot()
  return { runtime, handle, tabs, tab: () => within(view.getByTestId('tab')) }
}

describe('@fastvideo/dreamverse-ui-blender', () => {
  it('keeps the host Loader entry inert, and names the Blender tab type', () => {
    expect(hostApply).not.toThrow()
    const guide = blenderDefinition.guide?.map(entry => [entry.title(), entry.description?.()])
    expect({ kind: blenderDefinition.kind, title: blenderDefinition.title('dv-blender'), guide })
      .toEqual({ kind: 'dv-blender', title: 'Blender', guide: [['Blender', 'Connect Blender and watch its viewport live']] })
  })

  it('claims both render operations as the blender node type, draws the Blender panel, and removes both with the plugin', async () => {
    const source = new FakeSource()
    const { runtime, handle, tab } = await mount(source)
    const blenderType = () => runtime.ctx.dvCanvas.nodeTypes.getSnapshot().find(type => type.id === BLENDER_ID)
    expect({ type: blenderType()?.type, operations: blenderType()?.claimed?.operations })
      .toEqual({ type: 'blender', operations: ['blender.render', 'blender.animation_render'] })
    expect(await tab().findByTestId('dv-blender-panel')).toBeTruthy()
    expect(source.watchers).toBe(1)
    await handle.dispose()
    expect(blenderType()).toBeUndefined()
    expect(source.watchers).toBe(0)
  })
})

describe('BlenderPanel', () => {
  it('shows the connection steps with the connection string, copies it, and replaces the token', async () => {
    const source = new FakeSource()
    const copy = vi.fn(() => Promise.resolve())
    render(<BlenderPanel source={source} copy={copy} />)
    const connection = await screen.findByTestId('dv-blender-connection')
    expect(connection.textContent).toBe('http://127.0.0.1:18094#tok-1')
    const save = vi.fn()
    cleanup()
    render(<BlenderPanel source={source} copy={copy} save={save} />)
    await screen.findByTestId('dv-blender-connection')
    fireEvent.click(screen.getByText('Download dreamverse_blender.zip'))
    await vi.waitFor(() => { expect(save).toHaveBeenCalledWith(expect.any(Blob), 'dreamverse_blender.zip') })
    source.addonFailure = new Error('HTTP 401')
    fireEvent.click(screen.getByText('Download dreamverse_blender.zip'))
    expect(await screen.findByText('The download failed: HTTP 401')).toBeTruthy()
    fireEvent.click(screen.getByText('Copy the connection string'))
    expect(copy).toHaveBeenCalledWith('http://127.0.0.1:18094#tok-1')
    expect(await screen.findByText('Copied')).toBeTruthy()
    fireEvent.click(screen.getByText('Replace the pairing token'))
    await vi.waitFor(() => { expect(screen.getByTestId('dv-blender-connection').textContent).toBe('http://127.0.0.1:18094#tok-2') })
  })

  it('shows the live viewport while a Blender is connected, and the steps again after it disconnects', async () => {
    const source = new FakeSource()
    render(<BlenderPanel source={source} />)
    await screen.findByTestId('dv-blender-connection')
    source.link(STATE)
    expect(screen.getByText('Connected to Blender 5.3.0')).toBeTruthy()
    expect(screen.getByText('shot.blend')).toBeTruthy()
    expect(screen.getByText('Waiting for the viewport…')).toBeTruthy()
    source.frame({ src: 'data:image/jpeg;base64,AAAA', width: 640, height: 360 })
    expect(screen.getByTestId('dv-blender-view').getAttribute('src')).toBe('data:image/jpeg;base64,AAAA')
    source.link({ ...STATE, allow_code: false })
    expect(screen.getByText('This Blender has code from the harness switched off; the agent can only look.')).toBeTruthy()
    source.link(null)
    expect(screen.queryByTestId('dv-blender-view')).toBeNull()
    expect(screen.getByText('Connect Blender')).toBeTruthy()
  })
})
