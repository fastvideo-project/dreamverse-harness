/**
 * Pika H3 Flex text and native first/last image tasks through FastVideo's OpenAI API.
 * Text and endpoint tasks use the keyframe pipeline; Ref2VA requires a separately configured reference pipeline.
 * @module @dv/fastvideo/pika-h3-flex
 */
import type { TaskId } from '@dv/models'
import { assignFasth3ReferenceLabels } from './fasth3.ts'
import type { ServedTask } from './types.ts'

/** Tasks enabled for Pika H3 Flex. Backend precision and generation limits belong to deployment configuration. */
export const PIKA_H3_FLEX: { [T in TaskId]?: ServedTask } = {
  t2v: {
    description: 'Pika H3 Flex: video with sound from text, through the text/keyframe pipeline.',
    inputs: {}, extra: {}, openaiTask: 't2va', assignReferenceLabels: assignFasth3ReferenceLabels,
    skill: { name: 'pika-h3-flex-keyframe-prompting', description: 'Pika H3 Flex text and first/last frame prompts.', file: 'pika-h3-flex-keyframe-prompting.md' },
  },
  i2v: {
    description: 'Pika H3 Flex: video with sound beginning at a first image.',
    inputs: { first_frame: { min: 1, mediaTypes: ['image'] } },
    extra: {}, openaiTask: 'i2va', assignReferenceLabels: assignFasth3ReferenceLabels,
    skill: { name: 'pika-h3-flex-keyframe-prompting', description: 'Pika H3 Flex text and first/last frame prompts.', file: 'pika-h3-flex-keyframe-prompting.md' },
  },
  l2v: {
    description: 'Pika H3 Flex: video with sound ending at a last image. Requires native last-frame task selection on the server.',
    inputs: { last_frame: { min: 1, mediaTypes: ['image'] } },
    extra: {}, openaiTask: 'l2va', assignReferenceLabels: assignFasth3ReferenceLabels,
    skill: { name: 'pika-h3-flex-keyframe-prompting', description: 'Pika H3 Flex text and first/last frame prompts.', file: 'pika-h3-flex-keyframe-prompting.md' },
  },
  ref2v: {
    description: 'Pika H3 Flex: video with sound from reference media on a reference pipeline. Needs an image or video reference.',
    inputs: { reference: { min: 1, mediaTypes: ['image', 'video', 'audio'] } },
    extra: {}, openaiTask: 'ref2va', assignReferenceLabels: assignFasth3ReferenceLabels,
    inputProblems: (request, mediaTypeOf) => request.references.some(asset => ['image', 'video'].includes(mediaTypeOf(asset)))
      ? [] : ['Its reference input needs at least one image or video; audio alone is insufficient.'],
    skill: { name: 'pika-h3-flex-reference-prompting', description: 'Pika H3 Flex reference-media prompts and reference pipeline requirements.', file: 'pika-h3-flex-reference-prompting.md' },
  },
  fl2v: {
    description: 'Pika H3 Flex: video with sound between a first image and a last image. Both images are required.',
    inputs: { first_frame: { min: 1, mediaTypes: ['image'] }, last_frame: { min: 1, mediaTypes: ['image'] } },
    extra: {}, openaiTask: 'fl2va', assignReferenceLabels: assignFasth3ReferenceLabels,
    skill: { name: 'pika-h3-flex-keyframe-prompting', description: 'Pika H3 Flex text and first/last frame prompts.', file: 'pika-h3-flex-keyframe-prompting.md' },
  },
}
