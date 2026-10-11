/**
 * The FastVideo company plugin in a REAL composition: a test-only `cordis.yml` boots the DSH skill registry, the model
 * catalog and the plugin through the Loader. The FastVideo streaming_v2 servers are the only fakes: one HTTP server per
 * mode that answers the capabilities and health routes and streams fixed bytes for every render. An opt-in test renders
 * against a running server named by `DV_BACKEND_URL`.
 */
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import DvModels, { type ModelEntry, type RenderStreamEvent } from '@dv/models'
import { afterEach, describe, expect, it } from 'vitest'
import * as FastVideo from '../src/index.ts'

/** The reference image of the opt-in run against a running server. */
const REAL_REFERENCE = '/mnt/lustre/vlm-d1su/codes/dsh-dv-hub/elon-musk.jpg'
const REAL_BACKEND = process.env['DV_BACKEND_URL']

/** The capabilities the fake reference server reports; the server counts the first frame among its 3 images. */
const REFERENCE_CAPABILITIES = {
  model_id: 'fake-ref2va', name: 'Fake Ref2AV', min_segment_duration_sec: 5, max_segment_duration_sec: 6,
  max_reference_images: 3, max_reference_aspect_ratio: 4.0,
  frame_sizes: { '16:9': { '720p': [1344, 768] } }, num_frames_by_duration_sec: { 5: 124, 6: 158 },
}

/** The capabilities the fake text server reports. */
const TEXT_CAPABILITIES = {
  model_id: 'fake-t2va', name: 'Fake T2AV', min_segment_duration_sec: 5, max_segment_duration_sec: 6, max_reference_images: 0,
  frame_sizes: { '16:9': { '720p': [1344, 768] } }, num_frames_by_duration_sec: { 5: 124, 6: 158 },
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/**
 * Start a fake streaming_v2 server that answers capabilities and health and streams fixed bytes for every render.
 * @param capabilities - the capabilities body it reports.
 * @returns the server URL and the render request bodies.
 */
async function startFakeServer(capabilities: object): Promise<{ url: string; requests: Record<string, unknown>[] }> {
  const requests: Record<string, unknown>[] = []
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'POST') {
      response.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
      response.end(JSON.stringify((request.url ?? '').endsWith('/health') ? { status: 'ready' } : capabilities))
      return
    }
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>)
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'close' })
      const events: Array<[string, object]> = [
        ['last_frame', { data: Buffer.from('LAST').toString('base64') }],
        ['video_start', { mime: 'video/mp4; codecs="avc1.64001f"' }],
        ['video_chunk', { data: Buffer.from('VIDEO').toString('base64') }],
        ['done', { timings: { total_s: 0.4 } }],
      ]
      for (const [event, data] of events) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests }
}

/** The plugins the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = {
  SkillRegistry, DvModels,
  FastVideo: { name: FastVideo.name, inject: FastVideo.inject, Config: FastVideo.Config, apply: FastVideo.apply },
}

/**
 * Boot the skill registry, the catalog and the plugin from a test-only `cordis.yml`.
 * @param modes - the server URL of each mode of `fasth3` to configure.
 * @returns the root context.
 */
async function start(modes: { reference?: string; text?: string }): Promise<Context> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-fastvideo-'))
  const globals = globalThis as typeof globalThis & { __dvFastVideo?: typeof PLUGINS }
  globals.__dvFastVideo = PLUGINS
  const config = ['models:', '  fasth3:', ...Object.entries(modes).flatMap(([mode, url]) => [
    `    ${mode}:`, `      baseUrl: ${url}`, `      gpuSecondsPerVideoSecond: ${mode === 'reference' ? 4 : 1.5}`,
  ])]
  const rows: string[] = []
  for (const [id, key, lines] of [['skills', 'SkillRegistry', []], ['dv-models', 'DvModels', []], ['dv-fastvideo', 'FastVideo', config]] as const) {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvFastVideo.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...lines.length === 0 ? [] : ['  config:', ...lines.map(line => `    ${line}`)])
  }
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  return ctx
}

/** The registered `fasth3` entry. */
function fasth3(ctx: Context): ModelEntry {
  const entry = ctx.dvModels.get('fasth3')
  if (entry === undefined) throw new Error('fasth3 is not registered')
  return entry
}

/** Collect a render stream. */
async function collect(stream: AsyncIterable<RenderStreamEvent>): Promise<RenderStreamEvent[]> {
  const events: RenderStreamEvent[] = []
  for await (const event of stream) events.push(event)
  return events
}

/** A render request with the given images. */
function request(references: Buffer[], firstFrame: Buffer | null) {
  return { prompt: 'Picture 1 smiles', references, firstFrame, frameWidth: 1344, frameHeight: 768, numFrames: 124, seed: 7, extra: {} }
}

