/**
 * The Audio edit component of DreamVerse as the `dvAudioEdit` Cordis service: it cuts and retimes audio assets with
 * ffmpeg through `dvFfmpeg`, so the agent can fit generated speech to the clips of a timeline. It owns two operations;
 * each writes new WAV assets and leaves its input unchanged:
 * - `audioedit.split`: cut one audio asset into pieces, at given times or at its longest pauses;
 * - `audioedit.speed`: play one audio asset faster or slower without changing its pitch.
 *
 * `dvProject` turns each operation into its agent tool (`dv_audioedit_split`, `dv_audioedit_speed`). The component has
 * no reducer: its outputs are assets, which the asset pool lists.
 *
 * @module @dv/audio-edit
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@dv/asset-pool'
import type {} from '@dv/ffmpeg'
import { ProjectError, type AssetId, type OperationContext, type OperationResult, type OperationSpec, type RunRequest } from '@dv/project'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Audio edit component: split and retime audio assets. */
    dvAudioEdit: DvAudioEdit
  }
}

/** `dvAudioEdit` plugin configuration. */
export interface Config {
  /** The level in dB below which `audioedit.split` hears a pause. */
  pauseDb: number
  /** The shortest pause, in seconds, that `audioedit.split` can cut at. */
  minPauseSec: number
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  pauseDb: z.number().default(-35),
  minPauseSec: z.number().default(0.3),
})

/** The tempo range of ffmpeg's `atempo` filter. */
const MIN_SPEED = 0.5
const MAX_SPEED = 100

/** One piece that `audioedit.split` wrote, in seconds of its input. */
interface Piece {
  start_sec: number
  end_sec: number
  duration_sec: number
}

/**
 * A time in seconds rounded to milliseconds, for reports and messages.
 * @param sec - the time.
 * @returns the rounded time.
 */
function ms(sec: number): number {
  return Math.round(sec * 1000) / 1000
}

/**
 * The single resolved audio asset of a call.
 * @param context - the running call.
 * @returns the asset.
 * @throws Error when the call has no input "audio".
 */
function inputAudio(context: Pick<OperationContext, 'inputs'>): AssetId {
  const asset = context.inputs.find(input => input.role === 'audio')?.resolved_asset
  /* v8 ignore next -- the runner refuses a call without the required input "audio" before execute. */
  if (asset === undefined || asset === null) throw new Error('Input "audio" is required.')
  return asset
}

/**
 * The pauses that ffmpeg's `silencedetect` printed, as start and end times in seconds to the microsecond. A pause that runs
 * to the end of the audio ends at the audio's decoded length, which `silencedetect` and ffprobe can round 1 µs apart.
 * @param stderr - the filter's log.
 * @returns the pauses in time order.
 */
function pausesOf(stderr: string): Array<[number, number]> {
  return [...stderr.matchAll(/silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map(match => [Number(match[1]), Number(match[2])])
}

/**
 * The cut times at the middle of the longest pauses between sounds. A pause that starts at 0, or ends less than 1 ms
 * before `durationSec` or later, is not between sounds and is left out.
 * @param pauses - the pauses of the audio.
 * @param durationSec - the audio's decoded length.
 * @param count - how many cuts to make.
 * @returns the cut times in time order.
 * @throws Error when the audio has fewer pauses between sounds than `count`.
 */
function cutsAtPauses(pauses: Array<[number, number]>, durationSec: number, count: number): number[] {
  const inside = pauses.filter(([start, end]) => start > 0 && end < durationSec - 0.001)
  if (inside.length < count) {
    throw new Error(`The audio has ${String(inside.length)} pauses between sounds, too few for ${String(count + 1)} pieces; `
      + 'pass "at" with the cut times instead.')
  }
  return inside
    .sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))
    .slice(0, count)
    .map(([start, end]) => ms((start + end) / 2))
    .sort((a, b) => a - b)
}

/**
 * Why `audioedit.split` refuses a number of pieces.
 * @param pieces - the number of pieces.
 * @returns the refusal, or null when the number is valid.
 */
function piecesProblem(pieces: number): string | null {
  return pieces >= 2 ? null : `"pieces" is ${String(pieces)}; pass 2 or more.`
}

