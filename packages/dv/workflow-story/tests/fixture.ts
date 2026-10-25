/**
 * The story workflow in a REAL composition: a test-only `cordis.yml` boots the DSH tool registry, `dvProject`,
 * `dvFfmpeg`, the asset pool, `dvTimeline`, the model catalog `dvModels`, `dvShotRender`, `dvShotPlan` and `dvStory`
 * through the Loader, and the DSH skill registry when a test asks for it. The only fake is the model `fake` of provider
 * `test`, one entry per task, whose validation each test chooses and whose render streams a few bytes as the video and
 * the last still. A composition can start from the stored projects of `fixtures/`, which the record store loads at boot
 * as it loads any older log.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import DvAssetPool from '@dv/asset-pool'
import DvFfmpeg from '@dv/ffmpeg'
import DvModels, { type ModelEntry, type RenderModelFacts, type RenderRequest, type TaskOfPrimitive } from '@dv/models'
import DvProject, { type AssetId, type ProjectId, type ProjectRecord, type RecordId, type RunRequest, type SessionId } from '@dv/project'
import DvShotPlan from '@dv/shot-plan'
import DvShotRender from '@dv/shot-render'
import DvTimeline from '@dv/timeline'
import DvStory from '../src/index.ts'

const FFMPEG = process.env['DV_FFMPEG'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-native/bin/ffmpeg'
const FFPROBE = process.env['DV_FFPROBE'] ?? 'ffprobe'

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = {
  SkillRegistry, SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvTimeline, DvModels, DvShotRender, DvShotPlan, DvStory,
}

/** A user action outside any chat session: it lands on `main` directly. */
export const USER = { actor: 'user' as const, surface: 'canvas' as const, session: null, turn: null, tool_call: null }

/** Facts with one small frame size per aspect ratio and durations of 1 to 3 seconds. */
const FACTS: RenderModelFacts = {
  modelId: 'test-fake', aspectRatios: ['16:9', '9:16'], resolutions: ['720p'],
  frameSizes: { '16:9': { '720p': [192, 112] }, '9:16': { '720p': [112, 192] } }, minDurationSec: 1, maxDurationSec: 3,
  numFramesByDurationSec: { 1: 25, 2: 49, 3: 73 },
}

/** The problems the validation of the model `fake` reports for a request, by task; none by default. */
export type Checks = Record<TaskOfPrimitive<'video'>, (request: RenderRequest) => string[]>

/**
 * A catalog entry of the model `fake`.
 * @param task - the task the entry serves.
 * @param checks - the validation of each task.
 * @returns the entry.
 */
function fake(task: TaskOfPrimitive<'video'>, checks: Checks): ModelEntry<TaskOfPrimitive<'video'>> {
  return {
    modality: 'video', task, provider: 'test', model: 'fake', description: 'stand-in',
    facts: () => Promise.resolve(FACTS),
    schema: () => Promise.resolve({}),
    validateGenerationRequest: request => Promise.resolve(checks[task](request)),
    async *render() {
      yield { kind: 'last_frame', png: Buffer.from('png') }
      yield { kind: 'video_start', mime: 'video/mp4' }
      yield { kind: 'chunk', bytes: Buffer.from('mp4') }
      yield { kind: 'done', timings: {} }
    },
  }
}

export interface Fixture {
  ctx: Context
  project: ProjectId
  checks: Checks
  /** Store bytes in the asset pool. */
  put(bytes: string, mime: string, name: string): AssetId
  /** Run one tool as the agent of chat session `s1`, which is bound to `project`. */
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** Run one operation on `main` as the user and return its record; in `project` and without inputs unless given. */
  record(operation: string, params: Record<string, unknown>, options?: { project?: ProjectId; inputs?: RunRequest['inputs'] }): Promise<ProjectRecord>
  /** Render one take in `project` as the user with `dvShotRender.render`, started by a record at a slot when one is given. */
  take(params: Record<string, unknown>, inputs?: RunRequest['inputs'], started?: { record: RecordId; slot: number }): Promise<RecordId>
}

const disposers: Array<() => Promise<void>> = []

/** Dispose every composition that `start` booted; each spec file calls it after each test. */
export async function disposeAll(): Promise<void> {
  for (const dispose of disposers.splice(0)) await dispose()
}

/**
 * Boot the composition from a test-only `cordis.yml`, with the model `fake` in tasks `ref2v` and `t2v`.
 * @param stored - a directory under `fixtures/` whose project directories the record store loads at boot.
 * @param skills - whether the DSH skill registry is mounted.
 * @returns the fixture, with a new project bound to chat session `s1`.
 */
export async function start(stored?: string, skills = false): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-workflow-story-'))
  if (stored !== undefined) cpSync(new URL(`fixtures/${stored}`, import.meta.url), join(dir, 'projects'), { recursive: true })
  const globals = globalThis as typeof globalThis & { __dvStoryComposition?: typeof PLUGINS }
  globals.__dvStoryComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[]): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvStoryComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  if (skills) row('skills', 'SkillRegistry', [])
  row('system-prompt', 'SystemPrompt', [])
  row('tools', 'ToolRuntime', [])
  row('dv-project', 'DvProject', [`root: ${join(dir, 'projects')}`, `sessionRoot: ${join(dir, 'sessions')}`])
  row('dv-ffmpeg', 'DvFfmpeg', [`ffmpegPath: ${FFMPEG}`, `ffprobePath: ${FFPROBE}`])
  row('dv-asset-pool', 'DvAssetPool', [`root: ${join(dir, 'assets')}`])
  row('dv-timeline', 'DvTimeline', [])
  row('dv-models', 'DvModels', [])
  row('dv-shot-render', 'DvShotRender', [])
  row('dv-shot-plan', 'DvShotPlan', [])
  row('dv-story', 'DvStory', [])
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  const checks: Checks = { ref2v: () => [], t2v: () => [] }
  const removers = (['ref2v', 't2v'] as const).map(task => ctx.dvModels.register(fake(task, checks)))
  disposers.push(async () => {
    for (const remove of removers) remove()
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const project = (await ctx.dvProject.createProject('story', { ...USER, intent: 'create' })).id
  ctx.dvProject.bindSession(brandString<SessionId>('s1'), project)
  let calls = 0
  return {
    ctx, project, checks,
    put: (bytes, mime, name) => ctx.dvAssetPool.importAsset(Buffer.from(bytes), { mime, name }, null),
    call(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${calls}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    async record(operation, params, options = {}) {
      const { inputs = [], ...where } = options
      const result = await ctx.dvProject.run({ ...USER, project, ...where, operation, params, inputs, intent: operation })
      if (result.record === null) throw new Error(`${operation} wrote no record`)
      return result.record
    },
    take: (params, inputs = [], started) => ctx.dvShotRender.render({
      ...USER, project, params, inputs, intent: 'take', ...started === undefined ? {} : { started_by: started },
    }),
  }
}

/** The model key of the model `fake` in task `ref2v`. */
export const REF = { modality: 'video', task: 'ref2v', provider: 'test', model: 'fake' }

/** The model key of the model `fake` in task `t2v`. */
export const TXT = { ...REF, task: 't2v' }
