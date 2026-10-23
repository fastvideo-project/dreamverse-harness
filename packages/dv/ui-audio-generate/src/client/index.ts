/**
 * Browser half of audio generation: one `defineGenerationUi` declaration of `@dv/ui-generation` that claims the
 * `audio.generate` records as audio takes.
 *
 * @module @dv/ui-audio-generate/client
 */
import { defineGenerationUi } from '@dv/ui-generation/generation-kit.tsx'

/** The audio takes of `audio.generate`. */
export const { inject, apply } = defineGenerationUi({
  id: '@dv/ui-audio-generate', type: 'audio', operations: ['audio.generate'], label: ['音频', 'Audio'], color: 'var(--dv-node-8)',
  // The audio view's waveform and play button fill a lower body than the 16:9 frame.
  bodyHeight: 72,
  status: { running: ['生成中…', 'Generating…'], failed: ['生成失败', 'Generation failed'], done: ['已生成', 'Generated'] },
})
