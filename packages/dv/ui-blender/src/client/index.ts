/**
 * Browser half of the Blender component: the `dv-blender` right-Sidebar tab type, whose body is the Blender panel (how
 * to connect Blender, then its live viewport), the takes of `blender.render` and `blender.animation_render` on the
 * canvas through one `defineGenerationUi` declaration of `@dv/ui-generation`, and the Blender viewport node of the
 * canvas with its card and editor (see `ViewportNode.tsx`).
 *
 * @module @fastvideo/dreamverse-ui-blender/client
 */
import { createElement, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { defineGenerationUi } from '@dv/ui-generation/generation-kit.tsx'
import { pickText } from '@dv/ui-kit/locale.ts'
import { BlenderPanel } from './BlenderPanel.tsx'
import { httpBlenderSource, type BlenderSource } from './viewer.ts'
import { VIEWPORT_TYPE, ViewportCard, ViewportEditor, viewportNodeType } from './ViewportNode.tsx'

export { BlenderPanel } from './BlenderPanel.tsx'
export { drawFrame, useLiveView, type FrameDrawer, type LiveView } from './live-view.ts'
export {
  addonNavigates, httpBlenderSource, VIEW_COMMAND_LIMIT, VIEWPORT_OPERATION,
  type BlenderSource, type BlenderState, type BlenderStatus, type FrameStats, type ViewCommand, type ViewFrame, type ViewListener,
  type ViewPreset,
} from './viewer.ts'
export { buttons, LivePicture, shownSize, ViewportControls } from './controls.tsx'
export { VIEWPORT_SIZING, VIEWPORT_TYPE, ViewportCard, ViewportEditor, viewportNode, viewportNodeType } from './ViewportNode.tsx'

/** The tab kind this package owns. */
export const BLENDER_KIND = 'dv-blender'

/** This implementation's identity in the tab system, and the key its body and its takes register under. */
export const BLENDER_ID = '@fastvideo/dreamverse-ui-blender'

/** The Blender tab type: a page type the guide offers, with no resource address. */
export const blenderDefinition: SidebarRightTabDefinition = {
  id: BLENDER_ID,
  kind: BLENDER_KIND,
  priority: 'builtin',
  keepMounted: true,
  title: () => pickText('Blender', 'Blender'),
  guide: [{
    id: 'blender', order: 37, title: () => pickText('Blender', 'Blender'),
    description: () => pickText('连接 Blender，查看它的实时视口', 'Connect Blender and watch its viewport live'),
  }],
}

/** What the plugin hands the tab body and the viewport node's card and editor. */
interface BlenderTabInjected {
  source: BlenderSource
}

/**
 * The card body of the viewport node over the plugin's link to the bridge.
 * @param props - the card's props and the link.
 * @returns the card.
 */
function ViewportCardBody(props: PropsRuntime<'dv.canvas.card'> & BlenderTabInjected): ReactNode {
  return createElement(ViewportCard, props)
}

/**
 * The editor body of the viewport node over the plugin's link to the bridge.
 * @param props - the editor's props and the link.
 * @returns the editor.
 */
function ViewportEditorBody(props: PropsRuntime<'dv.canvas.editor'> & BlenderTabInjected): ReactNode {
  return createElement(ViewportEditor, props)
}

/**
 * The tab body: the Blender panel; it does not depend on the open project, because one Blender serves the harness.
 * @param props - the tab's props and the host half.
 * @returns the panel.
 */
function BlenderTabBody(props: PropsRuntime<'sidebar.right.pane.tab'> & BlenderTabInjected): ReactNode {
  return createElement(BlenderPanel, { source: props.source })
}

const takes = defineGenerationUi({
  id: BLENDER_ID, type: 'blender', operations: ['blender.render', 'blender.animation_render'], label: ['Blender', 'Blender'],
  color: 'var(--dv-node-4)',
  status: { running: ['渲染中…', 'Rendering…'], failed: ['渲染失败', 'Render failed'], done: ['已渲染', 'Rendered'] },
})

/** Required browser services: the tab registry and the DSH UI slot registry, besides the generation kit's own. */
export const inject = [...new Set([...takes.inject, 'slots', 'sidebarRightTabs'])]

/**
 * The plugin body over a given host half; the tests pass a fake one.
 * @param source - the host half.
 * @returns the body.
 */
export function applyWith(source: BlenderSource): (ctx: ClientContext) => void {
  return (ctx) => { mount(ctx, source) }
}

/**
 * Client plugin body: the Blender takes, and the Blender tab type with its body, over {@link httpBlenderSource}.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  mount(ctx, httpBlenderSource)
}

function mount(ctx: ClientContext, source: BlenderSource): void {
  takes.apply(ctx)
  ctx.effect(() => ctx.sidebarRightTabs.register(blenderDefinition), 'ui-blender: tab type')
  const injected: BlenderTabInjected = { source }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: BLENDER_ID, inject: () => injected },
    BlenderTabBody,
  )), 'ui-blender: tab body')
  // The viewport node type and its card and editor share one scope, so they come and go with the canvas together.
  ctx.inject(['dvCanvas'], (scope) => {
    scope.effect(() => scope.dvCanvas.nodeTypes.register(viewportNodeType(BLENDER_ID)), 'ui-blender: viewport node type')
    scope.effect(() => scope.slots.inject('dv.canvas.card', () => scope.slots.register(
      { name: 'dv.canvas.card', key: VIEWPORT_TYPE, inject: () => injected }, ViewportCardBody,
    )), 'ui-blender: viewport card')
    scope.effect(() => scope.slots.inject('dv.canvas.editor', () => scope.slots.register(
      { name: 'dv.canvas.editor', key: VIEWPORT_TYPE, inject: () => injected }, ViewportEditorBody,
    )), 'ui-blender: viewport editor')
  })
}
