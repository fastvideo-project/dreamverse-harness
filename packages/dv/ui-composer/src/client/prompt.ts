/**
 * The apply world of the prompt composer: the `dvComposer` registry of parameter bars, the `dv.prompt` Factory with
 * its inject face over the registered version kinds and the `/api/dv` routes, and the chip face of the `@` source in
 * every prompt occurrence and in the chat composer bar.
 * Live data reaches the components through observable sources: the model catalog, the operation declarations, the
 * open project, and each project's state, fetched again after its project events.
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
import { loadedOnce } from '@dv/ui-kit/loaded.ts'
import { createRegistry, type VersionKind } from '@dv/ui-kit/registries.ts'
import type { WireModelEntry, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import type { DvComposer, DvPromptInjected, ParamBar, PromptDocument, ReferenceFaceInjected } from './contract/index.ts'
import { DvPrompt } from './DvPrompt.tsx'
import { MENTION_SOURCE } from './mention.ts'
import {
  isAtom, reconcile, removeInput, resolveAtom, resolveInput, satisfyingIndexes, type ResolveContext,
} from './reference-model.ts'
import { ReferenceFace } from './ReferenceFace.tsx'

/** The wait after the last project event before the state is fetched again, in ms. */
const REFETCH_DELAY_MS = 150

/**
 * The live state of each project: fetched on the first subscription, and fetched again after each burst of project
 * events while a consumer subscribes.
 * @param client - reads a project's state and its events.
 * @returns the source of a project; the same source for the same project.
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
    const fetchState = (): void => {
      client.getState(projectId).then((state) => { store.set(state) }, (failure: unknown) => { console.error('[dv-composer] state failed:', failure) })
    }
    const source: HostObservable<WireState | null> = {
      getSnapshot: () => store.getSnapshot(),
      subscribe: (listener) => {
        const off = store.subscribe(listener)
        consumers += 1
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
          if (consumers === 0) { stop?.(); stop = null }
        }
      },
    }
    sources.set(projectId, source)
    return source
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
  const models = loadedOnce<readonly WireModelEntry[]>([], () => client.listModels())
  const operations = loadedOnce<readonly WireOperation[]>([], () => client.listOperations())
  const states = projectStates(client)
  const currentProject = createSnapshotStore<string | null>(getCurrentProject())
  // The version kinds that the canvas holds; views read them at call time, and components draw again when they change.
  const versionKinds = createSnapshotStore<readonly VersionKind[]>([])
  ctx.inject(['dvCanvas'], (scope) => {
    const registry = scope.dvCanvas.versionKinds
    versionKinds.set(registry.getSnapshot())
    scope.effect(() => {
      const off = registry.subscribe(() => { versionKinds.set(registry.getSnapshot()) })
      return () => {
        off()
        versionKinds.set([])
      }
    }, 'dv-composer: version kinds')
  })
  ctx.effect(() => {
    const follow = (): void => { currentProject.set(getCurrentProject()) }
    window.addEventListener(DV_CURRENT_PROJECT_EVENT, follow)
    return () => { window.removeEventListener(DV_CURRENT_PROJECT_EVENT, follow) }
  }, 'dv-composer: open project')
  /** The resolve context of a state: the version kinds that the canvas holds now. */
  const contextOf = (state: WireState, document: Pick<PromptDocument, 'inputs'> | null, filter: ResolveContext['filter']): ResolveContext => ({
    state, versions: versionKinds.getSnapshot(), inputs: document?.inputs ?? null, filter,
  })
  const injected: DvPromptInjected = {
    views: (state, document, filter) => {
      const resolve = contextOf(state, document, filter)
      const atoms = document.runs.filter(isAtom)
      return {
        atoms: atoms.map(atom => resolveAtom(atom, resolve)),
        tray: document.inputs.map((input, index) => ({
          input, view: resolveInput(input, resolve),
          cited: atoms.some(atom => satisfyingIndexes(atom.uri, document.inputs, resolve).includes(index)),
        })),
      }
    },
    reconcile: (state, document, runs, removed) => reconcile(document, runs, removed, contextOf(state, document, null)),
    removeInput: (state, document, index) => removeInput(document, index, contextOf(state, document, null)),
    bar: operation => composer.paramBars.getSnapshot().find(bar => bar.operation === operation) ?? null,
    check: request => client.checkOperation(request),
    hooks: { models, operations, versionKinds },
    keyedHooks: { projectState: states },
  }
  ctx.effect(() => ctx.slots.registerFactory({ name: 'dv.prompt', scope: 'root', inject: () => injected }, DvPrompt), 'dv-composer: dv.prompt')
  const face: ReferenceFaceInjected = {
    view: (state, atom, context) => resolveAtom(atom, contextOf(state, context, context?.filter ?? null)),
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
