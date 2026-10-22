/**
 * `defineReference` through the real `dvProject` service and the DSH tool and skill registries: a test noun gets its
 * component, reducer, reference kind, two operations with their agent tools, and its skill; versions resolve as
 * `<id>@<version>` inputs; an update keeps what the call leaves out and makes what read the old version stale; and the
 * ID check spans every reference kind.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectRecord, RecordId, RunRequest } from '@dv/project'
import { describe, expect, it } from 'vitest'
import { HUMAN, start, type Fixture } from './support.ts'

/**
 * Run one operation as a human edit.
 * @returns the record it wrote.
 */
async function run(fixture: Fixture, operation: string, params: Record<string, unknown>, inputs: RunRequest['inputs'] = []): Promise<ProjectRecord> {
  const result = await fixture.ctx.dvProject.run({ ...HUMAN, project: fixture.project, operation, params, inputs })
  if (result.record === null) throw new Error(`${operation} wrote no record`)
  return result.record
}

/** The `test_hand` slice: the record that wrote each version of a hand-written test item, oldest first, by ID. */
type HandSlice = Record<string, RecordId[]>

/**
 * Register a hand-written reference kind `test_hand` with its create `test_hand.create`, which refuses an ID that
 * `kindsWithId` lists, as every kind owner's create does.
 */
function registerHand(project: Context['dvProject']): void {
  project.registerComponent('test_hand')
  project.registerReducer('test_hand' as never, {
    initial: (): HandSlice => ({}),
    reduce: (slice: HandSlice, record: ProjectRecord): HandSlice => (
      record.operation === 'test_hand.create' && record.status === 'done' ? { ...slice, [String(record.params['id'])]: [record.id] } : slice),
  } as never)
  project.registerReferenceKind({
    kind: 'test_hand', component: 'test_hand' as never, assetsOf: () => [],
    createdBy: (slice: HandSlice, id, version) => slice[id]?.[version - 1] ?? null,
    latest: (slice: HandSlice, id) => slice[id]?.length ?? null,
  })
  project.registerOperation({
    name: 'test_hand.create', component: 'test_hand', version: '1', description: 'Test hand create.',
    params: { id: { type: 'string', required: true, description: 'The ID.' } }, inputs: {},
    outputs: [], deterministic: false, resource: 'none', confirm: 'never', summarize: () => 'test hand created',
    execute(context) {
      const used = project.kindsWithId(context.state, String(context.params['id']))
      if (used.length > 0) throw new Error(`The ID already names a ${used.join(', ')}.`)
      return Promise.resolve({ outputs: [] })
    },
  })
}

