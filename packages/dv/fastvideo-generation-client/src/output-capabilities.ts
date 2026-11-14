/** Validate native FastVideo output geometry before advertising it to a caller. */
import type { ModelFacts, ReferenceLimitFacts, ServedTaskFacts } from './types.ts'

/** Put the configured default first when the server offers it; keep the server's order otherwise. */
function moveToFront(keys: string[], first: string | undefined): string[] {
  return keys.filter(key => key === first).concat(keys.filter(key => key !== first))
}

/** Preserve reference limits and model identity while discovering native output choices. */
export function outputFacts(base: ModelFacts, value: unknown): ModelFacts {
  if (value === undefined || value === null) return base
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
  const tasks = data['tasks'] === undefined ? undefined : servedTasks(data['tasks'], fail, object)
  const referenceLimits = data['reference_limits'] == null ? undefined : limitFacts(object(data['reference_limits']), fail)
  // Shot rendering defaults to the first aspect ratio and resolution, so the configured defaults stay first.
  return { ...base, aspectRatios: moveToFront(sizes.map(([aspect]) => aspect), base.aspectRatios[0]),
    resolutions: moveToFront(resolutions, base.resolutions[0]), frameSizes,
    minDurationSec: min, maxDurationSec: max, numFramesByDurationSec,
    ...tasks === undefined ? {} : { tasks }, ...referenceLimits === undefined ? {} : { referenceLimits } }
}

const ANCHORS: ReadonlyArray<string> = ['first', 'last']

function servedTasks(value: unknown, fail: () => never, object: (entry: unknown) => Record<string, unknown>): ServedTaskFacts[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) return fail()
  return value.map((entry): ServedTaskFacts => {
    const task = object(entry)
    const name = task['task']; const images = task['image_references']; const anchors = task['anchors']
    if (typeof name !== 'string' || !/^[a-z0-9]+$/.test(name)) return fail()
    if (images !== undefined && !(typeof images === 'number' && Number.isSafeInteger(images) && images >= 0)) return fail()
    if (anchors !== undefined && !(Array.isArray(anchors) && anchors.every(anchor => ANCHORS.includes(anchor as string)))) return fail()
    return { task: name, ...images === undefined ? {} : { imageReferences: images },
      ...anchors === undefined ? {} : { anchors: anchors as Array<'first' | 'last'> } }
  })
}

function limitFacts(value: Record<string, unknown>, fail: () => never): ReferenceLimitFacts {
  const count = (key: string): number => {
    const entry = value[key]
    return typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0 ? entry : fail()
  }
  const limits = { images: count('images'), videos: count('videos'), audios: count('audios'), total: count('total') }
  const continuation = value['continuation_video']
  if (typeof continuation !== 'boolean') return fail()
  if (Math.max(limits.images, limits.videos, limits.audios) > limits.total) return fail()
  return { ...limits, continuationVideo: continuation }
}
