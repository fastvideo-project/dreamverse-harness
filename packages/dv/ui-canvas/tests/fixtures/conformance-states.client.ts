/**
 * The 23 project states of the canvas conformance check: the rollback project of a plan with four versions, cut after
 * ten records, with and without placed assets; the whole rollback project with plan and shot references; and the shared
 * view fixture with and without every asset placed. The graph that the canvas draws for each state with the registered
 * node types, and the History label of each record, must equal what `origin/main` showed at the branch's merge base
 * (`main-graph.json`, written by `main-graph.gen.client.ts`).
 */
import type { AssetId, RecordId } from '@dv/project/types'
import type { PlanId, PlanVersion } from '@dv/shot-plan/types'
import type { ClipId, TimelineId } from '@dv/timeline/types'
import type { ProjectAsset, ProjectRecord, WireOperation, WireState } from '@dv/ui-kit/types.ts'

/** A record with defaults for every field the case does not set. */
const record = (partial: Partial<ProjectRecord> & { id: string }): ProjectRecord => {
  const operation = partial.operation ?? null
  return {
    parents: [], turn: 't1', session: null, kind: 'operation', component: operation?.split('.')[0] ?? 'proj', operation,
    operation_version: '1', actor: 'user', surface: 'chat', tool_call: null, intent: '', inputs: [], params: {}, outputs: [],
    based_on: null, supersedes: [], status: 'done', deterministic: true, created_at: '2026-10-05T00:00:00Z', ...partial,
  }
}
const asset = (id: string, mime: string, createdBy: string | null, durationSec: number | null = null): ProjectAsset =>
  ({ id, mime, name: id, size_bytes: 3, created_by: createdBy, created_at: '2026-10-05T00:00:00Z', width: null, height: null, duration_sec: durationSec, made_by: null })

/** The operation declarations of the cases. */
export const OPS: WireOperation[] = [{
  name: 'shot.render', version: '1', description: '', deterministic: false, resource: 'gpu', confirm: 'never',
  outputs: [{ role: 'video', type: 'video' }, { role: 'still', type: 'image' }], label: { zh: '渲染镜头', en: 'Render shot' }, params: {}, inputs: {},
}]

/** The rollback project of a plan with four versions, its renders, timelines and a clip replacement, cut after `until`. */
function rollbackProject(until?: string): WireState {
  const hero = { role: 'reference', ref: { test_ref: 'hero', version: 1 }, resolved_asset: 'ref.png' }
  const render = (id: string, version: number, shot: number, basedOn: string | null = null): ProjectRecord => record({
    id, operation: 'shot.render', deterministic: false, inputs: [hero], based_on: basedOn, outputs: [`${id}.mp4`, `${id}.png`],
    params: { prompt: `shot ${String(shot)} v${String(version)}`, plan: 'p1', plan_version: version, shot },
    ...basedOn === null ? { started_by: { record: `a${String(version)}`, slot: shot } } : {},
  })
  const layout = (id: string, operation: string, clips: string[]): ProjectRecord => record({
    id, operation, params: { timeline: 't1', plan: 'p1' }, started_by: { record: `a${id.slice(1)}`, slot: null },
    inputs: clips.map(clip => ({ role: 'clip', ref: { record: clip, output: 0 }, resolved_asset: `${clip}.mp4` })),
  })
  const approve = (id: string, version: number): ProjectRecord => record({ id, operation: 'plan.approve', params: { plan: 'p1', version } })
  const v1 = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']
  const all = [
    record({ id: 'u1', operation: 'asset.import', params: { name: 'ref.png' }, outputs: ['ref.png'] }),
    record({ id: 'e1', operation: 'test_ref.create', params: { test_ref: 'hero', name: 'Hero' } }),
    record({ id: 'q1', operation: 'plan.create' }),
    approve('a1', 1), ...v1.map((id, index) => render(id, 1, index + 1)), layout('l1', 'timeline.create', v1),
    record({ id: 'q2', operation: 'plan.update' }), approve('a2', 2), render('s3', 2, 3), render('s7', 2, 7),
    layout('l2', 'timeline.update', ['r1', 'r2', 's3', 'r4', 'r5', 'r6', 's7']), render('x7', 2, 7, 's7'),
    record({ id: 'q3', operation: 'plan.update' }), approve('a3', 3), render('w5', 3, 5),
    layout('l3', 'timeline.update', ['r1', 'r2', 's3', 'r4', 'w5', 'r6', 's7']),
    record({ id: 'k1', operation: 'timeline.clip_replace', inputs: [{ role: 'clip', ref: { asset: 'r3.mp4' }, resolved_asset: 'r3.mp4' }] }),
    record({ id: 'q4', operation: 'plan.update' }), approve('a4', 4), layout('l4', 'timeline.update', v1),
  ]
  const kept = until === undefined ? all : all.slice(0, all.findIndex(entry => entry.id === until) + 1)
  const ids = new Set(kept.map(entry => entry.id))
  const shots = (count: number) => Array.from({ length: count }, () => ({ prompt: 'p', modality: 'video', task: 'ref2v', provider: '', model: '' }))
  const versions: PlanVersion[] = [
    { version: 1, shots: shots(6), created_by: 'q1' as RecordId }, { version: 2, shots: shots(7), created_by: 'q2' as RecordId },
    { version: 3, shots: shots(7), created_by: 'q3' as RecordId }, { version: 4, shots: shots(6), created_by: 'q4' as RecordId },
  ].filter(version => ids.has(version.created_by))
  const clips = (kept.findLast(entry => entry.operation?.startsWith('timeline.') === true && entry.id.startsWith('l'))?.inputs ?? [])
    .map((input, index) => ({
      id: `cl${String(index + 1)}` as ClipId, asset: input.resolved_asset as AssetId | null, source: null, in_sec: index === 1 ? 1 : null, out_sec: null,
    }))
  if (ids.has('k1') && !ids.has('l4')) clips[2] = { id: 'cl3' as ClipId, asset: 'r3.mp4' as AssetId, source: null, in_sec: null, out_sec: null }
  const renders = kept.filter(entry => entry.operation === 'shot.render')
  return {
    project: { id: 'p1', title: '', created_at: '' }, head: '', tip: '',
    components: {
      proj: {
        records: kept, stale: {}, superseded: {},
        created_by: Object.fromEntries<string>([['ref.png', 'u1'], ...renders.flatMap(entry => entry.outputs.map(output => [output, entry.id] as const))]),
      },
      plan: { plans: { ['p1' as PlanId]: versions } }, asset: { placed: [] }, timeline: { timelines: [{ id: 't1' as TimelineId, name: '', clips }] },
      test_ref: { hero: [{ id: 'hero', version: 1, name: 'Hero', description: '', references: ['ref.png'], created_by: 'e1' }] },
    },
    assets: [asset('ref.png', 'image/png', 'u1'), ...renders.flatMap(entry => [asset(`${entry.id}.mp4`, 'video/mp4', entry.id, 1), asset(`${entry.id}.png`, 'image/png', entry.id)])],
  }
}

