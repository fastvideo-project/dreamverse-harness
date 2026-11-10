/**
 * A project state the view tests share: the record that created character `hero` (the state holds no noun slice), two
 * rendered shots put on a timeline, a failed export, and a running retake as the last record. The canvas's node list
 * holds the character node and the two shot nodes; the retake is the second version of the first shot. Also a scripted `fetch`
 * that answers the `/api/dv` routes from such a state and records every write.
 */
import type { AssetId } from '@dv/project/types'
import type { ClipId, TimelineId } from '@dv/timeline/types'
import type { WireReferenceVersion } from '../../ui-reference-kit/src/client/reference-kit.tsx'
import type { WireTaskLabels } from '../src/client/tool-labels.ts'
import type {
  ComponentStates, OperationRequest, ProjectAsset, ProjectRecord, WireCanvas, WireCanvasNode, WireModelEntry, WireOperation, WireProject,
  WireState,
} from '../src/client/types.ts'

// The slice of the test-only reference noun `test_ref`.
declare module '../src/client/types.ts' { interface ComponentStates { test_ref: Record<string, WireReferenceVersion[]> } }

/**
 * A record with defaults for everything a test does not set.
 * @param partial - the fields that matter to the test.
 * @returns the record.
 */
export function record(partial: Partial<ProjectRecord> & { id: string }): ProjectRecord {
  const operation = partial.operation ?? null
  return {
    parents: [], turn: 't1', session: null, kind: 'operation', component: operation?.split('.')[0] ?? 'proj',
    operation, operation_version: operation === null ? null : '1', actor: 'user', surface: 'chat', tool_call: null, intent: '',
    inputs: [], params: {}, outputs: [], based_on: null, supersedes: [], status: 'done', deterministic: true,
    created_at: '2026-10-05T00:00:00Z',
    ...partial,
  }
}

/**
 * An asset.
 * @param id - the asset ID, which doubles as its name.
 * @param mime - the MIME type.
 * @param createdBy - the record that created it.
 * @param durationSec - the duration for videos.
 * @param madeBy - the operation of the project record that output it.
 * @returns the asset.
 */
export function asset(
  id: string, mime: string, createdBy: string | null, durationSec: number | null = null, madeBy: string | null = null,
): ProjectAsset {
  return {
    id, mime, name: id, size_bytes: 3, created_by: createdBy, created_at: `2026-10-05T00:00:0${String(id.length % 10)}Z`,
    width: null, height: null, duration_sec: durationSec, made_by: madeBy,
  }
}

/**
 * A node of the canvas's node list, at the default size of its type.
 * @param kind - the node type key.
 * @param versions - the records it shows, oldest first.
 * @param x - the left edge.
 * @param y - the top edge.
 * @param extra - fields that matter to the test, such as `asset` or a stored size.
 * @returns the node.
 */
export function canvasNode(
  kind: string, versions: string[], x = 0, y = 0, extra: Partial<WireCanvasNode> = {},
): WireCanvasNode {
  return { kind, name: null, versions, position: { x, y, width: null, height: null }, ...extra }
}

/**
 * A canvas slice from nodes keyed by ID, in key order; each node shows the outputs of its versions.
 * @param nodes - the nodes.
 * @param records - the records whose outputs the nodes show.
 * @returns the slice.
 */
export function canvasOf(nodes: Record<string, WireCanvasNode>, records: readonly ProjectRecord[] = []): WireCanvas {
  const assets: Record<string, string> = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (node.asset !== undefined) assets[node.asset] = id
    const outputs = node.versions.flatMap(version => records.find(entry => entry.id === version)?.outputs ?? [])
    for (const output of outputs) assets[output] = id
  }
  return { nodes, order: Object.keys(nodes), assets }
}

/** The project of the fixture. */
export const PROJECT: WireProject = { id: 'p1', title: 'Demo', created_at: '2026-10-05T00:00:00Z', path: '/dv/Demo' }

/** The fixture state: a wire state that holds the `timeline` slice and no noun slice. */
export type FixtureState = WireState & { components: Pick<ComponentStates, 'timeline'> }

/**
 * The shared state.
 * @returns a fresh copy.
 */
