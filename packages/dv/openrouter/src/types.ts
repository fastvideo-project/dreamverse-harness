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

/** Public OpenRouter speech metadata, from the models catalog filtered to speech output; contains no keys. */
export interface SpeechModel {
  id: string
  name: string
  /** The voice names the catalog lists for the model; empty when it lists none (a model that clones or designs voices). */
  voices: string[]
}

/**
 * Editable deployment settings. `models` maps an alias to an id in OpenRouter's video catalog, `imageModels` maps an
 * alias to an id in its image catalog, and `audioModels` maps an alias to an id among its speech models.
 */
export interface OpenRouterSettings {
  models: Record<string, string>
  imageModels: Record<string, string>
  audioModels: Record<string, string>
  credentialRef: string
}

/**
 * What the settings page's discovery route answers: the three catalogs, and the message of the configured models that
 * could not register, such as an id that its catalog no longer offers; null when every configured model registered.
 */
export interface OpenRouterCatalog { videos: VideoModel[]; images: ImageModel[]; speech: SpeechModel[]; error: string | null }
