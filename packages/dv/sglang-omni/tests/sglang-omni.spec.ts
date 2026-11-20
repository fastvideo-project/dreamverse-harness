/**
 * The `sglang-omni` provider plugin in a REAL composition against a fake SGLang-Omni server that answers with the bodies
 * and headers of a running server.
 */
import { readFileSync } from 'node:fs'
import type { AssetId, RecordId } from '@dv/project'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, describe, expect, it } from 'vitest'
import * as SglangOmni from '../src/index.ts'
import {
  CANNOT, KEY, REFUSAL_END, UNAVAILABLE, UNAVAILABLE_END, chunk, failure, json, speechHeaders, start, startFakeOmni, value, wav,
  type FakeOmni, type Fixture,
} from './fixture.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function boot(): Promise<{ fake: FakeOmni; fixture: Fixture }> {
  const fake = await startFakeOmni()
  cleanups.push(() => fake.close())
  const fixture = await start(fake.url)
  cleanups.push(() => fixture.dispose())
  return { fake, fixture }
}

function speech(prompt: string, extra: Record<string, unknown> = {}) {
  return { prompt, extra }
}

describe('dv-sglang-omni', () => {
  it('lists the model with its description and prompt skill, and removes both on disposal', async () => {
    const { fixture } = await boot()
    expect(fixture.ctx.dvModels.list().map(({ modality, task, provider, model }) => ({ modality, task, provider, model }))).toEqual([KEY])
    expect(value(await fixture.call('dv_models_list', {}))).toEqual([{
      ...KEY,
      hosting: 'self-hosted',
      description: 'Fish Audio Drama 3: expressive speech from text in many languages, with sound events such as laughs and sighs '
        + 'written into the text.',
      prompt_skill: 'fish-audio-drama-3-prompting',
    }])
    const skill = await fixture.ctx.skills.get('fish-audio-drama-3-prompting')
    expect(skill?.description).toBe('Prompt markup of model fish-audio-drama-3 for task t2a: speaker tags, sound events, clip length, and voices.')
    expect(skill?.content).toBe(readFileSync(new URL('../skills/fish-audio-drama-3-prompting.md', import.meta.url), 'utf8'))
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-sglang-omni.mjs'))
    await entry?.fiber?.dispose()
    expect(fixture.ctx.dvModels.list()).toEqual([])
    expect(await fixture.ctx.skills.get('fish-audio-drama-3-prompting')).toBeUndefined()
    expect(fixture.ctx.tools.get('dv_audio_generate')).toBeUndefined()
  })

  it('refuses a config that names a model it does not serve', async () => {
    const { fake, fixture } = await boot()
    expect(() => { SglangOmni.apply(fixture.ctx, { models: { kokoro: { baseUrl: fake.url } } }) })
      .toThrow('dv-sglang-omni serves no model "kokoro"; it serves: fish-audio-drama-3.')
    expect(fixture.ctx.dvModels.list()).toHaveLength(1)
  })

  it('reads the facts and gives the agent the speakers and the extra parameters after checking the served model', async () => {
    const { fixture } = await boot()
    expect(await fixture.entry().facts()).toEqual({ modelId: 'fishaudio/drama-3' })
    expect(value(await fixture.call('dv_models_get', KEY))).toEqual({
      ...KEY, hosting: 'self-hosted', description: fixture.entry().description,
      schema: { speakers: [0], extra: { speed: { type: 'number', description: 'Speaking rate; 1 is normal.' } } },
    })
  })

  it('rejects facts and schema for a server that serves another model, answers with an error, or cannot be reached', async () => {
    const { fake, fixture } = await boot()
    fake.models = json(200, '{"object":"list","data":[{"id":"Qwen/Qwen-Image-2.1-Turbo","object":"model"}]}')
    const misrouted = `The server at ${fake.url} serves Qwen/Qwen-Image-2.1-Turbo, not fishaudio/drama-3; the dv-sglang-omni config `
      + 'points this model at the wrong server.'
    await expect(fixture.entry().facts()).rejects.toThrow(misrouted)
    await expect(fixture.entry().schema()).rejects.toThrow(misrouted)
    expect(failure(await fixture.call('dv_models_get', KEY))).toBe(misrouted)
    const before = fixture.history()
    expect(failure(await fixture.call('dv_audio_generate', { ...KEY, reason: 'x', prompt: 'Hello.' })))
      .toBe(`${UNAVAILABLE}${misrouted} ${UNAVAILABLE_END}`)
    expect(fixture.history()).toBe(before)
    fake.models = { status: 503, headers: { 'content-type': 'text/plain' }, body: 'busy' }
    await expect(fixture.entry().facts()).rejects.toThrow(`The server at ${fake.url} answered GET /v1/models with HTTP 503: busy`)
    const down = await start('http://127.0.0.1:1')
    cleanups.push(() => down.dispose())
    await expect(down.entry().facts()).rejects.toThrow('The server at http://127.0.0.1:1 cannot be reached.')
    await expect(down.entry().schema()).rejects.toThrow('The server at http://127.0.0.1:1 cannot be reached.')
  })

  it('refuses refused speaker tags, a prompt of tags only, and unknown or invalid extra values before any record', async () => {
    const { fake, fixture } = await boot()
    const validate = (prompt: string, extra: Record<string, unknown> = {}) =>
      fixture.entry().validateGenerationRequest(speech(prompt, extra))
    expect(await validate('<|speaker:0|> Welcome. [laughs] Rest here tonight.', { speed: 1.2 })).toEqual([])
    expect(await validate('Text without a tag is speaker 0.')).toEqual([])
    expect(await validate('<|speaker:01|> One. <|speaker:2|> Two. <|speaker:01|> Three.')).toEqual([
      'This server speaks only <|speaker:0|>, and the prompt has <|speaker:01|>, <|speaker:2|>. Write one clip per character, each with '
        + '<|speaker:0|> or no speaker tag.',
    ])
    expect(await validate('Hello.', { speed: 'fast' })).toEqual(['extra."speed" must be a number.'])
    expect(await validate('Hello.', { voice: 'alloy', top_k: 30 })).toEqual(['This model takes no extra parameter voice, top_k; it takes speed.'])
    const before = fixture.history()
    const refusal = async (prompt: string, extra: Record<string, unknown> = {}) =>
      failure(await fixture.call('dv_audio_generate', { ...KEY, reason: 'line', prompt, extra }))
    const speakerOnly = 'This server speaks only <|speaker:0|>, and the prompt has <|speaker:1|>. Write one clip per character, each '
      + 'with <|speaker:0|> or no speaker tag.'
    const tagsOnly = 'The prompt has no text to speak besides its speaker tags; write the words to speak after the tag.'
    expect(await refusal('<|speaker:1|> Who goes there?')).toBe(`${CANNOT}${speakerOnly} ${REFUSAL_END}`)
    expect(await refusal('<|speaker:0|>')).toBe(`${CANNOT}${tagsOnly} ${REFUSAL_END}`)
    expect(await refusal('<|speaker:1|>')).toBe(`${CANNOT}${speakerOnly} ${tagsOnly} ${REFUSAL_END}`)
    expect(await refusal('Hello there.', { voice: 'alloy' }))
      .toBe(`${CANNOT}This model takes no extra parameter voice; it takes speed. ${REFUSAL_END}`)
    expect(await refusal('Hello there.', { speed: 'fast' })).toBe(`${CANNOT}extra."speed" must be a number. ${REFUSAL_END}`)
    expect(fixture.history()).toBe(before)
    expect(fake.requests).toEqual([])
  })

  it('speaks a clip through POST /v1/audio/speech, with the duration from the WAV header', async () => {
    const { fake, fixture } = await boot()
    const prompt = '<|speaker:0|> Welcome to DreamVerse, traveler. [laughs] Rest here tonight.'
    const take = value(await fixture.call('dv_audio_generate', { ...KEY, reason: 'greeting', prompt, extra: { speed: 1.1 } }))
    expect(fake.requests).toEqual([{ speed: 1.1, input: prompt, response_format: 'wav' }])
    const record = fixture.ctx.dvProject.getRecord(fixture.project, brandString<RecordId>(take.record))
    expect(record).toMatchObject({ status: 'done', report: { model_id: 'fishaudio/drama-3', duration_sec: 1.5 } })
    const asset = record.outputs[0] as AssetId
    expect(fixture.ctx.dvAssetPool.get(asset)).toMatchObject({ mime: 'audio/wav', duration_sec: 1.5 })
    expect(fixture.ctx.dvAssetPool.read(asset).equals(wav(132_300))).toBe(true)
    expect(take.summary).toBe('audio "<|speaker:0|> Welcome to DreamVerse, traveler. [laughs] Rest…" (1.5s)')
  })

  it('reads the duration past other chunks, and refuses a body that is not a WAV file with a duration or holds no samples', async () => {
    const { fake, fixture } = await boot()
    const render = () => fixture.entry().render(speech('Hello.'))
    fake.speech = { status: 200, headers: speechHeaders('stop'), body: wav(44_100, [chunk('LIST', Buffer.from('INFOISFTx'))]) }
    expect(await render()).toMatchObject({ mime: 'audio/wav', durationSec: 0.5 })
    const notWav = `The server at ${fake.url} answered POST /v1/audio/speech with a body that is not a WAV file.`
    for (const body of [
      Buffer.from('{"ok":true}'),
      Buffer.from('RIFF\0\0\0\0AVI ', 'latin1'),
      wav(0).subarray(0, 36),
      wav(0).subarray(0, 20),
      Buffer.concat([wav(0).subarray(0, 40), Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.alloc(88_200)]),
      Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE', 'latin1'), chunk('data', Buffer.alloc(4)), wav(0).subarray(12, 36)]),
      Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE', 'latin1'), chunk('fmt ', Buffer.alloc(8)), chunk('data', Buffer.alloc(88_200))]),
      Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE', 'latin1'), chunk('fmt ', Buffer.alloc(8))]),
    ]) {
      fake.speech = { status: 200, headers: speechHeaders('stop'), body }
      await expect(render()).rejects.toThrow(notWav)
    }
    fake.speech = { status: 200, headers: speechHeaders('stop'), body: wav(0) }
    await expect(render()).rejects.toThrow(`The server at ${fake.url} answered POST /v1/audio/speech with an empty WAV clip.`)
  })

  it('fails a clip that the server cut at its length limit, and names the server\'s error text', async () => {
    const { fake, fixture } = await boot()
    fake.speech = { status: 200, headers: speechHeaders('length'), body: wav(65_536) }
    expect(failure(await fixture.call('dv_audio_generate', { ...KEY, reason: 'long', prompt: 'A very long story.' })))
      .toBe('The server stopped the clip at its length limit before the text ended; split the text into shorter clips.')
    const [cut] = fixture.ctx.dvProject.listHistory({ project: fixture.project, operation: 'audio.generate' })
    expect(cut?.record).toMatchObject({ status: 'failed', outputs: [] })
    const render = () => fixture.entry().render(speech('Hello.'))
    const { 'x-finish-reason': _stop, ...noReason } = speechHeaders('stop')
    for (const [headers, reason] of [[noReason, 'null'], [{ ...noReason, 'x-finish-reason': 'abort' }, '"abort"']] as const) {
      fake.speech = { status: 200, headers, body: wav(65_536) }
      await expect(render()).rejects.toThrow(`The server at ${fake.url} answered POST /v1/audio/speech with x-finish-reason ${reason}, `
        + 'not "stop", so the clip may not hold the whole text.')
    }
    const answered = `The server at ${fake.url} answered POST /v1/audio/speech with HTTP 400: `
    fake.speech = json(400, '{"error":{"message":"Drama 3 request: unknown voice \'alloy\'; use default or an uploaded voice",'
      + '"type":"BadRequestError","param":null,"code":400}}')
    await expect(render()).rejects.toThrow(`${answered}Drama 3 request: unknown voice 'alloy'; use default or an uploaded voice`)
    fake.speech = json(400, '{"detail":"input: Field required"}')
    await expect(render()).rejects.toThrow(`${answered}input: Field required`)
    fake.speech = json(400, '{"detail":[{"loc":["body","input"]}]}')
    await expect(render()).rejects.toThrow(`${answered}{"detail":[{"loc":["body","input"]}]}`)
    for (const body of ['Internal Server Error', 'null']) {
      fake.speech = json(500, body)
      await expect(render()).rejects.toThrow(`The server at ${fake.url} answered POST /v1/audio/speech with HTTP 500: ${body}`)
    }
  })

  it('stops a render when its signal aborts, and rejects a render on an unreachable server', async () => {
    const { fake, fixture } = await boot()
    fake.speech = 'hang'
    const controller = new AbortController()
    const rendering = fixture.entry().render(speech('Hello.'), controller.signal)
    while (fake.requests.length === 0) await new Promise(resolve => setImmediate(resolve))
    controller.abort(new Error('stopped by the user'))
    await expect(rendering).rejects.toThrow('stopped by the user')
    const down = await start('http://127.0.0.1:1')
    cleanups.push(() => down.dispose())
    await expect(down.entry().render(speech('Hello.'), new AbortController().signal))
      .rejects.toThrow('The server at http://127.0.0.1:1 cannot be reached.')
  })
})