export function fixtureState(): FixtureState {
  const hero = { role: 'reference', ref: { character: 'hero', version: 1 }, resolved_asset: 'ref.png' }
  const records = [
    record({ id: 'u1', operation: 'asset.import', params: { name: 'ref.png' }, outputs: ['ref.png'] }),
    record({ id: 'e1', operation: 'character.create', params: { character: 'hero', name: 'Hero' } }),
    record({
      id: 'g1', turn: 't3', actor: 'agent', operation: 'shot.render', deterministic: false, inputs: [hero],
      params: { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'hero walks through the rain at night in the city' }, outputs: ['shot1.mp4', 'shot1-last.png'],
    }),
    record({
      id: 'g2', turn: 't3', actor: 'agent', operation: 'shot.render', deterministic: false,
      inputs: [hero, { role: 'first_frame', ref: { record: 'g1', output: 1 }, resolved_asset: 'shot1-last.png' }],
      params: { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'hero turns' }, outputs: ['shot2.mp4', 'shot2-last.png'],
    }),
    record({ id: 's1', turn: 't3', actor: 'agent', operation: 'timeline.create', params: { assets: ['shot1.mp4', 'shot2.mp4'] } }),
    record({
      id: 'c1', turn: 't4', surface: 'timeline', operation: 'timeline.export', params: { timeline: 't1' },
      inputs: [{ role: 'clip', ref: { asset: 'shot2.mp4' }, resolved_asset: 'shot2.mp4' }], outputs: ['export.mp4'], status: 'failed',
      error: { code: 'operation_failed', message: 'ffmpeg exit 1' },
    }),
    record({
      id: 'x1', turn: 't4', operation: 'asset.grab_still', inputs: [{ role: 'video', ref: { record: 'c1', output: 0 }, resolved_asset: 'export.mp4' }],
      outputs: ['export-last.png'],
    }),
    record({
      id: 'g3', turn: 't5', session: 's5', actor: 'agent', operation: 'shot.render', deterministic: false, based_on: 'g1',
      inputs: [hero], params: { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'hero walks, wider' }, status: 'running',
    }),
  ]
  return {
    project: { id: 'p1', title: 'Demo', created_at: '2026-10-05T00:00:00Z' },
    head: 'g3',
    tip: 'g3',
    components: {
      proj: {
        records,
        stale: { g2: 'g1' },
        superseded: { c1: 'c2' },
        created_by: {
          'ref.png': 'u1', 'shot1.mp4': 'g1', 'shot1-last.png': 'g1', 'shot2.mp4': 'g2', 'shot2-last.png': 'g2', 'export.mp4': 'c1',
          'export-last.png': 'x1',
        },
      },
      canvas: canvasOf({
        e1: canvasNode('character', ['e1'], 0, 0),
        g1: canvasNode('shot', ['g1', 'g3'], 480, 0),
        g2: canvasNode('shot', ['g2'], 480, 200),
      }, records),
      timeline: {
        timelines: [{
          id: 't1' as TimelineId, name: '', sounds: [], sound_track_names: [], clips: [
            { id: 'cl1' as ClipId, asset: 'shot1.mp4' as AssetId, source: null, in_sec: null, out_sec: null },
            { id: 'cl2' as ClipId, asset: 'shot2.mp4' as AssetId, source: null, in_sec: 1, out_sec: 4 },
          ],
        }],
      },
    },
    assets: [
      asset('ref.png', 'image/png', 'u1', null, 'asset.import'),
      asset('shot1.mp4', 'video/mp4', 'g1', 4, 'shot.render'),
      asset('shot1-last.png', 'image/png', 'g1', null, 'shot.render'),
      asset('shot2.mp4', 'video/mp4', 'g2', 6, 'shot.render'),
      asset('shot2-last.png', 'image/png', 'g2', null, 'shot.render'),
      asset('export.mp4', 'video/mp4', 'c1', 3, 'timeline.export'),
      asset('export-last.png', 'image/png', 'x1', null, 'asset.grab_still'),
    ],
  }
}

/**
 * A copy of a state that holds the test-only reference noun `test_ref`: its slice holds the versions of `hero`, and the
 * record `e1` that wrote them is the one record `test_ref.create`, shown by the `test_ref` node `e1`.
 * @param state - a state such as {@link fixtureState}.
 * @returns the copy.
 */
export function withTestRef<S extends WireState>(state: S): S {
  const { proj, canvas } = state.components
  const create = record({ id: 'e1', operation: 'test_ref.create', params: { test_ref: 'hero', name: 'Hero' } })
  return {
    ...state,
    components: {
      ...state.components,
      proj: { ...proj, records: proj.records.map(entry => entry.id === create.id ? create : entry) },
      canvas: { ...canvas, nodes: { ...canvas.nodes, e1: canvasNode('test_ref', ['e1'], 0, 0) } },
      test_ref: { hero: [{ id: 'hero', version: 1, name: 'Hero', description: 'A tired detective.', references: ['ref.png'], created_by: create.id }] },
    },
  }
}

