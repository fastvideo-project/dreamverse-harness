/**
 * The chat card of one generation tool call. The first output plays through `dv.media` at purpose 'loop', with the
 * kind's preview output as its poster.
 *
 * @module @dv/ui-generation/GenerationCard
 */
import type { ReactNode } from 'react'
import type { InjectFace, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { useText } from '@dv/ui-kit/locale.ts'
import { operationLabel, taskLabel } from '@dv/ui-kit/tool-labels.ts'
import { argsOf, HistoryLink, outputsOf } from '@dv/ui-kit/tool-rows.tsx'
import type { MediaAsset } from '@dv/ui-media/contract'
import type { GenerationInjected } from './loaded.ts'
import css from './generation-card.module.css'

/** The status words of a generation kind as text pairs: running, failed, and done. */
export interface StatusWords {
  running: readonly [zh: string, en: string]
  failed: readonly [zh: string, en: string]
  done: readonly [zh: string, en: string]
}

/** What the kit injects into the chat card of one operation. */
export interface GenerationCardInjected extends GenerationInjected {
  operation: string
  status: StatusWords
  /** The kind's preview of the call's outputs, which the player shows before it plays. */
  preview(outputs: readonly MediaAsset[]): string | undefined
}

/** The card's composed props: DSH's tool-call owner props plus the injected kind facts. */
export type GenerationCardProps = PropsRuntime<'tool.call.toolview'> & PropsRenderFactories & InjectFace<GenerationCardInjected>

/**
 * The card of one generation call.
 * @param props - the call, the kind's operation and status words, the label hooks, and the Factory renderer.
 * @returns the card.
 */
export function GenerationCard(props: GenerationCardProps): ReactNode {
  const t = useText()
  const operations = props.useOperations(value => value)
  const taskLabels = props.useTaskLabels(value => value)
  const live = props.useChatAssets(value => value)
  const record = Object.values(live.records).find(row => row.session === props.sessionId
    && row.tool_call === props.callId && row.operation === props.operation)
  const block = props.block
  const raw = 'argsRaw' in block && typeof block.argsRaw === 'string' ? block.argsRaw
    : 'call' in block && typeof block.call === 'object' && block.call !== null && 'argsRaw' in block.call ? block.call.argsRaw : ''
  const args = argsOf(raw)
  const prompt = typeof args['prompt'] === 'string' ? args['prompt'] : ''
  const model = typeof args['model'] === 'string' ? args['model'] : ''
  const task = typeof args['task'] === 'string' ? t(...taskLabel(args['task'], taskLabels)) : ''
  const modelLine = [model, task].filter(part => part !== '').join(' · ')
  const failed = record === undefined ? 'isError' in block && block.isError
    : record.status === 'failed' || record.status === 'cancelled'
  const settled = record === undefined ? props.phase === 'result'
    : record.status === 'done' || failed
  const recordedOutputs = record?.outputs.flatMap((id) => {
    const asset = live.assets[id]
    return asset === undefined ? [] : [{ id: asset.id, mime: asset.mime }]
  })
  const outputs: MediaAsset[] = recordedOutputs !== undefined && recordedOutputs.length > 0
    ? recordedOutputs : outputsOf(block).map(({ id, mime }): MediaAsset => ({ id, mime }))
  const played = outputs[0]
  const poster = props.preview(outputs)
  let status = t(...props.status.running)
  if (record?.status === 'pending') status = t('排队中', 'Queued')
  if (settled) status = failed ? t(...props.status.failed) : t(...props.status.done)
  if (record?.status === 'cancelled') status = t('已取消', 'Cancelled')
  return (
    <div className={css.card} data-tool={props.toolName}>
      <div className={css.cardHeader}>
        <span className={css.title}>{t(...operationLabel(props.operation, operations))}</span>
        <span className={css.status} role="status" data-failed={settled && failed ? '' : undefined}>
          {status}
        </span>
      </div>
      {modelLine !== '' && <div className={css.model} data-testid="dv-composer-render-model">{modelLine}</div>}
      {prompt !== '' && <div className={css.prompt}>{prompt}</div>}
      {!settled && <progress className={css.progress} aria-label={status} />}
      {played !== undefined && (
        <div className={css.media}>
          {props.renderFactorySlot('dv.media', { asset: played, purpose: 'loop', ...poster === undefined ? {} : { poster } })}
        </div>
      )}
      {settled && (
        <div className={css.cardFooter}>
          <HistoryLink sessionId={props.sessionId} callId={props.callId} className={css.textButton} />
        </div>
      )}
    </div>
  )
}
