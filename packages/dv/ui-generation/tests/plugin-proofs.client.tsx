/**
 * The checks that a generation UI plugin, one `defineGenerationUi` declaration, meets the canvas node SDK: it loads
 * before ui-canvas, each take draws once through the kit, its chat card renders in a chat session, its slot owner props
 * and injected values are JSON data or callbacks, and unloading it removes every registration. Each plugin's own spec
 * runs them with its operation and output media.
 */
import { expect, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { FeatureHandle } from '@deepseek-ai/dsh-client-test-runtime'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { assetUrl } from '@dv/ui-kit/api.ts'
import type { UiPlugin } from '@dv/ui-kit/registries.ts'
import type { WireOperation } from '@dv/ui-kit/types.ts'
import { asset, canvasNode, OPERATIONS, record, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { ALL_KINDS, mountCanvas } from '../../ui-canvas/tests/canvas-runtime.client.tsx'
import { apply as historyApply, inject as historyInject } from '../../ui-history/src/client/index.ts'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import type { Kind, MountedCanvas } from '../../ui-canvas/tests/canvas-runtime.client.tsx'

/** One generation primitive under test: its operation's declaration and one output of each record. */
export interface Primitive {
  /** The declaration that `GET /api/dv/operations` serves for the operation. */
  operation: WireOperation
  /** The node type key of the plugin, such as 'image'. */
  type: string
  /** The output asset of a done record: its ID and MIME type. */
  output: { id: string; mime: string; durationSec?: number }
}

/**
 * A declaration of a generation operation for a test.
 * @param name - the operation name, such as 'image.generate'.
 * @param type - its output type.
 * @param label - its wire label.
 * @returns the declaration.
 */
export function generationOperation(name: string, type: string, label: { zh: string; en: string }): WireOperation {
  return {
    name, version: '1', description: '', label, deterministic: false, resource: 'gpu',
    inputs: { reference: { type: 'image', description: 'references', many: true, versioned: true } },
    params: { prompt: { type: 'string', required: true, description: 'What to make.' }, seed: { type: 'integer', description: 'Seed.' } },
    outputs: [{ role: type, type }],
  }
}

/**
 * Add to the fixture state a done record `p1d` of the primitive with its output, and a running record `p1r` with none,
 * each the one version of a node of the primitive's kind.
 * @param primitive - the primitive.
 * @param params - the params of both records.
 * @returns the state edit.
 */
export function withRecords(primitive: Primitive, params: Record<string, unknown> = { prompt: 'a red umbrella', task: 't2i', model: 'm1' }) {
  return (state: FixtureState): void => {
    const { id, mime, durationSec } = primitive.output
    state.components.proj.records.push(
      record({ id: 'p1d', operation: primitive.operation.name, deterministic: false, params, outputs: [id] }),
      record({ id: 'p1r', operation: primitive.operation.name, deterministic: false, params, status: 'running' }),
    )
    state.components.proj.created_by[id] = 'p1d'
    state.assets.push(asset(id, mime, 'p1d', durationSec ?? null, primitive.operation.name))
    for (const [node, y] of [['p1d', 600], ['p1r', 800]] as const) {
      state.components.canvas.nodes[node] = canvasNode(primitive.type, [node], 0, y)
      state.components.canvas.order.push(node)
    }
    state.components.canvas.assets[id] = 'p1d'
  }
}

/**
 * Mount the canvas over the fixture project with the primitive's records, the History plugin, and the plugin before
 * ui-canvas.
 * @param plugin - the plugin, as its `src/client/index.ts` exports it.
 * @param primitive - the primitive.
 * @param declared - whether `GET /api/dv/operations` serves the primitive's declaration.
 * @param kinds - the kind plugins that the canvas test runtime mounts beside the plugin; a check of one of those plugins
 *   leaves it out, so it mounts once.
 * @returns the mounted canvas and the plugin's handle.
 */
export async function mountPrimitive(
  plugin: UiPlugin, primitive: Primitive, declared = true, kinds: readonly Kind[] = ALL_KINDS,
): Promise<MountedCanvas & { plugin: FeatureHandle }> {
  let mounted: FeatureHandle | undefined
  const canvas = await mountCanvas({
    kinds,
    edit: withRecords(primitive),
    operations: declared ? [...OPERATIONS, primitive.operation] : OPERATIONS,
    beforeCanvas: async (runtime) => {
      // The server also answers the output's media file, which a media view such as the audio waveform downloads.
      const served = globalThis.fetch
      vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => input === assetUrl(primitive.output.id)
        ? Promise.resolve(new Response(new ArrayBuffer(8)))
        : served(input, init))
      mounted = await runtime.mount({ inject: [...plugin.inject], apply: plugin.apply })
    },
  })
  if (mounted === undefined) throw new Error('the plugin did not mount')
  const handle = mounted
  await canvas.runtime.mount({ inject: [...historyInject], apply: historyApply })
  return { ...canvas, plugin: handle }
}

/**
 * Render the chat card of one settled call of the primitive's tool in chat session `s1`, in a runtime with the real
 * media plugins and the plugin, under DSH's session-scoped `tool.call.toolview` slot.
 * @param plugin - the plugin.
 * @param toolName - the tool, such as 'dv_image_generate'.
 * @param output - the call's output asset.
 * @returns the runtime and the rendered card.
 */
export async function renderSettledCall(plugin: UiPlugin, toolName: string, output: Primitive['output']) {
  vi.stubGlobal('fetch', scriptedFetch().fetch)
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('sidebarRightTabs', { register: () => () => undefined } as never)
  await runtime.declare({
    'tool.call.toolview': { kind: 'keyed', scope: 'session', inject: { hooks: { toolCallArgumentsPartial: () => () => '' } } },
  })
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  await runtime.mount({ inject: [...plugin.inject], apply: plugin.apply })
  const reference = runtime.sessions.retain(await runtime.sessions.add({ id: 's1' }))
  const block: ToolResultNode = {
    kind: 'tool-result', seq: 2, time: 0, callId: 'call-1', call: { name: toolName, argsRaw: '{"prompt":"a red umbrella"}' }, callTime: 0,
    content: [], isError: false, meta: { outputs: [{ role: 'output', asset_id: output.id, mime: output.mime }] }, subCalls: [],
  }
  const card = runtime.renderSlot('tool.call.toolview', {
    useDisclosure: () => ({ expanded: false, setExpanded: () => undefined, toggle: () => undefined }), callId: 'call-1', toolName,
    openFile: () => undefined, loadImage: () => Promise.resolve(''), phase: 'result', block,
  }, { session: reference, entryKey: toolName, hookContext: { callId: 'call-1', assistant: undefined } })
  return { runtime, card, release: () => { reference[Symbol.dispose]() } }
}

/**
 * The paths inside a value that are neither JSON data nor a function: class instances, DOM nodes, symbols, and other
 * non-plain objects. The inject `hooks` compartment may hold bare observable sources, so the walk skips it.
 * @param value - an owner prop object or an injected value.
 * @param path - the path of `value` in its root.
 * @returns the offending paths.
 */
export function notJsonOrCallback(value: unknown, path = '$'): string[] {
  if (value === null || ['string', 'number', 'boolean', 'undefined', 'function'].includes(typeof value)) return []
  if (Array.isArray(value)) return value.flatMap((item, index) => notJsonOrCallback(item, `${path}[${String(index)}]`))
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return [path]
  return Object.entries(value).flatMap(([key, item]) => key === 'hooks' ? [] : notJsonOrCallback(item, `${path}.${key}`))
}

/**
 * Wait until the canvas draws exactly one node of the record, of the plugin's type.
 * @param canvas - the mounted canvas.
 * @param id - the record ID.
 * @param type - the plugin's node type key.
 * @returns the node's element.
 */
export async function onlyNodeOf(canvas: MountedCanvas, id: string, type: string): Promise<HTMLElement> {
  const element = await waitFor(() => canvas.node(id))
  expect(canvas.view.container.querySelectorAll(`[data-node-id="${id}"]`)).toHaveLength(1)
  expect(element.getAttribute('data-node-type')).toBe(type)
  return element
}
