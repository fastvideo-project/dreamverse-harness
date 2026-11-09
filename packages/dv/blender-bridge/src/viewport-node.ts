/**
 * The Blender viewport node of the project canvas: the `blender.viewport` operation, whose finished record makes one
 * node of kind {@link VIEWPORT_KIND} in the canvas's node list. The node shows the live viewport of the connected
 * Blender whether or not a Blender is connected at the time; the canvas's own `canvas.node_remove` takes it off.
 *
 * @module @fastvideo/dreamverse-blender-bridge/viewport-node
 */
import type { NodeMaker } from '@dv/canvas'
import type { OperationSpec, ProjectState } from '@dv/project'

/** The operation that puts the viewport on the canvas. */
export const VIEWPORT_OPERATION = 'blender.viewport'

/** The node kind of the viewport node, shared with the browser's node type. */
export const VIEWPORT_KIND = 'blender-viewport'

/** The canvas registration through which a finished `blender.viewport` record makes the viewport node. */
export const viewportMaker: NodeMaker = {
  operations: [VIEWPORT_OPERATION],
  kind: VIEWPORT_KIND,
  column: 0,
  makes: record => record.status === 'done',
}

/** The node kind of render takes, shared with the browser's `blender` generation kind. */
export const RENDER_KIND = 'blender'

/**
 * The canvas registration through which each render record makes a take node; a running or failed render shows its
 * state on the node.
 * @param operations - the render operations.
 * @returns the registration.
 */
export function renderMaker(operations: readonly string[]): NodeMaker {
  return { operations, kind: RENDER_KIND, column: 2 }
}

function placed(state: ProjectState): boolean {
  return Object.values(state.components.canvas.nodes).some(node => node.kind === VIEWPORT_KIND)
}

/**
 * The `blender.viewport` operation. A call while the viewport is already on the canvas is refused, so the canvas holds
 * at most one viewport node.
 * @returns the operation spec.
 */
export function viewportOperation(): OperationSpec {
  return {
    name: VIEWPORT_OPERATION,
    component: 'blender',
    version: '2',
    label: { zh: 'Blender 视口节点', en: 'Blender viewport node' },
    description: 'Put the live viewport of the user\'s Blender on the project canvas as a node. The node shows what '
      + 'Blender\'s 3D viewport shows, and the user can open it to orbit, pan and zoom the view; it changes nothing in the '
      + 'scene. To take it off the canvas, remove its node with dv_canvas_node_remove.',
    params: {},
    inputs: {},
    outputs: [],
    deterministic: false,
    resource: 'none',
    summarize: () => 'put the Blender viewport on the canvas',
    precondition: (_request, state) => placed(state)
      ? Promise.reject(new Error('The Blender viewport is already on the canvas.'))
      : Promise.resolve(),
    execute: () => Promise.resolve({ outputs: [], report: {} }),
  }
}
