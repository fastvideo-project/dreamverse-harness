/**
 * The labels that a served model reads in its prompt for the references of a render request, and the prompt with each
 * citation of a reference replaced by its label. Each served model declares its own `AssignReferenceLabels` function.
 *
 * @module @dv/fastvideo/reference-labels
 */
import type { RenderRequest } from '@dv/models'
import { citedAsset, citedInput, replacePromptCitations, type AssetId } from '@dv/project'

/** One medium of a render request with its media type, such as `image`, as `dvAssetPool.mediaType` returns it. */
export interface ReferenceMedia {
  asset: AssetId
  mediaType: string
  /**
   * Whether the medium has sound: always for audio, never for an image. For a video, `dvAssetPool.hasAudio` answers when
   * the media hold audio; otherwise the sound does not change any label, and it is false.
   */
  hasAudio: boolean
}

/**
 * Assign a model's labels to the media of one render request.
 * @param media - the media in the order that the model receives them.
 * @returns the label of each medium, at the same position; null for a medium that the model does not name.
 */
export type AssignReferenceLabels = (media: readonly ReferenceMedia[]) => ReadonlyArray<string | null>

/**
 * The prompt that a model reads: each citation of a reference or of the first frame (`dv:input/first_frame`) replaced with the
 * model's label of that medium. A citation of anything else, or of a medium that the model has no label for, becomes its
 * label.
 * @param request - the render request.
 * @param assignReferenceLabels - assigns the model's label to each medium at its position in `media`.
 * @param media - the media of the request: the references in input order, then the first frame.
 * @returns the prompt.
 */
export function modelPrompt(
  request: RenderRequest, assignReferenceLabels: AssignReferenceLabels, media: readonly ReferenceMedia[],
): string {
  const labels = assignReferenceLabels(media)
  return replacePromptCitations(request.prompt, (citation) => {
    const asset = citedAsset(citation.uri)
    // The first frame follows the references; a reference cited by its asset takes the label of its first position.
    const position = citedInput(citation.uri) === 'first_frame' && request.firstFrame !== null
      ? request.references.length
      : asset === null ? -1 : request.references.indexOf(asset)
    return labels[position] ?? citation.label
  })
}
