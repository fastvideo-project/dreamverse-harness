/**
 * The `vllm-omni` provider plugin in a REAL composition against fake vLLM-Omni servers that answer with the bodies and
 * headers of running servers.
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as VllmOmni from '../src/index.ts'
import {
  IMAGE_KEY, IMAGE_MODELS, PNG, REFUSAL_END, SPEECH_KEY, SPEECH_MODELS, UNAVAILABLE_END, WAV, closedUrl, errorBody, failure,
  generated, json, speechHeaders, start, startFake, value, type FakeServer, type Fixture,
} from './fixture.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Boot the composition with one fake server per served model. */
async function boot(): Promise<{ image: FakeServer; speech: FakeServer; fixture: Fixture }> {
  const image = await startFake(IMAGE_MODELS)
  cleanups.push(() => image.close())
  const speech = await startFake(SPEECH_MODELS)
  cleanups.push(() => speech.close())
  const fixture = await start({ 'qwen-image-2.1-turbo': image.url, 'qwen3-tts-customvoice': speech.url })
  cleanups.push(() => fixture.dispose())
  return { image, speech, fixture }
}

const IMAGE_CANNOT = 'Model image/t2i/vllm-omni/qwen-image-2.1-turbo cannot generate this: '
const SPEECH_CANNOT = 'Model audio/t2a/vllm-omni/qwen3-tts-customvoice cannot generate this: '

