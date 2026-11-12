/**
 * The Audio edit component in a REAL composition: a test-only `cordis.yml` boots the DSH tool registry, the asset pool,
 * `dvProject`, `dvFfmpeg` and `dvAudioEdit` through the Loader. The agent's `dv_audioedit_*` calls write records whose
 * outputs are new WAV assets cut from or retimed from a WAV that ffmpeg writes: a tone, a 0.6 s pause, a tone, a
 * 0.4 s pause, and a tone, 5.5 s in all.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import DvAssetPool from '@dv/asset-pool'
import DvFfmpeg from '@dv/ffmpeg'
import DvProject, { type AssetId, type OperationToolValue, type ProjectId, type ProjectRecord } from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import { chatProject, provideChatServices } from '../../project/tests/workspaces.ts'
import DvAudioEdit from '../src/index.ts'

const FFMPEG = process.env['DV_FFMPEG'] ?? '/mnt/lustre/vlm-d1su/opt/ffmpeg-native/bin/ffmpeg'
const FFPROBE = process.env['DV_FFPROBE'] ?? 'ffprobe'

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvAudioEdit }

interface Fixture {
  ctx: Context
  dir: string
  project: ProjectId
  /** Store bytes in the asset pool. */
  put(bytes: Uint8Array, mime: string, name: string): AssetId
  /** Run one tool as the agent of chat session `s1`, which runs in the folder of `project`. */
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** Run one operation on input `audio` through `dvProject.run`, as the user in the canvas. */
  run(operation: string, params: Record<string, unknown>, audio: AssetId): Promise<ProjectRecord>
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/**
 * Boot the composition from a test-only `cordis.yml`.
 * @returns the fixture, with a project whose folder chat session `s1` runs in.
 */
