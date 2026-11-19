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

/** Editable deployment settings. Values identify models in OpenRouter's video catalog. */
export interface OpenRouterSettings {
  models: Record<string, string>
  credentialRef: string
}
