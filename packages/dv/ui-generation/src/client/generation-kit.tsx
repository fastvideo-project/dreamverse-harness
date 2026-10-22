/**
 * The browser twin of `defineGeneration`: one `defineGenerationUi` call per generation primitive defines the UI plugin
 * that registers the primitive's claimed node type, its `dv.canvas.card` and `dv.canvas.editor.claimed` entries, the
 * 重试 action of its failed takes, the chat card of each operation's agent tool, and the History row of each operation.
 * The canvas computes the takes' lineage; the kit supplies the title, the media, the copy and the rerun UI.
 *
 * @module @dv/ui-generation/generation-kit
 */
import type { CSSProperties, ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ClaimedEntry, ClaimedNodeView, ClaimedRecord, NodeAction, NodeInput, NodeType } from '@dv/ui-canvas/contract'
import type { HistoryRow } from '@dv/ui-history/contract'
import { DvClient } from '@dv/ui-kit/api.ts'
import { pickText } from '@dv/ui-kit/locale.ts'
import { formatInputRef } from '@dv/ui-kit/references.ts'
import type { UiPlugin } from '@dv/ui-kit/registries.ts'
import { toolNameOf } from '@dv/ui-kit/tool-labels.ts'
import type { Asset, ProjectRecord, WireState } from '@dv/ui-kit/types.ts'
import type { MediaAsset } from '@dv/ui-media/contract'
import { GenerationCard } from './GenerationCard.tsx'
import type { GenerationCardInjected, StatusWords } from './GenerationCard.tsx'
import { labelSources } from './loaded.ts'
import { TakeEditor } from './TakeEditor.tsx'
import type { TakeEditorInjected } from './TakeEditor.tsx'

export type { StatusWords } from './GenerationCard.tsx'

/** A pair of interface texts, Chinese then English. */
export type Text = readonly [zh: string, en: string]

/** The declaration of one generation primitive's UI. */
export interface GenerationUiSpec {
  /** The registering package. */
  id: string
  /** The node type key, such as 'audio'. */
  type: string
  /** The generation operations whose records are this kind's takes. */
  operations: readonly string[]
  /** The type label, such as ['音频', 'Audio']: the editor header and the accessible names. */
  label: Text
  /** A theme color, such as `var(--dv-kind-take)`. */
  color: string
  /** Default 2, the column of takes. */
  column?: number
  deepenOn?: readonly string[]
  /** Default 117, the 16:9 frame at the 208 card width. */
  bodyHeight?: number
  status: StatusWords
  /** Whether the take editor offers reference chips for a take, when its operation declares a `reference` input; default yes. */
  references?(record: ProjectRecord): boolean
  /** The History subject of a record; default none. */
  subject?(record: ProjectRecord): Text | null
  /**
   * The output that stands for a take in small views (the frame of its anchor's grid, its History thumbnail) and that the
   * players of its editor and its chat card show before they play, when it is not the first output; read from the
   * take's outputs, in output order.
   */
  preview?(outputs: readonly MediaAsset[]): string | undefined
}

/**
 * @param record - a record.
 * @param state - the project state.
 * @returns the output assets of the record that the state holds, in output order.
 */
const outputsIn = (record: ProjectRecord, state: WireState): Asset[] =>
  record.outputs.flatMap(id => state.assets.find(asset => asset.id === id) ?? [])

/** The take frame's height at the 208 card width. */
const FRAME_HEIGHT = 117

const frame: CSSProperties = { display: 'flex', width: '100%', overflow: 'hidden', background: 'var(--dv-surface-3)' }

/**
 * The card body of a take: its preview, else its first output, through `dv.media` at purpose 'card', in a frame of the
 * type's body height (the 16:9 frame by default). A pending take has no output yet and shows the empty frame under the
 * canvas's status words.
 * @param props - the node, its assets, and the Factory renderer.
 * @returns the element.
 */
function TakeCard({ node, assets, renderFactorySlot }: PropsRuntime<'dv.canvas.card'> & PropsRenderFactories): ReactNode {
  const shown = assets[node.preview ?? node.assets[0] ?? '']
  return <div style={{ ...frame, height: node.bodyHeight }}>{shown === undefined ? null : renderFactorySlot('dv.media', { asset: shown, purpose: 'card' })}</div>
}

/**
 * Define the UI plugin of one generation primitive.
 * @param spec - the primitive's UI declaration.
 * @returns what Cordis loads.
 */
