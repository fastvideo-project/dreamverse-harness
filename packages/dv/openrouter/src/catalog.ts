/** Read provider-published video choices without manufacturing frame rates or pixel geometry. */
import type { VideoModel } from './types.ts'

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : []
}

/** Models missing supported durations or output choices cannot serve the harness video contract. */
export function videoCatalog(value: unknown): VideoModel[] {
  if (typeof value !== 'object' || value === null || !('data' in value) || !Array.isArray(value.data)) {
    throw new Error('OpenRouter returned an invalid video catalog.')
  }
  return value.data.flatMap((row: unknown) => {
    if (typeof row !== 'object' || row === null) return []
    const fields = new Map(Object.entries(row))
    const id = fields.get('id')
    const durations = fields.get('supported_durations')
    const seconds = Array.isArray(durations)
      ? [...new Set(durations.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0))]
        .sort((a, b) => a - b) : []
    const resolutions = strings(fields.get('supported_resolutions'))
    const aspectRatios = strings(fields.get('supported_aspect_ratios'))
    if (typeof id !== 'string' || id === '' || seconds.length === 0 || resolutions.length === 0 || aspectRatios.length === 0
      || fields.get('upscale_factor') != null) return []
    const frames = strings(fields.get('supported_frame_images'))
      .filter((frame): frame is 'first_frame' | 'last_frame' => frame === 'first_frame' || frame === 'last_frame')
    const name = fields.get('name')
    return [{ id, name: typeof name === 'string' ? name : id, durations: seconds, resolutions, aspectRatios,
      frames, audio: fields.get('generate_audio') === true, seed: fields.get('seed') === true }]
  })
}
