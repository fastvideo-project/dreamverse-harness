/** Conversation-level model choices, one per generation modality, beside the operator LLM in the chat composer. */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { WireModelEntry, WireState } from '@dv/ui-kit/types.ts'

interface Selection { provider: string; model: string }

/** The menu row id of a provider and model. */
const choiceId = (choice: Selection): string => JSON.stringify([choice.provider, choice.model])

/** The modalities the composer offers a choice for, in the order their pickers show. */
export const PICKER_MODALITIES = ['video', 'image', 'audio'] as const

/** One modality the composer offers a choice for. */
export type PickerModality = typeof PICKER_MODALITIES[number]

/**
 * The menu rows of one modality: one row per model, even when a model serves several generation tasks, without models
 * whose weights are not installed.
 * @param models - the model catalog.
 * @param modality - the modality of the picker.
 * @returns one entry per provider and model.
 */
export function modelChoices(models: readonly WireModelEntry[], modality: PickerModality): WireModelEntry[] {
  return [...new Map(models.filter(entry => entry.modality === modality && entry.runtime?.installed !== false)
    .map(entry => [choiceId(entry), entry])).values()]
}

/**
 * The modalities that get a picker: video always, and image and audio while the catalog holds a model of theirs.
 * @param models - the model catalog.
 * @returns the modalities, in picker order.
 */
export function pickerModalities(models: readonly WireModelEntry[]): PickerModality[] {
  return PICKER_MODALITIES.filter(modality => modality === 'video' || modelChoices(models, modality).length > 0)
}

/** Narrow the optional component slice owned by the model controls. */
function selectedModel(state: WireState | null, session: string, modality: PickerModality): Selection | null {
  const slice = state?.components['models'] as { conversations?: Record<string, Partial<Record<string, Selection>>> } | undefined
  return slice?.conversations?.[session]?.[modality] ?? null
}

export interface ModelPickerProps {
  sessionId: string
  modality: PickerModality
  state: HostObservable<WireState | null>
  models: HostObservable<readonly WireModelEntry[] | null>
  /** Load the catalog again; the picker calls it each time the user opens the menu. */
  reloadModels: () => void
  save(selection: Selection | null): Promise<unknown>
}

/** Save a conversation default of one modality without changing the draft or any previous generation. */
export function ModelPicker({ sessionId, modality, state, models, reloadModels, save }: ModelPickerProps) {
  const pick = useText()
  const project = useSyncExternalStore(state.subscribe, state.getSnapshot)
  const catalog = useSyncExternalStore(models.subscribe, models.getSnapshot)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => { setOpen(false); setFailure(null) }, [state, sessionId])
  const kind = ({
    video: { short: pick('视频', 'Video'), long: pick('视频模型', 'Video model'), kept: pick('已生成的视频不变。', 'Existing videos keep their model.') },
    image: { short: pick('图片', 'Image'), long: pick('图片模型', 'Image model'), kept: pick('已生成的图片不变。', 'Existing images keep their model.') },
    audio: { short: pick('音频', 'Audio'), long: pick('音频模型', 'Audio model'), kept: pick('已生成的音频不变。', 'Existing audio keeps its model.') },
  } as const)[modality]
  const choices = modelChoices(catalog ?? [], modality)
  const selected = selectedModel(project, sessionId, modality)
  const selectedId = selected === null ? '' : choiceId(selected)
  const entry = choices.find(choice => choiceId(choice) === selectedId)
  const label = selected === null ? pick('自动', 'Auto') : entry?.display_name ?? selected.model
  const choose = (id: string): void => {
    const next = choices.find(choice => choiceId(choice) === id)
    if (id !== '' && next === undefined) return
    setOpen(false)
    setSaving(true)
    setFailure(null)
    save(next === undefined ? null : { provider: next.provider, model: next.model })
      .catch((error: unknown) => { setFailure(errorMessage(error)) })
      .finally(() => { setSaving(false) })
  }
  return <span className="dv-model-choice">
    <Menu open={open} onClose={() => { setOpen(false) }} onSelect={choose} selectedId={selectedId}
      portal side="top" compact autoFocus items={[
        { id: '', label: pick('自动 · 由智能体选择', 'Auto · let the operator choose') },
        ...choices.map(choice => ({ id: choiceId(choice),
          label: choice.display_name ?? choice.model })),
      ]} anchor={<button type="button" className="dv-model-choice-trigger" aria-haspopup="menu" aria-expanded={open}
        aria-label={`${kind.long}${pick('：', ': ')}${label}`}
        title={`${pick('后续生成使用此模型，需要时加载；', 'Used for future generations; loads when needed. ')}${kind.kept}`}
        disabled={saving || project === null}
        onClick={() => { if (!open) reloadModels(); setOpen(value => !value) }}>
        <span className="dv-model-choice-kind">{kind.short}</span>
        <span className="dv-model-choice-name">{saving ? pick('保存中…', 'Saving…') : label}</span>
        <IconChevronDownOutlineRegular size={14} />
      </button>} />
    {failure === null ? null : <span role="alert" className="dv-model-choice-error">{failure}</span>}
  </span>
}

export interface ModelPickersProps extends Omit<ModelPickerProps, 'modality' | 'save'> {
  save: (modality: PickerModality, selection: Selection | null) => Promise<unknown>
}

/** The pickers of every modality that `pickerModalities` names, side by side. */
export function ModelPickers({ sessionId, state, models, reloadModels, save }: ModelPickersProps) {
  const catalog = useSyncExternalStore(useCallback((listener: () => void) => models.subscribe(listener), [models]),
    useCallback(() => models.getSnapshot(), [models]))
  return <span className="dv-model-choices">
    {pickerModalities(catalog ?? []).map(modality => <ModelPicker key={modality} modality={modality} sessionId={sessionId}
      state={state} models={models} reloadModels={reloadModels} save={selection => save(modality, selection)} />)}
  </span>
}
