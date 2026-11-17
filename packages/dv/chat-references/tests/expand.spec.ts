/** Expansion of composer `dv:` mentions into concrete record and asset IDs. */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { formatCitation, versionRefOf, type AssetId, type ProjectId, type ProjectRecord, type ProjectState, type RecordId, type SessionId, type TurnId } from '@dv/project'
import type { CharacterId } from '@dv/character'
import type { ClipId, TimelineId } from '@dv/timeline'
import { expansionBlock, type ExpansionSources } from '../src/expand.ts'

declare module '@dv/project' {
  interface ReferenceKinds { character: CharacterId }
}

const project = brandString<ProjectId>('p1')
const img = brandString<AssetId>('img1')
const vid = brandString<AssetId>('vid1')
const shot: ProjectRecord = {
  id: brandString<RecordId>('rec-shot'), parents: [], kind: 'operation', component: 'shot', operation: 'shot.render_ref2va',
  operation_version: '1', actor: 'agent', surface: 'chat', turn: brandString<TurnId>('t1'), session: brandString<SessionId>('s1'),
  tool_call: null, intent: 'shot', params: { prompt: 'a cat walks', duration_sec: 5 },
  inputs: [
    { role: 'reference', ref: { asset: img }, resolved_asset: img },
    { role: 'reference', ref: { character: brandString<CharacterId>('c1'), version: 2 }, resolved_asset: null },
  ],
  outputs: [vid, brandString<AssetId>('frame1')], based_on: null, supersedes: [], deterministic: false, status: 'done',
  created_at: '2026-10-05T00:00:00Z',
}
/** The newest versions and their assets in the fake kernel's reference kinds; `test_prop` stands for a kind of another plugin. */
const versions: Record<string, Record<string, { version: number; assets: AssetId[] }>> = {
  character: { c1: { version: 1, assets: [img] } }, location: {}, test_prop: { p1: { version: 3, assets: [vid, img] } },
}
const sources: ExpansionSources = {
  getState: (): ProjectState => ({
    project: { id: project, title: 'p', created_at: '', path: '' }, head: shot.id,
    components: {
      proj: { records: [shot], stale: {}, superseded: {}, created_by: { [vid]: shot.id } },
      timeline: {
        timelines: [{
          id: brandString<TimelineId>('t1'), name: '',
          clips: [
            { id: brandString<ClipId>('cl1'), asset: img, source: null, in_sec: null, out_sec: null, start_sec: 0, track: 0 },
            { id: brandString<ClipId>('cl2'), asset: vid, source: null, in_sec: null, out_sec: null, start_sec: 5, track: 0 },
            { id: brandString<ClipId>('cl3'), asset: null, source: { record: shot.id, output: 0 }, in_sec: null, out_sec: null, start_sec: 10, track: 0 },
            { id: brandString<ClipId>('cl4'), asset: vid, source: null, in_sec: null, out_sec: null, start_sec: 8, track: 1 },
            { id: brandString<ClipId>('cl5'), asset: vid, source: null, in_sec: null, out_sec: null, start_sec: 2, track: 1 },
          ],
        }],
      },
    } as ProjectState['components'],
  }),
  getRecord: (_project, id) => id === shot.id ? shot : undefined,
  listReferenceKinds: () => Object.keys(versions),
  latestVersion: (_state, kind, id) => versions[kind]?.[id]?.version ?? null,
  assetsOf: (_state, ref) => {
    const named = versionRefOf(ref)
    const latest = named === null ? undefined : versions[named.kind]?.[named.id]
    return latest !== undefined && latest.version === named?.version ? latest.assets : null
  },
}

