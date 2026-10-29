/**
 * `dvStory` in the REAL composition of `fixture.ts`: registration, the skills folder, `story.preview`,
 * `story.approve` and the `story` slice, with the intended differences from `plan.approve` and the agent's flow.
 */
import { globSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, OperationSpec, OperationToolValue, RecordId, RunRequest } from '@dv/project'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { storyReducer } from '../src/reducer.ts'
import { disposeAll, REF, start, TXT, USER, type Fixture } from './fixture.ts'

afterEach(disposeAll)

/** The report of a successful `dv_story_preview` call of a plan, at a version when one is given. */
async function preview(fixture: Fixture, plan: string, version?: number): Promise<OperationToolValue['report']> {
  const result = await fixture.call('dv_story_preview', { reason: 'show the cost', plan, ...version === undefined ? {} : { version } })
  if (result.isError) throw new Error(result.error.message)
  return (result.value as OperationToolValue).report
}

/** The spec of a story operation while it is registered. */
function specOf(fixture: Fixture, name: 'story.preview' | 'story.approve'): OperationSpec | undefined {
  return fixture.ctx.dvProject.listOperations().find(entry => entry.name === name)
}

/** The error message of a failed tool call; empty for a call that succeeded. */
function refusal(result: Awaited<ReturnType<Fixture['call']>>): string {
  return result.isError ? result.error.message : ''
}

/** A reference input of an asset. */
function reference(asset: AssetId): RunRequest['inputs'][number] {
  return { role: 'reference', ref: { asset } }
}

