/**
 * Browser half of the shot render UI plugin: one `defineGenerationUi` declaration gives the `shot.render` takes their
 * canvas node type (a video take one column right of the take whose still it continues), card, editor, 重试 action,
 * the chat card of `dv_shot_render` calls, the History row of `shot.render` records, and the composer's parameter bar of
 * `shot.render`: the video model's chips, its `@` filter, and the shot's words.
 *
 * @module @dv/ui-shot-render/client
 */
import { defineGenerationUi } from '@dv/ui-generation/generation-kit.tsx'
import { shotRenderBar } from './param-bar.ts'

export const { inject, apply } = defineGenerationUi({
  id: '@dv/ui-shot-render', type: 'take', operations: ['shot.render'], label: ['版本', 'Take'], color: 'var(--dv-node-3)',
  deepenOn: ['first_frame'],
  status: { running: ['渲染中…', 'Rendering…'], failed: ['生成失败', 'Render failed'], done: ['已渲染', 'Rendered'] },
  preview: outputs => outputs.find(output => output.mime.startsWith('image/'))?.id,
  bar: shotRenderBar,
})
