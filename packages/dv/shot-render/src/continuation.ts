/** Extract a previous shot's tail as an ordinary video reference, retaining its audio when present. */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dv/asset-pool'
import type {} from '@dv/ffmpeg'
import type { RequestInput } from '@dv/generation'
import type { AssetId, OperationContext } from '@dv/project'

/**
 * Read the continuation source, refusing a second copy in ordinary references.
 * @param inputs - resolved or pending inputs of the render.
 * @returns the source asset, or null when absent or still pending.
 * @throws Error when the same video is also supplied in the reference role.
 */
export function continuationAsset(inputs: readonly RequestInput[]): AssetId | null {
  const source = inputs.find(input => input.role === 'continuation_video')?.resolved_asset ?? null
  if (source !== null && inputs.some(input => input.role === 'reference' && input.resolved_asset === source)) {
    throw new Error('The continuation video is also in inputs.reference. Remove it from inputs.reference; '
      + 'continue_video_from already supplies its tail.')
  }
  return source
}

/**
 * Prepare a continuation input after its producer finishes, without changing the recorded source dependency.
 * @param ctx - the shot-render context, with the asset pool and FFmpeg services.
 * @param run - the running render and its resolved inputs.
 * @returns inputs with the continuation source replaced by its cropped tail; other inputs stay unchanged.
 * @throws Error when the required services are absent, the source is not a video, or media preparation fails.
 */
export async function prepareContinuation(ctx: Context, run: OperationContext): Promise<readonly RequestInput[]> {
  const source = continuationAsset(run.inputs)
  if (source === null) return run.inputs
  const pool = ctx.get('dvAssetPool')
  const ffmpeg = ctx.get('dvFfmpeg')
  if (pool === undefined || ffmpeg === undefined) throw new Error('Video continuation needs dvAssetPool and dvFfmpeg.')
  if (pool.mediaType(source) !== 'video') throw new Error('continuation_video needs a video asset.')
  const path = pool.path(source)
  const probe = await ffmpeg.probe(path)
  const duration = probe.videoDurationSec ?? probe.durationSec
  if (duration === null || duration <= 0) throw new Error('Cannot determine the continuation video duration.')
  const seconds = Math.min((run.params['continuation_seconds'] as number | undefined) ?? 2, duration)
  run.signal.throwIfAborted()
  await ffmpeg.run({
    argv: ['ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}', '-ss', String(duration - seconds), '-t', String(seconds),
      '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', '{{out:continuation.mp4}}'],
    inputs: [path], outputs: ['continuation.mp4'], dir: run.scratchDir,
  })
  run.signal.throwIfAborted()
  const tailPath = join(run.scratchDir, 'continuation.mp4')
  const tail = await ffmpeg.probe(tailPath)
  const tailDuration = tail.videoDurationSec ?? tail.durationSec
  if (tailDuration === null || tail.width === null || tail.height === null) throw new Error('Cannot read extracted continuation video metadata.')
  const asset = run.importAsset({ path: tailPath }, {
    mime: 'video/mp4', name: 'continuation.mp4', durationSec: tailDuration,
    width: tail.width, height: tail.height,
  })
  return run.inputs.map(input => input.role === 'continuation_video' ? { ...input, resolved_asset: asset } : input)
}
