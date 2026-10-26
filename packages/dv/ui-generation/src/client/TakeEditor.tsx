/**
 * The editor body of a generation take, which the canvas renders for a claimed node: its first output through
 * `dv.media` at purpose 'loop' behind the take's preview as the poster, the failure reason of a failed take, its model
 * and generation task (the task's label in `GET /api/dv/tasks`, else its name), and the `dv.prompt` composer over the
 * take's call when `GET /api/dv/operations` declares its operation: the references, the prompt, the parameters and
 * the send. A send reruns the take's operation as edited, with the take as `based_on`; on success the canvas
 * closes the editor and selects the new take, and the composer shows a refused request's error. The composer's
 * host opens the canvas's asset picker with the versioned items, imports uploaded files as canvas imports, opens the
 * preview of an asset, and opens the editor of a versioned item's node over this one.
 *
 * @module @dv/ui-generation/TakeEditor
 */
import type { CSSProperties, ReactNode } from 'react'
import type { InjectFace, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@dv/ui-canvas/contract'
import type { PromptCall, PromptHost } from '@dv/ui-composer/contract'
import { useText } from '@dv/ui-kit/locale.ts'
import { playerBox } from '@dv/ui-kit/player-box.ts'
import { requestInputsOf } from '@dv/ui-kit/references.ts'
import { taskLabel } from '@dv/ui-kit/tool-labels.ts'
import type {} from '@dv/ui-media/contract'
import type { GenerationInjected } from './loaded.ts'

/** What the kit injects into a take editor: the task label source. */
export interface TakeEditorInjected {
  hooks: Pick<GenerationInjected['hooks'], 'taskLabels'>
}

/** The take editor's composed props. */
export type TakeEditorProps = PropsRuntime<'dv.canvas.editor.claimed'> & PropsRenderFactories & InjectFace<TakeEditorInjected>

const label: CSSProperties = { display: 'block', fontSize: 12, lineHeight: '16px', fontWeight: 500, color: 'var(--dv-text-2)', margin: '12px 0 4px' }
const player: CSSProperties = { display: 'flex', borderRadius: 'var(--dv-radius-lg)', overflow: 'hidden', background: 'var(--dv-media-bg)' }

/**
 * The editor body.
 * @param props - the take, the state, the operations, the canvas host, the label hooks, and the Factory renderer.
 * @returns the element.
 */
export function TakeEditor(props: TakeEditorProps): ReactNode {
  const { node, state, operations, host, renderFactorySlot } = props
  const pick = useText()
  const taskLabels = props.useTaskLabels(value => value)
  const record = node.record
  const declared = operations.some(candidate => candidate.name === record.operation)
  const model = typeof record.params['model'] === 'string' ? record.params['model'] : ''
  const task = typeof record.params['task'] === 'string' ? record.params['task'] : ''
  const failure = record.error?.message || null
  const shown = state.assets.find(asset => asset.id === node.assets[0])
  const promptHost: PromptHost = {
    pickAssets: (chosen, done) => { host.pickAssets(chosen, { versions: true }, done) },
    importFiles: files => host.importFiles(files),
    preview: (asset, opener) => { host.preview(asset, opener) },
    openNode: (nodeId) => { host.openNode(nodeId) },
  }
  // The composer shows a refused rerun under itself.
  const rerun = (call: PromptCall): Promise<void> => host.rerun({
    operation: call.operation, inputs: [...call.inputs], params: { ...call.params }, based_on: record.id,
    intent: pick(`在画布上生成 ${node.title} 的新版本`, `Generate a new version of ${node.title} from the canvas`),
  })
  return (
    <div>
      {shown === undefined ? null : <div style={{ ...player, ...playerBox(shown, 360) }} data-testid="dv-take-player">{renderFactorySlot('dv.media', { asset: shown, purpose: 'loop', ...node.preview === undefined ? {} : { poster: node.preview } })}</div>}
      {failure === null
        ? null
        : <p role="note" style={{ margin: 0, padding: '8px 12px', borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-danger-soft)', color: 'var(--dv-danger)' }}>{pick(`失败原因：${failure}`, `Failure reason: ${failure}`)}</p>}
      <span style={label}>{pick('模型和生成方式', 'Model and mode')}</span>
      <span data-testid="dv-canvas-render-mode">{`${model} · ${pick(...taskLabel(task, taskLabels))}`}</span>
      {declared
        ? (
          <div style={{ marginTop: 12 }}>
            {renderFactorySlot('dv.prompt', {
              projectId: state.project.id, state, operations, readOnly: false, surface: 'canvas', host: promptHost, onSubmit: rerun,
              call: { operation: record.operation, params: record.params, inputs: requestInputsOf(record) },
            })}
          </div>
        )
        : null}
    </div>
  )
}