/**
 * The whole rollback project whose latest plan version references the still of `w5` and whose third shot references the
 * still of `s3`; neither render is otherwise current, so only the plan's references in use keep them on the canvas.
 */
function referencedProject(): WireState {
  const state = rollbackProject()
  const versions = (state.components.plan?.plans['p1' as PlanId] ?? []).map(version => version.version !== 4 ? version : {
    ...version, references: ['w5.png'], shots: version.shots.map((each, index) => index === 2 ? { ...each, references: ['s3.png'] } : each),
  })
  state.components.plan = { plans: { ['p1' as PlanId]: versions } }
  return state
}

/** A plan shot whose fields the canvas does not read. */
const shot = () => ({ prompt: 'p', modality: 'video', task: 'ref2v', provider: '', model: '' })

/** The shared view fixture: a first-frame chain, a running retake, a failed export, and a still grab. */
function fixtureProject(): WireState {
  const hero = { role: 'reference', ref: { test_ref: 'hero', version: 1 }, resolved_asset: 'ref.png' }
  const records = [
    record({ id: 'u1', operation: 'asset.import', outputs: ['ref.png'] }),
    record({ id: 'e1', operation: 'test_ref.create' }),
    record({ id: 'p1', operation: 'plan.create' }),
    record({ id: 'a1', operation: 'plan.approve', params: { plan: 'p1' } }),
    record({ id: 'g1', operation: 'shot.render', deterministic: false, inputs: [hero], params: { prompt: 'walk' }, outputs: ['shot1.mp4', 'shot1-last.png'] }),
    record({
      id: 'g2', operation: 'shot.render', deterministic: false, params: { prompt: 'turn' }, outputs: ['shot2.mp4', 'shot2-last.png'],
      inputs: [hero, { role: 'first_frame', ref: { record: 'g1', output: 1 }, resolved_asset: 'shot1-last.png' }],
    }),
    record({ id: 's1', operation: 'timeline.create' }),
    record({ id: 'c1', operation: 'timeline.export', inputs: [{ role: 'clip', ref: { asset: 'shot2.mp4' }, resolved_asset: 'shot2.mp4' }], outputs: ['export.mp4'], status: 'failed' }),
    record({ id: 'x1', operation: 'asset.grab_still', inputs: [{ role: 'video', ref: { record: 'c1', output: 0 }, resolved_asset: 'export.mp4' }], outputs: ['export-last.png'] }),
    record({ id: 'g3', operation: 'shot.render', deterministic: false, based_on: 'g1', inputs: [hero], params: { prompt: 'wider' }, status: 'running' }),
  ]
  return {
    project: { id: 'p1', title: '', created_at: '' }, head: '', tip: '',
    components: {
      proj: {
        records, stale: { g2: 'g1' }, superseded: { c1: 'c2' },
        created_by: { 'ref.png': 'u1', 'shot1.mp4': 'g1', 'shot1-last.png': 'g1', 'shot2.mp4': 'g2', 'shot2-last.png': 'g2', 'export.mp4': 'c1', 'export-last.png': 'x1' },
      },
      plan: { plans: { ['p1' as PlanId]: [{ version: 1, shots: [shot(), shot()], created_by: 'p1' as RecordId }] } }, asset: { placed: [] },
      timeline: {
        timelines: [{
          id: 't1' as TimelineId, name: '', clips: [
            { id: 'cl1' as ClipId, asset: 'shot1.mp4' as AssetId, source: null, in_sec: null, out_sec: null },
            { id: 'cl2' as ClipId, asset: 'shot2.mp4' as AssetId, source: null, in_sec: 1, out_sec: 4 },
          ],
        }],
      },
      test_ref: { hero: [{ id: 'hero', version: 1, name: 'Hero', description: '', references: ['ref.png'], created_by: 'e1' }] },
    },
    assets: [asset('ref.png', 'image/png', 'u1'), asset('shot1.mp4', 'video/mp4', 'g1', 4), asset('shot1-last.png', 'image/png', 'g1'),
      asset('shot2.mp4', 'video/mp4', 'g2', 6), asset('shot2-last.png', 'image/png', 'g2'), asset('export.mp4', 'video/mp4', 'c1', 3),
      asset('export-last.png', 'image/png', 'x1')],
  }
}

