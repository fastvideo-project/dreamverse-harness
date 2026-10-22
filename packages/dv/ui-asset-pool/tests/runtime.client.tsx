/**
 * The asset pool as the DreamVerse bundle loads it: the real `@dv/ui-media` plugin and the real asset pool plugin in a
 * slot test runtime that provides the right-Sidebar tab registry, and whose root frame declares the slots the asset pool
 * fills (the canvas's picker slot, the right-Sidebar tab body slot, and DSH's root `shell.overlay` list) and draws what
 * a test asks for.
 */
import type { ReactNode } from 'react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { FeatureHandle } from '@deepseek-ai/dsh-client-test-runtime'
import { tabInfoFactory } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'

const SLOTS = {
  'dv.canvas.picker': { kind: 'keyed', scope: 'root' },
  'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
  'shell.overlay': { kind: 'list', scope: 'root' },
} as const

/** What the root frame hands a test's drawing. */
export type FrameProps = ComposedProps<'root', never, keyof typeof SLOTS, undefined, object>

/** The mounted runtime and the asset pool plugin's handle. */
export interface MountedAssetPool {
  runtime: SlotTestRuntime
  assetPool: FeatureHandle
}

const runtimes: SlotTestRuntime[] = []

/**
 * Mount the media plugin and the asset pool plugin under a frame that draws `draw` above the `shell.overlay` list. The
 * test renders the root itself with `runtime.renderRoot()`, so `draw` can read what it computed from the mounted
 * registries.
 * @param draw - what the frame draws.
 * @returns the runtime and the asset pool plugin's handle.
 */
export async function mountAssetPool(draw: (props: FrameProps) => ReactNode): Promise<MountedAssetPool> {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  await runtime.root.declare(SLOTS, props => <>{draw(props)}{props.renderSlot('shell.overlay', {})}</>)
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  const assetPool = await runtime.mount({ inject: [...inject], apply })
  return { runtime, assetPool }
}

/** Dispose every runtime that {@link mountAssetPool} created. */
export async function disposeRuntimes(): Promise<void> {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
}
