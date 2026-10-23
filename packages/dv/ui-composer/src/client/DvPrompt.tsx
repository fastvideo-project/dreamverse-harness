/**
 * The `dv.prompt` Factory component: the reference tray, the `conversation.prompt` editor, and the parameter bar with
 * the cost and send, over one call. The document holds the prompt and the call's inputs in their stored order; the
 * editor owns the text and the chips, and each editor change reconciles the inputs. A tray edit that changes the
 * prompt reaches the editor as a new content revision, so the editor's undo also undoes it. A tray edit that leaves the
 * prompt as it is (a picker add, an upload, a version pin) is no editor step, so the editor's undo leaves it: the
 * editor's history holds editor states only, and holding the inputs there would put them in the prompt's text. The
 * tile's × takes back a picker add or an upload; a pin to the newest version has no way back to the older one. In read
 * mode the tray and the editor only show the call. Every reference resolves against the state that the host lends, and
 * each chip's face draws what the composer resolved for it.
 *
 * The tray and `@` offer references only when the call's operation declares a `reference` input and the
 * selected model takes one. The placeholder and the send button read the copy of the operation's parameter bar; an
 * operation without one shows words that name no kind.
 *
 * @module @dv/ui-composer/DvPrompt
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Occurrence, PromptChip, PromptHostModel } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { FactoryComponentPropsOf, RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots'
import { parsePromptCitations } from '@dv/project/grammar'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { fieldsOf, valueOf } from '@dv/ui-kit/form.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { OperationCheck, WireModelEntry, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import type {} from '@dv/ui-media/contract'
import type {
  CallInput, CandidateFilter, ParamBar, ParamChip, PromptCopy, PromptDocument, PromptFaceContext, ReferenceView, RemovedInput,
} from './contract/index.ts'
import { MENTION_SOURCE } from './mention.ts'
import { callOf, documentOf, editorContent, faceOf, pinVersion, runsOfEditor } from './reference-model.ts'

/** Full props of the component. */
export type DvPromptComponentProps = FactoryComponentPropsOf<'dv.prompt'>

/** The wait after the last edit before the call is checked, in ms. */
const CHECK_DELAY_MS = 250

/** The words of an occurrence whose operation's bar gives none; they name no kind. */
const NEUTRAL_COPY: Required<PromptCopy> = {
  placeholder: ['描述要生成的内容', 'Describe what to generate'],
  send: ['生成新版本', 'Generate a new version'],
  sending: ['生成中…', 'Generating…'],
}

