/** The fixture project of `conformance.client.spec.ts`, its operation declarations and its clip uses. */
import type { AssetId } from '@dv/project/types'
import type { ClipId, TimelineId } from '@dv/timeline/types'
import type { ProjectAsset, ProjectRecord, WireOperation, WireState } from '@dv/ui-kit/types.ts'

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

/** The operation declarations of the fixture project. */
export const OPS: WireOperation[] = [{
  name: 'shot.render', version: '1', description: '', deterministic: false, resource: 'gpu',
  outputs: [{ role: 'video', type: 'video' }, { role: 'still', type: 'image' }], label: { zh: '渲染镜头', en: 'Render shot' }, params: {}, inputs: {},
}]

/**
 * The shared view fixture: a first-frame chain, a running retake, a failed export, and a still grab. The canvas's node
 * list holds the reference node and the two shot nodes; the retake is the second version of the first shot.
 */
export function fixtureProject(): WireState {
  const hero = { role: 'reference', ref: { test_ref: 'hero', version: 1 }, resolved_asset: 'ref.png' }
  const records = [
    record({ id: 'u1', operation: 'asset.import', outputs: ['ref.png'] }),
    record({ id: 'e1', operation: 'test_ref.create' }),
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
      canvas: {
        nodes: {
          e1: { kind: 'test_ref', name: null, versions: ['e1'], position: { x: 0, y: 0, width: null, height: null } },
          g1: { kind: 'shot', name: null, versions: ['g1', 'g3'], position: { x: 480, y: 0, width: null, height: null } },
          g2: { kind: 'shot', name: null, versions: ['g2'], position: { x: 480, y: 200, width: null, height: null } },
        },
        order: ['e1', 'g1', 'g2'],
        assets: { 'shot1.mp4': 'g1', 'shot1-last.png': 'g1', 'shot2.mp4': 'g2', 'shot2-last.png': 'g2' },
      },
      timeline: {
        timelines: [{
          id: 't1' as TimelineId, name: '', sounds: [], sound_track_names: [], muted_sound_tracks: [], video_track_volumes: [], sound_track_volumes: [], muted_video_tracks: [], track_order: ['video', 'sound'], clips: [
            { id: 'cl1' as ClipId, asset: 'shot1.mp4' as AssetId, source: null, in_sec: null, out_sec: null, start_sec: 0, track: 0 },
            { id: 'cl2' as ClipId, asset: 'shot2.mp4' as AssetId, source: null, in_sec: 1, out_sec: 4, start_sec: 0, track: 0 },
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

/** The records that the fixture's timeline clips use, and the trim badge of a clip that sets `in_sec`. */
export const CLIPS = {
  id: 'clips',
  uses: (state: WireState) => ((state.components['timeline'] as { timelines: Array<{ clips: Array<{ asset: string | null }> }> } | undefined)?.timelines ?? [])
    .flatMap(timeline => timeline.clips).flatMap(clip => state.components.proj.created_by[clip.asset ?? ''] ?? []),
  badges: (state: WireState) => ((state.components['timeline'] as { timelines: Array<{ clips: Array<{ asset: string | null; in_sec: number | null }> }> } | undefined)?.timelines ?? [])
    .flatMap(timeline => timeline.clips).filter(clip => clip.in_sec !== null).map(clip => ({ asset: clip.asset ?? '', label: 'trim' })),
}
