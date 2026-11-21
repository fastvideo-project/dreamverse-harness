/** The generation model picker of the chat composer: one popover for every media type, beside the operator LLM. */
import { useCallback, useEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import { IconPlayOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { providerName as genericProviderName } from '@dv/ui-kit/cloud-model-settings.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { WireModelEntry, WireState } from '@dv/ui-kit/types.ts'
import { ImageIcon, MusicNoteIcon } from './media-icons.tsx'
import { PickerPopover } from './PickerPopover.tsx'
import { ProviderGlyph } from './ProviderGlyph.tsx'

interface Selection { provider: string; model: string }

/** The menu row id of a provider and model. */
const choiceId = (choice: Selection): string => JSON.stringify([choice.provider, choice.model])

/** The modalities the composer offers a choice for, in the order their pickers show. */
export const PICKER_MODALITIES = ['video', 'image', 'audio'] as const

/** One modality the composer offers a choice for. */
export type PickerModality = typeof PICKER_MODALITIES[number]

const modalityIcons = { video: IconPlayOutlineRegular, image: ImageIcon, audio: MusicNoteIcon }

/** The menu row id of one media type's Auto choice. */
const autoId = (modality: PickerModality): string => `auto:${modality}`

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
 * Auto. Each media type has its own Auto row, so one type returns to Auto without touching the others. Models whose
 * backend does not answer (`schema` null) are not listed.
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
  const offered = pickerModalities(reachable)
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
  const modelName = (entry: Selection): string => choices
    .find(({ entry: choice }) => choice.provider === entry.provider && choice.model === entry.model)?.entry.display_name ?? entry.model
  // The full name always ends in the provider: equal names under different providers must stay distinguishable. The
  // trigger drops it when the provider's logo already names it.
  const fullName = (entry: Selection): string => `${modelName(entry)} · ${providerName(entry.provider)}`
  const shortName = (entry: Selection): string => logoOf?.(entry.provider) === undefined ? fullName(entry) : modelName(entry)
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
        [pick('托管', 'Hosting'), entry.hosting === undefined ? '—'
          : entry.hosting === 'managed' ? pick('云端', 'Cloud') : pick('自托管', 'Self-hosted')],
        [pick('任务', 'Tasks'), [...new Set(tasks)].join(' · ')],
        [pick('类型', 'Type'), kind(modality)],
        [pick('状态', 'Status'), status(entry)],
      ] as const,
    }
  })
  const autoRows = offered.map((modality) => {
    const Icon = modalityIcons[modality]
    return {
      id: autoId(modality), group: '', filter: modality, icon: <Icon size={16} />,
      label: pick(`${kind(modality)} · 自动`, `${kind(modality)} · Auto`), filteredLabel: pick('自动', 'Auto'),
      selected: !selected.has(modality),
      facts: [[pick('说明', 'About'), pick(`导演为每个镜头选择${kind(modality)}模型。`, `The director picks the ${kind(modality).toLowerCase()} model for each shot.`)]] as const,
    }
  })
  const shown = PICKER_MODALITIES.filter(modality => offered.includes(modality) || selected.has(modality))
  const summary = (name: (entry: Selection) => string, separator: string): string => {
    if (saving) return pick('保存中…', 'Saving…')
    if (selected.size === 0 && choices.length === 0 && catalog !== null) return pick('无可用模型', 'No models')
    const part = (modality: PickerModality): string => {
      const choice = selected.get(modality)
      return choice === undefined ? pick('自动', 'Auto') : name(choice)
    }
    return shown.length === 1 ? part(shown[0] as PickerModality)
      : selected.size === 0 ? pick('自动', 'Auto')
        : shown.map(modality => `${kind(modality)}: ${part(modality)}`).join(separator)
  }
  const chosen = [...selected.values()]
  const choose = (id: string): boolean => {
    const writes: (readonly [PickerModality, Selection | null])[] = []
    const auto = PICKER_MODALITIES.find(modality => autoId(modality) === id)
    const target = choices.find(({ modality, entry }) => rowOf(modality, entry) === id)
    if (auto !== undefined) {
      if (selected.has(auto)) writes.push([auto, null])
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
    <PickerPopover label={pick('生成模型', 'Generation model')} value={summary(shortName, ' · ')} fullValue={summary(fullName, ', ')}
      disabled={saving} valueIcon={chosen[0] === undefined ? undefined : glyph(chosen[0].provider)}
      searchLabel={pick('搜索模型', 'Search models')} emptyLabel={pick('没有匹配的模型。', 'No models match.')}
      noneLabel={filter => filter === null ? pick('还没有可用的模型。请在 设置 → 模型 中连接提供商。', 'No models yet. Connect a provider in Settings → Models.')
        : pick(`没有可用的${kind(filter as PickerModality)}模型。请在 设置 → 模型 中连接提供商。`,
          `No ${kind(filter as PickerModality).toLowerCase()} models yet. Connect a provider in Settings → Models.`)}
      onOpen={reloadModels} onSelect={choose}
      filters={(['video', 'audio', 'image'] as const).map((modality) => {
        const Icon = modalityIcons[modality]
        return { id: modality, name: kind(modality), icon: <Icon size={16} />,
          emptyNote: pick(`没有${kind(modality)}模型`, `No ${kind(modality).toLowerCase()} models`) }
      })}
      leading={autoRows}
      groups={providerIds.map(provider => ({ id: provider, name: providerName(provider), icon: glyph(provider) }))}
      items={items}
      footer={pick('在 设置 → 模型 中添加更多模型。', 'Add more models in Settings → Models.')} />
    {failure ?? notice ?? null ? <span role="alert" className="dv-model-choice-error">{failure ?? notice}</span> : null}
  </span>
}
