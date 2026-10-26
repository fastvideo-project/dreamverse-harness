/**
 * The rules of MiniMax H3 as UniServe serves it for task `ref2v` (FastH3 Omni 8-Step V1, UniServe task `ref2va`): the
 * catalog description, the input limits from the server's reference limits, the `schema()` of the entry, the problems
 * of a render request, and the prompt that the model reads, with each citation replaced by the model's label.
 *
 * @module @dv/uniserve/fasth3-omni
 */
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { RenderModelFacts, RenderRequest } from '@dv/models'
import { citedAsset, citedInput, parsePromptCitations, replacePromptCitations, type AssetId } from '@dv/project'

/** The catalog description of the entry. */
export const FASTH3_OMNI_DESCRIPTION = 'MiniMax H3 served as FastH3 Omni 8-Step V1 on UniServe: video with sound, dialogue '
  + 'and music written in the prompt, from reference images, videos and audio and an optional first frame. Keeps a face, '
  + 'place or style the same across shots through the references, and continues a shot from the previous shot\'s last '
  + 'still. Needs at least one reference.'

/** The media types of the `reference` input. */
const REFERENCE_TYPES = ['image', 'video', 'audio'] as const

/** The reference limits of one `ref2va` request, from `task_conditions.ref2va` of the server's capabilities. */
export interface Ref2vaConditions {
  max_references: number
  max_images: number
  max_videos: number
  max_audios: number
}

/**
 * The most assets of the `reference` input, in total and by media type. UniServe counts the first frame as one more
 * reference image, so the `reference` input keeps one slot less in total and one image slot less than the server.
 * @param conditions - the server's reference limits.
 * @returns the limits.
 */
function referenceLimits(conditions: Ref2vaConditions): { total: number; image: number; video: number; audio: number } {
  return {
    total: conditions.max_references - 1,
    image: conditions.max_images - 1,
    video: conditions.max_videos,
    audio: conditions.max_audios,
  }
}

/**
 * The `schema()` of the entry: the duration range, aspect ratios and resolutions of the server, the `reference` input
 * with its limits, the optional `first_frame` image, and no extra parameters.
 * @param facts - the entry's render facts.
 * @param conditions - the server's reference limits.
 * @returns the schema.
 */
export function fasth3OmniSchema(facts: RenderModelFacts, conditions: Ref2vaConditions): JsonValue {
  const limits = referenceLimits(conditions)
  return {
    duration_sec: { min: facts.minDurationSec, max: facts.maxDurationSec },
    aspect_ratios: facts.aspectRatios,
    resolutions: facts.resolutions,
    inputs: {
      reference: {
        min: 1, max: limits.total,
        media_types: { image: { max: limits.image }, video: { max: limits.video }, audio: { max: limits.audio } },
      },
      first_frame: { min: 0, max: 1, media_types: { image: {} } },
    },
    extra: {},
  }
}

/**
 * The problems of one render request: no reference, a reference or first frame of a media type the input does not take,
 * more references than the server takes in total or of one media type, an `extra` value, or a first frame that the
 * prompt does not cite. The model has no first-frame slot, so the first frame acts as the first frame only when the
 * prompt cites it and says so.
 * @param conditions - the server's reference limits.
 * @param request - the render request.
 * @param mediaTypeOf - the media type of an asset, read from the asset pool.
 * @returns one sentence per problem; empty when the server renders the request.
 */
export function fasth3OmniProblems(
  conditions: Ref2vaConditions, request: RenderRequest, mediaTypeOf: (asset: AssetId) => string,
): string[] {
  const problems: string[] = []
  const limits = referenceLimits(conditions)
  const accepted = REFERENCE_TYPES.join(', ')
  const { references, firstFrame } = request
  if (references.length === 0) problems.push(`Its reference input needs at least 1 of type ${accepted}; this shot has 0.`)
  if (references.length > limits.total) {
    problems.push(`Its reference input takes at most ${limits.total} assets; this shot has ${references.length}.`)
  }
  const types = references.map(asset => mediaTypeOf(asset))
  references.forEach((asset, index) => {
    const type = types[index] as string
    if (!(REFERENCE_TYPES as readonly string[]).includes(type)) {
      problems.push(`Its reference input takes assets of type ${accepted}; asset ${asset} is of type ${type}.`)
    }
  })
  for (const type of REFERENCE_TYPES) {
    const count = types.filter(candidate => candidate === type).length
    if (count > limits[type]) problems.push(`Its reference input takes at most ${limits[type]} of type ${type}; this shot has ${count}.`)
  }
  if (firstFrame !== null) {
    const type = mediaTypeOf(firstFrame)
    if (type !== 'image') problems.push(`Its first_frame input takes assets of type image; asset ${firstFrame} is of type ${type}.`)
    const cited = parsePromptCitations(request.prompt).some(citation => citedInput(citation.uri) === 'first_frame')
    if (!cited) problems.push('Its prompt does not cite the first frame; write "@[first frame](dv:input/first_frame) is the first frame of [Shot 1]".')
  }
  const extra = Object.keys(request.extra)
  if (extra.length > 0) {
    problems.push(`fasth3 has no extra parameter ${extra.map(key => `\`${key}\``).join(', ')} for task ref2v; its extra parameters: none.`)
  }
  return problems
}

/** One medium that the server receives: its media type and, for a video, whether it has sound. */
export interface SentMedium {
  mediaType: string
  hasAudio: boolean
}

/**
 * The prompt that the model reads. UniServe gives the media one counter per kind in the order it receives them: the
 * n-th image is `<Picture n>`, the n-th video `<Video n>`, and the n-th audio `<Audio n>`, where the soundtrack of a
 * video with sound takes the next audio number before the video. Each citation of a reference asset, or of the first
 * frame (`dv:input/first_frame`), becomes the label of that medium; any other citation becomes its own label.
 * @param request - the render request.
 * @param media - the media in the order the server receives them: the references, then the first frame.
 * @returns the prompt.
 */
export function fasth3OmniPrompt(request: RenderRequest, media: readonly SentMedium[]): string {
  const counters = { image: 0, video: 0, audio: 0 }
  const labels = media.map(({ mediaType, hasAudio }) => {
    if (mediaType === 'image') return `<Picture ${String(++counters.image)}>`
    if (mediaType === 'audio') return `<Audio ${String(++counters.audio)}>`
    if (hasAudio) counters.audio++
    return `<Video ${String(++counters.video)}>`
  })
  return replacePromptCitations(request.prompt, (citation) => {
    if (citedInput(citation.uri) === 'first_frame' && request.firstFrame !== null) return labels[request.references.length] as string
    const index = request.references.findIndex(reference => reference === citedAsset(citation.uri))
    return labels[index] ?? citation.label
  })
}
