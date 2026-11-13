/** Conversation model choices rebuilt from models.select records, and their enforcement on agent generations. */
import { describe, expect, it } from 'vitest'
import type { ProjectRecord, ProjectState, SessionId } from '@dv/project'
import { assertModelSelection, modelSelection, selectionReducer } from '../src/selection.ts'

const session = 's1' as SessionId
const record = (params: Record<string, unknown>, status = 'done'): ProjectRecord =>
  ({ operation: 'models.select', status, session, params }) as ProjectRecord

function reduce(...records: ProjectRecord[]): ProjectState['components']['models'] {
  return records.reduce((slice, next) => selectionReducer.reduce(slice, next), selectionReducer.initial())
}

describe('conversation model choices', () => {
  it('keeps one choice per modality, reads a record without a modality as video, and clears a choice for Auto', () => {
    const slice = reduce(
      record({ provider: 'fastvideo', model: 'pika' }),
      record({ modality: 'image', provider: 'openrouter', model: 'flux' }),
      record({ modality: 'image', provider: 'openrouter', model: 'seedream' }, 'failed'),
    )
    expect(slice).toEqual({ conversations: { s1: { video: { provider: 'fastvideo', model: 'pika' }, image: { provider: 'openrouter', model: 'flux' } } } })
    expect(selectionReducer.agentSummary?.(slice, { url: () => '' }, {} as ProjectState)).toEqual({ model_choices: {
      s1: { video: { provider: 'fastvideo', model: 'pika' }, image: { provider: 'openrouter', model: 'flux' } } } })
    expect(reduce(record({ provider: 'fastvideo', model: 'pika' }), record({ modality: 'video', provider: '', model: '' })))
      .toEqual({ conversations: { s1: {} } })
  })

  it('refuses an agent generation with another model of a chosen modality, and leaves other modalities and users free', () => {
    const state = { components: { models: reduce(record({ modality: 'image', provider: 'openrouter', model: 'flux' })) } } as ProjectState
    expect(modelSelection(state, session, 'image')).toEqual({ provider: 'openrouter', model: 'flux' })
    expect(modelSelection(state, null, 'image')).toBeNull()
    const call = (params: Record<string, unknown>, actor = 'agent') => () => { assertModelSelection({ actor, session, params } as Parameters<typeof assertModelSelection>[0], state) }
    expect(call({ modality: 'image', provider: 'openrouter', model: 'seedream' })).toThrow("This conversation's image model is openrouter/flux.")
    expect(call({ modality: 'image', provider: 'openrouter', model: 'flux' })).not.toThrow()
    expect(call({ modality: 'video', provider: 'fastvideo', model: 'pika' })).not.toThrow()
    expect(call({ modality: 'image', provider: 'openrouter', model: 'seedream' }, 'user')).not.toThrow()
  })
})
