/** Conversation-level video choice, beside the operator LLM in the chat composer. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { WireModelEntry, WireState } from '@dv/ui-kit/types.ts'

interface Selection { provider: string; model: string }

/** One menu row per model, even when a model serves several generation tasks. */
export function videoChoices(models: readonly WireModelEntry[]): WireModelEntry[] {
  return [...new Map(models.filter(entry => entry.modality === 'video' && entry.runtime?.installed !== false)
    .map(entry => [JSON.stringify([entry.provider, entry.model]), entry])).values()]
}

/** Narrow the optional component slice owned by the model controls. */
function selectedVideo(state: WireState | null, session: string): Selection | null {
  const slice = state?.components['models'] as { conversations?: Record<string, Selection | null> } | undefined
  return slice?.conversations?.[session] ?? null
}

export interface VideoModelPickerProps {
  sessionId: string
  state: HostObservable<WireState | null>
  models: HostObservable<readonly WireModelEntry[] | null>
  save(selection: Selection | null): Promise<unknown>
}

/** Save a conversation default without changing the draft or any previous render. */
export function VideoModelPicker({ sessionId, state, models, save }: VideoModelPickerProps) {
  const pick = useText()
  const project = useSyncExternalStore(state.subscribe, state.getSnapshot)
  const catalog = useSyncExternalStore(models.subscribe, models.getSnapshot)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => { setOpen(false); setFailure(null) }, [state, sessionId])
  const choices = videoChoices(catalog ?? [])
  const selected = selectedVideo(project, sessionId)
  const selectedId = selected === null ? '' : JSON.stringify([selected.provider, selected.model])
  const entry = choices.find(choice => JSON.stringify([choice.provider, choice.model]) === selectedId)
  const label = selected === null ? pick('自动', 'Auto') : entry?.display_name ?? selected.model
  const choose = (id: string): void => {
    const next = choices.find(choice => JSON.stringify([choice.provider, choice.model]) === id)
    if (id !== '' && next === undefined) return
    setOpen(false)
    setSaving(true)
    setFailure(null)
    save(next === undefined ? null : { provider: next.provider, model: next.model })
      .catch((error: unknown) => { setFailure(errorMessage(error)) })
      .finally(() => { setSaving(false) })
  }
  return <span className="dv-video-model">
    <Menu open={open} onClose={() => { setOpen(false) }} onSelect={choose} selectedId={selectedId}
      portal side="top" compact autoFocus items={[
        { id: '', label: pick('自动 · 由智能体选择', 'Auto · let the operator choose') },
        ...choices.map(choice => ({ id: JSON.stringify([choice.provider, choice.model]),
          label: choice.display_name ?? choice.model, disabled: choice.runtime?.installed === false })),
      ]} anchor={<button type="button" className="dv-video-model-trigger" aria-haspopup="menu" aria-expanded={open}
        aria-label={pick(`视频模型：${label}`, `Video model: ${label}`)}
        title={pick('后续生成使用此模型，需要时加载；已生成的视频不变。', 'Used for future generations; loads when needed. Existing videos keep their model.')}
        disabled={saving || project === null || catalog === null}
        onClick={() => { setOpen(value => !value) }}>
        <span className="dv-video-model-kind">{pick('视频', 'Video')}</span>
        <span className="dv-video-model-name">{saving ? pick('保存中…', 'Saving…') : label}</span>
        <IconChevronDownOutlineRegular size={14} />
      </button>} />
    {failure === null ? null : <span role="alert" className="dv-video-model-error">{failure}</span>}
  </span>
}
