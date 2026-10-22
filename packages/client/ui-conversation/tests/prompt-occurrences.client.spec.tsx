// @vitest-environment jsdom
/**
 * The chat composer bar and a `conversation.prompt` occurrence rendered at once under the real Conversation plugin: each
 * parent declares its own face slot, so the plugin loads with one owner per slot, and one face component registered in
 * both slots draws the chips of both editors.
 */
import './control-row-dom.ts'
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ISession } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRenderFactories, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, stubConfigForm, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, type PromptHostModel, type ReferenceFaceOwner } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

// jsdom implements no Range geometry; Lexical measures the caret once the surface is contenteditable.
Range.prototype.getBoundingClientRect = () => ({
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
})
usePinnedBrowserLanguages('zh-CN')

const SID = 's1' as SessionId
const CITE = '@[Cat](probe:cat)'

/** jsdom has no ResizeObserver; the composer seat publishes its height through one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
beforeEach(() => { vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** One face for both slots: it shows the chip's label and whether it came with an occurrence's face context. */
function ProbeFace({ label, context }: ReferenceFaceOwner) {
  return <b data-probe-face="">{`${label}:${context === null ? 'chat' : 'model'}`}</b>
}

describe('the chat bar and a prompt occurrence at once', () => {
  it('loads with one owner per face slot and draws the chips of both editors with the same face', async () => {
    const errors = vi.spyOn(console, 'error')
    const runtime = await SlotTestRuntime.create()
    let mainReference: ReturnType<typeof runtime.sessions.retain> | undefined
    runtime.ctx.provide('uiWorkspace', {
      openWorkspace: vi.fn(), openSession: (id: SessionId) => { mainReference = runtime.sessions.retain(id, { source: 'mainView' }) },
    } as never)
    runtime.ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.sessions.add({
      id: SID, summary: { title: 'S', displayTitle: 'S', cwd: '/proj' },
      session: { loadOlder: vi.fn<ISession['loadOlder']>(), prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })) },
    })
    mainReference = runtime.sessions.retain(SID, { source: 'mainView' })
    const model: PromptHostModel = {
      content: { revision: 0, text: `A ${CITE}`, chips: [{ source: 'probe', ref: CITE, label: 'Cat', offset: 2, length: CITE.length, clipboardText: CITE }] },
      readOnly: true, sources: [], sourceContext: null, faceContext: { node: 'n1' }, onChange: () => {}, placeholder: '', ariaLabel: 'take',
    }
    await runtime.root.declare({ main: { kind: 'keyed', scope: 'root' } }, ({ renderSlot, renderFactorySlot }: PropsRenderSlots<'main'> & PropsRenderFactories) => (
      <>
        <section data-testid="chat">{renderSlot('main', {}, { entryKey: 'conversation' })}</section>
        <section data-testid="take">{renderFactorySlot('conversation.prompt', { model })}</section>
      </>
    ))
    await runtime.mount({ inject: [...inject], apply })
    for (const name of ['conversation.input.reference', 'conversation.prompt.reference'] as const) {
      runtime.slots.inject(name, () => runtime.slots.register({ name, key: 'probe' }, ProbeFace))
    }
    const view = runtime.renderRoot()
    const input = runtime.ctx.conversation.input.for(runtime.sessions.scope(SID)!)
    await act(async () => {
      const { draft, draftRev } = input.state.getSnapshot()
      input.insertReference({ source: 'probe', ref: CITE, label: 'Cat', clipboardText: CITE }, { start: draft.length, end: draft.length, draftRev })
    })
    await waitFor(() => { expect(view.getByTestId('chat').querySelector('[data-probe-face]')?.textContent).toBe('Cat:chat') })
    await waitFor(() => { expect(view.getByTestId('take').querySelector('[data-probe-face]')?.textContent).toBe('Cat:model') })
    expect(runtime.slots.entries('conversation.input.reference')).toHaveLength(1)
    expect(runtime.slots.entries('conversation.prompt.reference')).toHaveLength(1)
    expect(errors).not.toHaveBeenCalled()
    mainReference.release()
    await runtime.dispose()
  })
})
