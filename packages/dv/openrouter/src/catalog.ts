/** Read provider-published video, image and speech choices without manufacturing frame rates or pixel geometry. */
import type { ImageModel, ImageParameterChoices, ReferenceMedia, SpeechModel, VideoModel } from './types.ts'

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : []
}

/**
 * The object rows of a catalog response's `data` array, as field maps; a row that is not an object is left out.
 * @param value - the response JSON.
 * @param list - the catalog's name in the error, such as `image catalog`.
 * @returns one field map per object row.
 * @throws Error when the response has no `data` array.
 */
function catalogRows(value: unknown, list: string): Array<Map<string, unknown>> {
  if (typeof value !== 'object' || value === null || !('data' in value) || !Array.isArray(value.data)) {
    throw new Error(`OpenRouter returned an invalid ${list}.`)
  }
  return value.data.flatMap((row: unknown) => typeof row === 'object' && row !== null ? [new Map<string, unknown>(Object.entries(row))] : [])
}

/**
 * Parse `GET /videos/models`. Models missing supported durations or output choices cannot serve the harness video
 * contract and are left out.
 * @param value - the response JSON.
 * @param references - the reference media of each model ID, from `videoReferences`; a model it leaves out takes none.
 * @returns the usable video models.
 * @throws Error when the response has no `data` array.
 */
export function videoCatalog(value: unknown, references: ReadonlyMap<string, ReferenceMedia[]>): VideoModel[] {
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
      frames, references: references.get(id) ?? [], audio: fields.get('generate_audio') === true, seed: fields.get('seed') === true }]
  })
}

/** The input modalities that `input_references` carries, in the order a schema lists them. */
const REFERENCE_MEDIA: readonly ReferenceMedia[] = ['image', 'video', 'audio']

/**
 * Parse `GET /models?output_modalities=video`: the reference media of each model, which are the image, video and audio
 * entries of its `architecture.input_modalities`. `GET /videos/models` lists no input modalities.
 * @param value - the response JSON.
 * @returns the reference media by model ID; a model whose row lists none is left out.
 * @throws Error when the response has no `data` array.
 */
export function videoReferences(value: unknown): Map<string, ReferenceMedia[]> {
  return new Map(catalogRows(value, 'video model list').flatMap((fields): Array<[string, ReferenceMedia[]]> => {
    const id = fields.get('id')
    const architecture = fields.get('architecture')
    const inputs = typeof architecture === 'object' && architecture !== null
      ? strings(new Map<string, unknown>(Object.entries(architecture)).get('input_modalities')) : []
    const media = REFERENCE_MEDIA.filter(kind => inputs.includes(kind))
    return typeof id !== 'string' || id === '' || media.length === 0 ? [] : [[id, media]]
  }))
}

/** The `output_modalities` of a catalog row's `architecture` object; empty when it lists none. */
function outputModalities(architecture: unknown): string[] {
  return typeof architecture === 'object' && architecture !== null
    ? strings(new Map<string, unknown>(Object.entries(architecture)).get('output_modalities')) : []
}

/** The enum parameters an image call may set through `extra`; the provider chooses pixel sizes from them. */
export const IMAGE_EXTRA_PARAMETERS = ['aspect_ratio', 'resolution', 'quality', 'background'] as const

/** The output formats the harness can store as PNG; vector and animated outputs are not images it can use. */
const RASTER_FORMATS = ['png', 'jpeg', 'webp']

function enumValues(descriptor: unknown): ImageParameterChoices | null {
  if (typeof descriptor !== 'object' || descriptor === null || !('type' in descriptor) || descriptor.type !== 'enum'
    || !('values' in descriptor) || !Array.isArray(descriptor.values)) return null
  const listed: unknown[] = descriptor.values
  const values = listed.filter((value): value is string | number => (typeof value === 'string' && value !== '')
    || (typeof value === 'number' && Number.isFinite(value)))
  return values.length === 0 ? null : values
}

/**
 * Parse `GET /images/models`. A row needs an id, `image` among its output modalities and a `supported_parameters`
 * object; a row whose `output_format` offers no PNG, JPEG or WebP (an SVG or GIF model) is left out.
 * @param value - the response JSON.
 * @returns the usable image models.
 * @throws Error when the response has no `data` array.
 */
export function imageCatalog(value: unknown): ImageModel[] {
  return catalogRows(value, 'image catalog').flatMap((fields) => {
    const id = fields.get('id')
    const outputs = outputModalities(fields.get('architecture'))
    const supported = fields.get('supported_parameters')
    if (typeof id !== 'string' || id === '' || !outputs.includes('image') || typeof supported !== 'object' || supported === null) return []
    const descriptors = new Map<string, unknown>(Object.entries(supported))
    const formats = (enumValues(descriptors.get('output_format')) ?? []).map(String)
    if (formats.length > 0 && !formats.some(format => RASTER_FORMATS.includes(format))) return []
    const parameters: Record<string, ImageParameterChoices> = {}
    for (const key of IMAGE_EXTRA_PARAMETERS) {
      const values = enumValues(descriptors.get(key))
      if (values !== null) parameters[key] = values
    }
    const name = fields.get('name')
    return [{ id, name: typeof name === 'string' ? name : id, parameters, outputFormats: formats, seed: descriptors.has('seed') }]
  })
}

/** The route a speech row must list among its `endpoints`, when it lists any. */
const SPEECH_ENDPOINT = '/api/v1/audio/speech'

/**
 * Parse `GET /models?output_modalities=speech`. A row needs an id and `speech` among its output modalities; a row whose
 * `endpoints` list leaves out `/api/v1/audio/speech` is left out.
 * @param value - the response JSON.
 * @returns the usable speech models, with the voices each lists in `supported_voices`.
 * @throws Error when the response has no `data` array.
 */
export function speechCatalog(value: unknown): SpeechModel[] {
  return catalogRows(value, 'speech catalog').flatMap((fields) => {
    const id = fields.get('id')
    const outputs = outputModalities(fields.get('architecture'))
    const endpoints = fields.get('endpoints')
    if (typeof id !== 'string' || id === '' || !outputs.includes('speech')
      || (Array.isArray(endpoints) && !strings(endpoints).includes(SPEECH_ENDPOINT))) return []
    const name = fields.get('name')
    return [{ id, name: typeof name === 'string' ? name : id, voices: [...new Set(strings(fields.get('supported_voices')))] }]
  })
}
