/** Public OpenRouter video metadata; contains no keys or generated media URLs. */
export interface VideoModel {
  id: string
  name: string
  durations: number[]
  resolutions: string[]
  aspectRatios: string[]
  frames: Array<'first_frame' | 'last_frame'>
  audio: boolean
  seed: boolean
}

/** The choices of one image parameter, from the `supported_parameters` of OpenRouter's image catalog. */
export type ImageParameterChoices = Array<string | number>

/** Public OpenRouter image metadata; contains no keys or generated media URLs. */
export interface ImageModel {
  id: string
  name: string
  /** The values of each enum parameter the harness passes through `extra`: `aspect_ratio`, `resolution`, `quality`, `background`. */
  parameters: Record<string, ImageParameterChoices>
  /** The output formats the model offers; empty when the catalog lists no `output_format` choice. */
  outputFormats: string[]
  seed: boolean
}

/**
 * Editable deployment settings. `models` maps an alias to an id in OpenRouter's video catalog, and `imageModels` maps
 * an alias to an id in its image catalog.
 */
export interface OpenRouterSettings {
  models: Record<string, string>
  imageModels: Record<string, string>
  credentialRef: string
}

/** What the settings page's discovery route answers: both catalogs. */
export interface OpenRouterCatalog { videos: VideoModel[]; images: ImageModel[] }
