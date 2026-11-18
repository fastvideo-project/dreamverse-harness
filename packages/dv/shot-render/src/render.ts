/**
 * The pure helpers of the Shot render operation: the frame size and frame count a shot asks the model for, and the GPU
 * time the backend reported.
 *
 * @module @dv/shot-render/render
 */
import type { RenderModelFacts } from '@dv/models'

/** A params field as text, or the fallback when it is absent or not a string. */
export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** A params field as a finite number, or the fallback. */
export function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** The frame size and frame count a shot asks for, after the model facts validated the choices. */
export interface ShotGeometry {
  aspectRatio: string
  resolution: string
  width?: number
  height?: number
  durationSec: number
  numFrames?: number
}

/**
 * Resolve a shot's geometry from its params and the served model's facts. Omitted params take the model's first
 * aspect ratio, first resolution, and shortest duration.
 * @param facts - the model's facts.
 * @param params - the record params.
 * @returns the geometry.
 * @throws Error naming the allowed values when a param is outside the model's facts.
 */
export function shotGeometry(facts: RenderModelFacts, params: Record<string, unknown>): ShotGeometry {
  const aspectRatio = text(params['aspect_ratio'], facts.aspectRatios[0] ?? '')
  const resolution = text(params['resolution'], facts.resolutions[0] ?? '')
  const size = facts.frameSizes?.[aspectRatio]?.[resolution]
  if (!facts.aspectRatios.includes(aspectRatio) || !facts.resolutions.includes(resolution)
    || (facts.frameSizes !== undefined && size === undefined)) {
    throw new Error(`aspect_ratio and resolution must be one of ${facts.aspectRatios.join(', ')} at ${facts.resolutions.join(', ')}.`)
  }
  const durationSec = number(params['duration_sec'], facts.minDurationSec)
  const numFrames = facts.numFramesByDurationSec?.[String(durationSec)]
  const supported = facts.durationsSec === undefined ? numFrames !== undefined : facts.durationsSec.includes(durationSec)
  if (!Number.isInteger(durationSec) || !supported) {
    throw new Error(facts.durationsSec === undefined
      ? `duration_sec must be a whole number from ${facts.minDurationSec} to ${facts.maxDurationSec}.`
      : `duration_sec must be one of ${facts.durationsSec.join(', ')} seconds.`)
  }
  return { aspectRatio, resolution, durationSec,
    ...size === undefined ? {} : { width: size[0], height: size[1] },
    ...numFrames === undefined ? {} : { numFrames } }
}

/** The MIME type without parameters, as the asset pool records it. */
export function baseMime(mime: string): string {
  return mime.replace(/;.*$/s, '').trim()
}
