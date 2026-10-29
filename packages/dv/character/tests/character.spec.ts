/**
 * The character component over the real `dvProject` service and the DSH tool and skill registries: the `dvCharacter` service
 * registers `character.create` and `character.update` with their agent tools and the skill `character`; the agent's calls write
 * versions, `<id>@<version>` inputs resolve to the version's reference images, an update makes what read the previous
 * version stale, and the ID check spans every reference kind. The only fake is a test `shot.render`.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import DvProject, {
  type AssetId, type AssetStore, type OperationToolValue, type ProjectId, type ProjectRecord, type RecordId, type RecordOrigin,
} from '@dv/project'
import { describe, expect, it, onTestFinished } from 'vitest'
import { chatProject, provideChatServices } from '../../project/tests/workspaces.ts'
import DvCharacter, { type CharacterId } from '../src/index.ts'

/** A human edit on the canvas, outside any chat session. */
const HUMAN: RecordOrigin = { actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: 'edit' }

/** An asset store that keeps bytes in memory. */
class MemoryAssets implements AssetStore {
  private readonly files = new Map<AssetId, { mime: string; name: string }>()
  has(asset: AssetId): boolean { return this.files.has(asset) }
  get(asset: AssetId): { mime: string; name: string } {
    const file = this.files.get(asset)
    if (file === undefined) throw new Error(`unknown asset ${asset}`)
    return file
  }
  read(): Uint8Array { return new Uint8Array() }
  importAsset(_project: ProjectId, source: Uint8Array | { path: string }, meta: { mime: string; name: string }): AssetId {
    const id = brandString<AssetId>(createHash('sha256').update(source instanceof Uint8Array ? source : Buffer.from(source.path)).digest('hex'))
    this.files.set(id, meta)
    return id
  }
  url(asset: AssetId): string { return `https://assets.example/${asset}` }
}

interface Fixture {
  ctx: Context
  project: ProjectId
  /** Store bytes as an image asset. */
  put(text: string): AssetId
  /** Run one tool as the agent of chat session `s1`, which runs in the folder of `project`. */
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** Remove the `dvCharacter` plugin. */
  disposeCharacter(): Promise<void>
}

/**
 * Mount the registries, `dvProject`, `dvCharacter` and a test `shot.render` whose `reference` input takes versions; the
 * context is disposed when the current test finishes.
 * @returns the fixture, with a project whose folder chat session `s1` runs in.
 */
async function start(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'dv-character-'))
  const ctx = new Context()
  const services = provideChatServices(ctx)
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  await ctx.plugin(SystemPrompt, {}).await()
  await ctx.plugin(ToolRuntime).await()
  await ctx.plugin(SkillRegistry, {}).await()
  await ctx.plugin(DvProject, {
    projectsFolder: join(root, 'projects'), cpuConcurrency: 1, gpuConcurrency: 1,
    promptSectionOrder: 4900,
  }).await()
  const assets = new MemoryAssets()
  ctx.dvProject.registerAssetStore(assets)
  const noun = ctx.plugin(DvCharacter)
  await noun.await()
  ctx.dvProject.registerComponent('shot')
  ctx.dvProject.registerOperation({
    name: 'shot.render', component: 'shot', version: '1', description: 'Test render.', params: {},
    inputs: { reference: { type: 'image', many: true, versioned: true, description: 'References.' } },
    outputs: [], deterministic: false, resource: 'none', summarize: () => 'rendered',
    execute: () => Promise.resolve({ outputs: [] }),
  })
  const project = await chatProject(ctx.dvProject, services, 'character', HUMAN)
  let calls = 0
  return {
    ctx, project,
    put: text => assets.importAsset(project, Buffer.from(text), { mime: 'image/png', name: `${text}.png` }),
    call(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${calls}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    disposeCharacter: async () => { await noun.dispose() },
  }
}

/** The `test_prop` slice: the record that wrote each version of a test prop, oldest first, by ID. */
type TestPropSlice = Record<string, RecordId[]>

/**
 * Register a test-only reference kind `test_prop` with `string` IDs and its create `test_prop.create`, which refuses
 * an ID that `kindsWithId` lists, as a kind owner's create does.
 * @param project - the `dvProject` service.
 */