describe('defineReference', () => {
  it('registers the component, both operations with labels and tools, and the kind, and removes them on disposal', async () => {
    const fixture = await start()
    const { ctx } = fixture
    const specs = ctx.dvProject.listOperations().filter(spec => spec.component === 'test_ref')
    expect(specs.map(spec => [spec.name, spec.label])).toEqual([
      ['test_ref.create', { zh: '新建测试', en: 'Create test reference' }],
      ['test_ref.update', { zh: '修改测试', en: 'Update test reference' }],
    ])
    expect(specs[0]?.description).toBe('Create a test_ref (an item a test keeps) with its reference images. Writes version 1; a shot names it '
      + 'as the input <test_ref>@1, which stands for those reference images. The ID must not name any other item that an input names as <id>@<version>.')
    expect(specs[0]?.params['test_ref']).toEqual({ type: 'string', required: true, description: 'Short stable ID, such as t1; without @ or #.' })
    expect(Object.keys(specs[1]?.params ?? {})).toEqual(['test_ref', 'name', 'description', 'traits'])
    expect(ctx.tools.get('dv_test_ref_create')).toBeDefined()
    expect(ctx.tools.get('dv_test_ref_update')).toBeDefined()
    expect(ctx.dvProject.getState(fixture.project).components.test_ref).toEqual({})
    expect(await ctx.skills.get('test_ref')).toBeUndefined()
    await fixture.disposeTestRef()
    expect(ctx.dvProject.listOperations().filter(spec => spec.component === 'test_ref')).toEqual([])
    expect(ctx.tools.get('dv_test_ref_create')).toBeUndefined()
    expect(ctx.dvProject.getState(fixture.project).components).not.toHaveProperty('test_ref')
  })

  it('registers the skill under the component key while the skill registry is mounted, and removes it on disposal', async () => {
    const fixture = await start()
    const skill = await fixture.ctx.skills.get('testskill')
    expect(skill).toMatchObject({ name: 'testskill', description: 'How to create and update test references.', whenToUse: 'A test needs a reference.', source: 'runtime' })
    expect(skill?.content.startsWith('# Test reference\n')).toBe(true)
    await fixture.disposeTestSkill()
    expect(await fixture.ctx.skills.get('testskill')).toBeUndefined()
  })

  it('creates version 1, resolves <id>@1 to its references, and updates to the next version that keeps what the call leaves out', async () => {
    const fixture = await start()
    const { ctx } = fixture
    const face = fixture.put('face')
    const coat = fixture.put('coat')
    const created = await run(fixture, 'test_ref.create', { test_ref: 'r1', name: 'Lead', description: 'red' }, [{ role: 'reference', ref: { asset: face } }])
    expect(created.status).toBe('done')
    expect(ctx.dvProject.listOperations().find(spec => spec.name === 'test_ref.create')?.summarize(created)).toBe('test_ref Lead created')
    ctx.dvProject.registerComponent('test_use')
    ctx.dvProject.registerOperation({
      name: 'test_use.render', component: 'test_use', version: '1', description: 'Test render.', params: {},
      inputs: { reference: { type: 'image', many: true, versioned: true, description: 'References.' } },
      outputs: [], deterministic: false, resource: 'none', confirm: 'never', summarize: () => 'rendered',
      execute: () => Promise.resolve({ outputs: [] }),
    })
    const ref = { test_ref: 'r1', version: 1 }
    const state = ctx.dvProject.getState(fixture.project)
    expect(ctx.dvProject.assetsOf(state, ref)).toEqual([face])
    expect(ctx.dvProject.parseInputs('test_use.render', { reference: ['r1@1'] }, state)).toEqual([{ role: 'reference', ref }])
    const render = await run(fixture, 'test_use.render', {}, [{ role: 'reference', ref }])
    expect(render.inputs).toEqual([{ role: 'reference', ref, resolved_asset: face }])
    const renamed = await run(fixture, 'test_ref.update', { test_ref: 'r1', name: 'Hero' })
    expect(ctx.dvProject.listOperations().find(spec => spec.name === 'test_ref.update')?.summarize(renamed)).toBe('test_ref r1 updated')
    const restyled = await run(fixture, 'test_ref.update', { test_ref: 'r1', traits: ['tall'] }, [{ role: 'reference', ref: { asset: coat } }])
    const after = ctx.dvProject.getState(fixture.project)
    expect(after.components.test_ref?.['r1']?.map(version => [version.version, version.name, version.description, version.references, version.traits]))
      .toEqual([[1, 'Lead', 'red', [face], []], [2, 'Hero', 'red', [face], []], [3, 'Hero', 'red', [coat], ['tall']]])
    const records = after.components.proj.records
    expect(records.find(entry => entry.id === renamed.id)?.supersedes).toEqual([created.id])
    expect(records.find(entry => entry.id === restyled.id)?.supersedes).toEqual([renamed.id])
    expect(after.components.proj.stale).toEqual({ [render.id]: renamed.id })
    expect(ctx.dvProject.latestVersion(after, 'test_ref', 'r1')).toBe(3)
  })

  it('resolves no assets for a version that the ID does not have, or for an unknown ID', async () => {
    const fixture = await start()
    const { ctx } = fixture
    await run(fixture, 'test_ref.create', { test_ref: 'r1', name: 'Lead' }, [{ role: 'reference', ref: { asset: fixture.put('face') } }])
    const state = ctx.dvProject.getState(fixture.project)
    expect(ctx.dvProject.assetsOf(state, { test_ref: 'r1', version: 2 })).toBeNull()
    expect(ctx.dvProject.assetsOf(state, { test_ref: 'r9', version: 1 })).toBeNull()
  })

  it('refuses an empty ID, an ID with @ or #, an unknown ID and a create without a name', async () => {
    const fixture = await start()
    const failed = async (operation: string, params: Record<string, unknown>): Promise<string | undefined> =>
      (await run(fixture, operation, params)).error?.message
    expect(await failed('test_ref.create', { test_ref: '', name: 'X' })).toBe("The test_ref ID '' must be non-empty and contain no @ or #.")
    expect(await failed('test_ref.create', { test_ref: 'r#1', name: 'X' })).toBe("The test_ref ID 'r#1' must be non-empty and contain no @ or #.")
    expect(await failed('test_ref.update', { test_ref: 'r9', name: 'X' })).toBe("Unknown test_ref 'r9'.")
    await expect(fixture.ctx.dvProject.run({ ...HUMAN, project: fixture.project, operation: 'test_ref.create', params: { test_ref: 'r1' }, inputs: [] }))
      .rejects.toMatchObject({ code: 'invalid_params' })
    expect(fixture.ctx.dvProject.getState(fixture.project).components.test_ref).toEqual({})
  })

  it('refuses an ID that another noun or a hand-written kind has, in both directions', async () => {
    const fixture = await start()
    const { ctx } = fixture
    registerHand(ctx.dvProject)
    expect((await run(fixture, 'test_ref.create', { test_ref: 'x1', name: 'One' })).status).toBe('done')
    expect((await run(fixture, 'test_ref2.create', { test_ref2: 'x1', name: 'Two' })).error?.message)
      .toBe("The ID 'x1' already names a test_ref; update it, or choose another ID.")
    expect((await run(fixture, 'test_hand.create', { id: 'x1' })).error?.message).toBe('The ID already names a test_ref.')
    expect((await run(fixture, 'test_ref2.create', { test_ref2: 'y1', name: 'Two' })).status).toBe('done')
    expect((await run(fixture, 'test_ref.create', { test_ref: 'y1', name: 'One' })).error?.message)
      .toBe("The ID 'y1' already names a test_ref2; update it, or choose another ID.")
    expect((await run(fixture, 'test_hand.create', { id: 'h1' })).status).toBe('done')
    expect((await run(fixture, 'test_ref.create', { test_ref: 'h1', name: 'One' })).error?.message)
      .toBe("The ID 'h1' already names a test_hand; update it, or choose another ID.")
    const state = ctx.dvProject.getState(fixture.project)
    expect([Object.keys(state.components.test_ref ?? {}), Object.keys(state.components.test_ref2 ?? {})]).toEqual([['x1'], ['y1']])
  })
})
