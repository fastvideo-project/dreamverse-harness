// @vitest-environment jsdom
/**
 * The `conversation.prompt` Factory outside any Session, rendered as three occurrences under the real trigger plugin.
 */
import { useState, type ReactNode } from 'react'
import { act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Occurrence, PromptHostModel, ReferenceFaceOwner } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { registerPromptFactory } from '@deepseek-ai/dsh-client-ui-conversation/src/client/prompt.ts'
import { apply, inject, type InputTriggerService, type InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

const CITE = '@[Cat](dv:asset/a1)'
const DOG = '@[Dog](dv:asset/a2)'

function promptSource(seen: unknown[]): InputTriggerSource {
  const refuse = (): never => { throw new Error('the session face was called') }
  return {
    trigger: '@', name: 'dv-project', candidates: refuse, onPick: refuse,
    codec: { clipboardText: ref => ref, serialize: ref => Promise.resolve(ref) },
    prompt: {
      candidates: (request) => {
        seen.push(request.context)
        return Promise.resolve([{ name: 'Cat', value: CITE }, { name: 'Dog', value: DOG }])
      },
      onPick: ({ candidate }) => ({ insert: { source: 'dv-project', ref: candidate.value ?? '', label: candidate.name, clipboardText: candidate.value ?? '' } }),
    },
  }
}

function model(overrides: Partial<PromptHostModel>, changes: Array<{ text: string; chips: readonly Occurrence[] }>): PromptHostModel {
  return {
    content: { revision: 0, history: 'reset', text: '', chips: [] }, readOnly: false, sources: ['dv-project'], sourceContext: { media: ['image'] },
    faceContext: { inputs: ['a1'] }, onChange: (text, chips) => { changes.push({ text, chips }) }, placeholder: '', ariaLabel: 'prompt',
    ...overrides,
  }
}

const runtimes: SlotTestRuntime[] = []
// jsdom has no layout; the menu scrolls its highlighted row into view.
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn() })
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
})

/** Mount the trigger plugin, the Factory, one face for `dv-project`, and a root that renders three occurrences. */
async function bench() {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.mount({ inject: [...inject], apply })
  runtime.ctx.effect(() => registerPromptFactory(runtime.ctx))
  const seen: unknown[] = []
  const triggers = runtime.ctx.get('inputTriggers') as InputTriggerService
  runtime.ctx.effect(() => triggers.registerSource(promptSource(seen)))
  runtime.slots.register({ name: 'conversation.prompt.reference', key: 'dv-project' }, (owner: ReferenceFaceOwner) => (
    <b data-face="">{`${owner.label}|${owner.reference}|${JSON.stringify(owner.context)}`}</b>
  ))
  const changes: Array<{ text: string; chips: readonly Occurrence[] }> = []
  const readChip = { source: 'dv-project', ref: CITE, offset: 4, length: CITE.length, label: 'Cat', clipboardText: CITE }
  const occurrences: Array<{ id: string; model: PromptHostModel }> = [
    { id: 'take', model: model({}, changes) },
    { id: 'sidebar', model: model({}, []) },
    { id: 'plan', model: model({ readOnly: true, sources: [], content: { revision: 0, history: 'reset', text: `See ${CITE} run`, chips: [readChip] } }, []) },
  ]
  let setTake: (next: PromptHostModel) => void = () => {}
  await runtime.root.declare({}, ({ renderFactorySlot }: PropsRuntime<'root'> & PropsRenderFactories) => {
    const [take, update] = useState(occurrences[0]!.model)
    setTake = update
    return (
      <>
        {[take, occurrences[1]!.model, occurrences[2]!.model].map((m, index): ReactNode => (
          <section key={occurrences[index]!.id} data-occurrence={occurrences[index]!.id}>{renderFactorySlot('conversation.prompt', { model: m })}</section>
        ))}
      </>
    )
  })
  const view = runtime.renderRoot()
  await runtime.flush()
  return { runtime, view, seen, changes, setTake: (next: PromptHostModel) => { act(() => { setTake(next) }) }, take: occurrences[0]!.model }
}

