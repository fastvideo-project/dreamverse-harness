/**
 * The text node editor: the `dv.canvas.editor` entry that the canvas shows for a text node version. Read mode
 * renders its Markdown through DSH's Markdown renderer; edit mode opens the `conversation.prompt` editor with the `@`
 * source of `@dv/ui-composer`. Both show each citation as the chip face of `@dv/ui-composer`, and a save writes the next
 * version through its own `/api/dv` call.
 *
 * @module @dv/ui-text-node/TextEditor
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { PromptContent, PromptHostModel } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MarkdownDelegateProvider, MarkdownText, type MarkdownElementRenderer, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderFactories, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { formatInputRef, parsePromptCitations } from '@dv/project/grammar'
import type {} from '@dv/ui-canvas/contract'
import { MENTION_SOURCE } from '@dv/ui-composer/mention'
import { editorContent, faceOf, resolveAtom } from '@dv/ui-composer/reference-model'
import { DvClient, errorMessage } from '@dv/ui-kit/api.ts'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import type { ProjectRecord, WireState } from '@dv/ui-kit/types.ts'
import type { NS } from './locales.ts'
import { footerText, useBody } from './TextCard.tsx'
import { pathOf, textsOf, withLabels } from './texts.ts'

/** The apply-world face of the editor entry: the version kinds of the canvas, which resolve each chip's face. */
export interface TextEditorInjected {
  readonly hooks: { readonly versionKinds: HostObservable<readonly VersionKind[]> }
}

/**
 * What the editor shows: the version in read mode, or a draft with the version it started from. A refused save keeps
 * its draft and the error of the refusal.
 */
type EditorMode =
  | { readonly mode: 'read' }
  | { readonly mode: 'edit'; readonly base: number; readonly start: string; readonly body: string; readonly saving: boolean; readonly refusal: string | null }

const READ: EditorMode = { mode: 'read' }

const client = new DvClient()

// The `dv-canvas-btn` class of the canvas stylesheet paints the fill and the hover of these buttons.
const button: CSSProperties = {
  height: 32, border: '1px solid var(--dv-line-strong)', borderRadius: 'var(--dv-radius-md)', padding: '0 12px', fontFamily: 'inherit', fontSize: 13,
  lineHeight: '20px', fontWeight: 500, color: 'var(--dv-text)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const meta: CSSProperties = { fontFamily: 'var(--dv-font-mono)', fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-2)' }
const box: CSSProperties = { minHeight: 320, padding: '10px 12px', borderRadius: 'var(--dv-radius-md)', boxShadow: 'inset 0 0 0 1px var(--dv-line)', background: 'var(--dv-surface-1)' }

// The `@` menu of `conversation.prompt` opens above the editor, where the scrolling editor body clips it; it opens below.
const MENU_BELOW_CSS = '[data-testid="dv-text-markdown"] [data-trigger-menu] { top: calc(100% + 4px); bottom: auto; }'

/**
 * The editor content of a Markdown body: the text, and a chip of the `@` source for each citation.
 * @param body - the Markdown.
 * @returns the first revision of the content.
 */
function contentOf(body: string): PromptContent {
  const { text, chips } = editorContent({ prompt: body, inputs: [] })
  return { revision: 0, history: 'reset', text, chips: chips.map(chip => ({ source: MENTION_SOURCE, ...chip, clipboardText: chip.ref })) }
}

/**
 * The read view of a Markdown body: DSH's chat Markdown renderer, with each citation as the chip face of the `@`
 * source, which shows the cited item's newest version.
 * @param props - the Markdown, the project state and version kinds that resolve each chip, the Factory renderer, and the
 *   translate function.
 * @returns the element.
 */
function MarkdownView({ body, state, versions, renderFactorySlot, t }: {
  readonly body: string
  readonly state: WireState
  readonly versions: readonly VersionKind[]
  readonly t: TranslateNS<typeof NS>
} & PropsRenderFactories): ReactNode {
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') }, footnotes: t('markdown.footnotes'),
  }), [t])
  const citations = parsePromptCitations(body)
  // Without its `@`, a citation `@[label](dv:…)` is a Markdown link to its URI, which the renderer hands to the chip.
  const text = withLabels(body, citations.map(citation => ({ ...citation, label: body.slice(citation.start + 1, citation.end) })))
  const renderElement: MarkdownElementRenderer = (element, fallback) => {
    const citation = element.kind === 'link' ? citations.find(each => each.uri === element.href) : undefined
    if (citation === undefined) return fallback
    const face = faceOf(resolveAtom({ label: citation.label, uri: citation.uri }, { state, versions, inputs: null, filter: null }))
    return renderFactorySlot('dv.text.reference', {
      source: MENTION_SOURCE, reference: body.slice(citation.start, citation.end), label: citation.label, invalid: false,
      context: { faces: { [citation.uri]: face } },
    })
  }
  return <MarkdownDelegateProvider renderElement={renderElement}><MarkdownText text={text} labels={labels} /></MarkdownDelegateProvider>
}

/**
 * The `source` inputs of a record as request inputs, each moved to the newest version of the text node it names, so
 * the next version keeps the text nodes it was built from and does not start stale.
 * @param state - the project state.
 * @param record - the record of the newest version.
 * @returns the request inputs, one per source text node.
 */
