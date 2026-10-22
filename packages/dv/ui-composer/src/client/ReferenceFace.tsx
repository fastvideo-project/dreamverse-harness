/**
 * The face of a DreamVerse chip in every prompt editor: the `conversation.prompt.reference` entry of the `@` source.
 * It draws the reference's preview, its label, and the version a call sends, from the live project state; a chip that
 * the call's inputs do not satisfy draws in the failure style. A chat chip names its element's newest version.
 *
 * @module @dv/ui-composer/ReferenceFace
 */
import type { CSSProperties, ReactNode } from 'react'
import type { ReferenceFaceOwner } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parsePromptCitations } from '@dv/project/grammar'
import type {} from '@dv/ui-media/contract'
import type { PromptFaceContext, ReferenceFaceInjected } from './contract/index.ts'

/** Full props of the face; the chat bar's slot has the same owner props. */
export type ReferenceFaceProps = PropsRuntime<'conversation.prompt.reference'> & InjectFace<ReferenceFaceInjected> & PropsRenderFactories

const face: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 6px 0 2px', borderRadius: 10, verticalAlign: 'middle',
  background: 'var(--dv-surface-3)', fontSize: 13, lineHeight: '20px', whiteSpace: 'nowrap',
}
const preview: CSSProperties = { display: 'inline-flex', width: 18, height: 18, borderRadius: 9, overflow: 'hidden' }

/** The face context that a `dv.prompt` occurrence wrote, read back from its JSON; null for a chat chip. */
function contextOf(owner: ReferenceFaceOwner): PromptFaceContext | null {
  const value = owner.context
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { projectId, inputs, filter } = value
  if (typeof projectId !== 'string' || !Array.isArray(inputs)) return null
  const calls = inputs.flatMap(input => typeof input === 'object' && input !== null && !Array.isArray(input)
    && typeof input['role'] === 'string' && typeof input['ref'] === 'string' ? [{ role: input['role'], ref: input['ref'] }] : [])
  const media = typeof filter === 'object' && filter !== null && !Array.isArray(filter) && Array.isArray(filter['mediaTypes'])
    ? { mediaTypes: filter['mediaTypes'].filter(type => typeof type === 'string'), maxReferences: typeof filter['maxReferences'] === 'number' ? filter['maxReferences'] : null }
    : null
  return { projectId, inputs: calls, filter: media }
}

/**
 * Draw one chip.
 * @param props - the chip, its occurrence's face context, and the face's inject.
 * @returns the face; the chip's label alone until the project state loads.
 */
export function ReferenceFace(props: ReferenceFaceProps): ReactNode {
  const context = contextOf(props)
  const current = props.useCurrentProject(projectId => projectId)
  const projectId = context?.projectId ?? current ?? ''
  const state = props.useProjectState(projectId) ?? null
  // The view reads the version kinds; reading them here draws the face again when a kind registers.
  props.useVersionKinds(kinds => kinds.length)
  const [citation] = parsePromptCitations(props.reference)
  const view = state === null || citation === undefined ? null : props.view(state, { label: citation.label, uri: citation.uri }, context)
  const invalid = props.invalid || (view !== null && !view.satisfied)
  return (
    <span data-dv-chip={citation?.uri ?? ''} data-invalid={invalid || undefined} title={props.label} style={{ ...face, ...invalid ? { color: 'var(--dv-danger)', boxShadow: 'inset 0 0 0 1px var(--dv-danger)' } : {} }}>
      {view?.preview === null || view === null ? null : <span style={preview}>{props.renderFactorySlot('dv.media', { asset: view.preview, purpose: 'thumb' })}</span>}
      {props.label}
      {view?.version === null || view === null ? null : <span style={{ color: 'var(--dv-text-2)', fontSize: 11 }}>{`v${String(view.version.sent)}`}</span>}
    </span>
  )
}
