/**
 * Browser half of the shot render UI plugin: one `defineGenerationUi` declaration gives the `shot.render` takes their
 * canvas node type (a video take one column right of the take whose still it continues), card, editor, 重试 action,
 * the chat card of `dv_shot_render` calls, and the History row of `shot.render` records. The composer's parameter bar
 * of `shot.render` gives the take editor the video model's chips, its `@` filter, and the shot's words.
 *
 * @module @dv/ui-shot-render/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dv/ui-composer/contract'
import { defineGenerationUi } from '@dv/ui-generation/generation-kit.tsx'
import { shotRenderBar } from './param-bar.ts'

const takes = defineGenerationUi({
  id: '@dv/ui-shot-render', type: 'take', operations: ['shot.render'], label: ['版本', 'Take'], color: 'var(--dv-node-3)',
  deepenOn: ['first_frame'],
  status: { running: ['渲染中…', 'Rendering…'], failed: ['生成失败', 'Render failed'], done: ['已渲染', 'Rendered'] },
  preview: outputs => outputs.find(output => output.mime.startsWith('image/'))?.id,
})

/** The services that the kit's registrations wait on. */
export const inject = takes.inject

/**
 * Register the takes of `shot.render`, and the parameter bar while the composer is loaded.
 * @param ctx - client root context.
 */
export const apply = (ctx: Context): void => {
  takes.apply(ctx)
  ctx.inject(['dvComposer'], (scope) => {
    scope.effect(() => scope.dvComposer.paramBars.register(shotRenderBar), '@dv/ui-shot-render: parameter bar')
  })
}
