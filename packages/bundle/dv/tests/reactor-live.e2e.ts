/**
 * Opt-in paid smoke for one real FastH3-Omni shot through the DreamVerse profile. FastH3-Omni uses Reactor's Clip
 * Generation HTTP API, so the run needs the API key only and no Python interpreter or reactor-sdk.
 */
import { copyFile } from 'node:fs/promises'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { AssetId, OperationToolValue } from '@dv/project'
import { expect, it } from 'vitest'
import { bootBundle } from './bundle.ts'

const apiKey = process.env['REACTOR_API_KEY']
const run = process.env['DV_REACTOR_LIVE_TEST'] === '1' && Boolean(apiKey)

it.skipIf(!run)('imports a paid Reactor shot through dv_shot_render', { timeout: 185_000, retry: 0 }, async () => {
  const bundle = await bootBundle({}, undefined, {
    'dv-reactor': {
      disabled: false,
      config: {
        timeoutSeconds: 150,
        models: { 'fast-h3-omni': { profile: 'fast-h3-omni' } },
      },
    },
  })
  try {
    const { ctx, services } = bundle
    await ctx.credentials.set(credentialRef('REACTOR_API_KEY'), apiKey!)
    services.chats.open('anonymous', await ctx.dvProject.newProjectFolder('reactor-live'))
    const signal = AbortSignal.timeout(175_000)
    const call = async (name: string, args: Record<string, unknown>): Promise<OperationToolValue> => {
      const result = await ctx.tools.execute({ callId: ToolCallId(name), name, arguments: args, signal })
      if (result.isError) throw new Error(result.error.message)
      return result.value as OperationToolValue
    }
    await call('dv_proj_create', { title: 'Reactor smoke' })
    const result = await call('dv_shot_render', {
      modality: 'video', provider: 'reactor', model: 'fast-h3-omni', task: 't2v', duration_sec: 5.875,
      prompt: 'A clear glass of sparkling water on a sunlit table. Static close-up. Tiny bubbles rise. Quiet room tone.',
      reason: 'Verify Reactor video and audio import',
    })
    expect(result.status).toBe('done')
    const [video, still] = result.outputs.map(({ asset_id }) => ctx.dvAssetPool.get(asset_id as AssetId))
    expect(video?.mime).toBe('video/mp4')
    expect(still?.mime).toBe('image/png')
    const path = ctx.dvAssetPool.path(video!.id)
    expect(await ctx.dvFfmpeg.probe(path)).toMatchObject({ hasAudio: true, width: 1344, height: 768 })
    const output = process.env['DV_REACTOR_LIVE_OUTPUT']
    if (output !== undefined) await copyFile(path, output)
  } finally {
    await bundle.dispose()
  }
})
