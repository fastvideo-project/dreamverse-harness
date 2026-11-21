/** The default LLM and the model a new conversation starts on for each generation media type. */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { providerName as nameOfProvider, type CloudMedia, type CloudModelSettings } from '@dv/ui-kit/cloud-model-settings.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { Registry } from '@dv/ui-kit/registries.ts'
import type { WireModelEntry } from '@dv/ui-kit/types.ts'
import css from './CloudModelsSettings.module.css'

type Choice = { provider: string; model: string }

/** The settings forms and catalogs the default model rows read and write. */
export interface DefaultModelsProps {
  source: {
    /** The `agent-default-model` namespace: the model a new agent starts on. */
    llmForm: ConfigForm<{ provider: string; model: string; reasoningEffort?: string }>
    /** The `dv-models` namespace, whose `defaults` names the model a new conversation starts on per media type. */
    mediaForm: ConfigForm<{ defaults: Record<string, Choice> }>
    llmCatalog(this: void): Promise<ModelCatalog>
    mediaCatalog(this: void, signal: AbortSignal): Promise<WireModelEntry[]>
  }
  providers: Registry<CloudModelSettings>
}

const choiceId = ({ provider, model }: Choice): string => JSON.stringify([provider, model])

function useForm<T>(form: ConfigForm<T>) {
  return useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot())
}

/** One labelled row with a menu of models. */
function ModelRow({ title, help, value, items, disabled, onSelect, onOpen, warning }: {
  title: string
  help: string
  /** Shown instead of nothing when the saved choice is no longer offered, with the action that clears it. */
  warning?: { message: string; action: string; onAction: () => void }
  value: { label: string; icon?: ReactNode }
  items: readonly MenuEntry[]
  disabled: boolean
  onSelect: (id: string) => void
  /** Read the catalogs again, so a provider connected on this page offers its models in this menu. */
  onOpen?: () => void
}) {
  const [open, setOpen] = useState(false)
  const labelId = useId()
  return <li className={css.settingRow}>
    <span className={css.settingText}>
      <strong id={labelId}>{title}</strong><span>{help}</span>
      {warning === undefined ? null : <span className={css.staleWarning} role="alert">
        {warning.message}<button type="button" className={css.chip} onClick={warning.onAction}>{warning.action}</button>
      </span>}
    </span>
    <Menu open={open} onClose={() => { setOpen(false) }} portal align="end" autoFocus items={items}
      selectedId={undefined} onSelect={(id) => { setOpen(false); onSelect(id) }}
      anchor={<button type="button" className={css.picker} aria-haspopup="menu" aria-expanded={open}
        aria-labelledby={labelId} aria-describedby={undefined} disabled={disabled}
        onClick={() => { if (!open) onOpen?.(); setOpen(current => !current) }}>
        {value.icon}<span className={css.pickerLabel}>{value.label}</span><IconChevronDownOutlineRegular size={12} />
      </button>} />
  </li>
}

/**
 * The default model rows: the LLM that directs generations, then one row per generation media type.
 * @param props - the settings forms, catalogs, and provider registry.
 * @returns the default models section.
 */
