/** Conversation video-model defaults and provider lifecycle operations. */
import type { Context } from '@deepseek-ai/cordis'
import type { OperationSpec, ProjectState, Reducer, RunRequest, SessionId } from '@dv/project'
import type DvModels from './index.ts'
import { modelKey } from './index.ts'
import type { VideoModelSelection } from './types.ts'

/** Read a conversation's explicit video default; null delegates to the operator. */
export function videoSelection(state: ProjectState, session: SessionId | null): VideoModelSelection | null {
  return session === null ? null : state.components.models?.conversations[session] ?? null
}

/** Enforce the conversation default before an agent render is recorded. */
export function assertVideoSelection(request: Pick<RunRequest, 'actor' | 'session' | 'params'>, state: ProjectState): void {
  if (request.actor !== 'agent' || request.params['modality'] !== 'video') return
  const selected = videoSelection(state, request.session)
  if (selected !== null && (request.params['provider'] !== selected.provider || request.params['model'] !== selected.model)) {
    throw new Error(`This conversation's video model is ${selected.provider}/${selected.model}. `
      + 'Use that model and its prompt skill, or change the conversation choice with dv_models_select before rendering.')
  }
}

/**
 * Rebuild conversation choices from successful selection operations. `models.select` is outside the undo history, so
 * the choices are those of every such record in write order, whatever the current position.
 */
export const selectionReducer: Reducer<'models'> = {
  initial: () => ({ conversations: {} }),
  reduce(slice, record) {
    if (record.operation !== 'models.select' || record.status !== 'done' || record.session === null) return slice
    const provider = String(record.params['provider'])
    const model = String(record.params['model'])
    return { conversations: { ...slice?.conversations, [record.session]: model === '' ? null : { provider, model } } }
  },
  // Each agent reads only its own conversation's choice: no model-visible input names a session ID.
  agentSummary: (slice, _assets, _state, session) => {
    const selected = slice?.conversations[session] ?? null
    return { video_model: selected === null ? null : { ...selected } }
  },
}

/**
 * Mount conversation selection and lifecycle operations with the project service. Selection, load and unload are
 * settings outside the undo history: they discard no step and undo never changes them.
 */
export function installModelControls(ctx: Context, models: DvModels): void {
  ctx.inject(['dvProject'], (scope) => {
    scope.effect(() => scope.dvProject.registerComponent('models'), 'model conversation component')
    scope.effect(() => scope.dvProject.registerReducer('models', selectionReducer), 'model conversation choices')
    const select: OperationSpec = {
      name: 'models.select', component: 'models', version: '1',
      label: { zh: '选择视频模型', en: 'Select video model' },
      description: 'Choose the video model for subsequent generations in this conversation. '
        + 'Pass empty provider and model strings to let the operator choose. Existing renders keep their model. '
        + 'Selecting does not download weights; the model loads when generation starts. '
        + 'The choice is not a project history step: dv_proj_undo and dv_proj_redo do not change it; to go back, select the earlier model again.',
      params: {
        provider: { type: 'string', required: true, description: 'The provider from dv_models_list, or empty for Auto.' },
        model: { type: 'string', required: true, description: 'The video model from dv_models_list, or empty for Auto.' },
      },
      inputs: {}, outputs: [], deterministic: false, resource: 'none', outsideHistory: true,
      summarize: record => `video model ${String(record.params['model']) || 'Auto'}, for the conversation that chose it only`,
      precondition: async (request) => {
        if (request.session === null || scope.dvProject.sessionProject(request.session) !== request.project) {
          throw new Error('Choose a video model from a conversation in this project.')
        }
        const { provider, model } = request.params
        if ((provider === '') !== (model === '')) throw new Error('Provider and model must both be empty for Auto.')
        if (model !== '' && !models.list().some(entry => entry.modality === 'video' && entry.provider === provider && entry.model === model)) {
          throw new Error(`Video model ${String(provider)}/${String(model)} is not configured.`)
        }
      },
      execute: async run => ({ outputs: [], report: { provider: run.params['provider'], model: run.params['model'] } }),
    }
    scope.effect(() => scope.dvProject.registerOperation(select), 'model selection operation')
    for (const action of ['load', 'unload', 'status'] as const) {
      const operation: OperationSpec = {
        name: `models.${action}`, component: 'models', version: '1',
        label: { zh: ({ load: '加载模型', unload: '卸载模型', status: '查看模型状态' })[action],
          en: ({ load: 'Load model', unload: 'Unload model', status: 'Inspect model state' })[action] },
        description: action === 'load' ? 'Load an installed model into GPU memory without generating. Never downloads weights. '
          + 'Not a project history step: dv_proj_undo does not reverse it; call dv_models_unload instead.'
          : action === 'unload' ? 'Release a model from GPU memory, keeping downloaded files and compatible shared components. '
            + 'Not a project history step: dv_proj_undo does not reverse it; call dv_models_load instead.'
            : 'Inspect whether a model is installed, loaded, loading, or busy with generation.',
        params: {
          modality: { type: 'string', required: true, description: 'The modality from dv_models_list.' },
          task: { type: 'string', required: true, description: 'The task from dv_models_list.' },
          provider: { type: 'string', required: true, description: 'The provider from dv_models_list.' },
          model: { type: 'string', required: true, description: 'The model from dv_models_list.' },
        },
        inputs: {}, outputs: [], deterministic: false, resource: action === 'status' ? 'none' : 'gpu',
        ...action === 'status' ? { readOnly: true } : { outsideHistory: true },
        summarize: record => String(record.params['model']),
        execute: async (run) => {
          const entry = models.get(modelKey(run.params))
          if (entry?.runtime === undefined) throw new Error('This provider does not expose GPU lifecycle controls.')
          if (action !== 'status') await entry.runtime[action](run.signal)
          return { outputs: [], report: { ...(await entry.runtime.status(run.signal)) } }
        },
      }
      scope.effect(() => scope.dvProject.registerOperation(operation), `model ${action} operation`)
    }
  })
}
