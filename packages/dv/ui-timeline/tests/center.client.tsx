/**
 * The timeline plugin booted over recording services, for specs that render its components directly with the values
 * that the plugin injects. A stand-in for the shell's center of project p1 keeps the center fields that the view notes
 * and the request that a test hands it. A scripted API can add the tracks that the editor's 添加轨道 menu writes.
 */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { CenterFields, CenterRequest, JsonFields } from '@dv/ui-shell/contract'
import type { TrackKind } from '@dv/timeline/types'
import type { DvClient } from '@dv/ui-kit/api.ts'
import { record } from '../../ui-kit/tests/fixture.client.tsx'
import type { FixtureState, ScriptedRoutes } from '../../ui-kit/tests/fixture.client.tsx'
import type { TimelineInjected } from '../src/client/TimelineBody.tsx'
import { TimelineView } from '../src/client/TimelineView.tsx'
import type { TimelineCenterInjected, TimelineViewProps } from '../src/client/TimelineView.tsx'
import { apply, inject } from '../src/client/index.ts'

/** One registration that the plugin made through the recording `ctx.slots`. */
export interface Registered {
  name: string
  key?: string
  id?: string
  inject: () => object
  component: unknown
}

/** What the stand-in center holds. */
export interface StandInSnapshot {
  fields: CenterFields
  request: CenterRequest | null
}

/** The shell's center of project p1, as a stand-in. */
export interface StandInCenter extends HostObservable<StandInSnapshot> {
  /** Hand the view a request with this value, as `dvCenter.show` does. */
  show: (value: JsonFields) => void
  /** Set center fields, as the view's `note` does; null removes a field. */
  note: (fields: Readonly<Record<string, string | null>>) => void
}

/** The booted plugin. */
export interface BootedTimeline {
  ctx: Context
  fiber: Fiber
  registered: Registered[]
  /** The center of project p1 that {@link centerView} draws the view in. */
  stand: StandInCenter
  center: () => TimelineCenterInjected
  tab: () => TimelineInjected
}

/**
 * A stand-in center whose request leaves once the view takes it.
 * @returns the center.
 */
export function standInCenter(): StandInCenter {
  let snapshot: StandInSnapshot = { fields: {}, request: null }
  const listeners = new Set<() => void>()
  const publish = (next: StandInSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    show: (value) => {
      const request: CenterRequest = { value, take: () => { if (snapshot.request === request) publish({ ...snapshot, request: null }) } }
      publish({ ...snapshot, request })
    },
    note: (fields) => {
      const merged = Object.entries({ ...snapshot.fields, ...fields }).filter((field): field is [string, string] => field[1] !== null)
      publish({ ...snapshot, fields: Object.fromEntries(merged) })
    },
  }
}

/**
 * Boot the plugin over recording `slots`, `locale` and `sidebarRightTabs` services and a `dvCenter` that shows nothing.
 * @returns the booted plugin.
 */
export async function bootTimeline(): Promise<BootedTimeline> {
  const ctx = new Context()
  const registered: Registered[] = []
  ctx.provide('slots', {
    inject: (_name: string, register: () => () => void) => register(),
    register: (options: Omit<Registered, 'component'>, component: unknown) => {
      const entry: Registered = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    },
  } as never)
  ctx.provide('locale', { bind: () => (key: string) => key, register: () => () => {} } as never)
  ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
  ctx.provide('dvCenter', { show: () => {} })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const injected = <T,>(name: string): () => T => () => {
    const entry = registered.find(item => item.name === name)
    if (entry === undefined) throw new Error(`no ${name} registration`)
    return entry.inject() as T
  }
  return {
    ctx, fiber, registered, stand: standInCenter(),
    center: injected<TimelineCenterInjected>('dv.center.view'),
    tab: injected<TimelineInjected>('sidebar.right.pane.tab'),
  }
}

/**
 * A selector hook over an observable source, as the renderer binds an inject `hooks` member.
 * @param source - the source.
 * @returns the hook.
 */
export function selectorHook<T>(source: HostObservable<T>): <S>(select: (value: T) => S) => S {
  return select => useSyncExternalStore(listener => source.subscribe(listener), () => select(source.getSnapshot()))
}

/** What {@link centerView} draws besides the plugin's injected values. */
export interface CenterViewOptions {
  client: DvClient
  session?: string | null
}

function CenterFrame({ booted, options }: { booted: BootedTimeline; options: CenterViewOptions }): ReactNode {
  const { fields, request } = useSyncExternalStore(listener => booted.stand.subscribe(listener), () => booted.stand.getSnapshot())
  const props = {
    ...booted.center(), projectId: 'p1', client: options.client, session: options.session ?? null, request, fields,
    note: booted.stand.note,
  } as TimelineViewProps
  return <TimelineView {...props} />
}

/**
 * The center view of project p1, with the plugin's injected center values, in the booted plugin's stand-in center.
 * @param booted - the booted plugin.
 * @param options - the client and the center's chat session.
 * @returns the element.
 */
export function centerView(booted: BootedTimeline, options: CenterViewOptions): ReactNode {
  return <CenterFrame booted={booted} options={options} />
}

/**
 * Scripted routes whose state adds a track to the first timeline for each `timeline.track_add` the editor writes; every
 * other write is answered and left out of the state.
 * @param base - the state before the writes.
 * @returns the routes.
 */
export function addingTracks(base: () => FixtureState): ScriptedRoutes {
  const added: TrackKind[] = []
  return {
    state: () => {
      const state = base()
      state.components.timeline.timelines[0]?.track_order.push(...added)
      return state
    },
    post: (_path, body) => {
      const { operation, params = {} } = body as { operation: string; params?: Record<string, unknown> }
      if (operation === 'timeline.track_add') added.push(params['kind'] as TrackKind)
      return { status: 200, body: record({ id: `w${String(added.length)}`, operation, params }) }
    },
  }
}
