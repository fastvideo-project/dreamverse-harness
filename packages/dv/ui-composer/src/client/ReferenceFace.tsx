/**
 * The face of a DreamVerse chip in every prompt editor and in the chat composer bar: the `conversation.prompt.reference`
 * and `conversation.input.reference` entries of the `@` source.
 * It draws the reference's preview, its label, and the version a call sends; a chip that the call's inputs do not
 * satisfy draws in the failure style. A chip of a `dv.prompt` occurrence draws the face that the occurrence resolved
 * against its host's state. A chat chip reads the live state of the open project and names its element's newest
 * version.
 *
 * @module @dv/ui-composer/ReferenceFace
 */
import type { CSSProperties, ReactNode } from 'react'
import type { ReferenceFaceOwner } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { parsePromptCitations } from '@dv/project/grammar'
import type {} from '@dv/ui-media/contract'
import type { ChipFace, ReferenceFaceInjected } from './contract/index.ts'
import { faceOf, resolveAtom } from './reference-model.ts'

/** Full props of the face; the chat bar's slot has the same owner props. */
export type ReferenceFaceProps = PropsRuntime<'conversation.prompt.reference'> & InjectFace<ReferenceFaceInjected> & PropsRenderFactories

const face: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 6px 0 2px', borderRadius: 10, verticalAlign: 'middle',
  background: 'var(--dv-surface-3)', fontSize: 13, lineHeight: '20px', whiteSpace: 'nowrap',
}
const preview: CSSProperties = { display: 'inline-flex', width: 18, height: 18, borderRadius: 9, overflow: 'hidden' }

/** A JSON object, else null. */
function objectOf(value: JsonValue | undefined): { readonly [key: string]: JsonValue } | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}

/** One face that a `dv.prompt` occurrence wrote, read back from its JSON; null for a value of another shape. */
function chipFaceOf(value: JsonValue): ChipFace | null {
  const fields = objectOf(value)
  const shown = objectOf(fields?.['preview'])
  const sent = fields?.['sent']
  const satisfied = fields?.['satisfied']
  if (fields === null || typeof satisfied !== 'boolean' || (typeof sent !== 'number' && sent !== null)) return null
  const { id, mime, name } = shown ?? {}
  const previewOf = typeof id === 'string' && typeof mime === 'string' && typeof name === 'string' ? { id, mime, name } : null
  return { preview: previewOf, sent, satisfied }
}

/** The faces that a `dv.prompt` occurrence gave its chips, by citation URI; null for a chat chip's context. */
function facesOf(owner: ReferenceFaceOwner): ReadonlyMap<string, ChipFace> | null {
  const faces = objectOf(objectOf(owner.context)?.['faces'])
  if (faces === null) return null
  return new Map(Object.entries(faces).flatMap(([uri, value]) => {
    const read = chipFaceOf(value)
    return read === null ? [] : [[uri, read]]
  }))
}

/**
 * Draw one chip.
 * @param props - the chip, its occurrence's face context, and the face's inject.
 * @returns the face; a chat chip's label alone until the project state loads.
 */
export function ReferenceFace(props: ReferenceFaceProps): ReactNode {
  const faces = facesOf(props)
  const current = props.useCurrentProject(projectId => projectId)
  // Only a chat chip reads a project's state; the empty project fetches nothing.
  const state = props.useProjectState(faces === null ? current ?? '' : '') ?? null
  const versions = props.useVersionKinds(kinds => kinds) ?? []
  const [citation] = parsePromptCitations(props.reference)
  const uri = citation?.uri ?? ''
  const chat = state === null || citation === undefined
    ? null
    : faceOf(resolveAtom({ label: citation.label, uri }, { state, versions, inputs: null, filter: null }))
  const shown = faces === null ? chat : faces.get(uri) ?? null
  const invalid = props.invalid || (shown !== null && !shown.satisfied)
  return (
    <span data-dv-chip={uri} data-invalid={invalid || undefined} title={props.label} style={{ ...face, ...invalid ? { color: 'var(--dv-danger)', boxShadow: 'inset 0 0 0 1px var(--dv-danger)' } : {} }}>
      {shown?.preview === null || shown === null ? null : <span style={preview}>{props.renderFactorySlot('dv.media', { asset: shown.preview, purpose: 'thumb' })}</span>}
      {props.label}
      {shown?.sent === null || shown === null ? null : <span style={{ color: 'var(--dv-text-2)', fontSize: 11 }}>{`v${String(shown.sent)}`}</span>}
    </span>
  )
}