async function start(): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-audio-edit-'))
  const globals = globalThis as typeof globalThis & { __dvAudioEditComposition?: typeof PLUGINS }
  globals.__dvAudioEditComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[]): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvAudioEditComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  row('system-prompt', 'SystemPrompt', [])
  row('tools', 'ToolRuntime', [])
  row('dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`])
  row('dv-ffmpeg', 'DvFfmpeg', [`ffmpegPath: ${FFMPEG}`, `ffprobePath: ${FFPROBE}`])
  row('dv-asset-pool', 'DvAssetPool', [])
  row('dv-audio-edit', 'DvAudioEdit', [])
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)

  const ctx = new Context()
  const services = provideChatServices(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const origin = { actor: 'user' as const, surface: 'api' as const, session: null, turn: null, tool_call: null, intent: 'create' }
  const project = await chatProject(ctx.dvProject, services, 'audio', origin)
  let calls = 0
  return {
    ctx, dir, project,
    put: (bytes, mime, name) => ctx.dvAssetPool.importAsset(project, bytes, { mime, name }, null),
    call(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${calls}`), name, arguments: args, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    async run(operation, params, audio) {
      const { record } = await ctx.dvProject.run({
        project, operation, params, inputs: [audioInput(audio)], actor: 'user', surface: 'canvas', session: null, turn: null, tool_call: null, intent: operation,
      })
      if (record === null) throw new Error(`${operation} wrote no record`)
      return record
    },
  }
}

/**
 * The input of role `audio`, resolved.
 * @param asset - the audio asset.
 * @returns the record input.
 */
function audioInput(asset: AssetId): ProjectRecord['inputs'][number] {
  return { role: 'audio', ref: { asset }, resolved_asset: asset }
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

/**
 * Three 1.5 s tones with a 0.6 s and a 0.4 s pause between them, as WAV bytes.
 * @param dir - a directory for the file.
 * @returns the bytes.
 */
function speech(dir: string): Uint8Array {
  const file = join(dir, 'speech.wav')
  execFileSync(FFMPEG, [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=1.5', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-filter_complex', '[1]atrim=0:0.6[p1];[1]atrim=0:0.4[p2];[0]asplit=3[a][b][c];[a][p1][b][p2][c]concat=n=5:v=0:a=1', '-c:a', 'pcm_s16le', file,
  ])
  return readFileSync(file)
}

describe('dvAudioEdit', () => {
  it('registers both operations with their dv_audioedit_* tools and removes them on disposal', async () => {
    const fixture = await start()
    const specs = fixture.ctx.dvProject.listOperations().filter(spec => spec.component === 'audioedit')
    expect(specs.map(spec => spec.name).sort()).toEqual(['audioedit.speed', 'audioedit.split'])
    expect(fixture.ctx.tools.get('dv_audioedit_split')).toBeDefined()
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-audio-edit.mjs'))
    await entry?.fiber?.dispose()
    expect(fixture.ctx.dvProject.listOperations().filter(spec => spec.component === 'audioedit')).toEqual([])
    expect(fixture.ctx.tools.get('dv_audioedit_speed')).toBeUndefined()
  })

  it('splits at the longest pauses or at given times into WAV pieces that cover the audio', async () => {
    const fixture = await start()
    const audio = fixture.put(speech(fixture.dir), 'audio/wav', 'speech.wav')
    const three = value(await fixture.call('dv_audioedit_split', { reason: 'one line per clip', pieces: 3, inputs: { audio } }))
    expect(three).toMatchObject({ status: 'done', summary: 'split into 3 pieces' })
    expect(three.outputs.map(output => output.mime)).toEqual(['audio/wav', 'audio/wav', 'audio/wav'])
    expect(three.report).toEqual({
      pieces: [
        { start_sec: 0, end_sec: 1.8, duration_sec: 1.8 },
        { start_sec: 1.8, end_sec: 3.8, duration_sec: 2 },
        { start_sec: 3.8, end_sec: 5.5, duration_sec: 1.7 },
      ],
    })
    expect(fixture.ctx.dvAssetPool.get(three.outputs[1]?.asset_id as AssetId)).toMatchObject({ name: 'piece-2.wav', duration_sec: 2 })
    const two = value(await fixture.call('dv_audioedit_split', { reason: 'longest pause only', pieces: 2, inputs: { audio } }))
    expect(two.report).toMatchObject({ pieces: [{ end_sec: 1.8 }, { start_sec: 1.8, end_sec: 5.5 }] })
    const at = value(await fixture.call('dv_audioedit_split', { reason: 'at a time', at: [1], inputs: { audio } }))
    expect(at.report).toMatchObject({ pieces: [{ start_sec: 0, end_sec: 1 }, { start_sec: 1, end_sec: 5.5, duration_sec: 4.5 }] })
  })

  it('retimes by a factor or to a length without changing the input', async () => {
    const fixture = await start()
    const audio = fixture.put(speech(fixture.dir), 'audio/wav', 'speech.wav')
    const faster = value(await fixture.call('dv_audioedit_speed', { reason: 'fit the clip', speed: 1.25, inputs: { audio } }))
    expect(faster).toMatchObject({ status: 'done', summary: 'speed ×1.25', report: { speed: 1.25 } })
    expect(Number((faster.report as Record<string, unknown>)['duration_sec'])).toBeCloseTo(4.4, 1)
    const fitted = value(await fixture.call('dv_audioedit_speed', { reason: 'fit 5 s', duration_sec: 5, inputs: { audio } }))
    expect(fitted).toMatchObject({ summary: 'fitted to 5 s', report: { speed: 1.1 } })
    expect(Number((fitted.report as Record<string, unknown>)['duration_sec'])).toBeCloseTo(5, 1)
    expect((await fixture.ctx.dvFfmpeg.probe(fixture.ctx.dvAssetPool.path(audio))).durationSec).toBeCloseTo(5.5, 1)
  })

  it('records each call with its params, input and outputs', async () => {
    const fixture = await start()
    const audio = fixture.put(speech(fixture.dir), 'audio/wav', 'speech.wav')
    const split = await fixture.run('audioedit.split', { at: [2] }, audio)
    expect(split).toMatchObject({
      actor: 'user', component: 'audioedit', operation: 'audioedit.split', params: { at: [2] }, inputs: [audioInput(audio)],
      status: 'done', deterministic: false,
    })
    expect(split.outputs.map(asset => fixture.ctx.dvAssetPool.get(asset).name)).toEqual(['piece-1.wav', 'piece-2.wav'])
    const speed = await fixture.run('audioedit.speed', { speed: 2 }, audio)
    expect(speed).toMatchObject({ component: 'audioedit', operation: 'audioedit.speed', params: { speed: 2 }, status: 'done', deterministic: true })
    expect(speed.outputs.map(asset => fixture.ctx.dvAssetPool.get(asset).name)).toEqual(['speed.wav'])
    expect((await fixture.run('audioedit.speed', { speed: 2 }, audio)).cost).toMatchObject({ reused: true })
    expect((await fixture.run('audioedit.split', { at: [2] }, audio)).cost).toMatchObject({ reused: false })
  })

  it('refuses invalid params with invalid_params before any record', async () => {
    const fixture = await start()
    const audio = fixture.put(speech(fixture.dir), 'audio/wav', 'speech.wav')
    const before = fixture.ctx.dvProject.listHistory({ project: fixture.project }).length
    const refusals: Array<[string, Record<string, unknown>, string]> = [
      ['audioedit.split', {}, 'Pass either "pieces" or "at".'],
      ['audioedit.split', { pieces: 2, at: [1] }, 'Pass either "pieces" or "at".'],
      ['audioedit.split', { pieces: 1 }, '"pieces" is 1; pass 2 or more.'],
      ['audioedit.split', { at: [] }, 'pass cut times after 0, in increasing order, at least 1 ms apart'],
      ['audioedit.split', { at: [0, 1] }, 'pass cut times after 0'],
      ['audioedit.split', { at: [2, 1] }, 'pass cut times after 0'],
      ['audioedit.split', { at: [1, 1] }, 'pass cut times after 0'],
      ['audioedit.split', { at: [1, 1.0004] }, 'at least 1 ms apart'],
      ['audioedit.speed', {}, 'Pass either "speed" or "duration_sec".'],
      ['audioedit.speed', { speed: 2, duration_sec: 2 }, 'Pass either "speed" or "duration_sec".'],
      ['audioedit.speed', { speed: 0.1 }, '"speed" is 0.1; pass 0.5 to 100.'],
      ['audioedit.speed', { speed: 101 }, '"speed" is 101; pass 0.5 to 100.'],
      ['audioedit.speed', { duration_sec: 0 }, '"duration_sec" is 0; pass more than 0.'],
    ]
    for (const [operation, params, message] of refusals) {
      await expect(fixture.run(operation, params, audio)).rejects.toMatchObject({ code: 'invalid_params', message: expect.stringContaining(message) as string })
    }
    expect(failure(await fixture.call('dv_audioedit_split', { reason: 'one', pieces: 1, inputs: { audio } }))).toContain('pass 2 or more')
    expect(fixture.ctx.dvProject.listHistory({ project: fixture.project })).toHaveLength(before)
  })

  it('fails the record with operation_failed when the audio cannot be cut or retimed', async () => {
    const fixture = await start()
    const audio = fixture.put(speech(fixture.dir), 'audio/wav', 'speech.wav')
    const text = fixture.put(Buffer.from('notes'), 'text/plain', 'notes.txt')
    const garbage = fixture.put(Buffer.from('not an mp3'), 'audio/mpeg', 'broken.mp3')
    // A WebM file written as a live stream, the way a browser records one, has no duration in its header.
    const live = join(fixture.dir, 'voice.webm')
    execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=d=1.5', '-c:a', 'opus', '-strict', '-2', '-ac', '2', '-ar', '48000', '-live', '1', live])
    const voice = fixture.put(readFileSync(live), 'audio/webm', 'voice.webm')
    const failures: Array<[string, Record<string, unknown>, AssetId, string]> = [
      ['audioedit.split', { pieces: 4 }, audio, 'The audio has 2 pauses between sounds, too few for 4 pieces; pass "at" with the cut times instead.'],
      ['audioedit.split', { at: [9] }, audio, 'The cut at 9s is not before the audio\'s end at 5.5s.'],
      ['audioedit.split', { at: [5.4996] }, audio, 'The cut at 5.5s is not before the audio\'s end at 5.5s.'],
      ['audioedit.split', { at: [1] }, text, 'The input is text/plain, not audio.'],
      ['audioedit.split', { at: [1] }, voice, 'ffprobe reports no duration for the audio.'],
      ['audioedit.speed', { speed: 2 }, text, 'The input is text/plain, not audio.'],
      ['audioedit.speed', { duration_sec: 0.01 }, audio, 'Fitting 5.5s into 0.01s needs speed 550, outside 0.5 to 100.'],
      ['audioedit.speed', { duration_sec: 20 }, audio, 'Fitting 5.5s into 20s needs speed 0.275, outside 0.5 to 100.'],
      ['audioedit.speed', { duration_sec: 1 }, voice, 'ffprobe reports no duration for the audio.'],
    ]
    for (const [operation, params, input, message] of failures) {
      expect(await fixture.run(operation, params, input)).toMatchObject({ status: 'failed', error: { code: 'operation_failed', message } })
    }
    expect(await fixture.run('audioedit.speed', { speed: 2 }, garbage)).toMatchObject({ status: 'failed', error: { code: 'operation_failed' } })
    expect(failure(await fixture.call('dv_audioedit_split', { reason: 'late', at: [9], inputs: { audio } }))).toContain('is not before the audio\'s end')
  })

  it('refuses invalid arguments from a direct caller of the service methods', async () => {
    const fixture = await start()
    const audio = fixture.put(speech(fixture.dir), 'audio/wav', 'speech.wav')
    await expect(fixture.ctx.dvAudioEdit.split(audio, { pieces: 1 }, fixture.dir)).rejects.toThrow('"pieces" is 1; pass 2 or more.')
    await expect(fixture.ctx.dvAudioEdit.split(audio, { at: [2, 1] }, fixture.dir)).rejects.toThrow('in increasing order')
    await expect(fixture.ctx.dvAudioEdit.speed(audio, { speed: 0.1 }, fixture.dir)).rejects.toThrow('"speed" is 0.1; pass 0.5 to 100.')
  })
})