describe('dv-vllm-omni', () => {
  it('registers one entry per configured model and removes them on disposal', async () => {
    const { fixture } = await boot()
    expect(value(await fixture.tool('dv_models_list', { provider: 'vllm-omni' }))).toEqual([
      { ...IMAGE_KEY, hosting: 'self-hosted', description: fixture.image().description },
      { ...SPEECH_KEY, hosting: 'self-hosted', description: fixture.speech().description },
    ])
    expect(fixture.image().description).toBe('Qwen-Image 2.1 Turbo: a fast text-to-image model that renders legible text inside '
      + 'the image, such as posters, labels and interface layouts. The same seed, size and prompt give the same image.')
    expect(fixture.speech().description).toBe('Qwen3-TTS 1.7B CustomVoice: speech from text in ten languages with a choice of '
      + 'preset voices, and a style instruction such as "speak slowly and sadly". One voice per clip; it makes no sound effects or music.')
    await fixture.disposePlugin()
    expect(fixture.ctx.dvModels.list({ provider: 'vllm-omni' })).toEqual([])
    expect(fixture.ctx.tools.get('dv_image_generate')).toBeUndefined()
    expect(fixture.ctx.tools.get('dv_audio_generate')).toBeUndefined()
  })

  it('refuses a config that names a model it does not serve', async () => {
    const { image, fixture } = await boot()
    expect(() => { VllmOmni.apply(fixture.ctx, { models: { 'wan2.2-t2v': { baseUrl: image.url } } }) })
      .toThrow('dv-vllm-omni serves no model "wan2.2-t2v"; it serves: qwen-image-2.1-turbo, qwen3-tts-customvoice.')
    expect(() => { VllmOmni.apply(fixture.ctx, { models: { constructor: { baseUrl: image.url } } }) })
      .toThrow('dv-vllm-omni serves no model "constructor"; it serves: qwen-image-2.1-turbo, qwen3-tts-customvoice.')
    expect(fixture.ctx.dvModels.list({ provider: 'vllm-omni' })).toHaveLength(2)
  })

  it('reads the facts and gives the agent each schema after checking the served model', async () => {
    const { image, speech, fixture } = await boot()
    expect(await fixture.image().facts()).toEqual({ modelId: 'Qwen/Qwen-Image-2.1-Turbo' })
    expect(await fixture.speech().facts()).toEqual({ modelId: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice' })
    expect(value(await fixture.tool('dv_models_get', IMAGE_KEY))).toMatchObject({ schema: {
      size: {
        default: '1024x1024', rule: 'width and height are multiples of 32, and width times height is at most 4300800',
        by_aspect_ratio: { '1:1': '2048x2048', '4:3': '2400x1792', '3:4': '1792x2400', '3:2': '2528x1696', '2:3': '1696x2528', '16:9': '2752x1536', '9:16': '1536x2752' },
      },
      extra: {},
    } })
    expect(await fixture.speech().schema()).toMatchObject({
      voices: ['aiden', 'default', 'dylan', 'eric', 'ono_anna', 'ryan', 'serena', 'sohee', 'uncle_fu', 'vivian'],
      extra: { voice: { type: 'string' }, language: { type: 'string' }, instructions: { type: 'string' }, speed: { type: 'number' } },
    })
    expect(image.routes).toEqual(['GET /v1/models', 'GET /v1/models'])
    expect(speech.routes).toEqual(['GET /v1/models', 'GET /v1/models', 'GET /v1/audio/voices'])
  })

  it('rejects facts and schema for a server of another model, an error answer, or no server', async () => {
    const { image, speech, fixture } = await boot()
    image.answers['GET /v1/models'] = json(200, SPEECH_MODELS)
    const misrouted = `The server at ${image.url} serves Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice, not Qwen/Qwen-Image-2.1-Turbo; `
      + 'the dv-vllm-omni config points this model at the wrong server.'
    await expect(fixture.image().schema()).rejects.toThrow(misrouted)
    expect(failure(await fixture.tool('dv_image_generate', { ...IMAGE_KEY, reason: 'x', prompt: 'a door' })))
      .toBe(`Model image/t2i/vllm-omni/qwen-image-2.1-turbo is unavailable: ${misrouted} ${UNAVAILABLE_END}`)
    speech.answers['GET /v1/models'] = json(500, errorBody('engine dead', 500))
    await expect(fixture.speech().facts()).rejects.toThrow(`The server at ${speech.url} answered GET /v1/models with HTTP 500: engine dead`)
    speech.answers['GET /v1/models'] = { status: 503, headers: { 'content-type': 'text/plain' }, body: 'starting' }
    await expect(fixture.speech().schema()).rejects.toThrow(`The server at ${speech.url} answered GET /v1/models with HTTP 503: starting`)
    const closed = await closedUrl()
    const offline = await start({ 'qwen3-tts-customvoice': closed })
    cleanups.push(() => offline.dispose())
    await expect(offline.speech().facts()).rejects.toThrow(`The server at ${closed} cannot be reached.`)
    expect(fixture.records()).toEqual([])
  })

  it('refuses an image size off the grid or above the pixel limit, and any extra, before any server call', async () => {
    const { image, fixture } = await boot()
    const problems = (size: { width: number; height: number } | null, extra: Record<string, unknown> = {}) =>
      fixture.image().validateGenerationRequest({ prompt: 'a door', size, seed: 1, extra })
    expect(await problems(null)).toEqual([])
    expect(await problems({ width: 2752, height: 1536 })).toEqual([])
    expect(await problems({ width: 1000, height: 1000 })).toEqual(['Width and height must be multiples of 32; use 992x992 or 1024x1024 instead of 1000x1000.'])
    expect(await problems({ width: 2050, height: 2050 })).toEqual(['Width and height must be multiples of 32; use 2048x2048 instead of 2050x2050.'])
    expect(await problems({ width: 2100, height: 2100 })).toEqual(['2100x2100 has 4410000 pixels, above the limit of 4300800; the largest size of aspect ratio 1:1 is 2048x2048.'])
    expect(await problems({ width: 20, height: 215040 })).toEqual(['Width and height must be multiples of 32; use 1536x2752 instead of 20x215040.'])
    expect(await problems({ width: 10, height: 1024 })).toEqual(['Width and height must be multiples of 32; use 32x1024 instead of 10x1024.'])
    expect(await problems({ width: 3200, height: 1792 })).toEqual(['3200x1792 has 5734400 pixels, above the limit of 4300800; the largest size of aspect ratio 16:9 is 2752x1536.'])
    expect(await problems({ width: 1024, height: 1024 }, { steps: 8 })).toEqual(['This model takes no extra parameter; omit extra.'])
    expect(failure(await fixture.tool('dv_image_generate', { ...IMAGE_KEY, reason: 'x', prompt: 'a door', size: '1000x1000' })))
      .toBe(`${IMAGE_CANNOT}Width and height must be multiples of 32; use 992x992 or 1024x1024 instead of 1000x1000. ${REFUSAL_END}`)
    expect(image.bodies).toEqual([])
    expect(fixture.records()).toEqual([])
  })

  it('renders an image through dv_image_generate: the request it sends and the PNG it stores', async () => {
    const { image, fixture } = await boot()
    image.answers['POST /v1/images/generations'] = json(200, generated('1024x768'))
    const result = value(await fixture.tool('dv_image_generate', { ...IMAGE_KEY, reason: 'lantern', prompt: 'a red lantern', size: '1024x768', seed: 7 }))
    expect(image.bodies).toEqual([{
      model: 'Qwen/Qwen-Image-2.1-Turbo', prompt: 'a red lantern', size: '1024x768', seed: 7, n: 1, response_format: 'b64_json', output_format: 'png',
    }])
    const asset = result.outputs[0]?.asset_id as never
    expect(Buffer.from(fixture.ctx.dvAssetPool.read(asset))).toEqual(PNG)
    expect(fixture.ctx.dvAssetPool.get(asset)).toMatchObject({ mime: 'image/png', width: 1024, height: 768 })
  })

  it('fails an image render with the server error, an answer without a PNG, or of another size', async () => {
    const { image, fixture } = await boot()
    const render = () => fixture.image().render({ prompt: 'a door', size: null, seed: 1, extra: {} })
    image.answers['POST /v1/images/generations'] = json(400, errorBody("Model mismatch: request specifies 'x'", 400))
    await expect(render()).rejects.toThrow(`The server at ${image.url} answered POST /v1/images/generations with HTTP 400: Model mismatch: request specifies 'x'`)
    image.answers['POST /v1/images/generations'] = json(200, generated('1024x1024', Buffer.from([0xff, 0xd8, 0xff, 0xe0])))
    await expect(render()).rejects.toThrow(`The server at ${image.url} answered POST /v1/images/generations without a PNG image.`)
    image.answers['POST /v1/images/generations'] = json(200, '{"created":1795069581,"data":[],"output_format":"png"}')
    await expect(render()).rejects.toThrow(`The server at ${image.url} answered POST /v1/images/generations without a PNG image.`)
    image.answers['POST /v1/images/generations'] = json(200, generated('992x992'))
    await expect(render()).rejects.toThrow(`The server at ${image.url} answered POST /v1/images/generations with an image of size 992x992, not 1024x1024.`)
    image.answers['POST /v1/images/generations'] = 'hang'
    const reason = new Error('stopped by the user')
    const controller = new AbortController()
    const pending = fixture.image().render({ prompt: 'a door', size: null, seed: 1, extra: {} }, controller.signal)
    setTimeout(() => { controller.abort(reason) }, 20)
    await expect(pending).rejects.toBe(reason)
  })

  it('refuses speech with unknown or invalid extra values, or with a voice the server lacks', async () => {
    const { speech, fixture } = await boot()
    const problems = (prompt: string, extra: Record<string, unknown> = {}) => fixture.speech().validateGenerationRequest({ prompt, extra })
    expect(await problems('Hello.', { voice: 'vivian', language: 'English', instructions: 'calm', speed: 1.2 })).toEqual([])
    expect(await problems('Hello.', { pitch: 2 })).toEqual(['This model takes no extra parameter pitch; it takes voice, language, instructions, speed.'])
    expect(await problems('Hello.', { speed: 'fast', language: 'Klingon', instructions: 4 })).toEqual([
      'extra."language" must be one of ["Auto","Chinese","English","Japanese","Korean","German","French","Russian","Portuguese","Spanish","Italian"].',
      'extra."instructions" must be a string.',
      'extra."speed" must be a number.',
    ])
    expect(await problems('Hello.', { voice: 'Vivian' })).toEqual([])
    expect(await problems('Hello.', { speed: 10 })).toEqual(['extra."speed" must be from 0.25 to 4.'])
    expect(await problems('Hello.', { speed: 0.25 })).toEqual([])
    expect(await problems('Hello.', { instructions: 'x'.repeat(501) })).toEqual(['extra."instructions" must be at most 500 characters.'])
    expect(await problems('Hello.', { instructions: 'x'.repeat(500) })).toEqual([])
    // The server counts code points: 251 emoji are 502 UTF-16 units, and the server accepts them.
    expect(await problems('Hello.', { instructions: '\u{1F600}'.repeat(251) })).toEqual([])
    expect(await problems('Hello.', { voice: 'morgan' }))
      .toEqual(['The server has no voice "morgan"; it has aiden, default, dylan, eric, ono_anna, ryan, serena, sohee, uncle_fu, vivian.'])
    // An uploaded voice is a voice-cloning input of the Base checkpoint, which a CustomVoice server cannot speak.
    // The body of the running server after an upload named MyVoice: `voices` holds its lowercase `id`.
    speech.answers['GET /v1/audio/voices'] = json(200, JSON.stringify({
      voices: ['aiden', 'default', 'myvoice', 'vivian'],
      uploaded_voices: [{
        id: 'myvoice', name: 'MyVoice', consent: 'test-consent', created_at: 1795075131, file_size: 195884, mime_type: 'audio/wav',
        embedding_source: 'audio', embedding_dim: null,
      }],
    }))
    expect(await fixture.speech().schema()).toMatchObject({ voices: ['aiden', 'default', 'vivian'] })
    expect(await problems('Hello.', { voice: 'MyVoice' })).toEqual(['The server has no voice "MyVoice"; it has aiden, default, vivian.'])
    speech.answers['GET /v1/audio/voices'] = json(500, errorBody('voices failed', 500))
    await expect(problems('Hello.', { voice: 'vivian' })).rejects.toThrow(`The server at ${speech.url} answered GET /v1/audio/voices with HTTP 500: voices failed`)
    expect(failure(await fixture.tool('dv_audio_generate', { ...SPEECH_KEY, reason: 'x', prompt: 'Hi.', extra: { pitch: 2 } })))
      .toBe(`${SPEECH_CANNOT}This model takes no extra parameter pitch; it takes voice, language, instructions, speed. ${REFUSAL_END}`)
    expect(speech.bodies).toEqual([])
  })

  it('speaks through dv_audio_generate: the request it sends and the clip with its duration', async () => {
    const { speech, fixture } = await boot()
    const result = value(await fixture.tool('dv_audio_generate', {
      ...SPEECH_KEY, reason: 'line', prompt: 'Welcome to DreamVerse.', extra: { voice: 'vivian', language: 'English' },
    }))
    expect(speech.bodies).toEqual([{
      voice: 'vivian', language: 'English', model: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice', input: 'Welcome to DreamVerse.', response_format: 'wav',
    }])
    const asset = result.outputs[0]?.asset_id as never
    expect(Buffer.from(fixture.ctx.dvAssetPool.read(asset))).toEqual(WAV)
    expect(fixture.ctx.dvAssetPool.get(asset)).toMatchObject({ mime: 'audio/wav', duration_sec: 1.84 })
  })

  it('fails speech that the server cut, that is not WAV, without a duration, or after an abort', async () => {
    const { speech, fixture } = await boot()
    const render = (signal?: AbortSignal) => fixture.speech().render({ prompt: 'Hello.', extra: {} }, signal)
    speech.answers['POST /v1/audio/speech'] = { status: 200, headers: speechHeaders('30.000', 'true'), body: WAV }
    await expect(render()).rejects.toThrow('The server stopped the clip at its token budget before the text ended; split the text into shorter clips.')
    speech.answers['POST /v1/audio/speech'] = { status: 200, headers: speechHeaders('1.000'), body: Buffer.from('ID3') }
    await expect(render()).rejects.toThrow(`The server at ${speech.url} answered POST /v1/audio/speech with a body that is not a WAV file.`)
    speech.answers['POST /v1/audio/speech'] = { status: 200, headers: speechHeaders(null), body: WAV }
    await expect(render()).rejects.toThrow(`The server at ${speech.url} answered POST /v1/audio/speech with x-audio-duration-seconds null, not a positive number of seconds.`)
    speech.answers['POST /v1/audio/speech'] = { status: 200, headers: speechHeaders('0.000'), body: WAV }
    await expect(render()).rejects.toThrow('with x-audio-duration-seconds "0.000", not a positive number of seconds.')
    speech.answers['POST /v1/audio/speech'] = 'hang'
    const controller = new AbortController()
    const pending = render(controller.signal)
    const reason = new Error('stopped by the user')
    setTimeout(() => { controller.abort(reason) }, 20)
    await expect(pending).rejects.toBe(reason)
  })
})
