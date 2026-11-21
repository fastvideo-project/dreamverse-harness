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
import { createElement, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@dv/ui-canvas/contract'
import { DvClient, errorMessage } from '@dv/ui-kit/api.ts'
import { providerName } from '@dv/ui-kit/cloud-model-settings.ts'
import { DV_CURRENT_PROJECT_EVENT, getCurrentProject } from '@dv/ui-kit/current-project.ts'
import { pickText } from '@dv/ui-kit/locale.ts'
import { createRegistry, type VersionKind } from '@dv/ui-kit/registries.ts'
import type { WireModelEntry, WireState } from '@dv/ui-kit/types.ts'
import type { DvComposer, DvPromptInjected, ParamBar, ReferenceFaceInjected } from './contract/index.ts'
import { DvPrompt } from './DvPrompt.tsx'
import { MENTION_SOURCE } from './mention.ts'
import { ReferenceFace } from './ReferenceFace.tsx'
import { ModelPickers } from './ModelPicker.tsx'

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
 * The model catalog, with the message of its last failed load and a reload that a consumer requests, such as when the
 * user opens a menu that lists it or presses Try again.
 */
export interface CatalogSource extends HostObservable<readonly WireModelEntry[] | null> {
  /** The message of the last load when it failed; null while a load is in flight and after a load succeeds. */
  readonly failure: HostObservable<string | null>
  /** Load the catalog again unless a load is in flight. */
  readonly reload: () => void
}

/**
 * The model catalog: null until the first load answers. Each subscription and each `reload()` starts a load unless one
 * is in flight, so an occurrence that opens reads the catalog as it is then, such as after a backend that was down comes
 * back, even while another consumer stays subscribed. A failed load keeps the catalog it had and records its message in
 * `failure` until the next load starts. While it has a consumer, it also loads again after each burst of changes that
 * `follow` reports, such as a model added in Settings; a burst that arrives while a load is in flight loads once more
 * after that load settles.
 * @param load - reads the catalog.
 * @param follow - calls its argument after each change of the catalog and returns the function that stops; omitted, the
 *   catalog loads only on a subscription or a `reload()`.
 * @returns the source.
 */
export function catalogSource(
  load: () => Promise<readonly WireModelEntry[]>,
  follow?: (onChange: () => void) => () => void,
): CatalogSource {
  const store = createSnapshotStore<readonly WireModelEntry[] | null>(null)
  const failure = createSnapshotStore<string | null>(null)
  let loading = false
  // Set by a catalog change during a load, whose answer may predate the change.
  let changedWhileLoading = false
  let consumers = 0
  let stop: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const reload = (): void => {
    if (loading) return
    loading = true
    // Clearing the failure takes down the Try again alert while the load runs, so a failed retry shows the alert anew.
    failure.set(null)
    load().then((catalog) => { store.set(catalog) }, (error: unknown) => {
      console.error('[dv-composer] models failed:', error)
      failure.set(errorMessage(error))
    }).finally(() => {
      loading = false
      if (!changedWhileLoading) return
      changedWhileLoading = false
      reload()
    })
  }
  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener) => {
      const off = store.subscribe(listener)
      consumers += 1
      reload()
      if (consumers === 1) {
        stop = follow?.(() => {
          if (timer !== null) clearTimeout(timer)
          timer = setTimeout(() => {
            timer = null
            if (loading) changedWhileLoading = true
            else reload()
          }, REFETCH_DELAY_MS)
        }) ?? null
      }
      return () => {
        off()
        consumers -= 1
        if (consumers > 0) return
        stop?.()
        stop = null
        if (timer !== null) clearTimeout(timer)
        timer = null
      }
    },
    failure: { getSnapshot: () => failure.getSnapshot(), subscribe: listener => failure.subscribe(listener) },
    reload,
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
  const currentProject = createSnapshotStore<string | null>(getCurrentProject())
  // The catalog's changes arrive on the open project's event stream, so following them opens no other connection.
  const models = catalogSource(() => client.listModels(), (onChange) => {
    let leave = (): void => {}
    const join = (): void => {
      leave()
      const project = currentProject.getSnapshot()
      leave = project === null ? () => {} : client.subscribeModels(project, onChange)
    }
    join()
    const off = currentProject.subscribe(join)
    return () => {
      off()
      leave()
    }
  })
  const states = projectStates(client)
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
  const cloudProviders = () => ctx.get('dvCloudModels')?.getSnapshot() ?? []
  type GenerationDefaults = Record<string, { provider: string; model: string }>
  const defaultsForm = (): ConfigForm<{ defaults?: GenerationDefaults }> | undefined =>
    ctx.get('configForms')?.get('dv-models')
  const defaultsSnapshot = (): ConfigFormSnapshot<{ defaults?: GenerationDefaults }> | undefined =>
    defaultsForm()?.getSnapshot()
  const subscribeDefaults = (listener: () => void): (() => void) => defaultsForm()?.subscribe(listener) ?? (() => {})
  /** No defaults while the Settings document is still loading, so an empty read seeds nothing. */
  const NO_DEFAULTS: Readonly<GenerationDefaults> = {}
  /** Blank conversations that already received the Settings defaults, so a re-render records them only once. */
  const seeded = new Set<string>()
  function ConversationModels({ sessionId }: { sessionId: string }) {
    const projectId = useSyncExternalStore(currentProject.subscribe, currentProject.getSnapshot)
    const state = states(projectId ?? '')
    const project = useSyncExternalStore(state.subscribe, state.getSnapshot)
    const settings = useSyncExternalStore(subscribeDefaults, defaultsSnapshot)
    const [seedFailed, setSeedFailed] = useState(false)
    const live = useRef(true)
    useEffect(() => {
      live.current = true
      return () => { live.current = false }
    }, [])
    const defaults = settings?.status === 'ready' ? settings.value?.defaults ?? NO_DEFAULTS : NO_DEFAULTS
    // One write per gesture: a conversation records each media type in turn, while the home picker replaces the whole
    // Settings defaults object in one mutation so clearing several media types cannot collide on one revision.
    const save = async (writes: readonly (readonly [string, { provider: string; model: string } | null])[]): Promise<void> => {
      if (projectId !== null) {
        for (const [modality, selection] of writes) {
          await client.runOperation({ project: projectId, session: sessionId, surface: 'chat', operation: 'models.select',
            params: { modality, ...selection === null ? { provider: '', model: '' } : selection } })
        }
        return
      }
      const form = defaultsForm()
      const current = form?.getSnapshot()
      if (form === undefined || current === undefined || current.status !== 'ready') throw new Error('Settings are unavailable.')
      const written = new Set(writes.map(([modality]) => modality))
      const next: GenerationDefaults = Object.fromEntries(Object.entries(current.value?.defaults ?? {})
        .filter(([modality]) => !written.has(modality)))
      for (const [modality, selection] of writes) {
        if (selection !== null) next[modality] = selection
      }
      if (!await form.mutate([{ op: 'set', path: ['defaults'], value: next }], current.revision)) {
        throw new Error('Settings changed elsewhere. Try again.')
      }
    }
    useEffect(() => {
      // Seeding waits for the Settings document itself: reading it mid-load would record an empty defaults object.
      if (projectId === null || project === null || settings?.status !== 'ready' || seeded.has(sessionId)) return
      const summaries: Readonly<Record<string, { blank: boolean } | undefined>> = ctx.sessions.list.getSnapshot().byId
      if (summaries[sessionId]?.blank !== true) return
      const slice = project.components['models'] as { conversations?: Record<string, unknown> } | undefined
      if (slice?.conversations?.[sessionId] !== undefined) return
      seeded.add(sessionId)
      const chosen = Object.entries(defaults)
      // A default whose model is no longer configured stays Auto.
      if (chosen.length > 0) {
        save(chosen).catch((_unavailable: unknown) => {
          // The conversation keeps Auto for the media types that were not recorded; the picker says so.
          if (live.current) setSeedFailed(true)
        })
      }
    }, [projectId, project, sessionId, settings, defaults])
    return createElement(ModelPickers, {
      key: `${projectId ?? ''}:${sessionId}`, sessionId, state, models, reloadModels: models.reload, save,
      defaults, notice: seedFailed ? pickText('无法应用默认模型，请在选择器中重新选择。',
        'Could not apply your default models. Pick them in the model picker.') : null,
      logoOf: provider => cloudProviders().find(entry => entry.id === provider)?.logo,
      providerName: provider => providerName(cloudProviders(), provider),
    })
  }
  ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'dv-model-choices', order: 40 }, ConversationModels,
  )), 'dv-composer: model choices')
  const injected: DvPromptInjected = {
    check: request => client.checkOperation(request),
    reloadModels: models.reload,
    hooks: { models, modelsFailure: models.failure, paramBars: composer.paramBars, versionKinds },
  }
  ctx.effect(() => ctx.slots.registerFactory({ name: 'dv.prompt', scope: 'root', inject: () => injected }, DvPrompt), 'dv-composer: dv.prompt')
  const face: ReferenceFaceInjected = {
    hooks: { currentProject, versionKinds },
    keyedHooks: { projectState: states },
  }
  ctx.effect(() => ctx.slots.inject('conversation.prompt.reference', () => ctx.slots.register(
    { name: 'conversation.prompt.reference', key: MENTION_SOURCE, inject: () => face }, ReferenceFace,
  )), 'dv-composer: prompt chip face')
  ctx.effect(() => ctx.slots.inject('conversation.input.reference', () => ctx.slots.register(
    { name: 'conversation.input.reference', key: MENTION_SOURCE, inject: () => face }, ReferenceFace,
  )), 'dv-composer: chat chip face')
}