export function defineGenerationUi(spec: GenerationUiSpec): UiPlugin {
  const operations = new Set(spec.operations)
  const bodyHeight = spec.bodyHeight ?? FRAME_HEIGHT
  /** The take's title: its chain's slot and lane, else its operation's label; with its number in a group of several. */
  const titleOf = ({ record, chain, version }: ClaimedRecord, input: NodeInput): string => {
    const pick = (zh: string, en: string): string => input.language === 'zh' ? zh : en
    const declared = input.operations.find(operation => operation.name === record.operation)?.label?.[input.language]
    const slot = chain?.slot ?? null
    const lane = chain?.lane === undefined ? '' : ` · ${chain.lane}`
    const base = slot === null ? declared ?? record.operation : pick(`镜头 ${String(slot)}${lane}`, `Shot ${String(slot)}${lane}`)
    return version === null ? base : pick(`${base} · 第 ${String(version)} 次`, `${base} · take ${String(version)}`)
  }
  const entry = (claimed: ClaimedRecord, input: NodeInput): ClaimedEntry => {
    const timed = claimed.record.outputs.map(id => input.state.assets.find(asset => asset.id === id)?.duration_sec ?? null)
      .find(seconds => seconds !== null)
    const preview = spec.preview?.(outputsIn(claimed.record, input.state))
    return {
      title: titleOf(claimed, input), bodyHeight,
      ...timed === undefined ? {} : { meta: `${timed.toFixed(1)}s` }, ...preview === undefined ? {} : { preview },
    }
  }
  const nodeType: NodeType = {
    id: spec.id, type: spec.type, label: () => pickText(...spec.label), color: spec.color, column: spec.column ?? 2,
    ...spec.deepenOn === undefined ? {} : { deepenOn: spec.deepenOn },
    claimed: {
      operations: spec.operations,
      status: { running: () => pickText(...spec.status.running), failed: () => pickText(...spec.status.failed) },
      entry,
    },
  }
  const retry: NodeAction<ClaimedNodeView> = {
    id: `${spec.id}:${spec.type}:retry`,
    label: () => pickText('重试', 'Retry'),
    order: 0,
    shows: (node): node is ClaimedNodeView => node.claimed && node.flags.failed && operations.has(node.record.operation),
    run({ record, title }, host) {
      // The request is the record's own operation, inputs and params, as 渲染新版本 sends it when nothing was edited.
      host.rerun({
        operation: record.operation, inputs: record.inputs.map(input => ({ role: input.role, ref: formatInputRef(input.ref) })),
        params: record.params, intent: pickText(`在画布上重试 ${title}`, `Retry ${title} from the canvas`), based_on: record.id,
      })
    },
  }
  const rows: HistoryRow[] = spec.operations.map(match => ({
    match,
    subject: record => spec.subject?.(record) ?? null,
    media: { thumbnail: (record, state) => spec.preview?.(outputsIn(record, state)) ?? record.outputs[0] ?? null },
  }))
  return {
    inject: [],
    apply: (ctx) => {
      const labels = labelSources(new DvClient())
      const editor: TakeEditorInjected = {
        hooks: { taskLabels: labels.hooks.taskLabels }, status: spec.status, references: record => spec.references?.(record) ?? true,
      }
      // The node type registers first in the one scope of the kind, so a refused type leaves nothing of the kind behind.
      ctx.inject(['dvCanvas', 'slots'], (scope) => {
        scope.effect(() => scope.dvCanvas.nodeTypes.register(nodeType), `${spec.id}: node type`)
        scope.effect(() => scope.dvCanvas.actions.register(retry), `${spec.id}: retry`)
        scope.effect(() => scope.slots.inject('dv.canvas.card', () => scope.slots.register(
          { name: 'dv.canvas.card', key: spec.type }, TakeCard,
        )), `${spec.id}: card`)
        scope.effect(() => scope.slots.inject('dv.canvas.editor.claimed', () => scope.slots.register(
          { name: 'dv.canvas.editor.claimed', key: spec.type, inject: () => editor }, TakeEditor,
        )), `${spec.id}: editor`)
        for (const operation of spec.operations) {
          const card: GenerationCardInjected = { ...labels, operation, status: spec.status, preview: outputs => spec.preview?.(outputs) }
          scope.effect(() => scope.slots.inject('tool.call.toolview', () => scope.slots.register(
            { name: 'tool.call.toolview', key: toolNameOf(operation), inject: () => card }, GenerationCard,
          )), `${spec.id}: chat card of ${operation}`)
        }
        scope.inject(['dvHistory'], (history) => {
          for (const row of rows) history.effect(() => history.dvHistory.rows.register(row), `${spec.id}: history row of ${row.match}`)
        })
      })
    },
  }
}
