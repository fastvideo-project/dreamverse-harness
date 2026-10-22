/**
 * The History tab as the DreamVerse bundle loads it: the real `@dv/ui-media` plugin, the real asset pool plugin, whose
 * image, video and audio views draw every `dv.media` occurrence, and the real History plugin, in a slot test runtime
 * that provides the right-Sidebar tab registry and a recording `dvCenter`, and whose root frame renders the History tab
 * body in chat session `s5`.
 */
import { act } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { FeatureHandle } from '@deepseek-ai/dsh-client-test-runtime'
import { tabInfoFactory } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-info.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import type { CenterTarget } from '@dv/ui-shell/contract'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import type {} from '../src/client/contract/index.ts'
import { HISTORY_ID } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'

const SLOTS = {
  'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: tabInfoFactory } } },
} as const

/** What the root frame hands its drawing. */
type FrameProps = ComposedProps<'root', never, keyof typeof SLOTS, undefined, object>

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
 * Mount the media plugin, the asset pool plugin and the History plugin, render the History tab body for project `p1` in
 * chat session `s5`, and record the center moves.
 * @returns the runtime, the History plugin's handle, the rendered page and the recorded center targets.
 */
export async function mountHistory(): Promise<MountedHistory> {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  const shown: CenterTarget[] = []
  runtime.ctx.provide('sidebarRightTabs', new SidebarRightTabRegistry(runtime.ctx) as never)
  runtime.ctx.provide('dvCenter', { show: (target: CenterTarget) => { shown.push(target) }, note: () => {} })
  const session = runtime.sessions.retain(await runtime.sessions.add({ id: 's5' }))
  sessions.push(session)
  await runtime.root.declare(SLOTS, ({ renderSlot, SessionProvider }: FrameProps) => (
    <SessionProvider session={session}>
      {renderSlot('sidebar.right.pane.tab', {}, { entryKey: HISTORY_ID, hookContext: {} as never })}
    </SessionProvider>
  ))
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
  const history = await runtime.mount({ inject: [...inject], apply })
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
