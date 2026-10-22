/**
 * The chat card of a `dv_shot_render` call: the tool's name, the model and generation task, the prompt, the status, the
 * rendered video, and the 在历史中查看 link once settled.
 *
 * @module @dv/ui-shot-render/RenderCard
 */
import { useText } from '@dv/ui-kit/locale.ts'
import { taskLabel, type WireTaskLabels } from '@dv/ui-kit/tool-labels.ts'
import { argsOf, HistoryLink, outputsOf } from '@dv/ui-kit/tool-rows.tsx'
import css from './render-card.module.css'

/** What the render card reads from the tool-call owner props. */
export interface RenderCardProps {
  /** The render tool, `dv_shot_render`. */
  toolName: string
  /** The tool's [Chinese, English] name. */
  label: readonly [string, string]
  /** The task labels of `GET /api/dv/tasks`; the card shows the call's task by its label, else by its name. */
  taskLabels: WireTaskLabels
  sessionId: string
  callId: string
  phase: 'preparing' | 'start' | 'result'
  block: object
}

/**
 * The card of one render call (`dv_shot_render`): the tool's name, the model and generation task, the prompt, the status,
 * and the rendered video.
 * @param props - the call.
 * @returns the card.
 */
export function RenderCard(props: RenderCardProps) {
  const t = useText()
  const block = props.block
  const raw = 'argsRaw' in block && typeof block.argsRaw === 'string' ? block.argsRaw
    : 'call' in block && typeof block.call === 'object' && block.call !== null && 'argsRaw' in block.call ? String(block.call.argsRaw) : ''
  const args = argsOf(raw)
  const prompt = typeof args['prompt'] === 'string' ? args['prompt'] : ''
  const model = typeof args['model'] === 'string' ? args['model'] : ''
  const task = typeof args['task'] === 'string' ? t(...taskLabel(args['task'], props.taskLabels)) : ''
  const modelLine = [model, task].filter(part => part !== '').join(' · ')
  const failed = 'isError' in block && block.isError === true
  const video = outputsOf(block).find(output => output.mime.startsWith('video/'))
  const status = props.phase === 'result' ? (failed ? t('未渲染', 'Not rendered') : t('已渲染', 'Rendered')) : t('渲染中…', 'Rendering…')
  return <div className={css.card} data-tool={props.toolName}>
    <div className={css.cardHeader}>
      <span className={css.title}>{t(props.label[0], props.label[1])}</span>
      <span className={css.status} data-failed={props.phase === 'result' && failed ? '' : undefined}>{status}</span>
    </div>
    {modelLine !== '' && <div className={css.model} data-testid="dv-composer-render-model">{modelLine}</div>}
    {prompt !== '' && <div className={css.prompt}>{prompt}</div>}
    {video !== undefined && <video src={video.url} controls muted className={css.video} />}
    {props.phase === 'result' && <div className={css.cardFooter}><HistoryLink sessionId={props.sessionId} callId={props.callId} className={css.textButton} /></div>}
  </div>
}
