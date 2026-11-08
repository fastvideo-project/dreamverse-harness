// @vitest-environment jsdom
/**
 * What `@fastvideo/dreamverse-ui-voice-convert` registers: the voice takes of `voice.convert` on the canvas, the Voice right-Sidebar tab
 * type and its body under the real slot runtime, and the removal of both with the plugin; and the browser microphone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, within } from '@testing-library/react'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { tabInfoFactory } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { VOICE_ID, apply, inject, voiceDefinition } from '../src/client/index.ts'
import { browserRecorder } from '../src/client/VoicePanel.tsx'
import { apply as hostApply } from '../src/index.ts'

const SLOTS = {
  'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
  'dv.canvas.card': { kind: 'keyed', scope: 'root' },
  'dv.canvas.editor.claimed': { kind: 'keyed', scope: 'root' },
} as const

type FrameProps = ComposedProps<'root', never, keyof typeof SLOTS, undefined, object>

const runtimes: SlotTestRuntime[] = []
const sessions: Disposable[] = []

afterEach(async () => {
  cleanup()
  publishCurrentProject(null)
  for (const session of sessions.splice(0)) session[Symbol.dispose]()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  vi.unstubAllGlobals()
})

/** Mount the plugin with the canvas and the tab registry, and draw its tab body in chat session s5. */
async function mount() {
  vi.stubGlobal('fetch', scriptedFetch().fetch)
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
          <div data-testid="tab">{renderSlot('sidebar.right.pane.tab', {}, { entryKey: VOICE_ID, hookContext: {} as never })}</div>
        </SessionProvider>
      )
  ))
  const handle = await runtime.mount({ inject: [...inject], apply })
  const retained = runtime.sessions.retain(await runtime.sessions.add({ id: 's5' }))
  sessions.push(retained)
  reference.current = retained
  const view = runtime.renderRoot()
  return { runtime, handle, tabs, tab: () => within(view.getByTestId('tab')) }
}

describe('@fastvideo/dreamverse-ui-voice-convert', () => {
  it('keeps the host Loader entry inert, and names the Voice tab type', () => {
    expect(hostApply).not.toThrow()
    const guide = voiceDefinition.guide?.map(entry => [entry.title(), entry.description?.()])
    expect({ kind: voiceDefinition.kind, title: voiceDefinition.title('dv-voice'), guide })
      .toEqual({ kind: 'dv-voice', title: 'Voice', guide: [['Voice', 'Record a line and convert it to an allowed voice']] })
  })

  it('claims voice.convert as the voice node type, draws the Voice panel of the open project, and removes both with the plugin', async () => {
    const { runtime, handle, tab } = await mount()
    const voiceType = () => runtime.ctx.dvCanvas.nodeTypes.getSnapshot().find(type => type.id === VOICE_ID)
    expect({ type: voiceType()?.type, operations: voiceType()?.claimed?.operations, color: voiceType()?.color })
      .toEqual({ type: 'voice', operations: ['voice.convert'], color: 'var(--dv-node-6)' })
    expect(tab().getByText('Open a project first')).toBeTruthy()
    act(() => { publishCurrentProject('p1') })
    expect(await tab().findByTestId('dv-voice-panel')).toBeTruthy()
    await handle.dispose()
    expect(voiceType()).toBeUndefined()
  })
})

describe('browserRecorder', () => {
  it('records from the microphone, stops its tracks, and stores the decoded recording as mono WAV', async () => {
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [{ stop: stopTrack }] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    class FakeMediaRecorder {
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      start(): void {}
      stop(): void {
        this.ondataavailable?.({ data: new Blob(['webm']) })
        this.onstop?.()
      }
    }
    const close = vi.fn(() => Promise.resolve())
    class FakeAudioContext {
      decodeAudioData = (): Promise<unknown> => Promise.resolve({
        numberOfChannels: 2, sampleRate: 8_000,
        getChannelData: (index: number) => new Float32Array(index === 0 ? [0.5, 0.5] : [0.5, -0.5]),
      })

      close = close
    }
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const stop = await browserRecorder().start()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    const file = await stop()
    expect(file.name).toMatch(/^line-\d{8}-\d{6}\.wav$/)
    expect(file.type).toBe('audio/wav')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const view = new DataView(bytes.buffer)
    expect([bytes.length, view.getUint32(24, true), view.getInt16(44, true), view.getInt16(46, true)]).toEqual([48, 8_000, 16_383, 0])
    expect(stopTrack).toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
  })
})
