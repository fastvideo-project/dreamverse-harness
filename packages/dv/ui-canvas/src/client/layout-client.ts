/**
 * The canvas's browser client of its layout route. Requests are same-origin, so the web application's authentication
 * cookie travels with them.
 *
 * @module @dv/ui-canvas/client/layout-client
 */
import { CANVAS_LAYOUT_ROUTE, type CanvasLayout } from '../canvas-layout.ts'

/**
 * @param response - a layout route answer.
 * @returns its layout.
 * @throws Error when the route refused the request.
 */
async function layoutOf(response: Response): Promise<CanvasLayout> {
  if (!response.ok) throw new Error(`${CANVAS_LAYOUT_ROUTE} answered HTTP ${String(response.status)}`)
  return await response.json() as CanvasLayout
}

/**
 * @param project - the project.
 * @returns the project's stored canvas layout.
 */
export async function readLayout(project: string): Promise<CanvasLayout> {
  return layoutOf(await fetch(`${CANVAS_LAYOUT_ROUTE}?${new URLSearchParams({ project }).toString()}`))
}

/**
 * Store the project's canvas viewport.
 * @param project - the project.
 * @param patch - the viewport.
 * @returns the stored layout.
 */
export async function writeLayout(project: string, patch: CanvasLayout): Promise<CanvasLayout> {
  return layoutOf(await fetch(CANVAS_LAYOUT_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, ...patch }) }))
}
