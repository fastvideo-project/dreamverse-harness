/**
 * The composer's visible tool rows: the chat row of an agent tool call, with the 在历史中查看 link of a settled call that
 * wrote a record.
 *
 * @module @dv/ui-composer/views
 */
import { useText } from '@dv/ui-kit/locale.ts'
import { HistoryLink, wroteRecord } from '@dv/ui-kit/tool-rows.tsx'
import css from './views.module.css'

/**
 * The chat row of one agent tool call: the tool's creator-facing name, whether the step is running, done, or failed,
 * and, once settled, 在历史中查看 for a tool that writes a record.
 * @param props - the tool's [Chinese, English] name, the chat session, the tool call, the call phase, and the call block.
 * @returns the row.
 */
export function ToolLabelRow(props: {
  label: readonly [string, string]
  toolName: string
  sessionId: string
  callId: string
  phase: 'preparing' | 'start' | 'result'
  block: object
}) {
  const t = useText()
  const failed = 'isError' in props.block && props.block.isError === true
  const status = props.phase !== 'result' ? t('进行中…', 'Running…') : failed ? t('未完成', 'Failed') : t('完成', 'Done')
  return <div className={css.toolRow} data-tool={props.toolName}>
    <span>{t(props.label[0], props.label[1])}</span>
    <span className={css.status} data-failed={props.phase === 'result' && failed ? '' : undefined}>{status}</span>
    {props.phase === 'result' && wroteRecord(props.block) && <HistoryLink sessionId={props.sessionId} callId={props.callId} className={css.textButton} />}
  </div>
}
