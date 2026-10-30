/**
 * The text node editor: the `dv.canvas.editor.claimed` entry that the canvas shows for a text node version. Read mode
 * renders its Markdown through DSH's Markdown renderer; edit mode opens the `conversation.prompt` editor with the `@`
 * source of `@dv/ui-composer`. Both show each citation as the chip face of `@dv/ui-composer`, and a save writes the next
 * version through its own `/api/dv` call.
 *
 * @module @dv/ui-text-node/TextEditor
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { PromptContent, PromptHostModel } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MarkdownDelegateProvider, MarkdownText, type MarkdownElementRenderer, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formatInputRef, parsePromptCitations } from '@dv/project/grammar'
import type {} from '@dv/ui-canvas/contract'
import { MENTION_SOURCE } from '@dv/ui-composer/mention'
import { editorContent, faceOf, resolveAtom } from '@dv/ui-composer/reference-model'
import { DvClient, errorMessage } from '@dv/ui-kit/api.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import type { ProjectRecord, WireState } from '@dv/ui-kit/types.ts'
import { footerText } from './TextCard.tsx'
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
 * @param props - the Markdown, the project state and version kinds that resolve each chip, and the Factory renderer.
 * @returns the element.
 */
function MarkdownView({ body, state, versions, renderFactorySlot }: {
  readonly body: string
  readonly state: WireState
  readonly versions: readonly VersionKind[]
} & PropsRenderFactories): ReactNode {
  const pick = useText()
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: pick('复制', 'Copy'), copiedLabel: pick('已复制', 'Copied') }, footnotes: pick('脚注', 'Footnotes'),
  }), [pick])
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

/** The `source` inputs of a record, as request inputs, so the next version keeps the text nodes it was built from. */
function sourcesOf(record: ProjectRecord | undefined): Array<{ role: string; ref: string }> {
  return (record?.inputs ?? []).filter(input => input.role === 'source')
    .map(input => ({ role: input.role, ref: formatInputRef(input.ref as Parameters<typeof formatInputRef>[0]) }))
}

/**
 * The editor of one text node version. Read mode renders the version's Markdown with its citations as chips; on the
 * newest version, edit mode opens the same editor with the `@` picker and keeps its draft when a newer version
 * arrives. Its save writes the next version with `textnode.write`, the draft's `base_version`, the sources of the
 * newest version, and `based_on` its record. A save
 * over a version that the draft did not start from is refused; the editor then names the newest version and the
 * draft's version, and keeps the draft. Any other refusal shows its own text. A saved draft closes the editor, and the
 * canvas draws the new version as the next node.
 * @param props - the node, the state, the canvas host, and the Factory renderer.
 * @returns the element.
 */
export function TextEditor({ node, state, host, renderFactorySlot, useVersionKinds }: PropsRuntime<'dv.canvas.editor.claimed'> & InjectFace<TextEditorInjected> & PropsRenderFactories): ReactNode {
  const pick = useText()
  const [editor, setEditor] = useState<EditorMode>(READ)
  const versionKinds = useVersionKinds(kinds => kinds)
  const path = pathOf(node.record)
  const versions = textsOf(state)[path] ?? []
  const shown = versions.find(version => version.created_by === node.record.id)
  const latest = versions.at(-1)
  if (shown === undefined || latest === undefined) return null
  const save = async (base: number, start: string, body: string): Promise<void> => {
    setEditor({ mode: 'edit', base, start, body, saving: true, refusal: null })
    const newest = state.components.proj.records.find(record => record.id === latest.created_by)
    try {
      await client.runOperation({
        project: state.project.id, operation: 'textnode.write', surface: 'canvas', based_on: latest.created_by,
        params: { path, body, base_version: base }, inputs: sourcesOf(newest), intent: pick(`在画布上保存 ${path}`, `Save ${path} from the canvas`),
      })
      host.close()
    } catch (error) {
      setEditor({ mode: 'edit', base, start, body, saving: false, refusal: errorMessage(error) })
    }
  }
  const model = (readOnly: boolean, content: PromptContent, onChange: (text: string) => void): PromptHostModel => ({
    content, readOnly, sources: readOnly ? [] : [MENTION_SOURCE], sourceContext: null, faceContext: null,
    onChange: (text) => { onChange(text) }, placeholder: pick('Markdown 文本', 'Markdown text'), ariaLabel: pick('Markdown 文本', 'Markdown text'),
  })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span data-testid="dv-text-version" style={meta}>{pick(...footerText(shown.version, Array.from(shown.body).length))}</span>
        <span style={{ flex: 1 }} />
        {editor.mode === 'edit'
          ? (
            <>
              <button type="button" className="dv-canvas-btn" style={button} disabled={editor.saving} onClick={() => { setEditor(READ) }}>{pick('取消', 'Cancel')}</button>
              <button type="button" className="dv-canvas-btn" style={button} disabled={editor.saving} onClick={() => { void save(editor.base, editor.start, editor.body) }}>
                {editor.saving ? pick('保存中…', 'Saving…') : pick('保存', 'Save')}
              </button>
            </>
          )
          : shown !== latest
            ? (
              <button type="button" className="dv-canvas-btn" style={button} onClick={() => { host.openNode(latest.created_by) }}>
                {pick(`打开第 ${String(latest.version)} 版`, `Open version ${String(latest.version)}`)}
              </button>
            )
            : (
              <button type="button" className="dv-canvas-btn" style={button} onClick={() => { setEditor({ mode: 'edit', base: latest.version, start: latest.body, body: latest.body, saving: false, refusal: null }) }}>
                {pick('编辑', 'Edit')}
              </button>
            )}
      </div>
      {editor.mode === 'edit' && editor.refusal !== null
        ? (
          <div role="alert" style={{ padding: '8px 12px', borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-surface-3)', color: 'var(--dv-danger)', fontSize: 13, lineHeight: '20px' }}>
            {latest.version === editor.base
              ? editor.refusal
              : pick(
                `有人先保存了第 ${String(latest.version)} 版。你的草稿基于第 ${String(editor.base)} 版。`,
                `Someone saved version ${String(latest.version)} first. Your draft is based on version ${String(editor.base)}.`,
              )}
          </div>
        )
        : null}
      {/* A new key per mode and version gives the editor a fresh occurrence, which opens on its first revision. */}
      <div key={`${editor.mode}:${shown.created_by}`} data-testid="dv-text-markdown" style={box}>
        {editor.mode === 'read'
          ? <MarkdownView body={shown.body} state={state} versions={versionKinds} renderFactorySlot={renderFactorySlot} />
          : renderFactorySlot('conversation.prompt', {
            model: model(editor.saving, contentOf(editor.start), (text) => { setEditor(current => current.mode === 'edit' ? { ...current, body: text } : current) }),
          })}
      </div>
    </div>
  )
}
