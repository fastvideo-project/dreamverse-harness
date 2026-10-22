/**
 * Browser half: provide `dvCanvas`, the registries that plugin UI halves fill; register `dv-canvas` as a right-Sidebar
 * tab type, its dictionaries, and its body; register the canvas as the 画布 view of the workspace center
 * (`dv.center.view`), which declares the slots of the editors: `dv.canvas.editor` of the entries, and `dv.canvas.picker`
 * of the asset pool. Both canvases open the asset preview of `dvMedia` while `@dv/ui-media` provides it.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { DvClient } from '@dv/ui-kit/api.ts'
import type {} from '@dv/ui-media/contract'
import { CanvasBody } from './CanvasBody.tsx'
import type { CanvasInjected } from './CanvasBody.tsx'
import { CanvasCenter } from './CanvasCenter.tsx'
import { CANVAS_ID, canvasDefinition } from './definition.ts'
import { createDvCanvas } from './dv-canvas.ts'
import { en, NS, zh } from './locales.ts'

export type { DvCanvasKey } from './locales.ts'
export type { CanvasBodyProps, CanvasInjected } from './CanvasBody.tsx'
export { CanvasView } from './CanvasView.tsx'
export type { CanvasViewProps } from './CanvasView.tsx'

/** Required browser services: the tab registry, the DSH UI slot registry, and the dictionaries. */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * Client plugin body: provide `dvCanvas`; register the type, its dictionaries, and its body under the type's id, and the
 * center view `canvas`, which draws the project and chat session that the workspace center passes and declares the slots
 * of the entry editors and the asset picker (one entry declares a slot, so the tab body declares none).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // At apply's top level, never inside an effect: other plugins register into the registries from their own fibers.
  const canvas = createDvCanvas()
  ctx.reflect.provide('dvCanvas', canvas)
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(canvasDefinition(t)), 'ui-canvas: tab type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-canvas: dictionaries')
  const injected: CanvasInjected = {
    client: new DvClient(), canvas, preview: (asset, opener) => { ctx.get('dvMedia')?.preview(asset, opener) },
  }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: CANVAS_ID, locale: NS, inject: () => injected },
    CanvasBody,
  )), 'ui-canvas: tab body')
  ctx.effect(() => ctx.slots.inject('dv.center.view', () => ctx.slots.register(
    {
      name: 'dv.center.view', id: 'canvas', order: 0, label: () => t('type.label'), inject: () => injected,
      children: {
        'dv.canvas.editor': { kind: 'keyed', scope: 'root' },
        'dv.canvas.picker': { kind: 'keyed', scope: 'root' },
      },
    },
    CanvasCenter,
  )), 'ui-canvas: center view')
}
