/**
 * Host half of the canvas plugin: the canvas layout store and, while a Connection service is mounted, its
 * authenticated Fetch route. The browser half in `src/client/` registers the tab and the center view.
 *
 * @module @dv/ui-canvas
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-workspace'
import { CanvasLayoutStore, layoutRoutes } from './layout.ts'

/** Required host services: the Workspace registry, which holds each project's folder. */
export const inject = ['workspaceRegistry']

/**
 * Loader entry: build the layout store and register its route while the Connection is mounted.
 * @param ctx - the plugin context.
 */
export function apply(ctx: Context): void {
  const store = new CanvasLayoutStore(ctx.workspaceRegistry)
  ctx.inject(['connection'], (connected) => {
    for (const route of layoutRoutes(store)) {
      connected.effect(() => {
        const dispose = connected.connection.fetch.register(route)
        return () => { void dispose() }
      }, `ui-canvas ${route.path}`)
    }
  })
}
