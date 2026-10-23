// @vitest-environment jsdom
/**
 * The draft editor runtime's merge rebuild, which a prompt host uses to turn pasted citations into chips: it replaces
 * the content inside the paste's undo step and keeps the caret at the same document position.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { UNDO_COMMAND } from 'lexical'
import { DraftEditorRuntime } from '../src/client/input/editor/runtime.ts'
import { $selectDetectSpan } from '../src/client/input/editor/span-map.ts'

const CITE = '@[Cat](dv:asset/cat)'
const CHIP = { source: 'probe', ref: CITE, label: 'Cat', offset: 2, length: CITE.length, clipboardText: CITE }

const offs: Array<() => void> = []
afterEach(() => { for (const off of offs.splice(0)) off() })

/** A registered runtime that projects after each update, seeded outside the undo history. */
function runtimeOf(text: string): DraftEditorRuntime {
  const runtime: DraftEditorRuntime = new DraftEditorRuntime({
    onUpdate: () => { runtime.refreshProjection() }, openReference: () => false, activeClaimToken: () => null,
    lexicon: () => new Map(), resolveLexicon: () => undefined,
  })
  offs.push(runtime.register())
  runtime.restoreDraft(text, [])
  runtime.clearHistory()
  return runtime
}

describe('the merge rebuild', () => {
  it('turns pasted text into a chip inside the paste\'s undo step, with the caret after the chip', async () => {
    const runtime = runtimeOf('a  b')
    runtime.editor.update(() => { $selectDetectSpan({ start: 2, end: 2 }) }, { discrete: true })
    runtime.paste(CITE)
    expect([runtime.projection.clipboardText, runtime.projection.caret]).toEqual([`a ${CITE} b`, 2 + CITE.length])
    runtime.mergeDraft(`a ${CITE} b`, [CHIP])
    expect([runtime.projection.occurrences.map(chip => chip.ref), runtime.projection.caret]).toEqual([[CITE], 3])
    // A command runs inside an editor update, which commits after the current task.
    runtime.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect([runtime.projection.clipboardText, runtime.projection.occurrences]).toEqual(['a  b', []])
  })

  it('puts the caret at the end when the selection held a range', () => {
    const runtime = runtimeOf(`a ${CITE} b`)
    runtime.editor.update(() => { $selectDetectSpan({ start: 0, end: 1 }) }, { discrete: true })
    runtime.mergeDraft(`a ${CITE} b`, [CHIP])
    expect(runtime.projection.caret).toBe(5)
  })
})
