/**
 * The History panel as the DreamVerse bundle loads it: the real `@dv/ui-media` plugin, test media views that show the
 * asset and the purpose they drew, and the real History plugin, in a slot test runtime that provides the right-Sidebar
 * tab registry, a recording `dvCenter` and the canvas registries, and whose root frame renders the History tab body in
 * chat session `s5`.
 */
import type { ReactNode } from 'react'
import { act } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { FeatureHandle } from '@deepseek-ai/dsh-client-test-runtime'
import { tabInfoFactory } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { ComposedProps, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import type { CenterTarget } from '@dv/ui-shell/contract'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { HISTORY_ID } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'

const SLOTS = {
  'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
} as const

/** What the root frame hands its drawing. */
type FrameProps = ComposedProps<'root', never, keyof typeof SLOTS, undefined, object>

/** A test media view: an element that names the asset, its MIME type and the purpose it was drawn at. */
function TestView({ asset, purpose }: PropsRuntime<'dv.media.view'>): ReactNode {
  return <img alt="" data-media={asset.id} data-mime={asset.mime} data-purpose={purpose} />
}

/** The image and video views that a media plugin registers once `dv.media` declares its views. */
const mediaViewsPlugin = {
  inject: ['slots'],
  apply(ctx: Context) {
    for (const key of ['image', 'video']) {
      ctx.effect(() => ctx.slots.inject('dv.media.view', () => ctx.slots.register({ name: 'dv.media.view', key }, TestView)), `test: ${key} view`)
    }
  },
}

/** The mounted History tab and what the tests read from it. */
export interface MountedHistory {
  runtime: SlotTestRuntime
  history: FeatureHandle
  view: RenderResult
  /** The targets that the tab body handed `dvCenter.show`, in order. */
  shown: CenterTarget[]
}

const runtimes: SlotTestRuntime[] = []
const sessions: Disposable[] = []

/**
 * Mount the media plugin, the test media views and the History plugin, render the History tab body of project `p1` in
 * chat session `s5`, and record the center moves.
 * @param plugins - plugins that register into `dvHistory`, mounted after the History plugin.
 * @returns the runtime, the History plugin's handle, the rendered page and the recorded center targets.
 */
export async function mountHistory(plugins: readonly Plugin[] = []): Promise<MountedHistory> {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const shown: CenterTarget[] = []
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  runtime.ctx.provide('dvCenter', { show: (target: CenterTarget) => { shown.push(target) } })
  // A kind's plugin registers its History rows only while the canvas registries exist.
  runtime.ctx.provide('dvCanvas', createDvCanvas())
  const reference: { current: SessionReference | undefined } = { current: undefined }
  await runtime.root.declare(SLOTS, ({ renderSlot, SessionProvider }: FrameProps) => (
    reference.current === undefined
      ? null
      : (
        <SessionProvider session={reference.current}>
          <div data-testid="tab">{renderSlot('sidebar.right.pane.tab', {}, { entryKey: HISTORY_ID, hookContext: {} as never })}</div>
        </SessionProvider>
      )
  ))
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount(mediaViewsPlugin)
  const history = await runtime.mount({ inject: [...inject], apply })
  for (const plugin of plugins) await runtime.mount(plugin)
  const retained = runtime.sessions.retain(await runtime.sessions.add({ id: 's5' }))
  sessions.push(retained)
  reference.current = retained
  const view = runtime.renderRoot()
  act(() => { publishCurrentProject('p1') })
  return { runtime, history, view, shown }
}

/** Release the sessions and dispose every runtime that {@link mountHistory} created. */
export async function disposeHistories(): Promise<void> {
  for (const session of sessions.splice(0)) session[Symbol.dispose]()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  publishCurrentProject(null)
}
