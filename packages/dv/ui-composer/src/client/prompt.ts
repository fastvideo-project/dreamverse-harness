/**
 * The apply world of the prompt composer: the `dvComposer` registry of parameter bars, the `dv.prompt` Factory with
 * its inject face over the `/api/dv` check route, and the chip face of the `@` source in every prompt occurrence and in
 * the chat composer bar.
 * Live data reaches the components through observable sources: the model catalog, the parameter bars, the version
 * kinds of the canvas, the open project, and the state of each project that a chat chip reads, fetched again after its
 * project events. A `dv.prompt` occurrence draws the state
 * that its host lends, so it fetches no state.
 *
 * @module @dv/ui-composer/prompt
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@dv/ui-canvas/contract'
import { DvClient } from '@dv/ui-kit/api.ts'
import { DV_CURRENT_PROJECT_EVENT, getCurrentProject } from '@dv/ui-kit/current-project.ts'
import { createRegistry, type VersionKind } from '@dv/ui-kit/registries.ts'
import type { WireModelEntry, WireState } from '@dv/ui-kit/types.ts'
import type { DvComposer, DvPromptInjected, ParamBar, ReferenceFaceInjected } from './contract/index.ts'
import { DvPrompt } from './DvPrompt.tsx'
import { MENTION_SOURCE } from './mention.ts'
import { ReferenceFace } from './ReferenceFace.tsx'

/** The wait after the last project event before the state is fetched again, in ms. */
const REFETCH_DELAY_MS = 150

/**
 * The live state of each project that a chat chip reads: fetched on the first subscription, and fetched again after
 * each burst of project events while a consumer subscribes. Only the answer of the newest fetch is kept, and the last
 * consumer to leave drops the state and stops the fetches.
 * @param client - reads a project's state and its events.
 * @returns the source of a project; the same source for the same project while it has a consumer.
 */
export function projectStates(client: Pick<DvClient, 'getState' | 'subscribe'>): (projectId: string) => HostObservable<WireState | null> {
  const sources = new Map<string, HostObservable<WireState | null>>()
  return (projectId) => {
    const known = sources.get(projectId)
    if (known !== undefined) return known
    const store = createSnapshotStore<WireState | null>(null)
    let consumers = 0
    let stop: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let fetches = 0
    const fetchState = (): void => {
      fetches += 1
      const fetched = fetches
      client.getState(projectId).then((state) => { if (fetched === fetches) store.set(state) }, (failure: unknown) => {
        console.error('[dv-composer] state failed:', failure)
      })
    }
    const source: HostObservable<WireState | null> = {
      getSnapshot: () => store.getSnapshot(),
      subscribe: (listener) => {
        const off = store.subscribe(listener)
        consumers += 1
        // A consumer that read this source before the last one left takes it back as the project's source.
        if (!sources.has(projectId)) sources.set(projectId, source)
        // The empty project is a chat chip's while the shell has no project open; it has no state to fetch.
        if (consumers === 1 && projectId !== '') {
          fetchState()
          stop = client.subscribe(projectId, () => {
            if (timer !== null) clearTimeout(timer)
            timer = setTimeout(() => { timer = null; fetchState() }, REFETCH_DELAY_MS)
          })
        }
        return () => {
          off()
          consumers -= 1
          if (consumers > 0) return
          stop?.()
          stop = null
          if (timer !== null) clearTimeout(timer)
          timer = null
          // An answer still in flight is dropped too.
          fetches += 1
          store.set(null)
          sources.delete(projectId)
        }
      },
    }
    sources.set(projectId, source)
    return source
  }
}

/**
 * The model catalog: null until the first load answers, and loaded again each time a consumer subscribes while none
 * did, so an occurrence that opens reads the catalog as it is then, such as after a backend that was down comes back. A
 * failed load keeps the catalog it had.
 * @param load - reads the catalog.
 * @returns the source.
 */
export function catalogSource(load: () => Promise<readonly WireModelEntry[]>): HostObservable<readonly WireModelEntry[] | null> {
  const store = createSnapshotStore<readonly WireModelEntry[] | null>(null)
  let consumers = 0
  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener) => {
      const off = store.subscribe(listener)
      consumers += 1
      if (consumers === 1) {
        load().then((catalog) => { store.set(catalog) }, (failure: unknown) => { console.error('[dv-composer] models failed:', failure) })
      }
      return () => {
        off()
        consumers -= 1
      }
    },
  }
}

/**
 * Provide `dvComposer` and register the `dv.prompt` Factory and the chip face. Call at `apply`'s top level.
 * @param ctx - client root context.
 */
export function applyPrompt(ctx: ClientContext): void {
  const composer: DvComposer = { paramBars: createRegistry<ParamBar>(bar => [bar.operation], bar => bar.owner) }
  ctx.reflect.provide('dvComposer', composer)
  const client = new DvClient()
  const models = catalogSource(() => client.listModels())
  const states = projectStates(client)
  const currentProject = createSnapshotStore<string | null>(getCurrentProject())
  // The version kinds that the canvas holds, which the components read through their hooks; null without the canvas.
  const versionKinds = createSnapshotStore<readonly VersionKind[] | null>(null)
  ctx.inject(['dvCanvas'], (scope) => {
    const registry = scope.dvCanvas.versionKinds
    versionKinds.set(registry.getSnapshot())
    scope.effect(() => {
      const off = registry.subscribe(() => { versionKinds.set(registry.getSnapshot()) })
      return () => {
        off()
        versionKinds.set(null)
      }
    }, 'dv-composer: version kinds')
  })
  ctx.effect(() => {
    const follow = (): void => { currentProject.set(getCurrentProject()) }
    window.addEventListener(DV_CURRENT_PROJECT_EVENT, follow)
    return () => { window.removeEventListener(DV_CURRENT_PROJECT_EVENT, follow) }
  }, 'dv-composer: open project')
  const injected: DvPromptInjected = {
    check: request => client.checkOperation(request),
    hooks: { models, paramBars: composer.paramBars, versionKinds },
  }
  ctx.effect(() => ctx.slots.registerFactory({ name: 'dv.prompt', scope: 'root', inject: () => injected }, DvPrompt), 'dv-composer: dv.prompt')
  const face: ReferenceFaceInjected = {
    hooks: { currentProject, versionKinds },
    keyedHooks: { projectState: states },
  }
  // One face for the chips of every prompt occurrence and of the chat composer bar, which each declare their own slot.
  ctx.effect(() => ctx.slots.inject('conversation.prompt.reference', () => ctx.slots.register(
    { name: 'conversation.prompt.reference', key: MENTION_SOURCE, inject: () => face }, ReferenceFace,
  )), 'dv-composer: prompt chip face')
  ctx.effect(() => ctx.slots.inject('conversation.input.reference', () => ctx.slots.register(
    { name: 'conversation.input.reference', key: MENTION_SOURCE, inject: () => face }, ReferenceFace,
  )), 'dv-composer: chat chip face')
}
