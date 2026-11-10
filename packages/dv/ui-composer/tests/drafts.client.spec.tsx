// @vitest-environment jsdom
/** The in-memory store of unsent take drafts: write, read, clear, the sending flag, and the 20-entry bound. */
import { beforeEach, describe, expect, it } from 'vitest'
import { draftOf } from '../src/client/draft.ts'
import { clearDraft, draftKey, MAX_DRAFTS, readDraft, resetDrafts, writeDraft } from '../src/client/drafts.ts'

const draftFor = (prompt: string) => draftOf({ operation: 'shot.render', params: { prompt }, inputs: [] })

beforeEach(() => { resetDrafts() })

describe('the draft store', () => {
  it('reads back what was written under the project, draft id and call, and nothing under another key', () => {
    const key = draftKey('p1', 'r1', '{"a":1}')
    expect(readDraft(key)).toBeUndefined()
    writeDraft(key, draftFor('rain'))
    expect(readDraft(key)?.params).toEqual({ prompt: 'rain' })
    expect(readDraft(draftKey('p2', 'r1', '{"a":1}'))).toBeUndefined()
    expect(readDraft(draftKey('p1', 'r2', '{"a":1}'))).toBeUndefined()
    clearDraft(key)
    expect(readDraft(key)).toBeUndefined()
  })

  it('never stores the sending state', () => {
    writeDraft('k', { ...draftFor('rain'), sending: true })
    expect(readDraft('k')?.sending).toBe(false)
  })

  it('keeps the 20 most recently written drafts and drops the oldest', () => {
    for (let index = 0; index < MAX_DRAFTS; index++) writeDraft(`k${String(index)}`, draftFor(String(index)))
    writeDraft('k0', draftFor('again'))
    writeDraft('extra', draftFor('extra'))
    expect([readDraft('k0')?.params['prompt'], readDraft('k1'), readDraft('k2')?.params['prompt'], readDraft('extra')?.params['prompt']]).toEqual(['again', undefined, '2', 'extra'])
  })
})
