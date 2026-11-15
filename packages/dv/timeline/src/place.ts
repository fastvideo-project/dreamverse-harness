/**
 * The canvas half of the Timeline component: `timeline.place`, which puts one timeline on the project's canvas as a
 * node of kind `timeline`. The component registers the operation and its node maker inside
 * `ctx.inject(['dvCanvasNodes'], …)`, so both exist only while `@dv/canvas` is loaded.
 *
 * @module @dv/timeline/place
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { NodeMaker } from '@dv/canvas'
import { ProjectError, type OperationResult, type OperationSpec, type ProjectState } from '@dv/project'
import type { TimelineId } from './types.ts'

/** The operation that puts a timeline on the canvas. */
export const PLACE = 'timeline.place'

/** The node type key of a placed timeline, shared with the browser's node type of `@dv/ui-timeline`. */
export const TIMELINE_NODE_KIND = 'timeline'

/**
 * The node maker of `timeline.place`: each finished record makes one `timeline` node in layout column 3, right of the
 * renders in column 2, clear of the 640 × 390 frame that the browser's node type draws by default.
 */
export const TIMELINE_NODE_MAKER: NodeMaker = {
  operations: [PLACE], kind: TIMELINE_NODE_KIND, column: 3, size: { width: 640, height: 390 }, makes: record => record.status === 'done',
}

/**
 * The canvas node that shows a timeline: a `timeline` node whose first record names the timeline in its `timeline`
 * param.
 * @param state - the project state, with the `canvas` slice.
 * @param timeline - the timeline.
 * @returns the node ID, or null when no node shows the timeline.
 */
export function timelineNode(state: ProjectState, timeline: TimelineId): string | null {
  const records = new Map(state.components.proj.records.map(record => [record.id, record]))
  const canvas = state.components.canvas
  const found = canvas.order.find((id) => {
    const node = canvas.nodes[id]
    const first = node?.versions[0]
    return node?.kind === TIMELINE_NODE_KIND && first !== undefined && records.get(first)?.params['timeline'] === timeline
  })
  return found ?? null
}

/**
 * `timeline.place`: put an existing timeline on the canvas. The precondition refuses, before any record, a timeline
 * that does not exist and a timeline that a canvas node already shows.
 * @returns the operation.
 */
export function placeOperation(): OperationSpec {
  return {
    name: PLACE,
    component: 'timeline',
    version: '1',
    label: { zh: '把时间线放到画布上', en: 'Place timeline on canvas' },
    description: 'Put a timeline on the canvas as one node. The node shows the timeline\'s picture and tracks in small, '
      + 'with a line from each node whose output the timeline plays; selecting the node outlines those nodes. A timeline '
      + 'goes on the canvas once, and its node stays until dv_canvas_node_remove takes it off. Works whether or not the '
      + 'user has a canvas open. The change is a step of the project history, so dv_proj_undo reverts it.',
    params: {
      timeline: { type: 'string', required: true, description: 'The timeline, such as t1 (see `timelines` in dv_proj_state).' },
    },
    inputs: {},
    outputs: [],
    deterministic: false,
    resource: 'none',
    summarize: record => `${String(record.params['timeline'])} placed on the canvas`,
    precondition: (request, state): Promise<void> => {
      const id = brandString<TimelineId>(String(request.params['timeline']))
      if (!state.components.timeline.timelines.some(timeline => timeline.id === id)) {
        throw new ProjectError('invalid_params', `Timeline ${id} does not exist.`)
      }
      const shown = timelineNode(state, id)
      if (shown !== null) throw new ProjectError('invalid_params', `Timeline ${id} is already on the canvas as node ${shown}.`)
      return Promise.resolve()
    },
    execute: (): Promise<OperationResult> => Promise.resolve({ outputs: [] }),
  }
}
