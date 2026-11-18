/**
 * The model facts that a FastVideo deployment's operator configures, and the `ModelFacts` derived from them. FastVideo
 * serves no capabilities route, so the operator writes the frame sizes, the frame count of each duration and the
 * reference limits; the aspect ratios, resolutions and duration range are read from the keys of those maps.
 *
 * @module @dv/fastvideo-generation-client/model-facts
 */
import z from '@deepseek-ai/schemastery'
import { REFERENCE_FIELDS, type ReferenceMediaType } from './references.ts'
import type { ModelFacts } from './types.ts'

/** The configured facts of the served model. */
export interface ModelFactsConfig {
  /** Exact model alias that `GET /v1/model_info` reports as `served_model_name`. */
  modelId: string
  /**
   * `[width, height]` by aspect ratio and then by resolution, such as `{'16:9': {'480p': [832, 480]}}`. Every aspect
   * ratio lists the same resolutions.
   */
  frameSizes: Record<string, Record<string, [number, number]>>
  /** Native frame count by whole-second duration, for every duration from the shortest to the longest. */
  numFramesByDurationSec: Record<string, number>
  /** The most references that one request carries across media types, a first frame included. */
  maxReferences: number
  /** The most references of each accepted media type in one request; a media type left out is not accepted. */
  referenceMediaTypes: Partial<Record<ReferenceMediaType, {
    /** The most references of the media type in one request. */
    maxCount: number
  }>>
}

// Schemastery's tuple output is typed as optional even when both elements are required.
const frameSize = z.tuple([z.natural().min(1).required(), z.natural().min(1).required()]).min(2).max(2) as z<[number, number]>
const mediaType = z.union(Object.keys(REFERENCE_FIELDS) as ReferenceMediaType[])

/** Loader validation of the configured facts; `deriveModelFacts` checks the relations between the fields. */
export const modelFactsConfig: z<ModelFactsConfig> = z.object({
  modelId: z.string().required(),
  frameSizes: z.dict(z.dict(frameSize)).required(),
  numFramesByDurationSec: z.dict(z.natural().min(1).required()).required(),
  maxReferences: z.natural().required(),
  referenceMediaTypes: z.dict(z.object({ maxCount: z.natural().required() }), mediaType).required(),
}) as z<ModelFactsConfig>

/**
 * The model facts of a configuration.
 * @param config - the configured facts.
 * @returns the facts, with the aspect ratios, resolutions and duration range read from the keys of the maps.
 * @throws Error naming the inconsistency: no frame size, aspect ratios with different resolutions, a duration that is
 *   not a whole number of seconds, a gap in the durations, a frame count that does not grow with the duration, or a
 *   media type limit above `maxReferences`.
 */
export function deriveModelFacts(config: ModelFactsConfig): ModelFacts {
  const fail = (problem: string): never => { throw new Error(`FastVideo modelFacts of ${config.modelId}: ${problem}`) }
  const aspectRatios = Object.keys(config.frameSizes)
  const resolutions = Object.keys(config.frameSizes[aspectRatios[0] ?? ''] ?? {})
  if (resolutions.length === 0) fail('frameSizes lists no frame size.')
  const sortedResolutions = [...resolutions].sort().join()
  for (const [ratio, sizes] of Object.entries(config.frameSizes)) {
    if (Object.keys(sizes).sort().join() !== sortedResolutions) {
      fail(`frameSizes of ${ratio} lists ${Object.keys(sizes).join(', ') || 'no resolution'}; every aspect ratio lists ${resolutions.join(', ')}.`)
    }
  }
  const durations = Object.keys(config.numFramesByDurationSec)
  for (const duration of durations) {
    if (!/^[1-9]\d*$/.test(duration)) fail(`numFramesByDurationSec has duration "${duration}"; durations are whole seconds of at least 1.`)
  }
  // Integer-like keys enumerate in ascending numeric order.
  const seconds = durations.map(Number)
  const [min, max] = [seconds[0], seconds.at(-1)]
  if (min === undefined || max === undefined) return fail('numFramesByDurationSec lists no duration.')
  if (seconds.length !== max - min + 1) fail(`numFramesByDurationSec has a gap; it needs every duration from ${min} to ${max}.`)
  const frames = durations.map(duration => config.numFramesByDurationSec[duration] as number)
  if (frames.some((count, index) => index > 0 && count <= (frames[index - 1] as number))) {
    fail('numFramesByDurationSec has a frame count that does not grow with the duration.')
  }
  for (const [type, limit] of Object.entries(config.referenceMediaTypes)) {
    if (limit.maxCount > config.maxReferences) fail(`referenceMediaTypes.${type}.maxCount ${limit.maxCount} exceeds maxReferences ${config.maxReferences}.`)
  }
  return {
    modelId: config.modelId, aspectRatios, resolutions, minDurationSec: min, maxDurationSec: max,
    maxReferences: config.maxReferences, referenceMediaTypes: { ...config.referenceMediaTypes },
    frameSizes: config.frameSizes, numFramesByDurationSec: config.numFramesByDurationSec,
  }
}
