/**
 * Shared fixtures of the `@dv/reference-kit` tests: the test-only nouns `test_ref` (with the extra field `traits`),
 * `test_ref2` and `testskill`, an in-memory asset store, and a context that mounts the DSH system prompt, tool and skill
 * registries, `dvProject` and the three nouns. The skill name is the component key, and a DSH skill name has no `_`,
 * so only `testskill` gets its skill registered.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import DvProject, { type AssetId, type AssetStore, type ProjectId, type RecordOrigin } from '@dv/project'
import { onTestFinished } from 'vitest'
import { defineReference, type ReferenceSlice, type ReferenceSpec, type ReferenceVersion } from '../src/index.ts'

/** One version of a `test_ref` item: the shared fields and its `traits`. */
export type TestRef = ReferenceVersion & { traits: string[] }

declare module '@dv/project/types' {
  interface ComponentStates {
    /** The test noun of the reference kit tests, with the extra field `traits`. */
    test_ref?: ReferenceSlice<TestRef>
    /** The second test noun of the reference kit tests, for the ID clash between two nouns. */
    test_ref2?: ReferenceSlice
    /** The test noun whose key is a valid DSH skill name, for the skill registration. */
    testskill?: ReferenceSlice
  }
  /** The test nouns as reference kinds, with `string` IDs. */
  interface ReferenceKinds { test_ref: string; test_ref2: string; testskill: string }
}

/** The input role of both test nouns. */
const REFERENCE = { reference: { type: 'image', many: true, description: 'The reference images of the version, in order.' } } as const

/** The skill of both test nouns. */
const SKILL = {
  description: 'How to create and update test references.', whenToUse: 'A test needs a reference.',
  file: new URL('test-ref-skill.md', import.meta.url),
}

/** The declaration of `test_ref`. */
export const TEST_REF: ReferenceSpec<'test_ref'> = {
  service: 'dvTestRef', component: 'test_ref', noun: { zh: '测试', en: 'test reference' }, meaning: 'an item a test keeps',
  reference: REFERENCE, skill: SKILL,
  fields: { traits: { param: { type: 'array', items: { type: 'string' }, description: 'Traits of the item.' }, initial: [] } },
}

/** The `test_ref` service. */
export class DvTestRef extends defineReference(TEST_REF) {}

/** The `test_ref2` service. */
export class DvTestRef2 extends defineReference<'test_ref2'>({
  service: 'dvTestRef2', component: 'test_ref2', noun: { zh: '测试二', en: 'second test reference' }, meaning: 'another item',
  reference: REFERENCE, skill: SKILL,
}) {}

/** The `testskill` service. */
export class DvTestSkill extends defineReference<'testskill'>({
  service: 'dvTestSkill', component: 'testskill', noun: { zh: '技能', en: 'skill test item' }, meaning: 'an item with a skill',
  reference: REFERENCE, skill: SKILL,
}) {}

/** A human edit on the canvas, outside any chat session. */
export const HUMAN: RecordOrigin = { actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: 'edit' }

/** An asset store that keeps bytes in memory. */
class MemoryAssets implements AssetStore {
  private readonly files = new Map<AssetId, { mime: string; name: string; bytes: Uint8Array }>()
  has(asset: AssetId): boolean { return this.files.has(asset) }
  get(asset: AssetId): { mime: string; name: string } {
    const file = this.files.get(asset)
    if (file === undefined) throw new Error(`unknown asset ${asset}`)
    return file
  }
  read(asset: AssetId): Uint8Array { return this.files.get(asset)?.bytes ?? new Uint8Array() }
  importAsset(source: Uint8Array | { path: string }, meta: { mime: string; name: string }): AssetId {
    const bytes = source instanceof Uint8Array ? source : Buffer.from(source.path)
    const id = brandString<AssetId>(createHash('sha256').update(bytes).digest('hex'))
    this.files.set(id, { mime: meta.mime, name: meta.name, bytes })
    return id
  }
  url(asset: AssetId): string { return `https://assets.example/${asset}` }
}

/** A mounted context with one project. */
export interface Fixture {
  ctx: Context
  project: ProjectId
  /** Store bytes as an image asset. */
  put(text: string): AssetId
  /** Remove the `test_ref` plugin. */
  disposeTestRef(): Promise<void>
  /** Remove the `testskill` plugin. */
  disposeTestSkill(): Promise<void>
}

/**
 * Mount the registries, `dvProject` and both test nouns; the context is disposed when the current test finishes.
 * @returns the fixture.
 */
export async function start(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'dv-reference-kit-'))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  await ctx.plugin(SystemPrompt, {}).await()
  await ctx.plugin(ToolRuntime).await()
  await ctx.plugin(SkillRegistry, {}).await()
  await ctx.plugin(DvProject, {
    root: join(root, 'projects'), sessionRoot: join(root, 'sessions'), projectsFolder: join(root, 'DreamVerse'), cpuConcurrency: 1, gpuConcurrency: 1,
    promptSectionOrder: 4900,
  }).await()
  const assets = new MemoryAssets()
  ctx.dvProject.registerAssetStore(assets)
  const testRef = ctx.plugin(DvTestRef)
  await testRef.await()
  await ctx.plugin(DvTestRef2).await()
  const testSkill = ctx.plugin(DvTestSkill)
  await testSkill.await()
  const project = (await ctx.dvProject.createProject('kit', HUMAN)).id
  return {
    ctx, project, put: text => assets.importAsset(Buffer.from(text), { mime: 'image/png', name: `${text}.png` }),
    disposeTestRef: async () => { await testRef.dispose() },
    disposeTestSkill: async () => { await testSkill.dispose() },
  }
}
