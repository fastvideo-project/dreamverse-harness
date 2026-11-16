/** Validate the native FastVideo `video_output_capabilities` of `GET /v1/model_info` before advertising them. */
import type { OutputFacts } from './types.ts'

/**
 * The output facts that the server publishes, in the server's order.
 * @param value - the `video_output_capabilities` value of `GET /v1/model_info`, present and not null.
 * @returns the aspect ratios, resolutions, frame sizes, duration range and frame count of each duration.
 * @throws Error for metadata that is not schema version 1, has no positive `fps`, a duration range outside 1 to 600
 *   seconds, a missing frame count, more than 64 aspect ratios or 16 resolutions, an aspect ratio that is not `N:M`, a
 *   frame size that is not two positive integers, or aspect ratios with different resolutions.
 */
export function outputFacts(value: unknown): OutputFacts {
  const fail = (): never => { throw new Error('FastVideo returned invalid video output capabilities.') }
  const object = (entry: unknown): Record<string, unknown> => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return fail()
    return entry as Record<string, unknown>
  }
  const positive = (entry: unknown): entry is number => typeof entry === 'number' && Number.isSafeInteger(entry) && entry > 0
  const data = object(value)
  if (data['schema_version'] !== 1 || !positive(data['fps'])) return fail()
  const duration = object(data['duration_seconds'])
  const min = duration['min']; const max = duration['max']
  if (!positive(min) || !positive(max) || min > max || max > 600) return fail()
  const frameCounts = object(data['num_frames_by_duration_seconds'])
  const numFramesByDurationSec: Record<string, number> = {}
  for (let seconds = min; seconds <= max; seconds++) {
    const frames = frameCounts[String(seconds)]
    if (!positive(frames)) return fail()
    numFramesByDurationSec[String(seconds)] = frames
  }
  const sizes = Object.entries(object(data['recommended_frame_sizes']))
  const first = sizes[0]
  if (first === undefined || sizes.length > 64) return fail()
  const frameSizes = Object.fromEntries(sizes.map(([aspect, tiers]) => {
    if (!/^\d+:\d+$/.test(aspect) || aspect.split(':').some(part => Number(part) <= 0)) return fail()
    const entries = Object.entries(object(tiers))
    if (entries.length === 0 || entries.length > 16) return fail()
    return [aspect, Object.fromEntries(entries.map(([resolution, size]) => {
      if (!/^[\w-]+$/.test(resolution) || !Array.isArray(size) || size.length !== 2 || !size.every(positive)) return fail()
      return [resolution, [size[0], size[1]] as [number, number]]
    }))]
  }))
  const resolutions = Object.keys(object(first[1]))
  const inconsistent = Object.values(frameSizes).some(tiers => Object.keys(tiers).length !== resolutions.length
    || resolutions.some(key => !(key in tiers)))
  if (inconsistent) return fail()
  return { aspectRatios: sizes.map(([aspect]) => aspect), resolutions, frameSizes,
    minDurationSec: min, maxDurationSec: max, numFramesByDurationSec }
}
