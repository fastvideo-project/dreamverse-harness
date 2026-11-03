/**
 * The canvas node type of assets, its card and editor bodies, and the 从画布移除 action. Each asset on the project's
 * canvas list gets one stand-in node, drawn from the first `asset.import` record of the current state that imported
 * it, else as `asset:<id>` with no record (an import that an undo went back past, a still, an export). A stand-in
 * shows only while no other node owns its asset.
 *
 * @module @dv/ui-asset-pool/canvas
 */
import type { CSSProperties, ReactNode } from 'react'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NodeAction, NodeEntry, NodeType, NodeView } from '@dv/ui-canvas/contract'
import { CARD_SURFACE, frameHeight, NODE_FRAME_HEIGHT } from '@dv/ui-kit/frame.ts'
import { pickText } from '@dv/ui-kit/locale.ts'
import { playerBox } from '@dv/ui-kit/player-box.ts'
import type { ProjectRecord } from '@dv/ui-kit/types.ts'
import type {} from '@dv/ui-media/contract'

const ID = '@dv/ui-asset-pool'

/** The asset node type. */
export const assetNodeType: NodeType = {
  id: ID,
  type: 'asset',
  label: () => pickText('素材', 'Asset'),
  color: 'var(--dv-node-6)',
  column: 0,
  entries({ state, placed }) {
    const assets = new Map(state.assets.map(asset => [asset.id, asset]))
    const entry = (id: string, record: ProjectRecord | null, assetId: string): NodeEntry => {
      const asset = assets.get(assetId)
      const seconds = asset?.duration_sec ?? null
      return {
        id, title: asset?.name ?? assetId, record, assets: [assetId], standIn: true,
        sizing: { heightAt: width => frameHeight(asset, NODE_FRAME_HEIGHT, width) },
        ...seconds === null ? {} : { meta: `${seconds.toFixed(1)}s` }, ...record === null ? { ref: { kind: 'asset', id: assetId } } : {},
      }
    }
    const imported = new Set<string>()
    const imports = state.components.proj.records.flatMap((record) => {
      const asset = record.operation === 'asset.import' ? record.outputs.find(id => placed.has(id) && !imported.has(id)) : undefined
      if (asset === undefined) return []
      imported.add(asset)
      return [entry(record.id, record, asset)]
    })
    return [...imports, ...[...placed].filter(id => !imported.has(id)).map(id => entry(`asset:${id}`, null, id))]
  },
}

const frame: CSSProperties = { display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }
const player: CSSProperties = { display: 'flex', borderRadius: 'var(--dv-radius-lg)', overflow: 'hidden', background: 'var(--dv-media-bg)' }

/**
 * The card body of an asset node: the asset through `dv.media`, filling the frame. An image or a video of known size
 * shows bare; any other asset, such as an audio waveform or a file card, and a missing asset sit on the card surface.
 * @param props - the node, its assets, and the Factory renderer.
 * @returns the element.
 */
export function AssetCard({ node, assets, renderFactorySlot }: PropsRuntime<'dv.canvas.card'> & PropsRenderFactories): ReactNode {
  const asset = node.assets.map(id => assets[id]).find(each => each !== undefined)
  const bare = asset !== undefined && asset.width !== null && asset.height !== null
  return <div style={{ ...bare ? {} : CARD_SURFACE, ...frame }}>{asset === undefined ? null : renderFactorySlot('dv.media', { asset, purpose: 'card' })}</div>
}

/**
 * The editor body of an asset node: the asset at purpose 'player'.
 * @param props - the node, the state, and the Factory renderer.
 * @returns the element.
 */
export function AssetEditor({ node, state, renderFactorySlot }: PropsRuntime<'dv.canvas.editor'> & PropsRenderFactories): ReactNode {
  const asset = state.assets.find(each => each.id === node.assets[0])
  return asset === undefined ? null : <div style={{ ...player, ...playerBox(asset, 360) }}>{renderFactorySlot('dv.media', { asset, purpose: 'player' })}</div>
}

/** 从画布移除 on an asset node: takes its asset off the project's canvas list; the asset stays in the pool. */
export const unplaceAction: NodeAction = {
  id: `${ID}:unplace`,
  label: () => pickText('从画布移除', 'Remove from canvas'),
  order: 20,
  shows: (node): node is NodeView => node.type === 'asset',
  run(node, host) {
    host.close()
    for (const asset of node.assets) host.setPlaced(asset, false)
  },
}
