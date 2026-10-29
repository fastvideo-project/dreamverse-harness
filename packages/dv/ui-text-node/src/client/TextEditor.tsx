/**
 * The text node editor: the `dv.canvas.editor.claimed` entry that the canvas shows for a text node version. Its
 * Markdown shows each citation as a chip through the `conversation.prompt` editor and the `@` source and chip face of
 * `@dv/ui-composer`, and a save writes the next version through its own `/api/dv` call.
 *
 * @module @dv/ui-text-node/TextEditor
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { PromptContent, PromptHostModel } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formatInputRef } from '@dv/project/grammar'
import type {} from '@dv/ui-canvas/contract'
import { MENTION_SOURCE } from '@dv/ui-composer/mention'
import { editorContent } from '@dv/ui-composer/reference-model'
import { DvClient, errorMessage } from '@dv/ui-kit/api.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { ProjectRecord } from '@dv/ui-kit/types.ts'
import { footerText } from './TextCard.tsx'
import { pathOf, textsOf } from './texts.ts'

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

/** The `source` inputs of a record, as request inputs, so the next version keeps the text nodes it was built from. */
function sourcesOf(record: ProjectRecord | undefined): Array<{ role: string; ref: string }> {
  return (record?.inputs ?? []).filter(input => input.role === 'source')
    .map(input => ({ role: input.role, ref: formatInputRef(input.ref as Parameters<typeof formatInputRef>[0]) }))
}

/**
 * The editor of one text node version. Read mode draws the version's Markdown with its citations as chips; on the
 * newest version, edit mode opens the same editor with the `@` picker and keeps its draft when a newer version
 * arrives. Its save writes the next version with `textnode.write`, the draft's `base_version`, the sources of the
 * newest version, and `based_on` its record. A save
 * over a version that the draft did not start from is refused; the editor then names the newest version and the
 * draft's version, and keeps the draft. Any other refusal shows its own text. A saved draft closes the editor, and the
 * canvas draws the new version as the next node.
 * @param props - the node, the state, the canvas host, and the Factory renderer.
 * @returns the element.
 */
export function TextEditor({ node, state, host, renderFactorySlot }: PropsRuntime<'dv.canvas.editor.claimed'> & PropsRenderFactories): ReactNode {
  const pick = useText()
  const [editor, setEditor] = useState<EditorMode>(READ)
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
          ? renderFactorySlot('conversation.prompt', { model: model(true, contentOf(shown.body), () => {}) })
          : renderFactorySlot('conversation.prompt', {
            model: model(editor.saving, contentOf(editor.start), (text) => { setEditor(current => current.mode === 'edit' ? { ...current, body: text } : current) }),
          })}
      </div>
    </div>
  )
}