describe('dv mentions', () => {
  it('reads the citations that the kernel writes, with the kernel\'s parser', () => {
    const block = expansionBlock(`改一下 ${formatCitation('时间线 1·片段 2', 'clip', 'cl2')} 的光线`, project, sources)
    expect(block).toContain('- 时间线 1·片段 2 (dv:clip/cl2): clip cl2, clip 2 by start time on video track 0 of timeline t1')
  })

  it('describes a mention whose URI has a malformed escape as unknown, and its asset as none', () => {
    expect(expansionBlock('@[x](dv:asset/img%) and @[y](dv:character/c%zz)', project, sources))
      .toBe('The user referenced these project items:\n- x (dv:asset/img%): unknown mention kind\n- y (dv:character/c%zz): unknown mention kind')
  })

  it('names the timeline, position, producing record, prompt, inputs, and duration of a clip, and a placeholder clip\'s render', () => {
    const block = expansionBlock('@[时间线 1·片段 2](dv:clip/cl2)', project, sources)
    expect(block).toContain('(dv:clip/cl2): clip cl2, clip 2 by start time on video track 0 of timeline t1, asset vid1')
    expect(block).toContain('asset vid1 made by record rec-shot (dv_shot_render_ref2va, done)')
    expect(block).toContain('prompt "a cat walks", duration 5 s')
    expect(block).toContain('inputs [reference=img1, reference=c1@2]')
    expect(expansionBlock('@[x](dv:clip/cl9)', project, sources)).toContain('no clip cl9 in the current state')
    expect(expansionBlock('@[x](dv:clip/cl3)', project, sources))
      .toContain('clip cl3, clip 3 by start time on video track 0 of timeline t1, a placeholder clip (no asset until its render is done), its render made by record rec-shot')
    // A clip's number is its place by start time on its own video track, whatever order the timeline stores the clips in.
    expect(expansionBlock('@[x](dv:clip/cl5)', project, sources)).toContain('clip cl5, clip 1 by start time on video track 1 of timeline t1, asset vid1')
    expect(expansionBlock('@[x](dv:clip/cl4)', project, sources)).toContain('clip cl4, clip 2 by start time on video track 1 of timeline t1, asset vid1')
  })

  it('describes assets, versions of any registered reference kind, records, and unknown mentions', () => {
    const text = ['@[a](dv:asset/img1)', '@[b](dv:character/c1)', '@[c](dv:character/c9)', '@[g](dv:location/c1)',
      '@[h](dv:test_prop/p1)', '@[d](dv:record/rec-shot)', '@[e](dv:record/none)', '@[f](dv:other/x)'].join(' ')
    const block = expansionBlock(text, project, sources) ?? ''
    expect(block).toContain('asset img1, imported (no producing record)')
    expect(block).toContain('(dv:character/c1): character c1@1, reference assets [img1]; pass it as input c1@1')
    expect(block).toContain('no character c9 in the current state')
    expect(block).toContain('no location c1 in the current state')
    expect(block).toContain('(dv:test_prop/p1): test_prop p1@3, reference assets [vid1, img1]; pass it as input p1@3')
    expect(block).toContain('(dv:record/rec-shot): made by record rec-shot')
    expect(block).toContain('record none not found')
    expect(block).toContain('unknown mention kind')
    expect(expansionBlock('@[a](dv:asset/img1)', null, sources)).toContain('this conversation has no project yet; call dv_proj_create first')
  })

  it('pins the host text of a version mention: the newest version, its assets, and the input text', () => {
    expect(expansionBlock('@[Lead](dv:character/c1) @[x](dv:character/c9) @[Prop](dv:test_prop/p1)', project, sources)).toMatchInlineSnapshot(`
      "The user referenced these project items:
      - Lead (dv:character/c1): character c1@1, reference assets [img1]; pass it as input c1@1
      - x (dv:character/c9): no character c9 in the current state
      - Prop (dv:test_prop/p1): test_prop p1@3, reference assets [vid1, img1]; pass it as input p1@3"
    `)
  })

  it('returns null for text without mentions', () => {
    expect(expansionBlock('hello', project, sources)).toBeNull()
  })
})