function registerTestProp(project: Context['dvProject']): void {
  project.registerComponent('test_prop')
  project.registerReducer('test_prop' as never, {
    initial: (): TestPropSlice => ({}),
    reduce: (slice: TestPropSlice, record: ProjectRecord): TestPropSlice => (
      record.operation === 'test_prop.create' && record.status === 'done' ? { ...slice, [String(record.params['id'])]: [record.id] } : slice),
  } as never)
  project.registerReferenceKind({
    kind: 'test_prop', component: 'test_prop' as never, assetsOf: () => [],
    createdBy: (slice: TestPropSlice, id, version) => slice[id]?.[version - 1] ?? null,
    latest: (slice: TestPropSlice, id) => slice[id]?.length ?? null,
  })
  project.registerOperation({
    name: 'test_prop.create', component: 'test_prop', version: '1', description: 'Test prop create.',
    params: { id: { type: 'string', required: true, description: 'The ID.' } }, inputs: {},
    outputs: [], deterministic: false, resource: 'none', summarize: () => 'test prop created',
    execute(context) {
      const used = project.kindsWithId(context.state, String(context.params['id']))
      if (used.length > 0) throw new Error(`The ID already names a ${used.join(', ')}.`)
      return Promise.resolve({ outputs: [] })
    },
  })
}

/** The value of a successful operation tool call. */
function value(result: ToolExecutionResult): OperationToolValue {
  if (result.isError) throw new Error(result.error.message)
  return result.value as OperationToolValue
}

/** The error message of a failed tool call. */
function failure(result: ToolExecutionResult): string {
  return result.isError ? result.error.message : ''
}

