/**
 * Browser half: provide `dvCanvas`, the registries that plugin UI halves fill; register the `dv.canvas` Component
 * Factory and its child slots; register `dv-canvas` as a right-Sidebar tab type, its dictionaries, and its body; and
 * register the canvas as the 画布 view of the workspace center (`dv.center.view`). The tab body and the center view
 * each render a `dv.canvas` occurrence. A mounted canvas answers the `dv_canvas_read` reads of its project through the
 * canvas stream that `CanvasViews` holds open. While `dvHistory` is loaded, the History rows of `canvas.node_position`,
 * `canvas.node_remove` and `canvas.node_rename` name each move, resize, removal and rename.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { DvClient } from '@dv/ui-kit/api.ts'
import type {} from '@dv/ui-history/contract'
import type {} from '@dv/ui-media/contract'
import { CanvasViews } from './agent-canvas.ts'
import { CanvasBody } from './CanvasBody.tsx'
import type { CanvasInjected } from './CanvasBody.tsx'
import { CanvasCenter } from './CanvasCenter.tsx'
import { CanvasFactory } from './CanvasFactory.tsx'
import type { CanvasFactoryInjected } from './CanvasFactory.tsx'
import { CANVAS_ID, canvasDefinition } from './definition.ts'
import { createDvCanvas } from './dv-canvas.ts'
import { positionRow, removeRow, renameRow } from './history-row.ts'
import { en, NS, zh } from './locales.ts'

export type { DvCanvasKey } from './locales.ts'

/** Required browser services: the tab registry, the DSH UI slot registry, and the dictionaries. */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // At apply's top level, never inside an effect: other plugins register into the registries from their own fibers.
  const canvas = createDvCanvas()
  ctx.reflect.provide('dvCanvas', canvas)
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(canvasDefinition(t)), 'ui-canvas: tab type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-canvas: dictionaries')
  const client = new DvClient()
  const views = new CanvasViews()
  const factory: CanvasFactoryInjected = {
    client,
    views,
    preview: (projectId, asset, opener) => { ctx.get('dvMedia')?.preview(projectId, asset, opener) },
    hooks: {
      nodeTypes: canvas.nodeTypes, recordsInUse: canvas.recordsInUse,
      versionKinds: canvas.versionKinds, actions: canvas.actions,
    },
  }
  ctx.effect(() => ctx.slots.registerFactory(
    {
      name: 'dv.canvas', scope: 'root', locale: NS, inject: () => factory,
      children: {
        'dv.canvas.card': { kind: 'keyed', scope: 'root' },
        'dv.canvas.editor': { kind: 'keyed', scope: 'root' },
        'dv.canvas.picker': { kind: 'keyed', scope: 'root' },
      },
    },
    CanvasFactory,
  ), 'ui-canvas: dv.canvas')
  const body: CanvasInjected = { client }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: CANVAS_ID, locale: NS, inject: () => body },
    CanvasBody,
  )), 'ui-canvas: tab body')
  ctx.effect(() => ctx.slots.inject('dv.center.view', () => ctx.slots.register(
    { name: 'dv.center.view', id: 'canvas', order: 0, label: () => t('type.label') },
    CanvasCenter,
  )), 'ui-canvas: center view')
  ctx.inject(['dvHistory'], (history) => {
    history.effect(() => history.dvHistory.rows.register(positionRow(canvas.nodeTypes)), 'ui-canvas: history row')
    history.effect(() => history.dvHistory.rows.register(removeRow(canvas.nodeTypes)), 'ui-canvas: removal history row')
    history.effect(() => history.dvHistory.rows.register(renameRow(canvas.nodeTypes)), 'ui-canvas: rename history row')
  })
}
