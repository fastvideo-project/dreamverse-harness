/**
 * The Canvas component of DreamVerse as the `dvCanvasNodes` Cordis service: the node list of a project. The `canvas`
 * slice holds every node with its kind, name, versions and position, and the reducer rebuilds it from the records up to
 * the current position, so undo, redo and History cover every change to a node. The service owns three operations:
 * `canvas.node_position`, which moves or resizes one node, `canvas.node_remove`, which takes nodes off the canvas, and
 * `canvas.node_rename`, which names one node; `dvProject` turns them into the agent tools `dv_canvas_node_position`,
 * `dv_canvas_node_remove` and `dv_canvas_node_rename`, which work whether or not a canvas is open.
 *
 * A producer names its operations through the service, inside `ctx.inject(['dvCanvasNodes'], …)`, so it loads without
 * this package: `registerMaker` for the operations whose records make nodes, `registerPlacement` for the operation that
 * puts assets on the canvas. The component names no operation of another component.
 *
 * @module @dv/canvas
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import z from '@deepseek-ai/schemastery'
import { ProjectError, toolNameOf, type OperationResult, type OperationSpec, type ProjectState } from '@dv/project'
import { canvasReducer, NAME_MAX, NODE_POSITION, NODE_REMOVE, NODE_RENAME, nodeName } from './reducer.ts'
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

/** The Canvas service: the component, the reducer, `canvas.node_position`, `canvas.node_remove`, and the producers' registrations. */
export default class DvCanvasNodes extends Service {
  static inject = ['dvProject']
  static Config = Config

  /** Operation → the maker that names it. */
  private readonly makers = new Map<string, NodeMaker>()
  /** Operation → the placement whose `place` it is. */
  private readonly placements = new Map<string, AssetPlacement>()

  constructor(ctx: Context, _config: Config) {
    super(ctx, 'dvCanvasNodes')
    const registered = {
      maker: (operation: string) => this.makers.get(operation),
      placement: (operation: string) => this.placements.get(operation),
      renameOperation: (kind: string) =>
        [...this.makers.values()].find(maker => maker.kind === kind && maker.renameOperation !== undefined)?.renameOperation,
    }
    ctx.effect(() => ctx.dvProject.registerComponent('canvas'), 'dvCanvasNodes component')
    ctx.effect(() => ctx.dvProject.registerReducer('canvas', canvasReducer(registered)), 'dvCanvasNodes reducer')
    ctx.effect(() => ctx.dvProject.registerOperation(positionOperation()), `dvCanvasNodes ${NODE_POSITION}`)
    ctx.effect(() => ctx.dvProject.registerOperation(removeOperation()), `dvCanvasNodes ${NODE_REMOVE}`)
    ctx.effect(() => ctx.dvProject.registerOperation(renameOperation(registered.renameOperation)), `dvCanvasNodes ${NODE_RENAME}`)
  }

  /**
   * Name operations whose records make nodes of one kind. One registration per operation: an operation that a maker or
   * a placement already names throws `invalid_params`.
   * @param maker - the operations, the kind, the column, the optional filter of records, and the optional operation
   *   that renames what the nodes show.
   * @returns a function that removes the registration.
   */
  registerMaker(maker: NodeMaker): () => void {
    return this.claim(maker.operations, maker, this.makers)
  }

