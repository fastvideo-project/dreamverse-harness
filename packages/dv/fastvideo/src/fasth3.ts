/**
 * MiniMax H3 (model `fasth3`) as this plugin serves it: the tasks, what each task accepts, how the model names the
 * references in its prompt, and the prompt skill of each task.
 *
 * @module @dv/fastvideo/fasth3
 */
import type { RenderRequest, TaskId } from '@dv/models'
import { citedInput, parsePromptCitations } from '@dv/project'
import type { AssignReferenceLabels } from './reference-labels.ts'
import type { ServedTask } from './types.ts'

/**
 * Assign the MiniMax H3 labels: the k-th image is `<Picture k>`, the k-th video is `<Video k>`, and the k-th audio file is
 * `<Audio n>`, counting in the order that the model receives the media, so the first frame is the image after the
 * reference images. MiniMax H3 also gives the sound of a video its own `<Audio N>` in the same sequence as the audio
 * files, so a video with sound takes an audio number before the audio files after it.
 */
export const assignFasth3ReferenceLabels: AssignReferenceLabels = (media) => {
  let pictures = 0
  let videos = 0
  let audios = 0
  return media.map((medium) => {
    if (medium.mediaType === 'image') return `<Picture ${String(++pictures)}>`
    if (medium.mediaType === 'audio') return `<Audio ${String(++audios)}>`
    // The reference input of fasth3 takes only images, videos and audio, so this medium is a video.
    if (medium.hasAudio) audios += 1
    return `<Video ${String(++videos)}>`
  })
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
  return cited ? [] : ['Its prompt does not cite the first frame; write "@[first frame](dv:input/first_frame) is the first frame of [Shot 1]".']
}

/** The tasks this plugin serves `fasth3` for. */
export const FASTH3: { [T in TaskId]?: ServedTask } = {
  ref2v: {
    description: 'MiniMax H3 served as FastH3 Ref2VA: video with sound, dialogue and music written in the prompt, from '
      + 'reference images, videos and audio and an optional first frame. Keeps a face, place or style the same across '
      + 'shots through the references, and continues a shot from the previous shot\'s last still. Needs at least one '
      + 'reference.',
    inputs: { reference: { min: 1, mediaTypes: ['image', 'video', 'audio'] }, first_frame: { min: 0, mediaTypes: ['image'] } },
    extra: {},
    assignReferenceLabels: assignFasth3ReferenceLabels,
    promptProblems: fasth3PromptProblems,
    skill: {
      name: 'fasth3-reference-prompting',
      description: 'Model limits and prompt rules for model fasth3 for task ref2v: reference images, videos and audio, '
        + 'how the prompt names them, and how a shot continues the previous one.',
      file: 'fasth3-reference-prompting.md',
    },
  },
  t2v: {
    description: 'MiniMax H3 served as FastH3 8-Step V2: video with sound, dialogue and music written in the prompt, from '
      + 'the prompt alone. A subject keeps its look only as far as the same words describe it, and no shot starts from '
      + 'an earlier shot\'s last still; a face that must stay the same needs fasth3 for task ref2v.',
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