function currentSources(state: WireState, record: ProjectRecord | undefined): Array<{ role: string; ref: string }> {
  const refs = (record?.inputs ?? []).filter(input => input.role === 'source').map(({ ref }) => {
    const producer = 'record' in ref ? state.components.proj.records.find(each => each.id === ref.record) : undefined
    const newest = producer === undefined ? undefined : textsOf(state)[pathOf(producer)]?.at(-1)
    return newest === undefined ? formatInputRef(ref as Parameters<typeof formatInputRef>[0]) : `${newest.created_by}#0`
  })
  return [...new Set(refs)].map(ref => ({ role: 'source', ref }))
}

/**
 * The editor of one text node version. Both modes read the version's Markdown from its asset, as the card does. Read
 * mode renders it with its citations as chips; on the newest version, edit mode opens the same editor with the `@`
 * picker and keeps its draft when a newer version arrives. Its save writes the next version with `textnode.write`, the
 * draft's `base_version`, the sources of the newest version at their own newest versions, and `based_on` its record.
 * When a newer version than the draft's exists, the editor names both versions, keeps the draft, and offers to save it
 * on top of the newest version. A refusal or a failed record shows its own text and keeps the draft. A saved draft
 * closes the editor, and the new version joins the node. An older version, chosen in the canvas's version strip, is
 * read only.
 * @param props - the node, the state, the canvas host, the version kinds, the Factory renderer, and the translate
 *   function.
 * @returns the element.
 */
export function TextEditor({ node, state, host, renderFactorySlot, useVersionKinds, t }: PropsRuntime<'dv.canvas.editor'> & InjectFace<TextEditorInjected> & PropsRenderFactories & PropsLocale<typeof NS>): ReactNode {
  const [editor, setEditor] = useState<EditorMode>(READ)
  const versionKinds = useVersionKinds(kinds => kinds)
  const path = pathOf(node.record)
  const versions = textsOf(state)[path] ?? []
  const shown = versions.find(version => version.created_by === node.record.id)
  const latest = versions.at(-1)
  const shownBody = useBody(shown?.asset)
  const latestBody = useBody(latest?.asset)
  if (shown === undefined || latest === undefined) return null
  const chars = node.record.report?.['chars']
  const save = async (base: number, start: string, body: string): Promise<void> => {
    setEditor({ mode: 'edit', base, start, body, saving: true, refusal: null })
    const newest = state.components.proj.records.find(record => record.id === latest.created_by)
    let refusal: string
    try {
      const record = await client.runOperation({
        project: state.project.id, operation: 'textnode.write', surface: 'canvas', based_on: latest.created_by,
        params: { path, body, base_version: base }, inputs: currentSources(state, newest), intent: `Save ${path} from the canvas`,
      })
      if (record.status !== 'failed' && record.status !== 'cancelled') {
        host.close()
        return
      }
      refusal = record.error?.message ?? t('node.saveFailed')
    } catch (error) {
      refusal = errorMessage(error)
    }
    setEditor({ mode: 'edit', base, start, body, saving: false, refusal })
  }
  const behind = editor.mode === 'edit' && latest.version !== editor.base
  const model = (readOnly: boolean, content: PromptContent, onChange: (text: string) => void): PromptHostModel => ({
    content, readOnly, sources: readOnly ? [] : [MENTION_SOURCE], sourceContext: null, faceContext: null,
    onChange: (text) => { onChange(text) }, placeholder: t('editor.markdown'), ariaLabel: t('editor.markdown'),
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span data-testid="dv-text-version" style={meta}>{typeof chars === 'number' ? footerText(shown.version, chars, t) : null}</span>
        <span style={{ flex: 1 }} />
        {editor.mode === 'edit'
          ? (
            <>
              <button type="button" className="dv-canvas-btn" style={button} disabled={editor.saving} onClick={() => { setEditor(READ) }}>{t('editor.cancel')}</button>
              <button type="button" className="dv-canvas-btn" style={button} disabled={editor.saving} onClick={() => { void save(latest.version, editor.start, editor.body) }}>
                {editor.saving ? t('editor.saving') : behind ? t('editor.saveOnTop', { version: String(latest.version) }) : t('editor.save')}
              </button>
            </>
          )
          : shown !== latest
            ? null
            : (
              <button
                type="button" className="dv-canvas-btn" style={button} disabled={latestBody === null}
                onClick={() => { if (latestBody !== null) setEditor({ mode: 'edit', base: latest.version, start: latestBody, body: latestBody, saving: false, refusal: null }) }}
              >
                {t('editor.edit')}
              </button>
            )}
      </div>
      {editor.mode === 'edit' && (behind || editor.refusal !== null)
        ? (
          <div role="alert" style={{ padding: '8px 12px', borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-surface-3)', color: 'var(--dv-danger)', fontSize: 13, lineHeight: '20px' }}>
            {behind ? t('editor.newerVersion', { newest: String(latest.version), base: String(editor.base) }) : editor.refusal}
          </div>
        )
        : null}
      {/* A new key per mode and version gives the editor a fresh occurrence, which opens on its first revision. */}
      <div key={`${editor.mode}:${shown.created_by}`} data-testid="dv-text-markdown" style={box}>
        {editor.mode === 'read'
          ? <MarkdownView body={shownBody ?? ''} state={state} versions={versionKinds} renderFactorySlot={renderFactorySlot} t={t} />
          : (
            <>
              <style>{MENU_BELOW_CSS}</style>
              {renderFactorySlot('conversation.prompt', {
                model: model(editor.saving, contentOf(editor.start), (text) => { setEditor(current => current.mode === 'edit' ? { ...current, body: text } : current) }),
              })}
            </>
          )}
      </div>
    </div>
  )
}
