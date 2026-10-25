/**
 * MiniMax H3 (model `fasth3`) as this plugin serves it: the tasks, what each task accepts, how the model names the
 * references in its prompt, and the prompt skill of each task.
 *
 * @module @dv/fastvideo/fasth3
 */
import type { RenderRequest, TaskId } from '@dv/models'
import { citedInput, parsePromptCitations } from '@dv/project'
import type { AssignReferenceLabels } from './reference-labels.ts'
import type { ServedFacts, ServedTask } from './types.ts'

/**
 * The MiniMax H3 facts of one task: 16:9 at 1344x768, 5 to 15 seconds at 24 fps on the 17n+5 frame grid, and at most 9
 * images per job. The job API reads images from `data:` URLs and refuses `data:` videos and audio, so a job carries
 * images only.
 * @param modelId - the model ID that `facts()` reports.
 * @returns the facts.
 */
function h3Facts(modelId: string): ServedFacts {
  return {
    modelId, aspectRatios: ['16:9'], resolutions: ['720p'], frameSizes: { '16:9': { '720p': [1344, 768] } },
    minDurationSec: 5, maxDurationSec: 15,
    numFramesByDurationSec: { 5: 124, 6: 158, 7: 175, 8: 192, 9: 226, 10: 243, 11: 277, 12: 294, 13: 328, 14: 345, 15: 362 },
    maxReferences: 9,
  }
}

/**
 * Assign the MiniMax H3 labels: the k-th image is `<Picture k>`, counting in the order that the model receives the
 * media, so the first frame is the image after the reference images.
 */
export const assignFasth3ReferenceLabels: AssignReferenceLabels = (media) => {
  let pictures = 0
  // The inputs of fasth3 take only images.
  return media.map(() => `<Picture ${String(++pictures)}>`)
}

/**
 * The MiniMax H3 prompt rule for the first frame: the model has no first-frame slot, so a first frame acts as the first
 * frame only when the prompt cites it and says so; an uncited first frame acts as a plain reference image.
 * @param request - the render request.
 * @returns one sentence when the request has a first frame that the prompt does not cite; else none.
 */
export function fasth3PromptProblems(request: RenderRequest): string[] {
  if (request.firstFrame === null) return []
  const cited = parsePromptCitations(request.prompt).some(citation => citedInput(citation.uri) === 'first_frame')
  return cited ? [] : ['Its prompt does not cite the first frame; write "@[首帧](dv:input/first_frame) is the first frame of [Shot 1]".']
}

/** The tasks this plugin serves `fasth3` for. */
export const FASTH3: { [T in TaskId]?: ServedTask } = {
  ref2v: {
    description: 'MiniMax H3 served as FastH3 Ref2VA: video with sound, dialogue and music written in the prompt, from '
      + 'reference images and an optional first frame. Keeps a face, place or style the same across shots through the '
      + 'references, and continues a shot from the previous shot\'s last still. Needs at least one reference image.',
    jobTask: 'ref2va',
    facts: h3Facts('fasth3-ref2va'),
    inputs: { reference: { min: 1, mediaTypes: ['image'] }, first_frame: { min: 0, mediaTypes: ['image'] } },
    extra: {},
    assignReferenceLabels: assignFasth3ReferenceLabels,
    promptProblems: fasth3PromptProblems,
    skill: {
      name: 'fasth3-reference-prompting',
      description: 'Model limits and prompt rules for model fasth3 for task ref2v: reference images, how the prompt names '
        + 'them, and how a shot continues the previous one.',
      file: 'fasth3-reference-prompting.md',
    },
  },
  t2v: {
    description: 'MiniMax H3 served as FastH3 8-Step V2: video with sound, dialogue and music written in the prompt, from '
      + 'the prompt alone. A subject keeps its look only as far as the same words describe it, and no shot starts from '
      + 'an earlier shot\'s last still; a face that must stay the same needs fasth3 for task ref2v.',
    jobTask: 't2va',
    facts: h3Facts('fasth3-t2va'),
    inputs: {},
    extra: {},
    assignReferenceLabels: assignFasth3ReferenceLabels,
    skill: {
      name: 'fasth3-text-prompting',
      description: 'Model limits and prompt rules for model fasth3 for task t2v: the three prompt fields, shot changes, '
        + 'camera motion, speakers and dialogue, sound and music.',
      file: 'fasth3-text-prompting.md',
    },
  },
}
