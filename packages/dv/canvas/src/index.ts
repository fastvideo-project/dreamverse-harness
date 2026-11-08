/**
 * The Canvas component of DreamVerse as the `dvCanvasNodes` Cordis service: the node list of a project. The `canvas`
 * slice holds every node with its kind, name, versions and position, and the reducer rebuilds it from the records up to
 * the current position, so undo, redo and History cover every change to a node. The service owns one operation,
 * `canvas.node_position`, which moves or resizes one node; `dvProject` turns it into the agent tool
 * `dv_canvas_node_position`, which works whether or not a canvas is open.
 *
 * A producer names its operations through the service, inside `ctx.inject(['dvCanvasNodes'], …)`, so it loads without
 * this package: `registerMaker` for the operations whose records make nodes, `registerPlacement` for the operations
 * that put assets on the canvas and take them off. The component names no operation of another component.
 *
 * @module @dv/canvas
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import z from '@deepseek-ai/schemastery'
import { ProjectError, type OperationResult, type OperationSpec } from '@dv/project'
import { canvasReducer, NODE_POSITION } from './reducer.ts'
import type { AssetPlacement, NodeId, NodeMaker } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Canvas component: the node list of a project, and the registrations of the operations that make nodes. */
    dvCanvasNodes: DvCanvasNodes
  }
}

/** `dvCanvasNodes` plugin configuration: the component has no deployment-varying values. */
export type Config = Record<string, unknown>

/** Loader validation. */
export const Config: z<Config> = z.object({})

const POSITION_FIELDS = ['x', 'y', 'width', 'height'] as const

/** The Canvas service: the component, the reducer, `canvas.node_position`, and the producers' registrations. */
export default class DvCanvasNodes extends Service {
  static inject = ['dvProject']
  static Config = Config

  /** Operation → the maker that names it. */
  private readonly makers = new Map<string, NodeMaker>()
  /** Operation → the placement whose `place` or `unplace` it is. */
  private readonly placements = new Map<string, AssetPlacement>()

  constructor(ctx: Context, _config: Config) {
    super(ctx, 'dvCanvasNodes')
    const registered = {
      maker: (operation: string) => this.makers.get(operation),
      placement: (operation: string) => this.placements.get(operation),
    }
    ctx.effect(() => ctx.dvProject.registerComponent('canvas'), 'dvCanvasNodes component')
    ctx.effect(() => ctx.dvProject.registerReducer('canvas', canvasReducer(registered)), 'dvCanvasNodes reducer')
    ctx.effect(() => ctx.dvProject.registerOperation(positionOperation()), `dvCanvasNodes ${NODE_POSITION}`)
  }

  /**
   * Name operations whose records make nodes of one kind. One registration per operation: an operation that a maker or
   * a placement already names throws `invalid_params`.
   * @param maker - the operations, the kind, the column, and the optional filter of records.
   * @returns a function that removes the registration.
   */
  registerMaker(maker: NodeMaker): () => void {
    return this.claim(maker.operations, maker, this.makers)
  }

  /**
   * Name the operations that put assets on the canvas and take them off, with the kind and column of their nodes.
   * @param placement - the two operations, the kind and the column.
   * @returns a function that removes the registration.
   */
  registerPlacement(placement: AssetPlacement): () => void {
    return this.claim([placement.place, placement.unplace], placement, this.placements)
  }

  /** Register one value under each operation, refusing an operation that any registration names. */
  private claim<T>(operations: readonly string[], value: T, into: Map<string, T>): () => void {
    const taken = operations.filter(operation => this.makers.has(operation) || this.placements.has(operation))
    if (taken.length > 0) throw new ProjectError('invalid_params', `The canvas already has a node registration for ${taken.join(', ')}.`)
    for (const operation of operations) into.set(operation, value)
    return () => {
      for (const operation of operations) if (into.get(operation) === value) into.delete(operation)
    }
  }
}

/**
 * `canvas.node_position`: move or resize one node. It refuses an unknown node and a call that gives no field, and
 * does not check overlap with other nodes, because only the browser knows the default size of a node's type.
 * @returns the operation.
 */
function positionOperation(): OperationSpec {
  return {
    name: NODE_POSITION,
    component: 'canvas',
    version: '1',
    label: { zh: '移动节点', en: 'Move node' },
    description: 'Move or resize one canvas node: give the new x and y of the top-left corner of the node (the top of its '
      + '20-unit caption), and the new width and height of its frame, which sits below the caption; canvas units, y grows '
      + 'downward. Fields you leave out keep their value. Works whether or not the user has a canvas open, and the user sees '
      + 'the change at once. The change is a step of the project history, so dv_proj_undo reverts it. dv_proj_state lists '
      + 'the nodes under canvas.',
    params: {
      node: { type: 'string', required: true, description: 'The node ID, as dv_proj_state or dv_canvas_read lists it.' },
      x: { type: 'number', description: 'The new left edge of the node.' },
      y: { type: 'number', description: 'The new top edge of the node.' },
      width: { type: 'number', description: 'The new frame width; more than 0.' },
      height: { type: 'number', description: 'The new frame height; more than 0.' },
    },
    inputs: {},
    outputs: [],
    deterministic: false,
    resource: 'none',
    summarize: (record) => {
      const resized = record.params['width'] !== undefined || record.params['height'] !== undefined
      return `${resized ? 'resized' : 'moved'} node ${String(record.params['node'])}`
    },
    precondition: (request, state): Promise<void> => {
      const node = brandString<NodeId>(String(request.params['node']))
      if (state.components.canvas.nodes[node] === undefined) {
        const known = state.components.canvas.order.join(', ')
        throw new ProjectError('invalid_params', `The canvas has no node ${node}. Its nodes are: ${known === '' ? 'none' : known}.`)
      }
      if (POSITION_FIELDS.every(field => request.params[field] === undefined)) {
        throw new ProjectError('invalid_params', 'Give at least one of x, y, width and height.')
      }
      for (const field of ['width', 'height'] as const) {
        const value = request.params[field]
        if (typeof value === 'number' && !(value > 0)) throw new ProjectError('invalid_params', `${field} must be more than 0.`)
      }
      return Promise.resolve()
    },
    execute: (): Promise<OperationResult> => Promise.resolve({ outputs: [] }),
  }
}