export function DefaultModels({ source, providers: registry }: DefaultModelsProps) {
  const text = useText()
  const llm = useForm(source.llmForm)
  const media = useForm(source.mediaForm)
  const providers = useSyncExternalStore(listener => registry.subscribe(listener), () => registry.getSnapshot())
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [entries, setEntries] = useState<readonly WireModelEntry[]>([])
  const [mediaLoaded, setMediaLoaded] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const headingId = useId()
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])
  /** Re-read both catalogs: the page changes provider settings, so a menu opened later must not offer a stale list. */
  const refresh = useCallback(() => {
    const controller = new AbortController()
    source.llmCatalog().then((value) => { if (live.current) setCatalog(value) }, (_unavailable: unknown) => {
      // Without a catalog the row still shows the saved default and offers no other choice.
      if (live.current) setCatalog(null)
    })
    source.mediaCatalog(controller.signal).then((value) => { if (live.current) { setEntries(value); setMediaLoaded(true) } },
      (_unavailable: unknown) => {
        // The generation rows offer Auto alone until the catalog loads.
        if (live.current) { setEntries([]); setMediaLoaded(false) }
      })
    return controller
  }, [source])
  useEffect(() => {
    const controller = refresh()
    return () => { controller.abort() }
  }, [refresh])

  const logoOf = (provider: string) => {
    const match = providers.find(entry => entry.id === provider)
    if (match === undefined) return <span className={css.initial} aria-hidden="true">{provider.slice(0, 1).toUpperCase()}</span>
    const Logo = match.logo
    return <span className={css.inlineMark} aria-hidden="true"><Logo size={12} /></span>
  }
  const providerName = (provider: string) => catalog?.groups.find(group => group.id === provider)?.name
    ?? nameOfProvider(providers, provider)

  const write = async (form: ConfigForm<never>, ops: Parameters<ConfigForm<never>['mutate']>[0], revision: number | undefined) => {
    setFailure(null)
    try {
      if (!await form.mutate(ops, revision)) setFailure(text('设置已在别处更改。请重试。', 'Settings changed elsewhere. Try again.'))
    } catch (_failed) {
      // The transport failed; the saved value is unchanged and the row keeps showing it.
      setFailure(text('无法保存默认模型。请重试。', 'Could not save the default model. Try again.'))
    }
  }

  const llmValue = llm.value === undefined ? null : { provider: llm.value.provider, model: llm.value.model }
  const llmModel = llmValue === null ? undefined
    : catalog?.groups.find(group => group.id === llmValue.provider)?.models.find(model => model.id === llmValue.model)
  const llmItems: MenuEntry[] = (catalog?.groups ?? []).flatMap(group => [
    { type: 'label' as const, id: `label:${group.id}`, text: group.name },
    ...group.models.map(model => ({ id: choiceId({ provider: group.id, model: model.id }), label: model.name, icon: logoOf(group.id) })),
  ])

  const defaults = media.value?.defaults ?? {}
  const rows: { media: CloudMedia; title: string; help: string }[] = [
    { media: 'video', title: text('视频模型', 'Video model'), help: text('新对话生成视频时使用。', 'New conversations generate video with this model.') },
    { media: 'image', title: text('图片模型', 'Image model'), help: text('新对话生成图片时使用。', 'New conversations generate images with this model.') },
    { media: 'audio', title: text('音频模型', 'Audio model'), help: text('新对话生成音频时使用。', 'New conversations generate audio with this model.') },
  ]
  const unique = (kind: CloudMedia) => [...new Map(entries
    .filter(entry => entry.modality === kind && entry.schema !== null && entry.runtime?.installed !== false)
    .map(entry => [choiceId(entry), entry])).values()]

  return <section className={css.group} aria-labelledby={headingId}>
    <header className={css.groupHeading}>
      <h3 id={headingId}>{text('默认模型', 'Default models')}</h3>
      <p>{text('未选择模型时，对话从这些模型开始。', 'What a conversation starts on when nobody picks a model.')}</p>
    </header>
    {failure === null ? null : <p className={css.error} role="alert">{failure}</p>}
    <ul className={css.card}>
      <ModelRow title={text('导演 LLM', 'Director LLM')}
        help={text('规划镜头并调用生成模型的语言模型。', 'The language model that plans shots and runs the generation models.')}
        value={llmValue === null ? { label: text('未设置', 'Not set') }
          : { label: llmModel?.name ?? llmValue.model, icon: logoOf(llmValue.provider) }}
        items={llmItems} disabled={llm.status !== 'ready' || !llm.writable || llmItems.length === 0}
        onOpen={refresh}
        onSelect={(id) => {
          const [provider, model] = JSON.parse(id) as [string, string]
          void write(source.llmForm as ConfigForm<never>, [
            { op: 'set', path: ['provider'], value: provider }, { op: 'set', path: ['model'], value: model },
            ...provider === llmValue?.provider ? [] : [{ op: 'unset' as const, path: ['reasoningEffort'] }],
          ], llm.revision)
        }} />
      {rows.map((row) => {
        const choices = unique(row.media)
        const current = defaults[row.media]
        const entry = current === undefined ? undefined : choices.find(choice => choiceId(choice) === choiceId(current))
        // A saved default the catalog no longer offers still starts new conversations on a missing model, so say so.
        const stale = current !== undefined && mediaLoaded && entry === undefined
        const clear = (): void => {
          void write(source.mediaForm as ConfigForm<never>, [{ op: 'set', path: ['defaults'],
            value: Object.fromEntries(Object.entries(defaults).filter(([kind]) => kind !== row.media)) }], media.revision)
        }
        return <ModelRow key={row.media} title={row.title} help={row.help}
          {...stale ? { warning: {
            message: text(`${current.model} 已不可用，新对话会从自动开始。`, `${current.model} is no longer available, so new conversations start on Auto.`),
            action: text('改回自动', 'Use Auto'), onAction: clear } } : {}}
          value={current === undefined ? { label: text('自动 · 由导演选择', 'Auto · the director chooses') }
            : { label: stale ? text(`${current.model} · 不可用`, `${current.model} · Unavailable`)
              : `${entry?.display_name ?? current.model} · ${providerName(current.provider)}`, icon: logoOf(current.provider) }}
          items={[
            { id: '', label: text('自动 · 由导演选择', 'Auto · the director chooses') },
            ...choices.length === 0 ? [] : [{ type: 'separator' as const, id: 'sep' }],
            ...choices.map(choice => ({ id: choiceId(choice),
              label: `${choice.display_name ?? choice.model} · ${providerName(choice.provider)}`, icon: logoOf(choice.provider) })),
          ]}
          disabled={media.status !== 'ready' || !media.writable}
          onOpen={refresh}
          onSelect={(id) => {
            const next = Object.fromEntries(Object.entries(defaults).filter(([kind]) => kind !== row.media))
            if (id !== '') {
              const [provider, model] = JSON.parse(id) as [string, string]
              next[row.media] = { provider, model }
            }
            void write(source.mediaForm as ConfigForm<never>, [{ op: 'set', path: ['defaults'], value: next }], media.revision)
          }} />
      })}
    </ul>
  </section>
}
