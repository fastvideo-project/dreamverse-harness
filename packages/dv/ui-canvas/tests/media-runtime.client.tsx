/**
 * The canvas's media as the bundle mounts it: the real `@dv/ui-media` plugin, which provides `dvMedia`, registers the
 * `dv.media` Factory and shows the asset preview in DSH's `shell.overlay` list, and the real `@dv/ui-asset-pool` plugin,
 * which registers the image, video and audio views and fills the canvas's `dv.canvas.picker` slot.
 */
import type { ReactNode } from 'react'
import type { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { ComposedProps, RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as assetPoolApply, inject as assetPoolInject } from '@dv/ui-asset-pool/src/client/index.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import { apply as mediaApply, inject as mediaInject } from '@dv/ui-media/src/client/index.ts'

/**
 * Mount the media plugin and then the asset pool plugin.
 * @param runtime - a runtime that provides the right Sidebar's tab registry, which the asset pool registers its tab in.
 */
export async function mountMediaPlugins(runtime: SlotTestRuntime): Promise<void> {
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
}

/** The slots that the root frame of {@link mountCanvasFrame} declares: the canvas editor slots and `shell.overlay`. */
const FRAME_SLOTS = {
  'dv.canvas.editor': { kind: 'keyed', scope: 'root' },
  'dv.canvas.picker': { kind: 'keyed', scope: 'root' },
  'shell.overlay': { kind: 'list', scope: 'root' },
} as const

/** What the root frame hands the canvas that a test draws. */
export interface MediaFrame {
  renderSlot: ComposedProps<'root', never, keyof typeof FRAME_SLOTS, undefined, object>['renderSlot']
  renderFactorySlot: RenderFactorySlot
  /** Opens the `dvMedia` preview, as the canvas plugin injects it into both canvases. */
  preview: (projectId: string, asset: Asset, opener: Element | null) => void
}

/**
 * Declare a root frame that draws `draw` above DSH's `shell.overlay` list and declares the canvas editor slots, as the
 * canvas center view does, then mount the media plugins. The test renders the root itself.
 * @param runtime - a fresh runtime.
 * @param draw - the canvas that the frame draws from its renderers and the `dvMedia` preview.
 * @param media - mounts the plugins that provide `dvMedia` and the media views; {@link mountMediaPlugins} by default.
 */
export async function mountCanvasFrame(
  runtime: SlotTestRuntime, draw: (frame: MediaFrame) => ReactNode, media: (runtime: SlotTestRuntime) => Promise<void> = mountMediaPlugins,
): Promise<void> {
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  const preview = (projectId: string, asset: Asset, opener: Element | null): void => {
    runtime.ctx.dvMedia.preview(projectId, asset, opener)
  }
  await runtime.root.declare(FRAME_SLOTS, ({ renderSlot, renderFactorySlot }) => (
    <>{draw({ renderSlot, renderFactorySlot, preview })}{renderSlot('shell.overlay', {})}</>
  ))
  await media(runtime)
}
