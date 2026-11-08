/**
 * Types of the Canvas component: the node list of a project's state slice, the registrations through which producers
 * name the operations that make nodes, and the slice declaration that adds `canvas` to the project state of
 * `@dv/project`.
 *
 * The slice fields use snake_case where they have more than one word, because the project state goes to the browser
 * views and the agent.
 *
 * @module @dv/canvas/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AssetId, RecordId, RecordStatus } from '@dv/project/types'

/**
 * The ID of a canvas node: the ID of the record that created the node. A record that places several assets creates one
 * node per asset; the second and later ones take the record ID with `.2`, `.3`, and so on.
 */
export type NodeId = Branded<'DvCanvasNodeId'>

/**
 * Where a node sits and how large its frame is, in canvas units with y growing downward: `x` and `y` are the top-left
 * corner of the node, the top of its caption; `width` and `height` are the frame below the caption, null for the
 * default size of the node's type in the browser.
 */
export interface NodePosition {
  x: number
  y: number
  width: number | null
  height: number | null
}

/** One node of the canvas: what the browser draws as one card. */
export interface CanvasNode {
  /** The node type key that the browser draws the node with, such as `shot` or `asset`. */
  kind: string
  /** The name the user gave the node; null shows the title that the node type computes. */
  name: string | null
  /** The records the node shows, oldest first; the card shows the newest. A failed record is a version too. */
  versions: RecordId[]
  /** The placed asset of a node that a placement made. */
  asset?: AssetId
  position: NodePosition
}

/** The Canvas component's slice. */
export interface CanvasState {
  nodes: Record<NodeId, CanvasNode>
  /** The node IDs in creation order. */
  order: NodeId[]
  /** The node that shows each asset: the placed asset of a placement node, and the outputs of each node's newest version. */
  assets: Record<AssetId, NodeId>
}

/**
 * Operations whose records make nodes of one kind: a record of one of them that is no version of an existing node
 * (rule 2 of the reducer) creates a node in the first free row of `column`.
 */
export interface NodeMaker {
  operations: readonly string[]
  /** The node type key of the nodes, shared with the browser's node type. */
  kind: string
  /** The layout column of new nodes, from 0 at the left. */
  column: number
  /** Whether a record of the operations makes a node; absent means every record does. */
  makes?(record: { params: Record<string, unknown>; status: RecordStatus }): boolean
}

/**
 * The operations that put assets on the canvas and take them off: a finished `place` record makes one node of `kind`
 * per input asset that no node shows yet, and a finished `unplace` record deletes the nodes of `kind` that show one of
 * its input assets.
 */
export interface AssetPlacement {
  place: string
  unplace: string
  kind: string
  column: number
}

declare module '@dv/project/types' {
  interface ComponentStates {
    /** The nodes of the canvas (Canvas). */
    canvas: CanvasState
  }
}
