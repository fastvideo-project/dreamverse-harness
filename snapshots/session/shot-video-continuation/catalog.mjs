/** Catalog-only models: the session reads reference capabilities and the providers' prompt skills without generating. */
import { readFileSync } from 'node:fs'

export const inject = ['dvModels']

/** Register the models and prompt skills for the lifetime of this scenario's plugin. */
export function apply(ctx) {
  const entry = {
    modality: 'video', task: 'ref2v', provider: 'snapshot', model: 'video-reference',
    description: 'Video references with audio conditioning.',
    facts: async () => ({
      modelId: 'video-reference', aspectRatios: ['16:9'], resolutions: ['720p'],
      frameSizes: { '16:9': { '720p': [192, 112] } }, minDurationSec: 1, maxDurationSec: 2,
      numFramesByDurationSec: { 1: 25, 2: 49 },
    }),
    schema: async () => ({ inputs: { reference: { media_types: ['video'], max_count: 1 } } }),
    validateGenerationRequest: async () => [],
    render: () => { throw new Error('The catalog snapshot must not generate video.') },
  }
  for (const [model, name, path] of [
    ['video-reference', 'fasth3-reference-prompting', '../../../packages/dv/fastvideo/skills/fasth3-reference-prompting.md'],
    ['video-reference-uniserve', 'fasth3-uniserve-prompting', '../../../packages/dv/uniserve/skills/fasth3-uniserve-prompting.md'],
  ]) {
    ctx.effect(() => ctx.dvModels.register({
      ...entry, model,
      promptSkill: { name, description: 'FastH3 reference and video-tail continuation prompts.',
        content: readFileSync(new URL(path, import.meta.url), 'utf8') },
    }))
  }
}
