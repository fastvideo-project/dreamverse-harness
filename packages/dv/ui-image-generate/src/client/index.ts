/**
 * Browser half of image generation: one `defineGenerationUi` declaration of `@dv/ui-generation` that claims the
 * `image.generate` records as image takes.
 *
 * @module @dv/ui-image-generate/client
 */
import { defineGenerationUi } from '@dv/ui-generation/generation-kit.tsx'

/** The image takes of `image.generate`. */
export const { inject, apply } = defineGenerationUi({
  id: '@dv/ui-image-generate', type: 'image', operations: ['image.generate'], label: ['图片', 'Image'], color: 'var(--dv-node-4)',
  status: { running: ['生成中…', 'Generating…'], failed: ['生成失败', 'Generation failed'], done: ['已生成', 'Generated'] },
})
