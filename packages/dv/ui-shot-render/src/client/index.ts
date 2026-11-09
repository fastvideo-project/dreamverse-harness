/**
 * Browser half of the shot render UI plugin: one `defineGenerationUi` declaration gives the `shot` nodes of
 * `shot.render` records their canvas node type, card, editor and 重试 action, and registers the chat card of
 * `dv_shot_render` calls, the History row of `shot.render` records, and the composer's parameter bar of
 * `shot.render`: the video model's chips, its `@` filter, and the shot's words.
 *
 * @module @dv/ui-shot-render/client
 */
import { defineGenerationUi } from '@dv/ui-generation/generation-kit.tsx'
import { shotRenderBar } from './param-bar.ts'

export const { inject, apply } = defineGenerationUi({
  id: '@dv/ui-shot-render', type: 'shot', operations: ['shot.render'], label: ['镜头', 'Shot'], color: 'var(--dv-node-3)',
  status: { running: ['渲染中…', 'Rendering…'], failed: ['生成失败', 'Render failed'], done: ['已渲染', 'Rendered'] },
  preview: outputs => outputs.find(output => output.mime.startsWith('image/'))?.id,
  bar: shotRenderBar,
})