describe('dvCharacter', () => {
  it('registers character.create and character.update with their tools, labels and the reducer, and removes them on disposal', async () => {
    const fixture = await start()
    const specs = fixture.ctx.dvProject.listOperations().filter(spec => spec.component === 'character')
    expect(specs.map(spec => [spec.name, spec.label])).toEqual([
      ['character.create', { zh: '新建角色', en: 'Create character' }], ['character.update', { zh: '修改角色', en: 'Update character' }],
    ])
    expect(fixture.ctx.tools.get('dv_character_create')).toBeDefined()
    expect(fixture.ctx.tools.get('dv_character_update')).toBeDefined()
    expect(fixture.ctx.dvProject.getState(fixture.project).components.character).toEqual({})
    await fixture.disposeCharacter()
    expect(fixture.ctx.dvProject.listOperations().filter(spec => spec.component === 'character')).toEqual([])
    expect(fixture.ctx.tools.get('dv_character_create')).toBeUndefined()
    expect(fixture.ctx.dvProject.getState(fixture.project).components).not.toHaveProperty('character')
  })

  it('registers the character skill while dvCharacter is mounted, and removes it on disposal', async () => {
    const fixture = await start()
    const skill = await fixture.ctx.skills.get('character')
    expect(skill).toMatchObject({ name: 'character', source: 'runtime', invocation: { modelInvocable: true } })
    expect(skill?.content.startsWith('# Character\n')).toBe(true)
    expect(skill?.content).toContain('`dv_character_create` for every person who must stay the same across shots')
    await fixture.disposeCharacter()
    expect(await fixture.ctx.skills.get('character')).toBeUndefined()
  })

  it('creates a character from the agent tool and resolves <id>@1 to its reference images', async () => {
    const fixture = await start()
    const image = fixture.put('image')
    const created = value(await fixture.call('dv_character_create', {
      reason: 'register', character: 'c1', name: 'Lead', description: 'red coat', inputs: { reference: [image] },
    }))
    expect(created).toMatchObject({ status: 'done', summary: 'character Lead created', outputs: [], params: { character: 'c1', name: 'Lead' } })
    const state = fixture.ctx.dvProject.getState(fixture.project)
    const record = state.components.proj.records.find(entry => entry.operation === 'character.create')
    expect(record).toMatchObject({
      actor: 'agent', surface: 'chat', component: 'character', params: { character: 'c1', name: 'Lead', description: 'red coat' },
      inputs: [{ role: 'reference', ref: { asset: image }, resolved_asset: image }], outputs: [], deterministic: false,
    })
    expect(state.components.character).toEqual({
      c1: [{ id: 'c1', version: 1, name: 'Lead', description: 'red coat', references: [image], created_by: record?.id }],
    })
    const ref = { character: brandString<CharacterId>('c1'), version: 1 }
    expect(fixture.ctx.dvProject.assetsOf(state, ref)).toEqual([image])
    expect(fixture.ctx.dvProject.parseInputs('shot.render', { reference: ['c1@1'] }, state)).toEqual([{ role: 'reference', ref }])
    value(await fixture.call('dv_shot_render', { reason: 'shoot', inputs: { reference: ['c1@1'] } }))
    const render = fixture.ctx.dvProject.getState(fixture.project).components.proj.records.at(-1)
    expect(render?.inputs).toEqual([{ role: 'reference', ref, resolved_asset: image }])
  })

  it('updates to the next version, keeps what the call leaves out, and marks what read the old version stale', async () => {
    const fixture = await start()
    const first = fixture.put('first')
    const second = fixture.put('second')
    value(await fixture.call('dv_character_create', { reason: 'add', character: 'c1', name: 'Lead', inputs: { reference: [first] } }))
    const render = value(await fixture.call('dv_shot_render', { reason: 'shoot', inputs: { reference: ['c1@1'] } }))
    const renamed = value(await fixture.call('dv_character_update', { reason: 'rename', character: 'c1', name: 'Hero' }))
    expect(renamed.summary).toBe('character c1 updated')
    const changed = value(await fixture.call('dv_character_update', { reason: 'new reference image', character: 'c1', inputs: { reference: [second] } }))
    const state = fixture.ctx.dvProject.getState(fixture.project)
    expect(state.components.character[brandString<CharacterId>('c1')]?.map(version => [version.version, version.name, version.references]))
      .toEqual([[1, 'Lead', [first]], [2, 'Hero', [first]], [3, 'Hero', [second]]])
    const records = state.components.proj.records
    const created = records.find(entry => entry.operation === 'character.create')
    expect(records.find(entry => entry.id === renamed.record)?.supersedes).toEqual([created?.id])
    expect(records.find(entry => entry.id === changed.record)?.supersedes).toEqual([renamed.record])
    expect(state.components.proj.stale).toEqual({ [render.record]: renamed.record })
  })

  it('refuses a used ID, an unknown ID, an ID with @, and invalid params', async () => {
    const fixture = await start()
    registerTestProp(fixture.ctx.dvProject)
    await fixture.ctx.dvProject.run({ ...HUMAN, project: fixture.project, operation: 'test_prop.create', params: { id: 'p1' }, inputs: [] })
    expect(failure(await fixture.call('dv_character_create', { reason: 'clash', character: 'p1', name: 'X' })))
      .toBe("The ID 'p1' already names a test_prop; update it, or choose another ID.")
    expect(failure(await fixture.call('dv_character_update', { reason: 'unknown', character: 'p1', name: 'X' }))).toBe("Unknown character 'p1'.")
    expect(failure(await fixture.call('dv_character_create', { reason: 'bad', character: 'c@1', name: 'X' })))
      .toBe("The character ID 'c@1' must be non-empty and contain no @ or #.")
    const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    await expect(fixture.ctx.dvProject.run({
      ...HUMAN, project: fixture.project, operation: 'character.create', params: { character: 'c1' }, inputs: [],
    })).rejects.toMatchObject({ code: 'invalid_params' })
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before)
    expect(fixture.ctx.dvProject.getState(fixture.project).components.character).toEqual({})
  })

  it('gives the ID of a character to kindsWithId, so a test_prop with that ID is refused', async () => {
    const fixture = await start()
    registerTestProp(fixture.ctx.dvProject)
    value(await fixture.call('dv_character_create', { reason: 'add', character: 'c1', name: 'Lead' }))
    value(await fixture.call('dv_character_update', { reason: 'rename', character: 'c1', name: 'Hero' }))
    const state = fixture.ctx.dvProject.getState(fixture.project)
    expect(fixture.ctx.dvProject.kindsWithId(state, 'c1')).toEqual(['character'])
    expect(fixture.ctx.dvProject.latestVersion(state, 'character', 'c1')).toBe(2)
    const prop = await fixture.ctx.dvProject.run({ ...HUMAN, project: fixture.project, operation: 'test_prop.create', params: { id: 'c1' }, inputs: [] })
    expect(prop.record).toMatchObject({ status: 'failed', error: { code: 'operation_failed', message: 'The ID already names a character.' } })
  })

  it('takes a version an undo took back off the state, and frees its ID there', async () => {
    const fixture = await start()
    registerTestProp(fixture.ctx.dvProject)
    const created = value(await fixture.call('dv_character_create', { reason: 'add', character: 'c1', name: 'Lead' }))
    expect(Object.keys(fixture.ctx.dvProject.getState(fixture.project).components.character)).toEqual(['c1'])
    await fixture.ctx.dvProject.undo(fixture.project)
    const prop = await fixture.ctx.dvProject.run({ ...HUMAN, project: fixture.project, operation: 'test_prop.create', params: { id: 'c1' }, inputs: [] })
    expect(prop.record?.status).toBe('done')
    expect(fixture.ctx.dvProject.getState(fixture.project).components.character).toEqual({})
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project, operation: 'character.create' })).toEqual([])
    expect(fixture.ctx.dvProject.listRecords(fixture.project).map(record => record.id)).toContain(created.record)
  })
})