  /**
   * Name the operation that puts assets on the canvas, with the kind and column of their nodes.
   * @param placement - the operation, the kind and the column.
   * @returns a function that removes the registration.
   */
  registerPlacement(placement: AssetPlacement): () => void {
    return this.claim([placement.place], placement, this.placements)
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
        throw new ProjectError('invalid_params', `The canvas has no node ${node}. Its nodes are: ${knownNodes(state)}.`)
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

/**
 * `canvas.node_remove`: take nodes off the canvas. It refuses a call that names no node or a node that the canvas does
 * not hold. The record's report keeps each removed node as it was, so a view can name a node that is gone.
 * @returns the operation.
 */
function removeOperation(): OperationSpec {
  return {
    name: NODE_REMOVE,
    component: 'canvas',
    version: '1',
    label: { zh: '从画布移除', en: 'Remove from canvas' },
    description: 'Remove nodes from the canvas. Each node goes with all its versions and the edges to and from it. Its '
      + 'assets stay in the asset pool, and every use of them stays: shot inputs, timeline clips, and nodes made from its '
      + 'outputs. A node that is still rendering can be removed; its output goes to the asset pool. A later step based on '
      + 'a version of a removed node makes a new node. Works whether or not the user has a canvas open. The removal is a '
      + 'step of the project history, so dv_proj_undo brings the nodes back with their versions and positions.',
    params: {
      nodes: {
        type: 'array', required: true, items: { type: 'string' },
        description: 'The node IDs to remove, as dv_proj_state or dv_canvas_read lists them.',
      },
    },
    inputs: {},
    outputs: [],
    deterministic: false,
    resource: 'none',
    summarize: record => `removed node ${(record.params['nodes'] as string[]).join(', ')} from the canvas`,
    precondition: (request, state): Promise<void> => {
      const nodes = request.params['nodes'] as string[]
      if (nodes.length === 0) throw new ProjectError('invalid_params', 'Name at least one node. Nothing was removed.')
      const missing = nodes.filter(node => state.components.canvas.nodes[brandString<NodeId>(node)] === undefined)
      if (missing.length > 0) {
        throw new ProjectError('invalid_params', `The canvas has no node ${missing.join(', ')}; its nodes are: ${knownNodes(state)}. Nothing was removed.`)
      }
      return Promise.resolve()
    },
    execute: ({ params, state }): Promise<OperationResult> => {
      const removed = Object.fromEntries((params['nodes'] as NodeId[]).map(node => [node, state.components.canvas.nodes[node]]))
      return Promise.resolve({ outputs: [], report: { removed } })
    },
  }
}

/**
 * @param state - a project state.
 * @returns the node IDs of the canvas, comma-separated, or `none`.
 */
function knownNodes(state: ProjectState): string {
  const known = state.components.canvas.order.join(', ')
  return known === '' ? 'none' : known
}

/**
 * `canvas.node_rename`: set the name that one node's card shows. It refuses an unknown node, a name longer than
 * {@link NAME_MAX} characters, the node's current name, and a name for a node whose kind takes none, before any record.
 * @param renamedBy - the operation that renames what the nodes of a kind show, or undefined for a kind that takes names.
 * @returns the operation.
 */
function renameOperation(renamedBy: (kind: string) => string | undefined): OperationSpec {
  return {
    name: NODE_RENAME,
    component: 'canvas',
    version: '1',
    label: { zh: '重命名节点', en: 'Rename node' },
    description: 'Rename one canvas node: the name replaces the title on its card, in dv_canvas_read and in dv_proj_state. '
      + `The name is trimmed, line breaks become spaces, and it has at most ${String(NAME_MAX)} characters; an empty or null `
      + 'name clears it, so the card shows the title its type computes again. The name is only the canvas label: the node '
      + 'keeps its id, versions, assets, files, text path and character, location or style name, and nothing becomes stale. '
      + 'A node that shows an item with a name of its own, such as a timeline, takes no name here: the call is refused and '
      + 'names the tool that renames the item. '
      + 'Names need not be unique. Works whether or not the user has a canvas open. The change is a step of the project '
      + 'history, so dv_proj_undo reverts it.',
    params: {
      node: { type: 'string', required: true, description: 'The node ID, as dv_proj_state or dv_canvas_read lists it.' },
      name: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true, description: 'The new name; empty or null clears it.' },
    },
    inputs: {},
    outputs: [],
    deterministic: false,
    resource: 'none',
    summarize: (record) => {
      const name = nodeName(record.params['name'])
      return `${name === null ? 'cleared the name of' : 'renamed'} node ${String(record.params['node'])}${name === null ? '' : ` to "${name}"`}`
    },
    precondition: (request, state): Promise<void> => {
      const id = brandString<NodeId>(String(request.params['node']))
      const node = state.components.canvas.nodes[id]
      if (node === undefined) throw new ProjectError('invalid_params', `The canvas has no node ${id}. Its nodes are: ${knownNodes(state)}.`)
      const name = nodeName(request.params['name'])
      const length = name?.length ?? 0
      if (length > NAME_MAX) {
        throw new ProjectError('invalid_params', `The name can have at most ${String(NAME_MAX)} characters; this one has ${String(length)}.`)
      }
      const owner = name === null ? undefined : renamedBy(node.kind)
      if (owner !== undefined) {
        throw new ProjectError('invalid_params', `Node ${id} shows the name of its ${node.kind}; rename the ${node.kind} with ${toolNameOf({ name: owner })}.`)
      }
      if (name === node.name) {
        throw new ProjectError('invalid_params', name === null ? 'The node has no name to clear.' : `The node is already named "${name}".`)
      }
      return Promise.resolve()
    },
    execute: (): Promise<OperationResult> => Promise.resolve({ outputs: [] }),
  }
}
