/**
 * Browser half of the shot render UI plugin: one `defineGenerationUi` declaration gives the `shot.render` takes their
 * canvas node type (a video take one column right of the take whose still it continues), card, editor, 重试 action,
 * the chat card of `dv_shot_render` calls, and the History row of `shot.render` records.
 *
 * @module @dv/ui-shot-render/client
 */
import { defineGenerationUi } from '@dv/ui-generation/generation-kit.tsx'

/** The video takes of `shot.render`; a take's still, its image output, stands for it in small views. */
export const { inject, apply } = defineGenerationUi({
  id: '@dv/ui-shot-render', type: 'take', operations: ['shot.render'], label: ['版本', 'Take'], color: 'var(--dv-kind-take)',
  deepenOn: ['first_frame'],
  status: { running: ['渲染中…', 'Rendering…'], failed: ['生成失败', 'Render failed'], done: ['已渲染', 'Rendered'] },
  // A text render (task `t2v`) takes no reference images.
  references: record => record.params['task'] !== 't2v',
  preview: (record, state) => record.outputs.find(id => state.assets.find(asset => asset.id === id)?.mime.startsWith('image/') === true),
})