describe('dv-fastvideo', () => {
  it('registers fasth3 in the configured modes, each with the facts of its own server', async () => {
    const [reference, text] = await Promise.all([startFakeServer(REFERENCE_CAPABILITIES), startFakeServer(TEXT_CAPABILITIES)])
    const ctx = await start({ reference: reference.url, text: text.url })
    const entry = fasth3(ctx)
    expect(entry).toMatchObject({
      company: 'local FastVideo',
      modes: { reference: { inputs: { reference: { min: 1 }, first_frame: { min: 0 } }, extra: {} }, text: { inputs: {}, extra: {} } },
    })
    // The server counts the first frame among its request images, so mode reference takes one reference image fewer.
    expect(await entry.facts('reference')).toEqual({
      modelId: 'fake-ref2va', aspectRatios: ['16:9'], resolutions: ['720p'], frameSizes: { '16:9': { '720p': [1344, 768] } },
      minDurationSec: 5, maxDurationSec: 6, numFramesByDurationSec: { 5: 124, 6: 158 },
      maxReferenceImages: 2, imageLabels: ['Picture 1', 'Picture 2', 'Picture 3'], gpuSecondsPerVideoSecond: 4,
    })
    expect(await entry.facts('text')).toMatchObject({ modelId: 'fake-t2va', maxReferenceImages: 0, imageLabels: [], gpuSecondsPerVideoSecond: 1.5 })
    // The streaming_v2 clients stay private to the plugin.
    expect(ctx.get('dreamverseGeneration')).toBeUndefined()
  })

  it('sends each mode to its own server: references, then the first frame, or no image', async () => {
    const [reference, text] = await Promise.all([startFakeServer(REFERENCE_CAPABILITIES), startFakeServer(TEXT_CAPABILITIES)])
    const ctx = await start({ reference: reference.url, text: text.url })
    const events = await collect(fasth3(ctx).render('reference', request([Buffer.from('REF1'), Buffer.from('REF2')], Buffer.from('FIRST'))))
    expect(reference.requests[0]).toEqual({
      prompt: 'Picture 1 smiles', width: 1344, height: 768, num_frames: 124, seed: 7, return_last_frame: true,
      reference_images: ['REF1', 'REF2', 'FIRST'].map(value => Buffer.from(value).toString('base64')),
    })
    expect(events.map(event => event.kind)).toEqual(['last_frame', 'video_start', 'chunk', 'done'])
    expect(events[2]).toEqual({ kind: 'chunk', bytes: Buffer.from('VIDEO') })
    await collect(fasth3(ctx).render('reference', request([Buffer.from('REF1')], null)))
    expect(reference.requests[1]?.['reference_images']).toEqual([Buffer.from('REF1').toString('base64')])
    await collect(fasth3(ctx).render('text', request([], null)))
    expect(text.requests).toHaveLength(1)
    expect(text.requests[0]?.['reference_images'] ?? []).toEqual([])
  })

  it('registers only the configured modes and their prompt skills, and removes them on disposal', async () => {
    const reference = await startFakeServer(REFERENCE_CAPABILITIES)
    const ctx = await start({ reference: reference.url })
    expect(Object.keys(fasth3(ctx).modes)).toEqual(['reference'])
    expect(() => fasth3(ctx).render('text', request([], null))).toThrow('Model fasth3 is not served in mode text.')
    const skill = await ctx.skills.get('fasth3-reference-prompting')
    expect(skill?.description).toContain('model fasth3 in mode reference')
    expect(skill?.content).toContain('Every shot needs at least one reference image.')
    expect(await ctx.skills.get('fasth3-text-prompting')).toBeUndefined()
    const entry = [...ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-fastvideo.mjs'))
    await entry?.fiber?.dispose()
    expect(await ctx.skills.get('fasth3-reference-prompting')).toBeUndefined()
    expect(ctx.dvModels.list()).toEqual([])
  })

  it('refuses a config that names a model or mode it does not serve', async () => {
    const reference = await startFakeServer(REFERENCE_CAPABILITIES)
    const ctx = await start({ reference: reference.url })
    const server = { baseUrl: reference.url, gpuSecondsPerVideoSecond: 1 }
    expect(() => { FastVideo.apply(ctx, { models: { wan: { text: server } } }) }).toThrow('dv-fastvideo serves no model "wan"; it serves: fasth3.')
    expect(() => { FastVideo.apply(ctx, { models: { fasth3: { edit: server } } }) })
      .toThrow('dv-fastvideo serves model "fasth3" in no mode "edit"; its modes: reference, text.')
    expect(() => { FastVideo.apply(ctx, { models: { fasth3: {} } }) }).toThrow('dv-fastvideo: model "fasth3" names no mode.')
    expect(ctx.dvModels.list().map(model => model.id)).toEqual(['fasth3'])
  })

  it.skipIf(REAL_BACKEND === undefined || !existsSync(REAL_REFERENCE))('renders a real five-second shot against the running server', async () => {
    const ctx = await start({ reference: REAL_BACKEND as string })
    const facts = await fasth3(ctx).facts('reference')
    const [width, height] = facts.frameSizes[facts.aspectRatios[0] ?? '']?.[facts.resolutions[0] ?? ''] ?? [0, 0]
    const events = await collect(fasth3(ctx).render('reference', {
      prompt: 'Picture 1 is a man speaking to the camera in a bright office, slow push-in, natural light.',
      references: [readFileSync(REAL_REFERENCE)], firstFrame: null, frameWidth: width, frameHeight: height,
      numFrames: facts.numFramesByDurationSec['5'] ?? 0, seed: 1, extra: {},
    }))
    expect(events.map(event => event.kind)).toEqual(expect.arrayContaining(['last_frame', 'video_start', 'chunk', 'done']))
  }, 600_000)
})
