// @vitest-environment jsdom
/**
 * What `@dv/ui-audio-generate` registers: its one `defineGenerationUi` declaration claims `audio.generate` as the
 * `audio` node type with its label, palette slot, body height and status words, and the entries keyed by that type, by
 * the tool `dv_audio_generate` and by the operation leave with the plugin.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { HistoryRow } from '@dv/ui-history/contract'
import { createRegistry } from '@dv/ui-kit/registries.ts'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import * as plugin from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.lang = ''
})

/**
 * Mount the plugin over the canvas and History registries, with the slots that it fills declared.
 * @returns the runtime, the registries, and the plugin's handle.
 */
async function mountPlugin() {
  document.documentElement.lang = 'zh-CN'
  // The kit's label sources read `/api/dv/operations` and `/api/dv/tasks`.
  vi.stubGlobal('fetch', scriptedFetch().fetch)
  const runtime = await SlotTestRuntime.create()
  const canvas = createDvCanvas()
  const rows = createRegistry<HistoryRow>(row => [row.match], row => row.match)
  runtime.ctx.provide('dvCanvas', canvas)
  runtime.ctx.provide('dvHistory', { rows })
  await runtime.declare({
    'dv.canvas.card': { kind: 'keyed', scope: 'root' },
    'dv.canvas.editor.claimed': { kind: 'keyed', scope: 'root' },
    'tool.call.toolview': { kind: 'keyed', scope: 'session', inject: { hooks: { toolCallArgumentsPartial: () => () => '' } } },
  })
  const handle = await runtime.mount({ inject: [...plugin.inject], apply: plugin.apply })
  return { runtime, canvas, rows, handle }
}

describe('@dv/ui-audio-generate', () => {
  it('exports only inject and apply, and keeps the host Loader entry inert', () => {
    expect(Object.keys(plugin).sort()).toEqual(['apply', 'inject'])
    expect(hostApply).not.toThrow()
  })

  it('claims audio.generate as the audio node type with its label, palette slot, body height and status words', async () => {
    const { runtime, canvas } = await mountPlugin()
    const type = canvas.nodeTypes.getSnapshot().find(entry => entry.id === '@dv/ui-audio-generate')
    const entry = type?.claimed?.entry({ record: { outputs: [] } as never, chain: null, version: null }, {
      state: { assets: [] } as never, operations: [], language: 'zh', placed: new Set(), records: [],
    })
    expect({
      type: type?.type, label: type?.label(), color: type?.color, operations: type?.claimed?.operations, bodyHeight: entry?.bodyHeight,
      running: type?.claimed?.status.running(), failed: type?.claimed?.status.failed(),
    }).toEqual({
      type: 'audio', label: '音频', color: 'var(--dv-node-8)', operations: ['audio.generate'], bodyHeight: 72,
      running: '生成中…', failed: '生成失败',
    })
    await runtime.dispose()
  })

  it('registers one action and the entries keyed by its type, its tool and its operation, which leave with the plugin', async () => {
    const { runtime, canvas, rows, handle } = await mountPlugin()
    const owned = () => ({
      types: canvas.nodeTypes.getSnapshot().length,
      actions: canvas.actions.getSnapshot().length,
      card: runtime.slots.entries('dv.canvas.card').map(entry => entry.options.key),
      editor: runtime.slots.entries('dv.canvas.editor.claimed').map(entry => entry.options.key),
      chat: runtime.slots.entries('tool.call.toolview').map(entry => entry.options.key),
      history: rows.getSnapshot().map(row => row.match),
    })
    expect(owned()).toEqual({ types: 1, actions: 1, card: ['audio'], editor: ['audio'], chat: ['dv_audio_generate'], history: ['audio.generate'] })
    await handle.dispose()
    expect(owned()).toEqual({ types: 0, actions: 0, card: [], editor: [], chat: [], history: [] })
    await runtime.dispose()
  })
})