describe('dvStory', () => {
  it('registers the labeled read story.preview and the labeled write story.approve, and removes both on disposal', async () => {
    const fixture = await start()
    const spec = specOf(fixture, 'story.preview')
    expect(spec).toMatchObject({
      component: 'story', label: { zh: '预览分镜计划', en: 'Preview plan' }, readOnly: true, confirm: 'never', deterministic: false,
      resource: 'none', inputs: {}, outputs: [],
    })
    expect(spec?.summarize({} as never)).toBe('story preview')
    expect(fixture.ctx.tools.schemas().find(tool => tool.name === 'dv_story_preview')?.description).toContain('A read that writes no record.')
    const approve = specOf(fixture, 'story.approve')
    expect(approve).toMatchObject({
      component: 'story', label: { zh: '批准分镜计划', en: 'Approve plan' }, confirm: 'always', resource: 'none', deterministic: false,
      inputs: {}, outputs: [],
    })
    expect(approve?.summarize({ params: { plan: 'p1' }, report: { version: 2 } } as never)).toBe('plan p1 v2 approved')
    expect(approve?.summarize({ params: { plan: 'p1' } } as never)).toBe('plan p1 approved')
    expect(fixture.ctx.tools.get('dv_story_approve')).toBeDefined()
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-story.mjs'))
    await entry?.fiber?.dispose()
    expect(specOf(fixture, 'story.preview')).toBeUndefined()
    expect(specOf(fixture, 'story.approve')).toBeUndefined()
    expect(fixture.ctx.tools.get('dv_story_preview')).toBeUndefined()
    expect(fixture.ctx.tools.get('dv_story_approve')).toBeUndefined()
  })

  it('serves exactly the SKILL.md files of its skills folder while dvStory is mounted, and removes them on disposal', async () => {
    // A skill in the user skill folder, which the provider must not read.
    const home = mkdtempSync(join(tmpdir(), 'dv-workflow-story-home-'))
    onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
    mkdirSync(join(home, 'skills', 'user-flow'), { recursive: true })
    writeFileSync(join(home, 'skills', 'user-flow', 'SKILL.md'), '---\nname: user-flow\ndescription: "A user skill."\n---\n\nBody.\n')
    vi.stubEnv('DSH_AGENTS_HOME', home)
    onTestFinished(() => { vi.unstubAllEnvs() })
    const fixture = await start(undefined, true)
    const folder = fileURLToPath(new URL('../skills', import.meta.url))
    const files = globSync('*/SKILL.md', { cwd: folder }).map(file => `custom ${realpathSync(join(folder, file))}`).sort()
    const served = async (): Promise<string[]> => (await fixture.ctx.skills.list())
      .filter(skill => skill.provider === 'workflow-story').map(skill => `${skill.source} ${skill.path ?? ''}`).sort()
    expect(files).not.toEqual([])
    expect(await served()).toEqual(files)
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-story.mjs'))
    await entry?.fiber?.dispose()
    expect(await served()).toEqual([])
  })

  it('the agent creates a plan, previews it, approves it with user_approved, and its renders finish; no tool is dv_plan_approve', async () => {
    const fixture = await start()
    const tools = fixture.ctx.tools.schemas().map(tool => tool.name).filter(name => /^dv_(?:plan|story)_/u.test(name))
    expect(tools.sort()).toEqual(['dv_plan_create', 'dv_plan_update', 'dv_story_approve', 'dv_story_preview'])
    const calls: Array<[string, Record<string, unknown>]> = [
      ['dv_plan_create', { reason: 'propose', title: 'Streets', shots: [{ ...TXT, prompt: 'A street at dawn', duration_sec: 1 }] }],
      ['dv_story_preview', { reason: 'show the cost', plan: 'p1' }],
      ['dv_story_approve', { reason: 'the user agreed', plan: 'p1', user_approved: true }],
    ]
    const results: Array<Awaited<ReturnType<Fixture['call']>>> = []
    for (const [name, args] of calls) {
      const result = await fixture.call(name, args)
      expect(refusal(result), name).toBe('')
      results.push(result)
    }
    const { scheduled } = (results.at(-1)?.value as OperationToolValue).report as { scheduled: string[] }
    await fixture.ctx.dvProject.wait(fixture.project, scheduled.map(id => brandString<RecordId>(id)))
    const records = fixture.ctx.dvProject.getState(fixture.project).components.proj.records
    expect(records.map(record => [record.operation, record.status])).toEqual([
      ['proj.create', 'done'], ['plan.create', 'done'], ['story.approve', 'done'], ['shot.render', 'done'], ['timeline.create', 'done'],
    ])
  })

  it('previews the shots a version renders, and keeps only takes of a story approval of the plan', async () => {
    const fixture = await start()
    const picture = fixture.put('face', 'image/png', 'face.png')
    const dawn = { ...TXT, prompt: 'A street at dawn', duration_sec: 2 }
    const shots = [{ ...REF, prompt: 'Picture 1 starts dancing', duration_sec: 1 }, { ...REF, prompt: 'keeps dancing', duration_sec: 2, continue_previous: true }, dawn]
    await fixture.call('dv_plan_create', { reason: 'propose', references: [picture], aspect_ratio: '9:16', shots })
    const history = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    const firstLines = [
      'shot 1 (video/ref2v/test/fake, 1 s): Picture 1 starts dancing',
      'shot 2 (video/ref2v/test/fake, 2 s, continues from the previous shot): keeps dancing',
    ]
    expect(await preview(fixture, 'p1')).toEqual({
      plan: 'p1', version: 1, shots: [...firstLines, 'shot 3 (video/t2v/test/fake, 2 s): A street at dawn'], rendered: 3,
      problems: [],
    })
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(history)
    // A free take with equal params belongs to no plan.
    await fixture.take({ ...dawn, aspect_ratio: '9:16' })
    expect(await preview(fixture, 'p1')).toMatchObject({ rendered: 3 })
    // Plan p2's one shot equals shot 3 of p1, and its story approval renders it as a take of p2.
    await fixture.call('dv_plan_create', { reason: 'other story', aspect_ratio: '9:16', shots: [dawn] })
    await fixture.record('story.approve', { plan: 'p2' })
    await fixture.ctx.dvProject.wait(fixture.project)
    expect(await preview(fixture, 'p1')).toMatchObject({ rendered: 3 })
    // After a story approval of p1, every shot keeps its take; shot 2 matches with shot 1's last still as its first frame.
    await fixture.record('story.approve', { plan: 'p1' })
    await fixture.ctx.dvProject.wait(fixture.project)
    const kept = ['shot 1: keeps its take', 'shot 2: keeps its take', 'shot 3: keeps its take']
    expect(await preview(fixture, 'p1')).toEqual({ plan: 'p1', version: 1, rendered: 0, problems: [], shots: kept })
    const night = { ...TXT, prompt: `A street at night ${'and rain '.repeat(10)}`, duration_sec: 2 }
    await fixture.call('dv_plan_update', { reason: 'night', plan: 'p1', references: [picture], aspect_ratio: '9:16', shots: [shots[0], shots[1], night] })
    const nightLine = `shot 3 (video/t2v/test/fake, 2 s): ${night.prompt.slice(0, 80)}…`
    expect(await preview(fixture, 'p1')).toEqual({ plan: 'p1', version: 2, rendered: 1, problems: [], shots: [...kept.slice(0, 2), nightLine] })
    expect(await preview(fixture, 'p1', 1)).toMatchObject({ version: 1, rendered: 0, shots: kept })
  })

  it('lists why each shot that renders would be refused, with a kept take as the first frame of a continuing shot', async () => {
    const fixture = await start()
    fixture.checks.t2v = request => request.prompt.includes('night') ? ['It renders no night.'] : []
    fixture.checks.ref2v = request => request.firstFrame === null ? [] : ['It takes no first frame.']
    const shots = [{ ...REF, prompt: 'dances' }, { ...REF, prompt: 'keeps dancing', continue_previous: true }, { ...TXT, prompt: 'A street at night' }]
    await fixture.call('dv_plan_create', { reason: 'propose', shots })
    const nightProblem = 'Shot 3: Model video/t2v/test/fake cannot generate this: It renders no night.'
    // Shot 2 continues a shot that renders, so its first frame is chained and the model check waits for the render.
    expect(await preview(fixture, 'p1')).toMatchObject({ rendered: 3, problems: [nightProblem] })
    fixture.checks.ref2v = () => []
    await fixture.call('dv_plan_update', { reason: 'day', plan: 'p1', shots: [shots[0], shots[1], { ...TXT, prompt: 'A street by day' }] })
    await fixture.record('story.approve', { plan: 'p1' })
    await fixture.ctx.dvProject.wait(fixture.project)
    fixture.checks.ref2v = request => request.firstFrame === null ? [] : ['It takes no first frame.']
    await fixture.call('dv_plan_update', { reason: 'spin', plan: 'p1', shots: [shots[0], { ...REF, prompt: 'spins', continue_previous: true }, { ...TXT, prompt: 'A street by day' }] })
    const firstFrameProblem = 'Shot 2: Model video/ref2v/test/fake cannot generate this: It takes no first frame.'
    expect(await preview(fixture, 'p1')).toMatchObject({ rendered: 1, problems: [firstFrameProblem] })
    // A model that fails with a value other than an Error reports that value.
    fixture.checks.t2v = () => { throw 'the backend is down' }
    expect(await preview(fixture, 'p1', 1)).toMatchObject({ rendered: 1, problems: ['Shot 3: the backend is down'] })
  })

  it('refuses an unknown plan or version with invalid_params', async () => {
    const fixture = await start()
    await fixture.call('dv_plan_create', { reason: 'propose', shots: [{ ...TXT, prompt: 'A street' }] })
    const unknown = await fixture.call('dv_story_preview', { reason: 'show', plan: 'p9' })
    expect(unknown.isError ? unknown.error.message : '').toContain('Unknown plan \'p9\'')
    const run = (operation: string, params: Record<string, unknown>): Promise<unknown> =>
      fixture.ctx.dvProject.run({ ...USER, project: fixture.project, operation, params, inputs: [], intent: 'call' })
    const unknownPlan = 'Unknown plan \'p9\'; pass the plan ID (p1, p2, …) that dv_plan_create reported.'
    await expect(run('story.preview', { plan: 'p9' })).rejects.toMatchObject({ code: 'invalid_params', message: unknownPlan })
    await expect(run('story.preview', { plan: 'p1', version: 9 })).rejects.toMatchObject({ code: 'invalid_params', message: 'Plan \'p1\' has no version 9; it has 1.' })
    await expect(run('story.approve', { plan: 'p9' })).rejects.toMatchObject({ code: 'invalid_params', message: unknownPlan })
  })

  it('reports a shot whose model key the catalog does not serve, which dv_plan_create accepts', async () => {
    const fixture = await start()
    const shots = [{ ...TXT, model: 'ghost', prompt: 'A street at dawn', duration_sec: 2 }, { ...TXT, prompt: 'A street at night', duration_sec: 2 }]
    expect(refusal(await fixture.call('dv_plan_create', { reason: 'propose', shots }))).toBe('')
    // The unknown model's refusal is the catalog's text.
    expect(await preview(fixture, 'p1')).toEqual({
      plan: 'p1', version: 1, rendered: 2,
      shots: ['shot 1 (video/t2v/test/ghost, 2 s): A street at dawn', 'shot 2 (video/t2v/test/fake, 2 s): A street at night'],
      problems: ['Shot 1: Unknown model "video/t2v/test/ghost"; call dv_models_list for the models.'],
    })
  })

  it('asks for the user\'s agreement with the preview lines, refuses a plan with problems, and records each approval', async () => {
    const fixture = await start()
    const shots = [{ ...TXT, prompt: 'A street at dawn', duration_sec: 2 }, { ...TXT, prompt: 'A street at night', duration_sec: 2 }]
    await fixture.call('dv_plan_create', { reason: 'propose', title: 'Streets', shots })
    // Without user_approved, the agent gets the head line and the preview lines to show.
    const { shots: lines } = await preview(fixture, 'p1') as { shots: string[] }
    expect(refusal(await fixture.call('dv_story_approve', { reason: 'go', plan: 'p1' }))).toContain([
      'dv_story_approve needs the user\'s agreement.', 'What it will do:',
      'Approve plan p1 v1 "Streets": render 2 of 2 shots and lay every shot on the plan\'s timeline.', ...lines.map(line => `- ${line}`),
    ].join('\n'))
    // A model refusal refuses the agent before Project asks for agreement, and every other caller before a record.
    fixture.checks.t2v = request => request.prompt.includes('night') ? ['It renders no night.'] : []
    const history = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    const refused = 'The plan cannot be approved as written. Shot 2: Model video/t2v/test/fake cannot generate this: It renders no night. '
      + 'Update the plan with dv_plan_update, then call again.'
    expect(refusal(await fixture.call('dv_story_approve', { reason: 'go', plan: 'p1', user_approved: true }))).toContain(refused)
    await expect(fixture.record('story.approve', { plan: 'p1' })).rejects.toThrow(refused)
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(history)
    fixture.checks.t2v = () => []
    // The system actor writes the chain in the approving record's session and turn; each record names the approval.
    const result = await fixture.call('dv_story_approve', { reason: 'go', plan: 'p1', user_approved: true })
    const report = (result.value as OperationToolValue).report
    expect(report).toEqual({ plan: 'p1', version: 1, timeline: 't1', scheduled: [expect.any(String), expect.any(String), expect.any(String)] })
    const { scheduled } = report as { scheduled: string[] }
    await fixture.ctx.dvProject.wait(fixture.project, scheduled.map(id => brandString<RecordId>(id)))
    const records = fixture.ctx.dvProject.getState(fixture.project).components.proj.records
    const approve = records.find(record => record.operation === 'story.approve')
    const written = scheduled.map(id => records.find(record => record.id === id))
    expect(written.map(record => [record?.operation, record?.status, record?.intent])).toEqual([
      ['shot.render', 'done', 'shot 1 of plan p1 v1'], ['shot.render', 'done', 'shot 2 of plan p1 v1'],
      ['timeline.create', 'done', 'timeline of plan p1 v1'],
    ])
    const by = (slot: number | null): unknown[] => ['system', 's1', approve?.turn, null, { record: approve?.id, slot }]
    const origins = written.map(record => [record?.actor, record?.session, record?.turn, record?.tool_call, record?.started_by])
    expect(origins).toEqual([by(1), by(2), by(null)])
    // v2 has no title and keeps its one shot's take; approving v1 again makes v1 the plan's newest approval.
    await fixture.call('dv_plan_update', { reason: 'shorter', plan: 'p1', shots: [shots[0]] })
    expect(refusal(await fixture.call('dv_story_approve', { reason: 'go', plan: 'p1' }))).toContain(
      'Approve plan p1 v2: render 0 of 1 shots and lay every shot on the plan\'s timeline.\n- shot 1: keeps its take')
    const second = await fixture.record('story.approve', { plan: 'p1' })
    const third = await fixture.record('story.approve', { plan: 'p1', version: 1 })
    expect(fixture.ctx.dvProject.getState(fixture.project).components.story).toEqual({
      approvals: { p1: [{ version: 1, record: approve?.id }, { version: 2, record: second.id }, { version: 1, record: third.id }] },
      timelines: { p1: 't1' },
    })
    const summary = await fixture.call('dv_proj_state', {})
    expect(summary.isError ? null : summary.value).toMatchObject({ story_approvals: [{ plan: 'p1', approved_version: 1, timeline: 't1' }] })
  })

  it('after a stored plan.approve log, the first story approval renders every shot into the next timeline', async () => {
    const fixture = await start('plan-approve')
    const stored = fixture.ctx.dvProject.listProjects().find(info => info.title === 'plan.approve log')?.id
    if (stored === undefined) throw new Error('the stored plan.approve log did not load')
    const before = fixture.ctx.dvProject.getState(stored)
    expect(before.components.proj.records.filter(record => record.operation === 'plan.approve')).toHaveLength(1)
    const approved = await fixture.record('story.approve', { plan: 'p1' }, { project: stored })
    await fixture.ctx.dvProject.wait(stored)
    const after = fixture.ctx.dvProject.getState(stored)
    const report = after.components.proj.records.find(record => record.id === approved.id)?.report
    expect(report).toMatchObject({ plan: 'p1', version: 1, timeline: 't2' })
    const renders = after.components.proj.records.filter(record => record.started_by?.record === approved.id && record.operation === 'shot.render')
    expect(renders.map(record => [record.started_by?.slot, record.status])).toEqual([[1, 'done'], [2, 'done']])
    expect(after.components.timeline.timelines.map(timeline => timeline.id)).toEqual(['t1', 't2'])
    expect(after.components.timeline.timelines[0]).toEqual(before.components.timeline.timelines[0])
    const clips = after.components.timeline.timelines[1]?.clips.map(clip => clip.source)
    expect(clips).toEqual(renders.map(record => ({ record: record.id, output: 0 })))
  })

  it('never reuses a take without started_by, even with the params and inputs of a shot', async () => {
    const fixture = await start()
    const picture = fixture.put('face', 'image/png', 'face.png')
    const shot = { ...REF, prompt: 'Picture 1 starts dancing', duration_sec: 1 }
    await fixture.call('dv_plan_create', { reason: 'propose', references: [picture], aspect_ratio: '9:16', shots: [shot] })
    const free = await fixture.take({ ...shot, aspect_ratio: '9:16' }, [reference(picture)])
    await fixture.ctx.dvProject.wait(fixture.project)
    const approved = await fixture.record('story.approve', { plan: 'p1' })
    const { scheduled } = approved.report as { scheduled: string[] }
    expect(scheduled).toHaveLength(2)
    expect(scheduled).not.toContain(free)
  })

  it('approves a fresh plan whose continuing shot cites its first frame, rendering it from the last still of shot 1', async () => {
    const fixture = await start()
    const shots = [{ ...REF, prompt: 'A dancer bows', duration_sec: 1 }, { ...REF, prompt: 'The dancer from @[首帧](dv:input/first_frame) spins', duration_sec: 1, continue_previous: true }]
    await fixture.call('dv_plan_create', { reason: 'propose', shots })
    expect(await preview(fixture, 'p1')).toMatchObject({ rendered: 2, problems: [] })
    const approved = await fixture.record('story.approve', { plan: 'p1' })
    await fixture.ctx.dvProject.wait(fixture.project)
    const records = fixture.ctx.dvProject.getState(fixture.project).components.proj.records
    const [first, second] = (approved.report as { scheduled: string[] }).scheduled.map(id => records.find(record => record.id === id))
    expect(second?.inputs.map(input => [input.role, input.ref])).toEqual([['first_frame', { record: first?.id, output: 1 }]])
    expect([first?.status, second?.status]).toEqual(['done', 'done'])
  })

  it('skips a story.approve record without its report, and shows an approved plan without a timeline as null', () => {
    const slice = storyReducer.initial()
    expect(storyReducer.reduce(slice, { status: 'done', operation: 'story.approve', params: { plan: 'p1' } } as never)).toBe(slice)
    const approved = { approvals: { p1: [{ version: 2, record: 'r1' }] }, timelines: {} }
    expect(storyReducer.agentSummary?.(approved as never, {} as never, {} as never)).toEqual({
      story_approvals: [{ plan: 'p1', approved_version: 2, timeline: null }],
    })
  })
})
