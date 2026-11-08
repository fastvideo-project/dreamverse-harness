/**
 * Browser half of the Blender component: the `dv-blender` right-Sidebar tab type, whose body is the Blender panel (how
 * to connect Blender, then its live viewport), and the takes of `blender.render` and `blender.animation_render` on the
 * canvas through one `defineGenerationUi` declaration of `@dv/ui-generation`.
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
import { BlenderPanel, httpBlenderSource, type BlenderSource } from './BlenderPanel.tsx'

export { BlenderPanel, httpBlenderSource, type BlenderSource, type BlenderState, type BlenderStatus, type ViewFrame } from './BlenderPanel.tsx'

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

/** What the plugin hands the tab body. */
interface BlenderTabInjected {
  source: BlenderSource
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
}