/** One conformance case: its name, its state, and the assets on the canvas. */
export interface ConformanceCase { name: string; state: WireState; placed: readonly string[] }

/** @returns the 23 cases, in the order of `main-graph.json`. */
export function conformanceCases(): ConformanceCase[] {
  const cutoffs = [undefined, 'r6', 'l1', 's7', 'x7', 'w5', 'l3', 'k1', 'q4', 'l4']
  return [
    ...cutoffs.flatMap(until => [
      { name: `rollback until ${until ?? 'end'}`, state: rollbackProject(until), placed: [] },
      { name: `rollback until ${until ?? 'end'}, ref.png and r1.png placed`, state: rollbackProject(until), placed: ['ref.png', 'r1.png', 'r1.mp4'] },
    ]),
    { name: 'rollback until end, plan and shot references', state: referencedProject(), placed: [] },
    { name: 'fixture project', state: fixtureProject(), placed: [] },
    { name: 'fixture project, every asset placed', state: fixtureProject(), placed: fixtureProject().assets.map(entry => entry.id) },
  ]
}

/** The chain anchor of the cases: a `plan.approve` record hangs the records it started off `plan:<plan>`. */
export const APPROVAL = { starter: 'plan.approve', anchor: (approval: ProjectRecord) => `plan:${String(approval.params['plan'])}` }

/** The records that the cases' timeline clips use, and the trim badge of a clip that sets `in_sec`. */
export const CLIPS = {
  id: 'clips',
  uses: (state: WireState) => ((state.components['timeline'] as { timelines: Array<{ clips: Array<{ asset: string | null }> }> } | undefined)?.timelines ?? [])
    .flatMap(timeline => timeline.clips).flatMap(clip => state.components.proj.created_by[clip.asset ?? ''] ?? []),
  badges: (state: WireState) => ((state.components['timeline'] as { timelines: Array<{ clips: Array<{ asset: string | null; in_sec: number | null }> }> } | undefined)?.timelines ?? [])
    .flatMap(timeline => timeline.clips).filter(clip => clip.in_sec !== null).map(clip => ({ asset: clip.asset ?? '', label: 'trim' })),
}

/** One drawn node as the conformance check compares it. */
export interface ComparedNode {
  id: string
  /** The `data-node-type` value: the node type key on the SDK side; the asset, take or entry type key on `main`. */
  type: string
  x: number
  y: number
  /** The take number on `main`, the version number on the SDK side. */
  number: number | null
  /** The title that the card header and the accessible name show. */
  title: string
  /** The text right of the title in the card header, such as '4.0s'; null for none. */
  meta: string | null
  badges: string[]
  flags: { stale: boolean; rendering: boolean; failed: boolean; superseded: boolean }
  /** Whether the node can carry the unseen dot. */
  finished: boolean
  /** The card height at base text size, as the free positions read it. */
  height: number
  /** The preview asset of each slot frame of a node with slots. */
  frames: Array<string | null> | null
}

/** One graph as the conformance check compares it. */
export interface ComparedGraph {
  nodes: ComparedNode[]
  /** `<from>><to>:<kind>[:<role>]`, sorted; kind is input, chain or lineage. */
  edges: string[]
  assetNodes: Record<string, string>
  /** The Chinese History label of each record of the state, by record ID. */
  labels: Record<string, string>
}
