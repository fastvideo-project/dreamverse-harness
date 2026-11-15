/**
 * The browser twin of `defineGeneration`: one `defineGenerationUi` call per generation primitive defines the UI plugin
 * that registers the primitive's node type, its `dv.canvas.card` and `dv.canvas.editor` entries, the 重试 action of a
 * node whose shown version failed, the chat card of each operation's agent tool, the History row of each operation, and
 * the composer's parameter bar of each operation. The host's node list holds every version of a node; the kit supplies
 * the title, the media, the copy and the rerun UI.
 *
 * @module @dv/ui-generation/generation-kit
 */
import type { CSSProperties, ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type { NodeAction, NodeInput, NodeType, NodeView, TypeEntry } from '@dv/ui-canvas/contract'
import type { HistoryRow, Text } from '@dv/ui-history/contract'
import { DvClient } from '@dv/ui-kit/api.ts'
import { CARD_SURFACE, mediaSizing, WIDE_RATIO } from '@dv/ui-kit/frame.ts'
import { pickText } from '@dv/ui-kit/locale.ts'
import { requestInputsOf } from '@dv/ui-kit/references.ts'
import type { UiPlugin } from '@dv/ui-kit/registries.ts'
import { toolNameOf } from '@dv/ui-kit/tool-labels.ts'
import type { Asset, ProjectRecord, WireState } from '@dv/ui-kit/types.ts'
import type { ParamBar, PromptCopy } from '@dv/ui-composer/contract'
import type { MediaAsset } from '@dv/ui-media/contract'
import { GenerationCard } from './GenerationCard.tsx'
import type { GenerationCardInjected, StatusWords } from './GenerationCard.tsx'
import { labelSources } from './loaded.ts'
import { TakeEditor } from './TakeEditor.tsx'
import type { TakeEditorInjected } from './TakeEditor.tsx'

export type { StatusWords } from './GenerationCard.tsx'

/** The declaration of one generation primitive's UI. */
export interface GenerationUiSpec {
  /** The registering package. */
  id: string
  /** The node type key, such as 'audio': the kind that the host primitive's `node` declares. */
  type: string
  /** The generation operations of the kind, for the chat cards, the History rows and the parameter bars. */
  operations: readonly string[]
  /** The type label, such as ['音频', 'Audio']: the editor header and the accessible names. */
  label: Text
  /** A slot of the theme's node palette, such as `var(--dv-node-3)`. */
  color: string
  /**
   * The frame aspect ratio (width ÷ height) of a node whose shown asset has an unknown width or height, such as an audio
   * node; default 16:9. A node whose shown asset has a known size gets the frame at that asset's aspect ratio.
   */
  fallbackRatio?: number
  status: StatusWords
  /** The History subject of a record; default none. */
  subject?(record: ProjectRecord): Text | null
  /**
   * The parameter bar of the kind's take editors: the `placeholder` and `send` words, which the neutral words of the
   * composer replace when absent, the chips of a call under a model's schema, and the `@` filter of a model. The kit
   * registers it for each operation, owned by `id`, with `status.running` as the words while a send runs.
   */
  bar?: GenerationBar
  /**
   * The output that stands for a take in small views (the frame of its anchor's grid, its History thumbnail) and that the
   * players of its editor and its chat card show before they play, when it is not the first output; read from the
   * take's outputs, in output order.
   */
  preview?(outputs: readonly MediaAsset[]): string | undefined
}

/** The parameter bar that a generation kind declares; the kit adds the operation, the owner and the running words. */
export interface GenerationBar extends Pick<ParamBar, 'chips' | 'hidden' | 'candidates'> {
  readonly copy?: Pick<PromptCopy, 'placeholder' | 'send'>
}

const outputsIn = (record: ProjectRecord, state: WireState): Asset[] =>
  record.outputs.flatMap(id => state.assets.find(asset => asset.id === id) ?? [])

const frame: CSSProperties = { display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }

/**
 * The card body of a take: its shown asset (its preview, else its first output) through `dv.media`, filling the frame
 * the canvas sizes. A picture of known size fills the frame bare; any other asset, such as an audio waveform, and a take
 * without outputs sit on the card surface.
 * @param props - the node, its assets, and the Factory renderer.
 * @returns the element.
 */
function TakeCard({ node, assets, renderFactorySlot }: PropsRuntime<'dv.canvas.card'> & PropsRenderFactories): ReactNode {
  const shown = assets[node.preview ?? node.assets[0] ?? '']
  const bare = shown !== undefined && shown.width !== null && shown.height !== null
  return (
    <div style={{ ...bare ? {} : CARD_SURFACE, ...frame }}>
      {shown === undefined ? null : renderFactorySlot('dv.media', { asset: shown, purpose: 'card' })}
    </div>
  )
}

/**
 * Define the UI plugin of one generation primitive.
 * @param spec - the primitive's UI declaration.
 * @returns what Cordis loads.
 */
export function defineGenerationUi(spec: GenerationUiSpec): UiPlugin {
  const operations = new Set(spec.operations)
  const fallbackRatio = spec.fallbackRatio ?? WIDE_RATIO
  // The title is the operation label, the same for every version of the node.
  const titleOf = ({ record, operations: declared, language }: NodeInput): string =>
    declared.find(operation => operation.name === record.operation)?.label?.[language] ?? record.operation
  const entry = (input: NodeInput): TypeEntry => {
    const { record, state } = input
    const timed = record.outputs.map(id => state.assets.find(asset => asset.id === id)?.duration_sec ?? null)
      .find(seconds => seconds !== null)
    const preview = spec.preview?.(outputsIn(record, state))
    const shown = state.assets.find(asset => asset.id === (preview ?? record.outputs[0]))
    return {
      title: titleOf(input), sizing: mediaSizing(shown, fallbackRatio, 0),
      ...timed === undefined ? {} : { meta: `${timed.toFixed(1)}s` }, ...preview === undefined ? {} : { preview },
    }
  }
  const nodeType: NodeType = {
    id: spec.id, type: spec.type, label: () => pickText(...spec.label), color: spec.color,
    status: { running: () => pickText(...spec.status.running), failed: () => pickText(...spec.status.failed) },
    entry,
  }
  const retry: NodeAction = {
    id: `${spec.id}:${spec.type}:retry`,
    label: () => pickText('重试', 'Retry'),
    order: 0,
    shows: (node): node is NodeView => node.flags.failed && operations.has(node.record.operation),
    run({ record, title }, host) {
      host.rerun({
        operation: record.operation, inputs: requestInputsOf(record),
        params: record.params, intent: pickText(`在画布上重试 ${title}`, `Retry ${title} from the canvas`), based_on: record.id,
      })
    },
  }
  const bars: ParamBar[] = spec.operations.map(operation => ({
    ...spec.bar, operation, owner: spec.id, copy: { ...spec.bar?.copy, sending: spec.status.running },
  }))
  const rows: HistoryRow[] = spec.operations.map(match => ({
    match,
    subject: record => spec.subject?.(record) ?? null,
    media: { thumbnail: (record, state) => spec.preview?.(outputsIn(record, state)) ?? record.outputs[0] ?? null },
  }))
  return {
    inject: [],
    apply: (ctx) => {
      const labels = labelSources(new DvClient())
      const editor: TakeEditorInjected = { hooks: { taskLabels: labels.hooks.taskLabels } }
      // The canvas parts of the kind share one scope with the node type first, so a refused type leaves none of them.
      ctx.inject(['dvCanvas', 'slots'], (scope) => {
        scope.effect(() => scope.dvCanvas.nodeTypes.register(nodeType), `${spec.id}: node type`)
        scope.effect(() => scope.dvCanvas.actions.register(retry), `${spec.id}: retry`)
        scope.effect(() => scope.slots.inject('dv.canvas.card', () => scope.slots.register(
          { name: 'dv.canvas.card', key: spec.type }, TakeCard,
        )), `${spec.id}: card`)
        scope.effect(() => scope.slots.inject('dv.canvas.editor', () => scope.slots.register(
          { name: 'dv.canvas.editor', key: spec.type, inject: () => editor }, TakeEditor,
        )), `${spec.id}: editor`)
      })
      // Chat cards and History rows are keyed by tool and operation, so they register while the canvas is not loaded.
      ctx.inject(['slots'], (scope) => {
        for (const operation of spec.operations) {
          const card: GenerationCardInjected = { ...labels, operation, status: spec.status, preview: outputs => spec.preview?.(outputs) }
          scope.effect(() => scope.slots.inject('tool.call.toolview', () => scope.slots.register(
            { name: 'tool.call.toolview', key: toolNameOf(operation), inject: () => card }, GenerationCard,
          )), `${spec.id}: chat card of ${operation}`)
        }
      })
      // Each operation's bar gives its take editor the kind's words and chips while the composer is loaded.
      ctx.inject(['dvComposer'], (scope) => {
        for (const bar of bars) {
          scope.effect(() => scope.dvComposer.paramBars.register(bar), `${spec.id}: parameter bar of ${bar.operation}`)
        }
      })
      ctx.inject(['dvHistory'], (history) => {
        for (const row of rows) history.effect(() => history.dvHistory.rows.register(row), `${spec.id}: history row of ${row.match}`)
      })
    },
  }
}