/**
 * Why `audioedit.split` refuses cut times, which it rounds to milliseconds.
 * @param at - the cut times in seconds.
 * @returns the refusal, or null when the times are valid.
 */
function atProblem(at: number[]): string | null {
  const times = at.map(ms)
  return times.length === 0 || times.some((time, index) => time <= (times[index - 1] ?? 0))
    ? `"at" is ${JSON.stringify(at)}; pass cut times after 0, in increasing order, at least 1 ms apart.`
    : null
}

/**
 * Why `audioedit.speed` refuses a speed factor.
 * @param speed - the factor.
 * @returns the refusal, or null when the factor is in range.
 */
function speedProblem(speed: number): string | null {
  return speed >= MIN_SPEED && speed <= MAX_SPEED ? null : `"speed" is ${String(speed)}; pass ${String(MIN_SPEED)} to ${String(MAX_SPEED)}.`
}

/** The Audio edit service: the two operations and the methods they run. */
export default class DvAudioEdit extends Service {
  static inject = ['dvProject', 'dvAssetPool', 'dvFfmpeg']
  static Config = Config

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'dvAudioEdit')
    ctx.effect(() => ctx.dvProject.registerComponent('audioedit'), 'dvAudioEdit component')
    for (const spec of [this.splitOperation(), this.speedOperation()]) {
      ctx.effect(() => ctx.dvProject.registerOperation(spec), `dvAudioEdit ${spec.name}`)
    }
  }

  /**
   * Cut an audio asset into WAV pieces that together cover the audio up to its decoded length rounded to milliseconds.
   * It measures, searches, and cuts the decoded audio, so a pause at the end ends at the last sample. The reported times
   * are rounded to milliseconds, and each written piece's length is its reported length to within 1 ms.
   * @param audio - an audio asset.
   * @param cut - the cut times in seconds, in time order, or the number of pieces to cut at the longest pauses.
   * @param dir - the directory the pieces are written into.
   * @returns each piece's path and its times in the input, in time order.
   * @throws Error for fewer than 2 pieces, for cut times that are not after 0, increasing and at least 1 ms apart, for
   *   an asset that is not audio, when ffprobe reports no duration for the decoded audio, for a cut at or after the
   *   end, or when the audio has too few pauses between sounds; FfmpegError when ffmpeg fails.
   */
  async split(audio: AssetId, cut: { at: number[] } | { pieces: number }, dir: string): Promise<Array<{ file: string; piece: Piece }>> {
    const problem = 'at' in cut ? atProblem(cut.at) : piecesProblem(cut.pieces)
    if (problem !== null) throw new Error(problem)
    const { path, durationSec } = await this.decode(this.audioPath(audio), dir)
    const times = 'at' in cut ? cut.at.map(ms) : cutsAtPauses(await this.pauses(path, dir), durationSec, cut.pieces - 1)
    const endSec = ms(durationSec)
    const late = times.find(time => time >= endSec)
    if (late !== undefined) throw new Error(`The cut at ${String(late)}s is not before the audio's end at ${String(endSec)}s.`)
    let start = 0
    const pieces = [...times, endSec].map((end): Piece => {
      const piece = { start_sec: start, end_sec: end, duration_sec: ms(end - start) }
      start = end
      return piece
    })
    const names = pieces.map((_piece, index) => `piece-${String(index + 1)}.wav`)
    const { outputs } = await this.ctx.dvFfmpeg.run({
      argv: [
        'ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}',
        ...pieces.flatMap((piece, index) => [
          '-map', '0:a:0', '-ss', String(piece.start_sec), '-to', String(piece.end_sec), '-c:a', 'pcm_s16le', `{{out:piece-${String(index + 1)}.wav}}`,
        ]),
      ],
      inputs: [path], outputs: names, dir,
    })
    return outputs.map((file, index) => ({ file, piece: pieces[index] as Piece }))
  }

  /**
   * Play an audio asset faster or slower without changing its pitch, into a WAV file.
   * @param audio - an audio asset.
   * @param change - the speed factor (2 plays twice as fast), or the length in seconds the result should have, which
   *   the factor fits from the decoded audio's length.
   * @param dir - the directory the result is written into.
   * @returns the result's path, the speed factor used, and the result's length.
   * @throws Error for a given or fitted factor outside 0.5 to 100, for an asset that is not audio, or when ffprobe
   *   reports no duration for the decoded audio or the result; FfmpegError when ffmpeg fails.
   */
  async speed(
    audio: AssetId, change: { speed: number } | { durationSec: number }, dir: string,
  ): Promise<{ file: string; speed: number; durationSec: number }> {
    let path = this.audioPath(audio)
    let speed: number
    if ('speed' in change) {
      const problem = speedProblem(change.speed)
      if (problem !== null) throw new Error(problem)
      speed = change.speed
    } else {
      const decoded = await this.decode(path, dir)
      path = decoded.path
      const durationSec = decoded.durationSec
      speed = durationSec / change.durationSec
      if (speed < MIN_SPEED || speed > MAX_SPEED) {
        throw new Error(`Fitting ${String(ms(durationSec))}s into ${String(change.durationSec)}s needs speed ${String(ms(speed))}, `
          + `outside ${String(MIN_SPEED)} to ${String(MAX_SPEED)}.`)
      }
    }
    const file = (await this.ctx.dvFfmpeg.run({
      argv: [
        'ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}', '-map', '0:a:0', '-af', `atempo=${String(speed)}`, '-c:a', 'pcm_s16le', '{{out:speed.wav}}',
      ],
      inputs: [path], outputs: ['speed.wav'], dir,
    })).outputs[0] as string
    return { file, speed: ms(speed), durationSec: ms(await this.durationOf(file)) }
  }

  /**
   * The length of an audio file.
   * @param path - the file.
   * @returns its length in seconds.
   * @throws Error when ffprobe reports no duration, as for a WAV file with no samples.
   */
  private async durationOf(path: string): Promise<number> {
    const durationSec = (await this.ctx.dvFfmpeg.probe(path)).durationSec
    if (durationSec === null) throw new Error('ffprobe reports no duration for the audio.')
    return durationSec
  }

  /**
   * Decode the first audio stream of a file into a 16-bit PCM WAV file, whose length is the decoded audio's length; a
   * container such as MP3 can report a longer duration than it decodes to.
   * @param path - the file.
   * @param dir - the directory the WAV file is written into.
   * @returns the WAV file and its length in seconds.
   * @throws Error when ffprobe reports no duration for the WAV file; FfmpegError when ffmpeg fails.
   */
  private async decode(path: string, dir: string): Promise<{ path: string; durationSec: number }> {
    const decoded = (await this.ctx.dvFfmpeg.run({
      argv: ['ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}', '-map', '0:a:0', '-c:a', 'pcm_s16le', '{{out:decoded.wav}}'],
      inputs: [path], outputs: ['decoded.wav'], dir,
    })).outputs[0] as string
    return { path: decoded, durationSec: await this.durationOf(decoded) }
  }

  /**
   * The file of an audio asset.
   * @param audio - the asset.
   * @returns its path.
   * @throws Error for an asset that is not audio.
   */
  private audioPath(audio: AssetId): string {
    const mime = this.ctx.dvAssetPool.get(audio).mime
    if (!mime.startsWith('audio/')) throw new Error(`The input is ${mime}, not audio.`)
    return this.ctx.dvAssetPool.path(audio)
  }

  /**
   * The pauses of an audio file, as ffmpeg's `silencedetect` hears them with the configured level and length.
   * @param path - the file.
   * @param dir - the command's working directory.
   * @returns the pauses in time order.
   */
  private async pauses(path: string, dir: string): Promise<Array<[number, number]>> {
    const result = await this.ctx.dvFfmpeg.run({
      argv: [
        'ffmpeg', '-hide_banner', '-nostats', '-i', '{{in:0}}', '-map', '0:a:0',
        '-af', `silencedetect=noise=${String(this.config.pauseDb)}dB:d=${String(this.config.minPauseSec)}`, '-f', 'null', '-',
      ],
      inputs: [path], outputs: [], dir,
    })
    return pausesOf(result.stderr)
  }

  /** The `audioedit.split` operation. */
  private splitOperation(): OperationSpec {
    return {
      name: 'audioedit.split',
      component: 'audioedit',
      version: '1',
      label: { zh: '切分音频', en: 'Split audio' },
      description: 'Cut an audio asset into pieces that together cover it, such as one narration into one line per clip. '
        + 'Pass "pieces" to cut at its longest pauses, or "at" with the cut times. Each piece is a new WAV asset, in time order.',
      inputs: { audio: { type: 'audio', required: true, description: 'The audio.' } },
      params: {
        pieces: { type: 'integer', description: 'How many pieces to cut, at the longest pauses; 2 or more.' },
        at: { type: 'array', items: { type: 'number' }, description: 'The cut times in seconds from the audio\'s start, in increasing order.' },
      },
      outputs: [{ role: 'piece', type: 'audio' }],
      // Cuts at pauses also depend on Config pauseDb and minPauseSec, which the runner's reuse check does not compare.
      deterministic: false,
      resource: 'cpu',
      summarize: record => `split into ${String(record.outputs.length)} pieces`,
      precondition: (request: RunRequest): Promise<void> => {
        const { pieces, at } = request.params
        if ((pieces === undefined) === (at === undefined)) throw new ProjectError('invalid_params', 'Pass either "pieces" or "at".')
        const problem = Array.isArray(at) ? atProblem(at.map(Number)) : piecesProblem(Number(pieces))
        if (problem !== null) throw new ProjectError('invalid_params', problem)
        return Promise.resolve()
      },
      execute: async (context): Promise<OperationResult> => {
        const { pieces, at } = context.params
        const cut = Array.isArray(at) ? { at: at.map(Number) } : { pieces: Number(pieces) }
        const split = await this.split(inputAudio(context), cut, context.scratchDir)
        return {
          outputs: split.map(({ file, piece }, index) => context.importAsset({ path: file }, {
            mime: 'audio/wav', name: `piece-${String(index + 1)}.wav`, durationSec: piece.duration_sec,
          })),
          report: { pieces: split.map(({ piece }) => piece) },
        }
      },
    }
  }

  /** The `audioedit.speed` operation. */
  private speedOperation(): OperationSpec {
    return {
      name: 'audioedit.speed',
      component: 'audioedit',
      version: '1',
      label: { zh: '调整语速', en: 'Change speed' },
      description: 'Play an audio asset faster or slower without changing its pitch, such as a narration line that runs '
        + 'longer than its clip. Pass "speed" (1.2 plays 20% faster) or "duration_sec" (the length to fit). The result is a new WAV asset.',
      inputs: { audio: { type: 'audio', required: true, description: 'The audio.' } },
      params: {
        speed: { type: 'number', description: `The speed factor, from ${String(MIN_SPEED)} to ${String(MAX_SPEED)}.` },
        duration_sec: { type: 'number', description: 'The length in seconds that the result should have.' },
      },
      outputs: [{ role: 'audio', type: 'audio' }],
      deterministic: true,
      resource: 'cpu',
      summarize: record => (record.params['speed'] === undefined
        ? `fitted to ${String(record.params['duration_sec'])} s`
        : `speed ×${String(Number(record.params['speed']))}`),
      precondition: (request: RunRequest): Promise<void> => {
        const { speed, duration_sec: durationSec } = request.params
        if ((speed === undefined) === (durationSec === undefined)) throw new ProjectError('invalid_params', 'Pass either "speed" or "duration_sec".')
        const problem = speed === undefined ? null : speedProblem(Number(speed))
        if (problem !== null) throw new ProjectError('invalid_params', problem)
        if (durationSec !== undefined && Number(durationSec) <= 0) throw new ProjectError('invalid_params', `"duration_sec" is ${String(Number(durationSec))}; pass more than 0.`)
        return Promise.resolve()
      },
      execute: async (context): Promise<OperationResult> => {
        const { speed, duration_sec: durationSec } = context.params
        const change = speed === undefined ? { durationSec: Number(durationSec) } : { speed: Number(speed) }
        const result = await this.speed(inputAudio(context), change, context.scratchDir)
        return {
          outputs: [context.importAsset({ path: result.file }, { mime: 'audio/wav', name: 'speed.wav', durationSec: result.durationSec })],
          report: { speed: result.speed, duration_sec: result.durationSec },
        }
      },
    }
  }
}
