/** Conversation model defaults, one per modality, and provider lifecycle operations. */
import type { Context } from '@deepseek-ai/cordis'
import type { OperationSpec, ProjectState, Reducer, RunRequest, SessionId } from '@dv/project'
import type DvModels from './index.ts'
import { modelKey } from './index.ts'
import type { ModelSelection, ModelSelections } from './types.ts'

/**
 * Read a conversation's explicit default for one modality.
 * @param state - the project state.
 * @param session - the conversation, or null for a call from outside one.
 * @param modality - the modality, such as `video` or `image`.
 * @returns the chosen model, or null when the operator chooses (Auto).
 */
export function modelSelection(state: ProjectState, session: SessionId | null, modality: string): ModelSelection | null {
  if (session === null) return null
  // The slice is absent from a project state while the model controls are not mounted.
  const slice: ModelSelections | undefined = state.components.models
  const choices: Partial<Record<string, ModelSelection>> = slice?.conversations[session] ?? {}
  return choices[modality] ?? null
}

/**
 * Enforce the conversation default of the request's modality before an agent generation is recorded.
 * @param request - the run request; only agent calls are checked.
 * @param state - the project state the request is checked against.
 * @throws Error naming the chosen model when the request names another model of that modality.
 */
export function assertModelSelection(request: Pick<RunRequest, 'actor' | 'session' | 'params'>, state: ProjectState): void {
  const modality = request.params['modality']
  if (request.actor !== 'agent' || typeof modality !== 'string') return
  const selected = modelSelection(state, request.session, modality)
  if (selected !== null && (request.params['provider'] !== selected.provider || request.params['model'] !== selected.model)) {
    throw new Error(`This conversation's ${modality} model is ${selected.provider}/${selected.model}. `
      + 'Use that model and its prompt skill, or change the conversation choice with dv_models_select before generating.')
  }
}

/** The modality of a models.select record; version 1 records chose only video models and carry no modality. */
function selectedModality(params: Record<string, unknown>): string {
  return typeof params['modality'] === 'string' ? params['modality'] : 'video'
}

/** Rebuild conversation choices from successful selection operations. */
export const selectionReducer: Reducer<'models'> = {
  initial: () => ({ conversations: {} }),
  reduce(slice, record) {
    if (record.operation !== 'models.select' || record.status !== 'done' || record.session === null) return slice
    const modality = selectedModality(record.params)
    const provider = String(record.params['provider'])
    const model = String(record.params['model'])
    const { [modality]: _previous, ...others }: Partial<Record<string, ModelSelection>> = slice.conversations[record.session] ?? {}
    const choices = model === '' ? others : { ...others, [modality]: { provider, model } }
    return { conversations: { ...slice.conversations, [record.session]: choices } }
  },
  agentSummary: slice => ({ model_choices: Object.fromEntries(Object.entries(slice.conversations)
    .map(([session, choices]) => [session, Object.fromEntries(Object.entries(choices)
      .map(([modality, selection]) => [modality, { ...selection }]))])) }),
}

/** Mount conversation selection and lifecycle operations with the project service. */
export function installModelControls(ctx: Context, models: DvModels): void {
  ctx.inject(['dvProject'], (scope) => {
    scope.effect(() => scope.dvProject.registerComponent('models'), 'model conversation component')
    scope.effect(() => scope.dvProject.registerReducer('models', selectionReducer), 'model conversation choices')
    const select: OperationSpec = {
      name: 'models.select', component: 'models', version: '2',
      label: { zh: '选择模型', en: 'Select model' },
      description: 'Choose the model of one modality (video, image or audio) for subsequent generations in this conversation. '
        + 'Pass empty provider and model strings to let the operator choose. Existing generations keep their model. '
        + 'Selecting does not download weights; the model loads when generation starts.',
      params: {
        modality: { type: 'string', required: true, description: 'The modality from dv_models_list, such as video or image.' },
        provider: { type: 'string', required: true, description: 'The provider from dv_models_list, or empty for Auto.' },
        model: { type: 'string', required: true, description: 'The model from dv_models_list, or empty for Auto.' },
      },
      inputs: {}, outputs: [], deterministic: false, resource: 'none',
      summarize: record => `${selectedModality(record.params)}: ${String(record.params['model']) || 'Auto'}`,
      precondition: async (request) => {
        if (request.session === null || scope.dvProject.sessionProject(request.session) !== request.project) {
          throw new Error('Choose a model from a conversation in this project.')
        }
        const { modality, provider, model } = request.params
        if ((provider === '') !== (model === '')) throw new Error('Provider and model must both be empty for Auto.')
        if (!models.list().some(entry => entry.modality === modality)) throw new Error(`No ${String(modality)} model is configured.`)
        if (model !== '' && !models.list().some(entry => entry.modality === modality && entry.provider === provider && entry.model === model)) {
          throw new Error(`${String(modality)} model ${String(provider)}/${String(model)} is not configured.`)
        }
      },
      execute: async run => ({ outputs: [], report: { modality: run.params['modality'], provider: run.params['provider'], model: run.params['model'] } }),
    }
    scope.effect(() => scope.dvProject.registerOperation(select), 'model selection operation')
    for (const action of ['load', 'unload', 'status'] as const) {
      const operation: OperationSpec = {
        name: `models.${action}`, component: 'models', version: '1',
        label: { zh: ({ load: '加载模型', unload: '卸载模型', status: '查看模型状态' })[action],
          en: ({ load: 'Load model', unload: 'Unload model', status: 'Inspect model state' })[action] },
        description: action === 'load' ? 'Load an installed model into GPU memory without generating. Never downloads weights.'
          : action === 'unload' ? 'Release a model from GPU memory, keeping downloaded files and compatible shared components.'
            : 'Inspect whether a model is installed, loaded, loading, or busy with generation.',
        params: {
          modality: { type: 'string', required: true, description: 'The modality from dv_models_list.' },
          task: { type: 'string', required: true, description: 'The task from dv_models_list.' },
          provider: { type: 'string', required: true, description: 'The provider from dv_models_list.' },
          model: { type: 'string', required: true, description: 'The model from dv_models_list.' },
        },
        inputs: {}, outputs: [], deterministic: false, resource: action === 'status' ? 'none' : 'gpu',
        ...action === 'status' ? { readOnly: true } : {},
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
