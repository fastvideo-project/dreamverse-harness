/**
 * The Blender viewport node of the project canvas: the `blender` state slice, which says whether the live viewport of
 * the connected Blender is on the canvas, and the `blender.viewport` operation that puts it there or takes it off. The
 * node shows the viewport whether or not a Blender is connected at the time; the slice records only the placement.
 *
 * @module @fastvideo/dreamverse-blender-bridge/viewport-node
 */
import type { OperationSpec, ProjectState, Reducer } from '@dv/project'
import type {} from './types.ts'

/** The operation that puts the viewport on the canvas or takes it off. */
export const VIEWPORT_OPERATION = 'blender.viewport'

/**
 * The `blender` reducer: a finished `blender.viewport` record with `on: true` places the viewport, one with `on: false`
 * removes it; every other record leaves the slice unchanged.
 */
export const blenderReducer: Reducer<'blender'> = {
  initial: () => ({ viewport: null }),
  reduce(slice, record) {
    if (record.status !== 'done' || record.operation !== VIEWPORT_OPERATION) return slice
    return { viewport: record.params['on'] === true ? record.id : null }
  },
  agentSummary: slice => ({ blender_viewport_on_canvas: slice.viewport !== null }),
}

function placed(state: ProjectState): boolean {
  return state.components.blender.viewport !== null
}

/**
 * The `blender.viewport` operation. A call that would change nothing is refused, so every record changes the canvas.
 * @returns the operation spec.
 */
export function viewportOperation(): OperationSpec {
  return {
    name: VIEWPORT_OPERATION,
    component: 'blender',
    version: '1',
    label: { zh: 'Blender 视口节点', en: 'Blender viewport node' },
    description: 'Put the live viewport of the user\'s Blender on the project canvas as a node (on: true), or take it off '
      + '(on: false). The node shows what Blender\'s 3D viewport shows, and the user can open it to orbit, pan and zoom the '
      + 'view; it changes nothing in the scene.',
    params: {
      on: { type: 'boolean', required: true, description: 'true puts the viewport on the canvas; false takes it off.' },
    },
    inputs: {},
    outputs: [],
    deterministic: false,
    resource: 'none',
    summarize: record => record.params['on'] === true ? 'put the Blender viewport on the canvas' : 'took the Blender viewport off the canvas',
    precondition: (request, state) => {
      const on = request.params['on'] === true
      if (on && placed(state)) return Promise.reject(new Error('The Blender viewport is already on the canvas.'))
      if (!on && !placed(state)) return Promise.reject(new Error('The Blender viewport is not on the canvas.'))
      return Promise.resolve()
    },
    execute: run => Promise.resolve({ outputs: [], report: { on: run.params['on'] === true } }),
  }
}