const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }
const tile: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px 2px 2px', borderRadius: 14, background: 'var(--dv-surface-3)', fontSize: 12, lineHeight: '20px' }
const thumb: CSSProperties = { display: 'flex', width: 22, height: 22, borderRadius: 11, overflow: 'hidden' }
const plain: CSSProperties = { border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', padding: '0 4px' }
const select: CSSProperties = { height: 26, borderRadius: 13, border: '1px solid var(--dv-line-strong)', background: 'var(--dv-surface-2)', color: 'var(--dv-text)', font: 'inherit', fontSize: 12, padding: '0 8px' }

/** The params that the editor and the model chip edit, and the model's own params, which no default chip shows. */
const NOT_CHIPS = new Set(['prompt', 'modality', 'task', 'provider', 'model', 'extra'])

/**
 * The default bar of an operation without a registered bar: one chip per declared param, a menu for a param with
 * choices and a text field otherwise.
 */
function defaultChips(operation: WireOperation, params: Readonly<Record<string, unknown>>): ParamChip[] {
  return fieldsOf(operation.params, { ...params }).filter(field => !NOT_CHIPS.has(field.key)).map(field => ({
    key: field.key, label: [field.key, field.key], value: field.text,
    options: field.options.map(option => ({ label: option, patch: { [field.key]: valueOf({ ...field, text: option }) } })),
  }))
}

/** The model entry that a call's key params name. */
function modelOf(models: readonly WireModelEntry[], params: Readonly<Record<string, unknown>>): WireModelEntry | undefined {
  return models.find(entry => entry.modality === params['modality'] && entry.task === params['task']
    && entry.provider === params['provider'] && entry.model === params['model'])
}

/** The editor content of a document, with every chip owned by the `@` source. */
function chipsOf(document: PromptDocument): { text: string; chips: PromptChip[] } {
  const content = editorContent(document)
  return { text: content.text, chips: content.chips.map(chip => ({ source: MENTION_SOURCE, ...chip, clipboardText: chip.ref })) }
}

/**
 * Render one composer occurrence.
 * @param props - the call, the host, the send, the inject face, and the Factory renderer.
 * @returns the composer.
 */
export function DvPrompt(props: DvPromptComponentProps): ReactNode {
  const { projectId, call, state, readOnly, host, onSubmit, renderFactorySlot } = props
  const pick = useText()
  // The views read the version kinds; reading them here draws the composer again when a kind registers.
  props.useVersionKinds(kinds => kinds.length)
  const models = props.useModels(catalog => catalog)
  const operation = props.operations.find(candidate => candidate.name === call.operation) ?? null
  const [document, setDocument] = useState(() => documentOf(call))
  const [removed, setRemoved] = useState<readonly RemovedInput[]>([])
  const [content, setContent] = useState(() => ({ revision: 0, ...chipsOf(documentOf(call)) }))
  const [params, setParams] = useState(call.params)
  const [checked, setChecked] = useState<OperationCheck | null>(null)
  const [sending, setSending] = useState(false)
  // A host that lends another call, such as the plan view on another version, starts the occurrence over on it.
  const callKey = JSON.stringify(call)
  const [shownCall, setShownCall] = useState(callKey)
  if (shownCall !== callKey) {
    const next = documentOf(call)
    setShownCall(callKey)
    setDocument(next)
    setRemoved([])
    setContent(current => ({ revision: current.revision + 1, ...chipsOf(next) }))
    setParams(call.params)
    setChecked(null)
  }
  // The editor calls back during its own update; the ref gives those callbacks this render's document and state.
  const latest = useRef({ document, removed, state })
  latest.current = { document, removed, state }

  const edited = callOf(document, { ...call, params })
  const entry = modelOf(models, params)
  const bar = props.bar(call.operation)
  const copy = { ...NEUTRAL_COPY, ...bar?.copy }
  const filter: CandidateFilter | null = readOnly || entry === undefined || bar === null ? null : bar.candidates(entry.schema)
  const offersReferences = !readOnly && operation?.inputs['reference'] !== undefined && filter?.mediaTypes.length !== 0
  const editedKey = JSON.stringify(edited)
  useEffect(() => {
    if (readOnly) return
    let live = true
    const timer = setTimeout(() => {
      const request = { project: projectId, operation: edited.operation, params: { ...edited.params }, inputs: [...edited.inputs], surface: 'canvas' as const }
      props.check(request).then((answer) => { if (live) setChecked(answer) }, (error: unknown) => {
        if (live) setChecked({ problems: [errorMessage(error)], gpu_seconds: null })
      })
    }, CHECK_DELAY_MS)
    return () => { live = false; clearTimeout(timer) }
    // The check follows the edited call, whose key holds every field the request sends.
  }, [editedKey, readOnly, projectId])

  const views = props.views(state, document, filter)
  const faces: PromptFaceContext = { faces: Object.fromEntries(views.atoms.map(view => [view.uri, faceOf(view)])) }
  const onEditorChange = (text: string, chips: readonly Occurrence[]): void => {
    const now = latest.current
    const next = props.reconcile(now.state, now.document, runsOfEditor(text, chips), now.removed)
    setDocument(next.document)
    setRemoved(next.removed)
  }
  const openReference = (reference: string): boolean => {
    const uri = parsePromptCitations(reference)[0]?.uri
    const opened = views.atoms.find(view => view.uri === uri)?.open ?? null
    if (opened === null) return false
    if ('node' in opened) host.openNode(opened.node)
    else host.preview(opened.asset, null)
    return true
  }
  const blocked = checked === null || checked.problems.length > 0
  const send = (): void => {
    if (onSubmit === undefined || sending || blocked) return
    setSending(true)
    void onSubmit(edited).finally(() => { setSending(false) })
  }
  const media = filter === null ? null : { mediaTypes: [...filter.mediaTypes], maxReferences: filter.maxReferences }
  const model: PromptHostModel = {
    content, readOnly, sources: offersReferences ? [MENTION_SOURCE] : [], sourceContext: media, faceContext: faces,
    onChange: onEditorChange,
    ...readOnly ? {} : { onSubmit: send },
    openReference: (_source, reference) => openReference(reference),
    placeholder: pick(...copy.placeholder),
    ariaLabel: pick('提示词', 'Prompt'),
  }
  const removeTile = (loaded: WireState, index: number): void => {
    const next = props.removeInput(loaded, document, index)
    setDocument(next.document)
    setRemoved([...removed, ...next.removed])
    // Removing a tile turns its chips into text, so the editor takes the new prompt as one undoable step.
    setContent(current => ({ revision: current.revision + 1, ...chipsOf(next.document) }))
  }
  const picker = host.pickAssets
  const addTiles = (pickAssets: NonNullable<typeof picker>): void => {
    pickAssets(document.inputs.map(input => input.ref), (refs) => {
      const added = refs.filter(ref => !document.inputs.some(input => input.ref === ref)).map(ref => ({ role: 'reference', ref }))
      setDocument({ ...document, inputs: [...document.inputs, ...added] })
    })
  }
  const importer = host.importFiles
  const addFiles = (importFiles: NonNullable<typeof importer>, files: readonly File[]): void => {
    if (files.length === 0) return
    void importFiles(files).then((assets) => {
      setDocument(current => ({ ...current, inputs: [...current.inputs, ...assets.map(ref => ({ role: 'reference', ref }))] }))
    })
  }
  return (
    <div data-dv-prompt="" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {views.tray.length === 0 && !offersReferences ? null : <div role="list" aria-label={pick('参考', 'References')} style={row}>
        {views.tray.map(({ input, view, cited }, index) => (
          <Tile
            key={`${String(index)}:${input.ref}`} input={input} view={view} cited={cited} readOnly={readOnly}
            renderFactorySlot={renderFactorySlot}
            onOpen={(opener) => {
              if (view.open === null) return
              if ('node' in view.open) host.openNode(view.open.node)
              else host.preview(view.open.asset, opener)
            }}
            onRemove={() => { removeTile(state, index) }}
            onPin={(version) => { setDocument(pinVersion(document, index, version)) }}
          />
        ))}
        {offersReferences && picker !== undefined
          ? <button type="button" className="dv-canvas-btn" style={{ ...tile, ...plain }} onClick={() => { addTiles(picker) }}>{pick('添加素材', 'Add asset')}</button>
          : null}
        {offersReferences && importer !== undefined
          ? (
            <label className="dv-canvas-btn" style={{ ...tile, ...plain }}>
              {pick('上传文件', 'Upload files')}
              <input
                type="file" multiple hidden data-testid="dv-prompt-upload"
                onChange={(event) => { addFiles(importer, [...event.target.files ?? []]); event.target.value = '' }}
              />
            </label>
          )
          : null}
      </div>}
      {renderFactorySlot('conversation.prompt', { model })}
      {readOnly
        ? null
        : (
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <span style={row}>
              <ModelChip models={models} entry={entry} params={params} onPatch={(patch) => { setParams({ ...params, ...patch }) }} />
              {operation === null ? null : chipsFor(bar, entry, params, operation).map(chip => (
                <Chip
                  key={chip.key} chip={chip} onPatch={(patch) => { setParams({ ...params, ...patch }) }}
                  onText={(text) => { setParams(withText(params, operation, chip.key, text)) }}
                />
              ))}
            </span>
            <span style={row}>
              <span data-testid="dv-prompt-cost" style={{ fontSize: 12, color: 'var(--dv-text-2)' }}>
                {checked?.gpu_seconds === null || checked === null ? '' : pick(`约 ${String(checked.gpu_seconds)} GPU 秒`, `≈ ${String(checked.gpu_seconds)} GPU s`)}
              </span>
              <button type="button" className="dv-canvas-soft" disabled={onSubmit === undefined || sending || blocked} onClick={send} style={{ height: 30, borderRadius: 15, padding: '0 14px', border: 'none', font: 'inherit', cursor: 'pointer' }}>
                {sending ? pick(...copy.sending) : pick(...copy.send)}
              </button>
            </span>
          </div>
        )}
      {checked === null || checked.problems.length === 0 || readOnly
        ? null
        : <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--dv-danger)' }}>{checked.problems.join(' ')}</p>}
    </div>
  )
}

/**
 * One reference tile: its preview and name, whether a chip cites it, the version it sends, and its remove button.
 * @param props - the tile's input and view, whether it is cited, the mode, the Factory renderer, and the callbacks.
 * @returns the tile.
 */
function Tile({ input, view, cited, readOnly, renderFactorySlot, onOpen, onRemove, onPin }: {
  input: CallInput
  view: ReferenceView
  cited: boolean
  readOnly: boolean
  renderFactorySlot: RenderFactorySlot
  onOpen: (opener: Element | null) => void
  onRemove: () => void
  onPin: (version: number) => void
}): ReactNode {
  const pick = useText()
  const version = view.version
  return (
    <span role="listitem" data-reference-tile={input.ref} data-cited={cited} style={{ ...tile, opacity: view.fits ? 1 : 0.5 }}>
      <button type="button" style={{ ...plain, display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 }} onClick={(event) => { onOpen(event.currentTarget) }}>
        <span style={thumb}>{view.preview === null ? null : renderFactorySlot('dv.media', { asset: view.preview, purpose: 'thumb' })}</span>
        {view.label}
        {version === null ? null : <span style={{ color: 'var(--dv-text-2)' }}>{`v${String(version.sent)}`}</span>}
      </button>
      {cited ? null : <span style={{ color: 'var(--dv-text-3)' }}>{pick('未引用', 'uncited')}</span>}
      {readOnly || version === null || version.newest === version.sent
        ? null
        : <button type="button" style={{ ...plain, color: 'var(--dv-accent-text)' }} onClick={() => { onPin(version.newest) }}>{pick(`用 v${String(version.newest)}`, `Use v${String(version.newest)}`)}</button>}
      {readOnly ? null : <button type="button" aria-label={pick(`移除 ${view.label}`, `Remove ${view.label}`)} style={plain} onClick={onRemove}>×</button>}
    </span>
  )
}

/**
 * The model chip: the catalog entries of the call's modality; a pick writes the four key params.
 * @param props - the catalog, the selected entry, the params, and the patch callback.
 * @returns the chip.
 */
function ModelChip({ models, entry, params, onPatch }: {
  models: readonly WireModelEntry[]
  entry: WireModelEntry | undefined
  params: Readonly<Record<string, unknown>>
  onPatch: (patch: Readonly<Record<string, unknown>>) => void
}): ReactNode {
  const pick = useText()
  const choices = models.filter(candidate => candidate.modality === params['modality'])
  const keyOf = (candidate: WireModelEntry): string => `${candidate.provider}/${candidate.model}/${candidate.task}`
  return (
    <select
      aria-label={pick('模型', 'Model')} data-testid="dv-prompt-model" style={select} value={entry === undefined ? '' : keyOf(entry)}
      onChange={(event) => {
        const next = choices.find(candidate => keyOf(candidate) === event.target.value)
        if (next !== undefined) onPatch({ modality: next.modality, task: next.task, provider: next.provider, model: next.model })
      }}
    >
      {entry === undefined ? <option value="">{typeof params['model'] === 'string' ? params['model'] : ''}</option> : null}
      {choices.map(candidate => <option key={keyOf(candidate)} value={keyOf(candidate)}>{`${candidate.model} · ${candidate.task}`}</option>)}
    </select>
  )
}

/** The chips of a call: the registered bar's under the selected model, else the operation's default chips. */
function chipsFor(
  bar: ParamBar | null, entry: WireModelEntry | undefined, params: Readonly<Record<string, unknown>>, operation: WireOperation,
): ParamChip[] {
  if (bar === null) return defaultChips(operation, params)
  return entry === undefined ? [] : bar.chips({ schema: entry.schema, params, operation })
}

/** The params with one free-text chip's text, typed by the param's declaration; text that does not parse stays out. */
function withText(
  params: Readonly<Record<string, unknown>>, operation: WireOperation, key: string, text: string,
): Readonly<Record<string, unknown>> {
  const field = fieldsOf(operation.params, {}).find(candidate => candidate.key === key)
  if (field === undefined) return params
  let value: unknown
  try {
    value = valueOf({ ...field, text })
  } catch (unparsed) {
    // A text the param's type cannot take keeps the previous value; the check route names the problem of a bad value.
    void unparsed
    return params
  }
  const { [key]: _old, ...rest } = params
  return value === undefined ? rest : { ...rest, [key]: value }
}

/**
 * One parameter chip: a menu of the choices that its descriptor gives, or a text field for a chip without choices.
 * @param props - the chip and the patch callbacks.
 * @returns the chip.
 */
function Chip({ chip, onPatch, onText }: {
  chip: ParamChip
  onPatch: (patch: Readonly<Record<string, unknown>>) => void
  onText: (text: string) => void
}): ReactNode {
  const pick = useText()
  if (chip.options.length === 0) {
    return (
      <input
        aria-label={pick(...chip.label)} data-param-chip={chip.key} style={{ ...select, width: 96 }} defaultValue={chip.value}
        placeholder={chip.key}
        onBlur={(event) => { onText(event.target.value) }}
      />
    )
  }
  return (
    <select
      aria-label={pick(...chip.label)} data-param-chip={chip.key} style={select} value={chip.value}
      onChange={(event) => {
        const option = chip.options.find(candidate => candidate.label === event.target.value)
        if (option !== undefined) onPatch(option.patch)
      }}
    >
      {chip.options.some(option => option.label === chip.value) ? null : <option value={chip.value}>{chip.value}</option>}
      {chip.options.map(option => <option key={option.label} value={option.label}>{option.label}</option>)}
    </select>
  )
}
