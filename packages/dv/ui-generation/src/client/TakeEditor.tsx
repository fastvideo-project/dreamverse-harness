/**
 * The editor body of a generation take, which the canvas renders for a claimed node: its first output through
 * `dv.media` at purpose 'loop' behind the take's preview as the poster, the failure reason of a failed take, its model
 * and generation task (the task's label in `GET /api/dv/tasks`, else its name), the params that its operation declares
 * in `GET /api/dv/operations` (prompt first), reference chips when the operation takes references and the kind's
 * `references` rule allows them for the take, and "渲染新版本": a rerun of the take's operation in the take's model and
 * task, whose `based_on` is the take. A take whose operation the list does not name shows no params and no button.
 * While the rerun starts the button is disabled and reads the kind's running words, and a refused request shows its
 * error under the button. "添加素材" opens the canvas's asset picker with the versioned items; a reference chip opens
 * the preview of its asset, or the editor of the node of its versioned item over this one.
 *
 * @module @dv/ui-generation/TakeEditor
 */
import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { InjectFace, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@dv/ui-canvas/contract'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { fieldsOf, paramsOf, type FormField } from '@dv/ui-kit/form.ts'
import { useText, type PickText } from '@dv/ui-kit/locale.ts'
import { playerBox } from '@dv/ui-kit/player-box.ts'
import { formatInputRef } from '@dv/ui-kit/references.ts'
import { taskLabel } from '@dv/ui-kit/tool-labels.ts'
import type { ProjectRecord } from '@dv/ui-kit/types.ts'
import type {} from '@dv/ui-media/contract'
import type { StatusWords } from './GenerationCard.tsx'
import type { GenerationInjected } from './loaded.ts'

/** What the kit injects into a take editor: the task label source, the kind's status words and its reference rule. */
export interface TakeEditorInjected {
  hooks: Pick<GenerationInjected['hooks'], 'taskLabels'>
  status: StatusWords
  /** Whether a take of the kind takes reference images, given its record. */
  references(record: ProjectRecord): boolean
}

/** The take editor's composed props. */
export type TakeEditorProps = PropsRuntime<'dv.canvas.editor.claimed'> & PropsRenderFactories & InjectFace<TakeEditorInjected>

const label: CSSProperties = { display: 'block', fontSize: 12, lineHeight: '16px', fontWeight: 500, color: 'var(--dv-text-2)', margin: '12px 0 4px' }
const field: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--dv-surface-2)', color: 'var(--dv-text)',
  border: '1px solid var(--dv-line-strong)', borderRadius: 'var(--dv-radius-md)', padding: '6px 8px', fontFamily: 'inherit', fontSize: 13, lineHeight: '20px',
}
const button: CSSProperties = {
  height: 32, border: 'none', borderRadius: 'var(--dv-radius-md)', padding: '0 12px', fontFamily: 'inherit', fontSize: 13, lineHeight: '20px', fontWeight: 500,
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const secondaryButton: CSSProperties = { ...button, border: '1px solid var(--dv-line-strong)', color: 'var(--dv-text)' }
const chip: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px 2px 2px', borderRadius: 14, background: 'var(--dv-surface-3)', fontSize: 13, lineHeight: '20px' }
/** The part of a reference chip that opens the reference: its thumbnail and its name. */
const chipOpen: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }
const chipMedia: CSSProperties = { display: 'flex', width: 22, height: 22, borderRadius: 11, overflow: 'hidden' }
/** The frame of the take's player; `playerBox` gives its size. */
const player: CSSProperties = { display: 'flex', borderRadius: 'var(--dv-radius-lg)', overflow: 'hidden', background: 'var(--dv-media-bg)' }
/** The model key params: the model-and-task line shows them, and a new take keeps them. */
const MODEL_KEY = new Set(['modality', 'task', 'provider', 'model'])
/** The params whose fields keep their element ID and localized label; any other param shows its key. */
const SHARED_FIELDS: Readonly<Record<string, { id: string; label: readonly [string, string] }>> = {
  prompt: { id: 'prompt', label: ['提示词', 'Prompt'] }, duration_sec: { id: 'duration', label: ['时长（秒）', 'Duration (s)'] },
  seed: { id: 'seed', label: ['种子', 'Seed'] },
}