/** The operation declarations the fixture's records use. */
export const OPERATIONS: WireOperation[] = [
  {
    name: 'shot.render', version: '1', description: 'One shot.', inputs: { reference: { type: 'image', description: 'reference images', many: true, versioned: true } },
    params: {
      prompt: { type: 'string', required: true, description: 'What happens.' }, seed: { type: 'integer', description: 'Seed.' },
      aspect: { type: 'string', enum: ['16:9', '9:16'] }, loop: { type: 'boolean' }, extra: { type: 'object' },
    },
    outputs: [{ role: 'video', type: 'video' }, { role: 'last_still', type: 'image' }], deterministic: false, resource: 'gpu',
  },
  {
    name: 'timeline.create', version: '1', description: 'Create a timeline.', inputs: {}, params: {}, outputs: [], deterministic: true, resource: 'none',
  },
]

/** The model catalog: the reference-image video model of the takes, and a second one that takes no reference. */
export const MODELS: WireModelEntry[] = [
  {
    modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', description: 'References to video.',
    schema: { duration_sec: { min: 1, max: 5 }, aspect_ratios: ['16:9', '9:16'], resolutions: ['720p'], inputs: { reference: { min: 1, max: 2, media_types: { image: {} } } }, extra: {} },
  },
  {
    modality: 'video', task: 't2v', provider: 'fastvideo', model: 'fastt2v', description: 'Text to video.',
    schema: { duration_sec: { min: 1, max: 3 }, aspect_ratios: ['16:9'], resolutions: ['720p'], inputs: {}, extra: {} },
  },
]

/** The task labels of the video declaration, as the model catalog serves them at `GET /api/dv/tasks`. */
export const TASK_LABELS: WireTaskLabels = {
  t2v: { zh: '文字生成', en: 'From text' },
  ref2v: { zh: '参考图生成', en: 'From references' },
}

/** Every POST the scripted fetch received, by path. */
export interface Recorded {
  path: string
  body: unknown
}

/** What the scripted fetch answers with. */
export interface ScriptedRoutes {
  projects?: WireProject[]
  state?: WireState | (() => WireState)
  operations?: WireOperation[]
  tasks?: WireTaskLabels
  models?: WireModelEntry[]
  /** Answer a POST; return `{status, body}` or throw. Default echoes a done record. */
  post?: (path: string, body: unknown) => { status: number; body: unknown }
}

/**
 * A `fetch` that answers the `/api/dv` routes from fixed data and records writes.
 * @param routes - the answers.
 * @returns the fetch and the recorded writes.
 */
export function scriptedFetch(routes: ScriptedRoutes = {}): { fetch: typeof fetch; writes: Recorded[] } {
  const writes: Recorded[] = []
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://host')
    if (init?.method === 'POST') {
      const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : '')
      writes.push({ path: url.pathname, body })
      if (routes.post !== undefined) {
        const answer = routes.post(url.pathname, body)
        return Promise.resolve(json(answer.body, answer.status))
      }
      if (url.pathname === '/api/dv/operation/check') return Promise.resolve(json({ problems: [] }))
      if (url.pathname === '/api/dv/operation') {
        const request = body as OperationRequest
        return Promise.resolve(json(record({ id: `new-${String(writes.length)}`, operation: request.operation, params: request.params ?? {}, outputs: ['new.mp4'] })))
      }
      // Undo and redo move the current position and answer the line.
      if (url.pathname === '/api/dv/undo' || url.pathname === '/api/dv/redo') return Promise.resolve(json({ tip: 'g3', at: 'g3' }))
      return Promise.resolve(json({ record: record({ id: 'b1' }) }))
    }
    switch (url.pathname) {
      case '/api/dv/projects': return Promise.resolve(json(routes.projects ?? [PROJECT]))
      case '/api/dv/state': {
        const state = routes.state ?? fixtureState
        return Promise.resolve(json(typeof state === 'function' ? state() : state))
      }
      case '/api/dv/operations': return Promise.resolve(json(routes.operations ?? OPERATIONS))
      case '/api/dv/tasks': return Promise.resolve(json(routes.tasks ?? TASK_LABELS))
      case '/api/dv/models': return Promise.resolve(json(routes.models ?? MODELS))
      default: return Promise.resolve(json({ error: `no route ${url.pathname}` }, 404))
    }
  }
  return { fetch: fetchImpl, writes }
}
