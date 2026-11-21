/** The composer's LLM seat as a provider-grouped popover; lists only providers that can serve a request now. */
import { useEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { useText } from '@dv/ui-kit/locale.ts'
import { PickerPopover, type PickerItem } from './PickerPopover.tsx'
import { ProviderGlyph } from './ProviderGlyph.tsx'
import css from './picker.module.css'

/** The seat's face: the session's model directory plus the providers able to serve a request. */
export interface LlmPickerInjected extends ModelSelectInjected {
  /** Read the provider routes that can serve a request now; null when unknown. */
  routable(this: void): Promise<readonly string[] | null>
  /** The logo of a provider, when its plugin draws one. */
  logoOf(this: void, provider: string): ComponentType<{ size: number }> | undefined
}

const rowOf = (provider: string, model: string): string => JSON.stringify([provider, model])

/**
 * Draw the LLM trigger and its popover. Choosing a model keeps the current effort when the model offers it.
 * @param props - the session directory face and the composer lock.
 * @returns the LLM picker.
 */
export function LlmPicker({ locked, available, directory, load, select, routable, logoOf }: LlmPickerInjected & { locked: boolean }) {
  const text = useText()
  const state = useSyncExternalStore(listener => directory.subscribe(listener), () => directory.getSnapshot())
  const [routes, setRoutes] = useState<readonly string[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const refresh = (): void => {
    if (!available) return
    load()
    routable().then(setRoutes, (_unknown: unknown) => {
      // Without the route list every loaded group stays listed.
      setRoutes(null)
    })
  }
  useEffect(refresh, [available])
  if (!available) return null
  const glyph = (provider: string, name: string) => <ProviderGlyph logo={logoOf(provider)} name={name} />
  const current = state.current
  const groups = state.groups.filter(group => routes === null || routes.includes(group.id)
    || (current !== null && current.provider === group.id))
  const currentModel = current === null ? undefined
    : state.groups.find(group => group.id === current.provider)?.models.find(model => model.id === current.model)
  const effortName = currentModel?.reasoning?.efforts.find(effort => effort.id === current?.reasoningEffort)?.name
  const choose = (selection: Parameters<typeof select>[0]): void => {
    setFailure(null)
    select(selection).then((result) => {
      if (result !== undefined && !result.ok) setFailure(result.error.message)
    }, (error: unknown) => { setFailure(error instanceof Error ? error.message : String(error)) })
  }
  const items: PickerItem[] = groups.flatMap(group => group.models.map((model) => {
    const selected = current?.provider === group.id && current.model === model.id
    const efforts = model.reasoning?.efforts ?? []
    return {
      id: rowOf(group.id, model.id), group: group.id, label: model.name, keywords: group.name, selected,
      facts: [
        [text('提供商', 'Provider'), group.name],
        [text('模型', 'Model'), model.id],
        ...efforts.length === 0 ? [] : [[text('推理', 'Reasoning'), efforts.map(effort => effort.name).join(' · ')] as const],
        ...model.description === undefined ? [] : [[text('说明', 'About'), model.description] as const],
      ],
      ...!selected || efforts.length === 0 ? {} : {
        extra: <div className={css.efforts}>
          <span className={css.effortLabel}>{text('推理强度', 'Reasoning effort')}</span>
          <div className={css.effortTrack} role="group" aria-label={text('推理强度', 'Reasoning effort')}>
            {efforts.map(effort => <button key={effort.id} type="button" aria-pressed={current.reasoningEffort === effort.id}
              title={effort.description} onClick={() => { choose({ provider: group.id, model: model.id, reasoningEffort: effort.id }) }}>
              {effort.name}</button>)}
          </div>
        </div>,
      },
    }
  }))
  return <span className="dv-model-choice">
    <PickerPopover label={text('语言模型', 'Language model')} disabled={locked || state.status === 'selecting'}
      value={currentModel === undefined ? current?.model ?? text('选择模型', 'Choose a model')
        : [currentModel.name, state.groups.find(group => group.id === current?.provider)?.name, effortName]
          .filter(part => part !== undefined).join(' · ')}
      valueIcon={current === null ? undefined
        : glyph(current.provider, groups.find(group => group.id === current.provider)?.name ?? current.provider)}
      searchLabel={text('搜索模型', 'Search models')} emptyLabel={text('没有匹配的模型。', 'No models match.')}
      onOpen={refresh}
      groups={groups.map(group => ({ id: group.id, name: group.name, icon: glyph(group.id, group.name) }))}
      items={items}
      footer={text('在 设置 → 模型 中连接更多提供商。', 'Connect more providers in Settings → Models.')}
      onSelect={(id) => {
        const [provider, model] = JSON.parse(id) as [string, string]
        const efforts = groups.find(group => group.id === provider)?.models.find(entry => entry.id === model)?.reasoning
        const keep = current?.reasoningEffort !== undefined
          && efforts?.efforts.some(effort => effort.id === current.reasoningEffort) === true
        const reasoningEffort = keep ? current.reasoningEffort : efforts?.defaultEffort
        choose({ provider, model, ...reasoningEffort === undefined ? {} : { reasoningEffort } })
        return true
      }} />
    {failure === null ? null : <span role="alert" className="dv-model-choice-error">{failure}</span>}
  </span>
}