describe('the prompt controllers of the trigger service', () => {
  it('go with the service, and a service loaded again mints keys that the first did not', async () => {
    const runtime = await SlotTestRuntime.create()
    runtimes.push(runtime)
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    const options = { sources: () => [], context: () => null, deliver: () => false }
    const first = await runtime.mount({ inject: [...inject], apply })
    const service = runtime.ctx.get('inputTriggers') as InputTriggerService
    const opened = service.controllerFor(options)
    await first.dispose()
    expect(service.occurrence(opened.key)).toBeUndefined()
    await runtime.mount({ inject: [...inject], apply })
    const next = (runtime.ctx.get('inputTriggers') as InputTriggerService).controllerFor(options)
    expect(next.key).not.toBe(opened.key)
  })
})

describe('conversation.prompt outside a Session', () => {
  it('renders three occurrences under one Factory, each with its own editor and controller', async () => {
    const { view } = await bench()
    const boxes = view.container.querySelectorAll('[data-prompt-occurrence] [data-composer-input]')
    expect(boxes).toHaveLength(3)
    expect([...boxes].map(box => box.getAttribute('contenteditable'))).toEqual(['true', 'true', 'false'])
    const plan = view.container.querySelector('[data-occurrence="plan"]')!
    expect(plan.textContent).toBe(`See Cat|${CITE}|{"inputs":["a1"]} run`)
  })

  it('opens the @ menu of one occurrence and inserts the picked chip there', async () => {
    const { view, seen, changes, setTake, take } = await bench()
    setTake({ ...take, content: { revision: 1, history: 'step', text: 'a picture of @', chips: [] } })
    const take_ = view.container.querySelector('[data-occurrence="take"]')!
    await vi.waitFor(() => { expect(take_.querySelector('[role="option"]')).not.toBeNull() })
    expect(view.container.querySelectorAll('[role="option"]')).toHaveLength(2)
    expect(seen).toEqual([{ media: ['image'] }])
    await act(async () => { fireEvent.mouseDown(take_.querySelector('[role="option"]')!) })
    await vi.waitFor(() => { expect(changes.at(-1)?.chips).toHaveLength(1) })
    expect(changes.at(-1)?.text).toBe(`a picture of ${CITE} `)
    expect(changes.at(-1)?.chips[0]).toMatchObject({ source: 'dv-project', ref: CITE, label: 'Cat' })
    expect(take_.querySelector('[data-face]')?.textContent).toBe(`Cat|${CITE}|{"inputs":["a1"]}`)
    expect(take_.querySelector('[role="option"]')).toBeNull()
  })

  it('reads the sources and their context from the host model each time the menu lists candidates', async () => {
    const { runtime, view, seen, setTake, take } = await bench()
    const box = view.container.querySelector('[data-occurrence="take"]')!
    setTake({ ...take, sources: [], content: { revision: 1, history: 'step', text: '@', chips: [] } })
    await runtime.flush()
    expect([seen, box.querySelector('[role="option"]')]).toEqual([[], null])
    setTake({ ...take, sourceContext: { media: ['audio'] }, content: { revision: 2, history: 'step', text: 'a @', chips: [] } })
    await vi.waitFor(() => { expect(box.querySelectorAll('[role="option"]')).toHaveLength(2) })
    expect(seen).toEqual([{ media: ['audio'] }])
  })

  it('moves the highlight to the row under the pointer, and closes the menu on a pointer outside the occurrence', async () => {
    const { view, setTake, take } = await bench()
    setTake({ ...take, content: { revision: 1, history: 'step', text: '@', chips: [] } })
    const box = view.container.querySelector('[data-occurrence="take"]')!
    await vi.waitFor(() => { expect(box.querySelectorAll('[role="option"]')).toHaveLength(2) })
    const selected = () => box.querySelector('[role="option"][aria-selected="true"]')?.textContent
    expect(selected()).toBe('Cat')
    act(() => { fireEvent.mouseMove(box.querySelectorAll('[role="option"]')[1]!) })
    await vi.waitFor(() => { expect(selected()).toBe('Dog') })
    act(() => { fireEvent.pointerDown(box.querySelector('[data-composer-input]')!) })
    expect(box.querySelectorAll('[role="option"]')).toHaveLength(2)
    act(() => { fireEvent.pointerDown(document.body) })
    await vi.waitFor(() => { expect(box.querySelector('[role="option"]')).toBeNull() })
  })
})
