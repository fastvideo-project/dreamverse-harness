/**
 * Open-H3-Regenerate-2K (model `open-h3-regenerate-2k`) as this plugin serves it: task `v2v` regenerates one MiniMax H3
 * draft video at 2560x1440 on a FastVideo server that runs the 2K pipeline, often a second GPU or a second DGX Spark
 * beside the one that drafts.
 *
 * @module @dv/fastvideo/open-h3-regenerate-2k
 */
import type { RenderRequest, TaskId } from '@dv/models'
import type { ServedTask } from './types.ts'

/**
 * The rules of task `v2v`: exactly one reference, a video, and no frame inputs; the input declaration already refuses
 * frames and other media types, so this adds the count the declaration cannot express.
 * @param request - the render request.
 * @returns one sentence when the shot has more than one reference; else none.
 */
export function regenerate2kProblems(request: RenderRequest): string[] {
  return request.references.length > 1
    ? [`It regenerates exactly one draft video; this shot has ${request.references.length} references.`] : []
}

/** The tasks this plugin serves `open-h3-regenerate-2k` for. */
export const OPEN_H3_REGENERATE_2K: { [T in TaskId]?: ServedTask } = {
  v2v: {
    description: 'Open-H3-Regenerate-2K: regenerate one MiniMax H3 draft video (for example a FastH3 take) at 2560x1440, '
      + 'keeping its scene, motion and timing. Takes the draft as its one reference video; the prompt is the draft\'s own prompt.',
    inputs: { reference: { min: 1, mediaTypes: ['video'] } },
    extra: {},
    // The 2K model reads no reference labels: the draft is its input, not a cited reference.
    assignReferenceLabels: media => media.map(() => null),
    modelProblems: regenerate2kProblems,
    skill: {
      name: 'open-h3-regenerate-2k-upscale',
      description: 'Open-H3-Regenerate-2K upscaling: regenerate a MiniMax H3 draft take at 2K with its own prompt.',
      file: 'open-h3-regenerate-2k-upscale.md',
    },
  },
}