/**
 * The field of one declared param: the prompt as a text area, a param with choices as a select, else an input.
 * @param props - the field, the text picker, and the callback that gets the field's next text.
 * @returns the label and the control.
 */
function ParamField({ param, pick, onText }: { param: FormField; pick: PickText; onText: (text: string) => void }): ReactNode {
  const shared = SHARED_FIELDS[param.key]
  const id = `dv-canvas-editor-${shared?.id ?? param.key}`
  const change = (event: { target: { value: string } }): void => { onText(event.target.value) }
  let control: ReactNode
  if (param.key === 'prompt') control = <textarea id={id} style={{ ...field, minHeight: 72, resize: 'vertical' }} value={param.text} onChange={change} />
  else if (param.control === 'select') control = <select id={id} style={field} value={param.text} onChange={change}><option value="" />{param.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
  else if (param.control === 'checkbox') control = <input id={id} type="checkbox" checked={param.text === 'true'} onChange={(event) => { onText(String(event.target.checked)) }} />
  else control = <input id={id} type={param.control === 'number' ? 'number' : 'text'} style={field} placeholder={param.key === 'seed' ? pick('随机', 'random') : undefined} value={param.text} onChange={change} />
  return <div style={{ flex: '1 1 200px' }}><label style={label} htmlFor={id}>{shared === undefined ? param.key : pick(...shared.label)}</label>{control}</div>
}

/** One input of the edited record. */
interface EditedInput {
  role: string
  ref: string
}

/**
 * The editor body.
 * @param props - the take, the state, the operations, the canvas host, the label hooks, the status words, and the
 *   Factory renderer.
 * @returns the element.
 */
export function TakeEditor(props: TakeEditorProps): ReactNode {
  const { node, state, operations, host, renderFactorySlot } = props
  const pick = useText()
  const taskLabels = props.useTaskLabels(value => value)
  const record = node.record
  const declared = operations.find(candidate => candidate.name === record.operation)
  const [inputs, setInputs] = useState<EditedInput[]>(
    () => record.inputs.map(input => ({ role: input.role, ref: formatInputRef(input.ref) })),
  )
  // The text of each field the user changed; the other fields show the record's params.
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({})
  const fields = declared === undefined ? [] : fieldsOf(declared.params, record.params)
    .filter(param => !MODEL_KEY.has(param.key)).map(param => ({ ...param, text: texts[param.key] ?? param.text }))
  const [starting, setStarting] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const references = inputs.filter(input => input.role === 'reference')
  const assets = new Map(state.assets.map(asset => [asset.id, asset]))
  const addReferences = (refs: readonly string[]): void => {
    const added = refs.filter(ref => !references.some(input => input.ref === ref))
    setInputs(current => [...current, ...added.map(ref => ({ role: 'reference', ref }))])
  }
  const model = typeof record.params['model'] === 'string' ? record.params['model'] : ''
  const task = typeof record.params['task'] === 'string' ? record.params['task'] : ''
  // Reference chips need a declared `reference` input and a take that the kind lets take references.
  const withReferences = declared?.inputs['reference'] !== undefined && props.references(record)
  const renderTake = (): void => {
    let edited: Record<string, unknown>
    try {
      edited = paramsOf(fields)
    } catch (error) {
      // A field whose text does not parse, or an empty required field, starts no render.
      setRenderError(errorMessage(error))
      return
    }
    // The take's other params stay, the model key among them; an emptied field drops its param.
    const kept = Object.entries(record.params).filter(([key]) => !fields.some(param => param.key === key))
    const params = { ...Object.fromEntries(kept), ...edited }
    setStarting(true)
    setRenderError(null)
    // On success the canvas closes the editor and selects the new take.
    host.rerun({
      operation: record.operation, inputs, params, intent: pick(`在画布上渲染 ${node.title} 的新版本`, `Render a new take of ${node.title} from the canvas`), based_on: record.id,
    }).catch((error: unknown) => {
      setStarting(false)
      setRenderError(errorMessage(error))
    })
  }
  const failure = record.error?.message ?? null
  const shown = assets.get(node.assets[0] ?? '')
  const fieldOf = (param: FormField): ReactNode => (
    <ParamField key={param.key} param={param} pick={pick} onText={(text) => { setTexts(current => ({ ...current, [param.key]: text })) }} />
  )
  return (
    <div>
      {shown === undefined ? null : <div style={{ ...player, ...playerBox(shown, 360) }} data-testid="dv-take-player">{renderFactorySlot('dv.media', { asset: shown, purpose: 'loop', ...node.preview === undefined ? {} : { poster: node.preview } })}</div>}
      {failure === null
        ? null
        : <p role="note" style={{ margin: 0, padding: '8px 12px', borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-danger-soft)', color: 'var(--dv-danger)' }}>{pick(`失败原因：${failure}`, `Failure reason: ${failure}`)}</p>}
      <span style={label}>{pick('模型和生成方式', 'Model and mode')}</span>
      <span data-testid="dv-canvas-render-mode">{`${model} · ${pick(...taskLabel(task, taskLabels))}`}</span>
      {fields.filter(param => param.key === 'prompt').map(fieldOf)}
      {!withReferences ? null : <><span style={label}>{pick('参考', 'References')}</span><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {references.map((input) => {
          const facts = host.reference(input.ref)
          const { asset } = facts
          // A versioned item opens the editor of its node; an asset opens its preview, which grows out of the chip.
          const open = (chipButton: Element): void => {
            if (facts.node !== null) host.openNode(facts.node)
            else if (asset !== null) host.preview(asset.id, chipButton)
          }
          return (
            <span key={input.ref} style={chip}>
              <button type="button" data-reference={input.ref} aria-label={pick(`查看 ${facts.name}`, `View ${facts.name}`)} style={chipOpen} onClick={(event) => { open(event.currentTarget) }}>
                <span style={chipMedia}>{asset === null ? null : renderFactorySlot('dv.media', { asset, purpose: 'thumb' })}</span>
                {facts.name}
              </button>
              <button type="button" aria-label={pick(`移除 ${facts.name}`, `Remove ${facts.name}`)} style={{ border: 'none', background: 'transparent', color: 'var(--dv-text-2)', cursor: 'pointer' }} onClick={() => { setInputs(inputs.filter(other => other !== input)) }}>×</button>
            </span>
          )
        })}
        <button
          type="button" className="dv-canvas-btn" style={{ ...secondaryButton, height: 28 }}
          onClick={() => { host.pickAssets(references.map(input => input.ref), { versions: true }, addReferences) }}
        >
          {pick('＋ 添加素材', '+ Add asset')}
        </button>
      </div></>}
      <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 12 }}>{fields.filter(param => param.key !== 'prompt').map(fieldOf)}</div>
      {declared === undefined ? null : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 14 }}>
        {renderError === null ? null : <p role="alert" style={{ flex: 1, minWidth: 0, margin: 0, color: 'var(--dv-danger)' }}>{pick(`失败：${renderError}`, `Failed: ${renderError}`)}</p>}
        <button
          type="button" className="dv-canvas-soft" disabled={starting}
          style={{ ...button, opacity: starting ? 0.5 : 1 }} onClick={renderTake}
        >
          {starting ? pick(...props.status.running) : pick('渲染新版本', 'Render new take')}
        </button>
      </div>}
    </div>
  )
}
