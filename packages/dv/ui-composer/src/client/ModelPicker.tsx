/** The generation model picker of the chat composer: one popover for every media type, beside the operator LLM. */
import { useCallback, useEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import { IconBrowseOutlineRegular, IconMicrophoneOutlineRegular, IconPlayOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { providerName as genericProviderName } from '@dv/ui-kit/cloud-model-settings.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { WireModelEntry, WireState } from '@dv/ui-kit/types.ts'
import { PickerPopover } from './PickerPopover.tsx'
import { ProviderGlyph } from './ProviderGlyph.tsx'

interface Selection { provider: string; model: string }

/** The menu row id of a provider and model. */
const choiceId = (choice: Selection): string => JSON.stringify([choice.provider, choice.model])

/** The modalities the composer offers a choice for, in the order their pickers show. */
export const PICKER_MODALITIES = ['video', 'image', 'audio'] as const

/** One modality the composer offers a choice for. */
export type PickerModality = typeof PICKER_MODALITIES[number]

const modalityIcons = {
  video: IconPlayOutlineRegular,
  image: IconBrowseOutlineRegular,
  audio: IconMicrophoneOutlineRegular,
}

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

/** Props of {@link ModelPickers}. */
export interface ModelPickersProps {
  sessionId: string
  state: HostObservable<WireState | null>
  models: HostObservable<readonly WireModelEntry[] | null>
  /** Load the catalog again; the picker calls it each time the user opens the menu. */
  reloadModels: () => void
  /** Record one gesture's writes: a conversation records each media type, and the home picker folds them into one. */
  save: (writes: readonly (readonly [PickerModality, Selection | null])[]) => Promise<unknown>
  /** The Settings defaults a conversation starts on, shown while the conversation has no choice of its own. */
  defaults?: Readonly<Partial<Record<PickerModality, Selection>>>
  /** The logo of a provider, when its plugin draws one. */
  logoOf?: (provider: string) => ComponentType<{ size: number }> | undefined
  /** The display name of a provider; without it the provider id is capitalized. */
  providerName?: (provider: string) => string
  /** A message about the conversation's models, such as defaults that could not be applied. */
  notice?: string | null
}

/** The row id of one modality's model. */
const rowOf = (modality: PickerModality, choice: Selection): string => JSON.stringify([modality, choice.provider, choice.model])

/**
 * One popover for every generation media type: models grouped by provider, media filters, and a detail card. Choosing a
 * model makes it the conversation's choice of its media type; choosing the current choice again returns that type to
 * Auto. Models whose backend does not answer (`schema` null) are not listed.
 */
export function ModelPickers({
  sessionId, state, models, reloadModels, save, logoOf, providerName = id => genericProviderName([], id), notice = null, defaults = {},
}: ModelPickersProps) {
  const pick = useText()
  const project = useSyncExternalStore(useCallback((listener: () => void) => state.subscribe(listener), [state]),
    useCallback(() => state.getSnapshot(), [state]))
  const catalog = useSyncExternalStore(useCallback((listener: () => void) => models.subscribe(listener), [models]),
    useCallback(() => models.getSnapshot(), [models]))
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => { setFailure(null) }, [state, sessionId])
  const kind = (modality: PickerModality): string =>
    ({ video: pick('视频', 'Video'), image: pick('图片', 'Image'), audio: pick('音频', 'Audio') })[modality]
  const reachable = (catalog ?? []).filter(entry => entry.schema !== null)
  const choices = PICKER_MODALITIES.flatMap(modality => modelChoices(reachable, modality).map(entry => ({ modality, entry })))
  const started = (project?.components['models'] as { conversations?: Record<string, unknown> } | undefined)
    ?.conversations?.[sessionId] !== undefined
  const selected = new Map(PICKER_MODALITIES.flatMap((modality) => {
    // The Settings default stands in only until the conversation records a choice of its own: a media type the person
    // already returned to Auto stays Auto, because showing a default there would disagree with the next generation.
    const choice = selectedModel(project, sessionId, modality) ?? (started ? null : defaults[modality] ?? null)
    return choice === null ? [] : [[modality, choice] as const]
  }))
  const providerIds = [...new Set(choices.map(({ entry }) => entry.provider))]
  const glyph = (provider: string) => <ProviderGlyph logo={logoOf?.(provider)} name={providerName(provider)} />
  // The provider always follows the model name: equal names under different providers must stay distinguishable.
  const nameOf = (entry: Selection): string => `${choices.find(({ entry: choice }) => choice.provider === entry.provider && choice.model === entry.model)
    ?.entry.display_name ?? entry.model} · ${providerName(entry.provider)}`
  const status = (entry: WireModelEntry): string => entry.runtime == null ? pick('可用', 'Available')
    : entry.runtime.busy ? pick('生成中', 'Generating') : entry.runtime.loading ? pick('加载中', 'Loading')
      : entry.runtime.loaded ? pick('已加载', 'Loaded') : pick('已安装', 'Installed')
  const items = choices.map(({ modality, entry }) => {
    const tasks = (catalog ?? [])
      .filter(other => other.modality === modality && other.provider === entry.provider && other.model === entry.model)
      .map(other => other.task.toUpperCase())
    const current = selected.get(modality)
    return {
      id: rowOf(modality, entry), group: entry.provider, filter: modality, label: entry.display_name ?? entry.model,
      keywords: `${providerName(entry.provider)} ${kind(modality)}`,
      selected: current !== undefined && current.provider === entry.provider && current.model === entry.model,
      facts: [
        [pick('提供商', 'Provider'), providerName(entry.provider)],
        [pick('类型', 'Type'), kind(modality)],
        ...entry.hosting === undefined ? [] : [[pick('托管', 'Hosting'), entry.hosting === 'managed' ? pick('云端', 'Cloud') : pick('自托管', 'Self-hosted')] as const],
        [pick('任务', 'Tasks'), [...new Set(tasks)].join(' · ')],
        [pick('状态', 'Status'), status(entry)],
      ] as const,
    }
  })
  const chosen = [...selected.values()]
  const first = chosen[0]
  const value = saving ? pick('保存中…', 'Saving…') : first === undefined ? pick('自动', 'Auto')
    : chosen.length === 1 ? nameOf(first) : `${nameOf(first)} +${chosen.length - 1}`
  const choose = (id: string): boolean => {
    const target = choices.find(({ modality, entry }) => rowOf(modality, entry) === id)
    const writes: (readonly [PickerModality, Selection | null])[] = []
    if (id === 'auto') {
      for (const modality of selected.keys()) writes.push([modality, null])
    } else if (target !== undefined) {
      const { modality, entry: { provider, model } } = target
      const current = selected.get(modality)
      writes.push([modality, current?.provider === provider && current.model === model ? null : { provider, model }])
    }
    if (writes.length === 0) return true
    setSaving(true)
    setFailure(null)
    Promise.resolve()
      .then(async () => await save(writes))
      .catch((error: unknown) => { setFailure(errorMessage(error)) })
      .finally(() => { setSaving(false) })
    return true
  }
  return <span className="dv-model-choice">
    <PickerPopover label={pick('生成模型', 'Generation model')} value={value} disabled={saving}
      valueIcon={chosen[0] === undefined ? undefined : glyph(chosen[0].provider)}
      searchLabel={pick('搜索模型', 'Search models')} emptyLabel={pick('没有匹配的模型。', 'No models match.')}
      onOpen={reloadModels} onSelect={choose}
      filters={(['video', 'audio', 'image'] as const).map((modality) => {
        const Icon = modalityIcons[modality]
        return { id: modality, name: kind(modality), icon: <Icon size={16} /> }
      })}
      leading={[{ id: 'auto', group: '', label: pick('自动 · 由导演选择', 'Auto · the director chooses'), selected: chosen.length === 0,
        facts: [[pick('说明', 'About'), pick('导演为每个镜头选择模型。', 'The director picks a model for each shot.')]] }]}
      groups={providerIds.map(provider => ({ id: provider, name: providerName(provider), icon: glyph(provider) }))}
      items={items}
      footer={pick('在 设置 → 模型 中添加更多模型。', 'Add more models in Settings → Models.')} />
    {failure ?? notice ?? null ? <span role="alert" className="dv-model-choice-error">{failure ?? notice}</span> : null}
  </span>
}
