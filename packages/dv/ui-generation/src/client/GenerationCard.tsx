/**
 * The chat card of one generation tool call: the operation's name, the model and generation task, the prompt, the
 * status words of the kind, the first output drawn through `dv.media` at purpose 'loop' (muted and looping behind the
 * kind's preview output as the poster), and the 在历史中查看 link once settled.
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

/** What the kit injects into the chat card of one operation: the operation, the status words, and the label sources. */
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
  const block = props.block
  const raw = 'argsRaw' in block && typeof block.argsRaw === 'string' ? block.argsRaw
    : 'call' in block && typeof block.call === 'object' && block.call !== null && 'argsRaw' in block.call ? block.call.argsRaw : ''
  const args = argsOf(raw)
  const prompt = typeof args['prompt'] === 'string' ? args['prompt'] : ''
  const model = typeof args['model'] === 'string' ? args['model'] : ''
  const task = typeof args['task'] === 'string' ? t(...taskLabel(args['task'], taskLabels)) : ''
  const modelLine = [model, task].filter(part => part !== '').join(' · ')
  const failed = 'isError' in block && block.isError
  const outputs = outputsOf(block).map(({ id, mime }): MediaAsset => ({ id, mime }))
  const played = outputs[0]
  const poster = props.preview(outputs)
  let status = t(...props.status.running)
  if (props.phase === 'result') status = failed ? t(...props.status.failed) : t(...props.status.done)
  return (
    <div className={css.card} data-tool={props.toolName}>
      <div className={css.cardHeader}>
        <span className={css.title}>{t(...operationLabel(props.operation, operations))}</span>
        <span className={css.status} data-failed={props.phase === 'result' && failed ? '' : undefined}>{status}</span>
      </div>
      {modelLine !== '' && <div className={css.model} data-testid="dv-composer-render-model">{modelLine}</div>}
      {prompt !== '' && <div className={css.prompt}>{prompt}</div>}
      {played !== undefined && (
        <div className={css.media}>
          {props.renderFactorySlot('dv.media', { asset: played, purpose: 'loop', ...poster === undefined ? {} : { poster } })}
        </div>
      )}
      {props.phase === 'result' && <div className={css.cardFooter}><HistoryLink sessionId={props.sessionId} callId={props.callId} className={css.textButton} /></div>}
    </div>
  )
}
