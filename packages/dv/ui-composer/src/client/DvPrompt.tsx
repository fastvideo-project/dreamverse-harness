/**
 * The `dv.prompt` Factory component: the reference tray, the `conversation.prompt` editor, and the parameter bar with
 * the cost and send, over one call. Its draft (`draft.ts`) holds the document, which keeps the prompt and the call's
 * inputs in their stored order, and the edited params; the editor owns the text and the chips, and each editor change
 * reconciles the inputs with the citations that the kernel's parser reads in the editor's text. A citation that arrives
 * as text, such as a pasted chip, becomes a chip within the same undo step. A tray edit that changes the prompt reaches
 * the editor as a new content revision, so the editor's undo also undoes it. A tray edit that leaves the prompt as it
 * is (a picker add, an upload, a version pin, the removal of a tile that no chip cites) is no editor step, so the
 * editor's undo leaves it: the editor's history holds editor states only, and holding the inputs there would put them
 * in the prompt's text. The tile's × takes back a picker add or an upload; a pin to the newest version has no way back
 * to the older one. In read mode the tray and the editor only show the call. Every reference resolves against the state
 * that the host lends, and each chip's face draws what the composer resolved for it.
 *
 * The tray and `@` offer references only when the call's operation declares a `reference` input and the
 * selected model takes one. The placeholder and the send button read the copy of the operation's parameter bar; an
 * operation without one shows words that name no kind.
 *
 * @module @dv/ui-composer/DvPrompt
 */
import { useEffect, useReducer, type CSSProperties, type ReactNode } from 'react'
import type { PromptHostModel } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { FactoryComponentPropsOf, RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots'
import { parsePromptCitations } from '@dv/project/grammar'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { WireModelEntry, WireOperation } from '@dv/ui-kit/types.ts'
import type {} from '@dv/ui-media/contract'
import type { CallInput, CandidateFilter, ParamBar, ParamChip, PromptCopy, PromptFaceContext, ReferenceView } from './contract/index.ts'
import { draftOf, reduceDraft } from './draft.ts'
import { MENTION_SOURCE } from './mention.ts'
import { paramChips, typedValue } from './param-chips.ts'
import { callOf, documentViews, faceOf, type ResolveContext } from './reference-model.ts'

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

/** The model entry that a call's key params name. */
function modelOf(models: readonly WireModelEntry[], params: Readonly<Record<string, unknown>>): WireModelEntry | undefined {
  return models.find(entry => entry.modality === params['modality'] && entry.task === params['task']
    && entry.provider === params['provider'] && entry.model === params['model'])
}

/**
 * Render one composer occurrence.
 * @param props - the call, the state and operations of the host, the host, the send, the inject face, and the Factory
 *   renderer.
 * @returns the composer.
 */
export function DvPrompt(props: DvPromptComponentProps): ReactNode {
  const { projectId, call, state, readOnly, host, onSubmit, renderFactorySlot } = props
  const pick = useText()
  const versions = props.useVersionKinds(kinds => kinds)
  // Null until the catalog loads; until then the composer knows no model's references and offers none.
  const catalog = props.useModels(loaded => loaded)
  const models = catalog ?? []
  const bar = props.useParamBars(bars => bars.find(candidate => candidate.operation === call.operation) ?? null)
  const operation = props.operations.find(candidate => candidate.name === call.operation) ?? null
  const [draft, dispatch] = useReducer(reduceDraft, call, draftOf)
  // A host that lends another call, such as the plan view on another version, starts the occurrence over on it.
  const callKey = JSON.stringify(call)
  if (draft.callKey !== callKey) dispatch({ type: 'callLent', call })
  const { document, params, checked, sending } = draft

  const edited = callOf(document, { ...call, params })
  const entry = modelOf(models, params)
  const copy = { ...NEUTRAL_COPY, ...bar?.copy }
  const filter: CandidateFilter | null = readOnly || entry === undefined ? null : bar?.candidates?.(entry.schema) ?? null
  const offersReferences = !readOnly && catalog !== null && operation?.inputs['reference'] !== undefined && filter?.mediaTypes.length !== 0
  const editedKey = JSON.stringify(edited)
  useEffect(() => {
    if (readOnly) return
    let live = true
    const timer = setTimeout(() => {
      const request = { project: projectId, operation: edited.operation, params: { ...edited.params }, inputs: [...edited.inputs], surface: 'canvas' as const }
      props.check(request).then((answer) => { if (live) dispatch({ type: 'checked', answer }) }, (error: unknown) => {
        if (live) dispatch({ type: 'checked', answer: { problems: [errorMessage(error)], gpu_seconds: null } })
      })
    }, CHECK_DELAY_MS)
    return () => { live = false; clearTimeout(timer) }
    // The check follows the edited call, whose key holds every field the request sends.
  }, [editedKey, readOnly, projectId])

  const ctx: ResolveContext = { state, versions, inputs: null, filter: null }
  const views = documentViews(document, { ...ctx, filter })
  const faces: PromptFaceContext = { faces: Object.fromEntries(views.atoms.map(view => [view.uri, faceOf(view)])) }
  const openReference = (reference: string): boolean => {
    const uri = parsePromptCitations(reference)[0]?.uri
    const opened = views.atoms.find(view => view.uri === uri)?.open ?? null
    if (opened === null) return false
    if ('node' in opened) host.openNode(opened.node)
    else host.preview(opened.asset, null)
    return true
  }
  // A text chip whose text its param cannot take blocks the send, so the field never shows a value that the call lacks.
  const typing = operation === null ? [] : Object.entries(draft.texts).flatMap(([key, text]) => {
    const typed = typedValue(operation, key, text)
    return 'problem' in typed ? [typed.problem] : []
  })
  const problems = typing.length > 0 ? typing : checked?.problems ?? []
  const blocked = typing.length > 0 || checked === null || checked.problems.length > 0
  const send = (): void => {
    if (onSubmit === undefined || sending || blocked) return
    dispatch({ type: 'sending', sending: true })
    void onSubmit(edited).finally(() => { dispatch({ type: 'sending', sending: false }) })
  }
  const media = filter === null ? null : { mediaTypes: [...filter.mediaTypes], maxReferences: filter.maxReferences }
  const model: PromptHostModel = {
    content: draft.content, readOnly, sources: offersReferences ? [MENTION_SOURCE] : [], sourceContext: media, faceContext: faces,
    onChange: (text, chips, cause) => { dispatch({ type: 'editorChanged', text, chips: chips.length, cause, ctx }) },
    ...readOnly ? {} : { onSubmit: send },
    openReference: (_source, reference) => openReference(reference),
    placeholder: pick(...copy.placeholder),
    ariaLabel: pick('提示词', 'Prompt'),
  }
  const picker = host.pickAssets
  const importer = host.importFiles
  const addFiles = (importFiles: NonNullable<typeof importer>, files: readonly File[]): void => {
    if (files.length === 0) return
    void importFiles(files).then((assets) => { dispatch({ type: 'imported', assets }) })
  }
  const patch = (next: Readonly<Record<string, unknown>>): void => { dispatch({ type: 'patched', patch: next }) }
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
            onRemove={() => { dispatch({ type: 'tileRemoved', index, ctx }) }}
            onPin={(version) => { dispatch({ type: 'pinned', index, version }) }}
          />
        ))}
        {offersReferences && picker !== undefined
          ? (
            <button
              type="button" className="dv-canvas-btn" style={{ ...tile, ...plain }}
              onClick={() => { picker(document.inputs.map(input => input.ref), (refs) => { dispatch({ type: 'picked', refs }) }) }}
            >
              {pick('添加素材', 'Add asset')}
            </button>
          )
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
              <ModelChip models={models} entry={entry} params={params} onPatch={patch} />
              {operation === null ? null : chipsFor(bar, entry, params, operation).map(chip => (
                <Chip
                  key={chip.key} chip={chip} typed={draft.texts[chip.key]} onPatch={patch}
                  onText={(text) => { dispatch({ type: 'typed', operation, key: chip.key, text }) }}
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
      {problems.length === 0 || readOnly
        ? null
        : <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--dv-danger)' }}>{problems.join(' ')}</p>}
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

/** The chips of a call: one per declared param, with the registered bar's chips under the selected model. */
function chipsFor(
  bar: ParamBar | null, entry: WireModelEntry | undefined, params: Readonly<Record<string, unknown>>, operation: WireOperation,
): ParamChip[] {
  const own = entry === undefined ? [] : bar?.chips?.({ schema: entry.schema, params, operation }) ?? []
  return paramChips(operation, params, own)
}

/**
 * One parameter chip with its name: a menu of the choices that its descriptor gives, a checkbox, or a text field that
 * shows the text the user typed.
 * @param props - the chip, the typed text of a text chip, and the patch callbacks.
 * @returns the chip.
 */
function Chip({ chip, typed, onPatch, onText }: {
  chip: ParamChip
  typed: string | undefined
  onPatch: (patch: Readonly<Record<string, unknown>>) => void
  onText: (text: string) => void
}): ReactNode {
  const pick = useText()
  let control: ReactNode
  switch (chip.kind) {
    case 'text':
      control = (
        <input
          data-param-chip={chip.key} style={{ ...select, width: 96 }} value={typed ?? chip.value}
          placeholder={chip.placeholder === undefined ? undefined : pick(...chip.placeholder)}
          onChange={(event) => { onText(event.target.value) }}
        />
      )
      break
    case 'toggle':
      control = <input type="checkbox" data-param-chip={chip.key} checked={chip.checked} onChange={(event) => { onPatch({ [chip.key]: event.target.checked }) }} />
      break
    case 'menu':
      control = (
        <select
          data-param-chip={chip.key} style={select} value={chip.value}
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
  return <label style={{ ...row, gap: 4, fontSize: 12, color: 'var(--dv-text-2)' }}>{pick(...chip.label)}{control}</label>
}
