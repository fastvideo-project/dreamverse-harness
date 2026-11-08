/**
 * The Asset pool component of DreamVerse as the `dvAssetPool` Cordis service: every image, video, audio and text file
 * of a project, addressed by the SHA-256 of its bytes and never changed after it is written.
 *
 * Each project keeps its assets in its own folder, so a copy of the folder holds the whole project:
 *
 * ```
 * <folder>/.dreamverse/assets/objects/<sha256>   the bytes, written once
 * <folder>/.dreamverse/assets/index.jsonl        one `Asset` line per asset, appended on import, replayed at first read
 * ```
 *
 * Two identical files in one project become one asset; the same bytes in two projects are two files with one ID. The
 * service registers itself as Project's asset store, and five operations:
 * - `asset.import`: a file on this machine, or base64 bytes, becomes an asset; with `place`, it also goes on the canvas;
 *   an image or video gets its pixel size and duration, and an audio file its duration, from `dvFfmpeg` the first time a
 *   record imports it;
 * - `asset.grab_still`: one frame of a video becomes a PNG still, through `dvFfmpeg`;
 * - `asset.cut_segment`: the part of a video between two times becomes a re-encoded MP4 video with its sound, through
 *   `dvFfmpeg`;
 * - `asset.place` and `asset.unplace`: assets go on the canvas or come off it, and stay in the pool either way.
 *
 * `dvProject` turns each operation into its agent tool (`dv_asset_import`, `dv_asset_grab_still`,
 * `dv_asset_cut_segment`, `dv_asset_place`, `dv_asset_unplace`). The `asset` reducer keeps the canvas placements of the
 * state; the `proj` slice's `created_by` names the record that created each asset. While the DSH web server is mounted,
 * the service serves `GET /dv/assets/<AssetId>`.
 *
 * @module @dv/asset-pool
 */
import { createHash } from 'node:crypto'
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { FfmpegError } from '@dv/ffmpeg'
import type {} from '@dv/ffmpeg'
import { ProjectError, type AssetId, type OperationContext, type OperationResult, type OperationSpec, type ProjectId, type RecordId } from '@dv/project'
import { PROJECT_DIR } from '@dv/project/folder'
import { importedAssets, placeable } from './imports.ts'
import { assetReducer } from './reducer.ts'
import type { Asset, StillAt } from './types.ts'

export { importedAssets, placeable } from './imports.ts'
export type { Asset, AssetState } from './types.ts'
/** The SHA-256 hex digest of an asset's bytes; defined by `@dv/project`. */
export type { AssetId } from '@dv/project'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Asset pool component: the content-addressed asset store and its operations. */
    dvAssetPool: DvAssetPool
  }
}

/** `dvAssetPool` plugin configuration. */
export interface Config {
  /** Base of the asset URLs that the agent and chat cards show, such as a tunnel origin; empty keeps them relative. */
  publicBaseUrl: string
}

/** Loader validation. */
export const Config: z<Config> = z.object({
  publicBaseUrl: z.string().default(''),
})

const ASSETS_DIR = 'assets'
const INDEX_FILE = 'index.jsonl'
const OBJECTS_DIR = 'objects'
const ROUTE_PREFIX = '/dv/assets'
const FILE_ROUTE = /^\/dv\/assets\/([0-9a-f]{64})$/
/** The file name of a grabbed still inside the operation's scratch directory. */
const STILL_FILE = 'still.png'
/** The file name of a cut segment inside the operation's scratch directory. */
const SEGMENT_FILE = 'segment.mp4'

/** What `importAsset` takes besides the bytes: the media type, the display name, and what the importer knows. */
type ImportMeta = Parameters<OperationContext['importAsset']>[1]

/**
 * The still position a caller asked for: `first`, `last`, a number of seconds, or a numeric string; anything else
 * means the last frame.
 * @param value - the raw `at` param.
 * @returns the position.
 */
function stillAt(value: unknown): StillAt {
  if (value === 'first' || value === 'last') return value
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string') {
    const seconds = Number(value.trim())
    if (value.trim().length > 0 && Number.isFinite(seconds) && seconds >= 0) return seconds
  }
  return 'last'
}

/**
 * The ffmpeg command lines that read a video's last frame, in the order to try them: an input seek just before the
 * video stream's end, then a full decode where every frame overwrites the output so the last one survives. The seek
 * uses the video stream's duration because rendered takes carry an audio track that runs past the last video frame,
 * and a seek relative to the container duration lands after it and writes nothing.
 * @param videoDurationSec - the video stream's duration, or null when ffprobe reported none.
 * @returns the argument lists, each with `{{in:0}}` and `{{out:still.png}}` placeholders.
 */
function lastFrameAttempts(videoDurationSec: number | null): string[][] {
  const out = `{{out:${STILL_FILE}}}`
  const attempts: string[][] = []
  if (videoDurationSec !== null && Number.isFinite(videoDurationSec) && videoDurationSec > 0) {
    attempts.push(['ffmpeg', '-y', '-loglevel', 'error', '-ss', String(Math.max(0, videoDurationSec - 0.1)), '-i', '{{in:0}}', '-update', '1', out])
  }
  attempts.push(['ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}', '-an', '-update', '1', out])
  return attempts
}

/**
 * A params field as text, or the fallback when it is absent or not a string.
 * @param value - the field.
 * @param fallback - the text for anything else.
 * @returns the text.
 */
function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** The content-addressed asset store, its route, its operations, and the canvas placements. */
export default class DvAssetPool extends Service {
  static inject = ['dvProject', 'dvFfmpeg']
  static Config = Config

  /** The `.dreamverse/assets/` directory of each project folder read so far → the assets its index holds. */
  private readonly folders = new Map<string, Map<AssetId, Asset>>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'dvAssetPool')
    // Project checks input assets, imports operation outputs, and describes outputs to the agent through the pool.
    ctx.effect(() => ctx.dvProject.registerAssetStore({
      has: asset => this.has(asset),
      get: asset => this.get(asset),
      read: asset => this.read(asset),
      url: asset => this.url(asset),
      importAsset: (project, source, meta, createdBy) => this.importAsset(project, source, meta, createdBy),
    }), 'dvAssetPool asset store')
    ctx.effect(() => ctx.dvProject.registerComponent('asset'), 'dvAssetPool component')
    ctx.effect(() => ctx.dvProject.registerReducer('asset', assetReducer), 'dvAssetPool reducer')
    for (const spec of [this.importOperation(), this.grabStillOperation(), this.cutSegmentOperation(), this.placementOperation('asset.place'), this.placementOperation('asset.unplace')]) {
      ctx.effect(() => ctx.dvProject.registerOperation(spec), `dvAssetPool ${spec.name}`)
    }
    ctx.inject(['webServer'], (webCtx) => {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (request, response) => { this.serveFile(request, response) },
      }), 'dvAssetPool /dv/assets route')
    })
  }

  /**
   * Store bytes, or a file's bytes, once in a project's folder; importing identical content into the same project again
   * returns the existing ID and keeps the first asset's name and creator.
   * @param project - the project whose folder receives the bytes.
   * @param source - the bytes, or the path of a file to copy in.
   * @param meta - the media type, the display name, and the duration and pixel size when known.
   * @param createdBy - the record that created the asset; null outside any record.
   * @returns the asset ID.
   * @throws ProjectError `unknown_project`, before anything is written, for an unknown project, also a registered folder
   * without `.dreamverse/records.jsonl`.
   */
  importAsset(project: ProjectId, source: Uint8Array | { path: string }, meta: ImportMeta, createdBy: RecordId | null): AssetId {
    const dir = this.assetsDir(project)
    const bytes = source instanceof Uint8Array ? source : readFileSync(source.path)
    const id = brandString<AssetId>(createHash('sha256').update(bytes).digest('hex'))
    if (this.folder(dir).has(id)) return id
    mkdirSync(join(dir, OBJECTS_DIR), { recursive: true })
    const objectPath = join(dir, OBJECTS_DIR, id)
    // Write beside the final name and rename, so a crash never leaves a half-written object under its hash.
    const partial = `${objectPath}.partial`
    writeFileSync(partial, bytes)
    renameSync(partial, objectPath)
    const asset: Asset = {
      id,
      mime: meta.mime,
      name: meta.name,
      size_bytes: bytes.byteLength,
      created_by: createdBy,
      created_at: new Date().toISOString(),
      width: meta.width ?? null,
      height: meta.height ?? null,
      duration_sec: meta.durationSec ?? null,
    }
    this.append(dir, asset)
    return id
  }

  /**
   * @param project - a project.
   * @returns the `.dreamverse/assets/` directory of its folder; throws `unknown_project`.
   */
  private assetsDir(project: ProjectId): string {
    return join(this.ctx.dvProject.openProject(project).path, PROJECT_DIR, ASSETS_DIR)
  }

  /**
   * Append an entry to a folder's `index.jsonl` (the last line of an ID wins at replay) and keep it in memory.
   * @param dir - a `.dreamverse/assets/` directory.
   * @param asset - the entry.
   */
  private append(dir: string, asset: Asset): void {
    appendFileSync(join(dir, INDEX_FILE), `${JSON.stringify(asset)}\n`)
    this.folder(dir).set(asset.id, asset)
  }

  /**
   * The assets of one `.dreamverse/assets/` directory, replayed from its `index.jsonl` at first use; a line whose object
   * file is missing is skipped.
   * @param dir - the directory.
   * @returns asset ID → entry.
   */
  private folder(dir: string): Map<AssetId, Asset> {
    const known = this.folders.get(dir)
    if (known !== undefined) return known
    const assets = new Map<AssetId, Asset>()
    const indexPath = join(dir, INDEX_FILE)
    if (existsSync(indexPath)) {
      for (const line of readFileSync(indexPath, 'utf8').split('\n')) {
        if (line.trim() === '') continue
        const asset = JSON.parse(line) as Asset
        if (existsSync(join(dir, OBJECTS_DIR, asset.id))) assets.set(asset.id, asset)
      }
    }
    this.folders.set(dir, assets)
    return assets
  }

  /**
   * Find the folder that stores an asset among the folders read so far; on a miss, read the folders of the projects
   * not read yet, such as a folder registered after start, and look once more.
   * @param id - an asset ID.
   * @returns the `.dreamverse/assets/` directory and the entry, or undefined.
   */
  private locate(id: AssetId): { dir: string; asset: Asset } | undefined {
    const find = (): { dir: string; asset: Asset } | undefined => {
      for (const [dir, assets] of this.folders) {
        const asset = assets.get(id)
        if (asset !== undefined) return { dir, asset }
      }
      return undefined
    }
    const found = find()
    if (found !== undefined) return found
    const unread = this.ctx.dvProject.listProjects().map(info => join(info.path, PROJECT_DIR, ASSETS_DIR))
      .filter(dir => !this.folders.has(dir))
    for (const dir of unread) this.folder(dir)
    return unread.length === 0 ? undefined : find()
  }

  /**
   * @param asset - an asset ID.
   * @returns the folder and entry of an asset the pool holds.
   * @throws ProjectError `unknown_asset` for an asset the pool does not hold.
   */
  private require(asset: AssetId): { dir: string; asset: Asset } {
    const found = this.locate(asset)
    if (found === undefined) throw new ProjectError('unknown_asset', `Asset '${asset}' is not in the asset pool.`)
    return found
  }

  /**
   * Fill the media facts an asset entry of one folder does not know yet: append the updated entry to the folder's
   * `index.jsonl` and keep it in memory. Facts the entry already holds stay as they are.
   * @param dir - the `.dreamverse/assets/` directory that holds the asset.
   * @param current - the folder's entry.
   * @param media - the pixel size and the duration, each null when unknown.
   */
  private describe(dir: string, current: Asset, media: { width: number | null; height: number | null; durationSec: number | null }): void {
    const next: Asset = {
      ...current,
      width: current.width ?? media.width,
      height: current.height ?? media.height,
      duration_sec: current.duration_sec ?? media.durationSec,
    }
    if (next.width === current.width && next.height === current.height && next.duration_sec === current.duration_sec) return
    this.append(dir, next)
  }

  /**
   * @param asset - an asset ID.
   * @returns whether the folder of a project holds it.
   */
  has(asset: AssetId): boolean {
    return this.locate(asset) !== undefined
  }

  /**
   * @param asset - an asset ID.
   * @returns the asset.
   * @throws ProjectError `unknown_asset` for an asset the pool does not hold.
   */
  get(asset: AssetId): Asset {
    return this.require(asset).asset
  }

  /**
   * Whether an asset holds sound: an audio file always, a video when ffprobe finds an audio stream, and any other asset
   * never. The first read of a video probes the file and appends the answer to the `index.jsonl` of the folder that
   * holds it, so later reads and restarts reuse it.
   * @param asset - an asset ID.
   * @returns true when the asset holds sound.
   * @throws ProjectError `unknown_asset` for an asset the pool does not hold; FfmpegError when ffprobe cannot read the
   * video.
   */
  async hasAudio(asset: AssetId): Promise<boolean> {
    const mediaType = this.mediaType(asset)
    if (mediaType !== 'video') return mediaType === 'audio'
    const { dir, asset: entry } = this.require(asset)
    if (entry.has_audio !== undefined) return entry.has_audio
    const hasAudio = (await this.ctx.dvFfmpeg.probe(join(dir, OBJECTS_DIR, asset))).hasAudio
    this.append(dir, { ...entry, has_audio: hasAudio })
    return hasAudio
  }

  /**
   * @param asset - an asset ID.
   * @returns the top-level type of the asset's MIME type: `video` for `video/mp4`.
   * @throws ProjectError `unknown_asset` for an asset the pool does not hold.
   */
  mediaType(asset: AssetId): string {
    return this.get(asset).mime.split('/')[0] as string
  }

  /**
   * @param asset - an asset ID.
   * @returns the absolute path of the stored bytes.
   * @throws ProjectError `unknown_asset` for an asset the pool does not hold.
   */
  path(asset: AssetId): string {
    return join(this.require(asset).dir, OBJECTS_DIR, asset)
  }

  /**
   * @param asset - an asset ID.
   * @returns the stored bytes.
   * @throws ProjectError `unknown_asset` for an asset the pool does not hold.
   */
  read(asset: AssetId): Buffer {
    return readFileSync(this.path(asset))
  }

  /**
   * @param asset - an asset ID.
   * @returns the URL of its bytes under the configured public base.
   */
  url(asset: AssetId): string {
    return `${this.config.publicBaseUrl.replace(/\/+$/, '')}${ROUTE_PREFIX}/${asset}`
  }

  /**
   * Write one frame of a video as a PNG file into a directory; the caller imports it.
   * @param video - a video asset.
   * @param at - the first frame, the last frame, or a time in seconds.
   * @param dir - an existing directory, such as an operation's `scratchDir`.
   * @returns the absolute path of the PNG.
   * @throws FfmpegError when ffmpeg cannot read the video or writes no frame.
   */
  async grabStill(video: AssetId, at: StillAt, dir: string): Promise<string> {
    const input = this.path(video)
    const ffmpeg = this.ctx.dvFfmpeg
    if (at !== 'last') {
      const seek = at === 'first' ? [] : ['-ss', String(at)]
      const argv = ['ffmpeg', '-y', '-loglevel', 'error', ...seek, '-i', '{{in:0}}', '-frames:v', '1', `{{out:${STILL_FILE}}}`]
      return (await ffmpeg.run({ argv, inputs: [input], outputs: [STILL_FILE], dir })).outputs[0] as string
    }
    // A fragmented MP4 from a streaming backend has no reliable duration in its header, so each attempt is tried in
    // turn until one writes a frame.
    const probed = await ffmpeg.probe(input)
    let failure = new FfmpegError('No attempt to read the last frame ran.', '')
    for (const argv of lastFrameAttempts(probed.videoDurationSec ?? probed.durationSec)) {
      try {
        return (await ffmpeg.run({ argv, inputs: [input], outputs: [STILL_FILE], dir })).outputs[0] as string
      } catch (error: unknown) {
        if (!(error instanceof FfmpegError)) throw error
        failure = error
      }
    }
    throw failure
  }

  /** The `asset.import` operation. */
  private importOperation(): OperationSpec {
    return {
      name: 'asset.import',
      component: 'asset',
      version: '1',
      description: 'Bring a file into the asset pool: a path on this machine, or base64 bytes. Returns the asset ID to reference later.',
      inputs: {},
      params: {
        path: { type: 'string', description: 'Absolute path of the file to import.' },
        base64: { type: 'string', description: 'The file bytes as base64, when there is no path.' },
        mime: { type: 'string', required: true, description: 'Media type, such as image/png or video/mp4.' },
        name: { type: 'string', description: 'Display name; defaults to the file name.' },
        place: { type: 'boolean', description: 'Also put the asset on the canvas.' },
      },
      outputs: [{ role: 'asset', type: 'any' }],
      deterministic: true,
      resource: 'none',
      summarize: record => `imported ${text(record.params['name'], basename(text(record.params['path'], 'bytes')))}`,
      execute: async (context): Promise<OperationResult> => {
        const path = text(context.params['path'])
        const base64 = text(context.params['base64'])
        if (path === '' && base64 === '') throw new Error('asset.import needs `path` or `base64`.')
        const asset = context.importAsset(path === '' ? Buffer.from(base64, 'base64') : { path }, {
          mime: text(context.params['mime']),
          name: text(context.params['name'], path === '' ? 'imported' : basename(path)),
        })
        // The import route and chat images store the bytes before this record runs, so the probe runs here for them too.
        await this.probeMedia(this.assetsDir(context.project), asset)
        return { outputs: [asset] }
      },
    }
  }

  /**
   * The `asset.place` or `asset.unplace` operation: put assets on the canvas (an asset the project imported anywhere in
   * its history, or one a record of the current state made), or take assets off it. A call that changes nothing (every
   * asset already placed, or none of them placed) is refused before any record.
   * @param name - which of the two operations.
   * @returns the operation spec.
   */
  private placementOperation(name: 'asset.place' | 'asset.unplace'): OperationSpec {
    const place = name === 'asset.place'
    return {
      name,
      component: 'asset',
      version: '1',
      description: place
        ? 'Put assets of the project on the canvas, where the user sees each one as a node. An asset the project imported '
          + 'anywhere in its history can go on the canvas, and an asset a step of the current state made.'
        : 'Take assets off the canvas. The assets stay in the asset pool.',
      inputs: { asset: { type: 'any', required: true, many: true, description: place ? 'The assets to put on the canvas.' : 'The assets to take off the canvas.' } },
      params: {},
      outputs: [],
      deterministic: false,
      resource: 'none',
      summarize: record => `${place ? 'placed' : 'took off'} ${String(record.inputs.length)} asset(s) ${place ? 'on' : 'from'} the canvas`,
      precondition: (request, state): Promise<void> => {
        const assets = request.inputs.flatMap(input => input.role === 'asset' && 'asset' in input.ref ? [input.ref.asset] : [])
        const placed = new Set(state.components.asset.placed)
        if (place) {
          // The records are read only when an asset was not created by a record of the current state.
          const imported = assets.every(asset => asset in state.components.proj.created_by)
            ? new Map<AssetId, unknown>()
            : importedAssets(this.ctx.dvProject.listRecords(request.project))
          const missing = assets.filter(asset => !placeable(state, imported, asset))
          if (missing.length > 0) {
            throw new ProjectError('invalid_inputs', `Asset ${missing.join(', ')} is neither an import of this project nor made by a step of its current state.`)
          }
          if (assets.every(asset => placed.has(asset))) throw new ProjectError('invalid_params', 'Every asset is already on the canvas.')
        } else if (!assets.some(asset => placed.has(asset))) {
          throw new ProjectError('invalid_params', 'None of the assets is on the canvas.')
        }
        return Promise.resolve()
      },
      execute: (): Promise<OperationResult> => Promise.resolve({ outputs: [] }),
    }
  }

  /**
   * Read the pixel size and duration of an image or video, and the duration of an audio file, that a project folder's
   * entry does not know yet, and store them with {@link DvAssetPool.describe}. ffprobe reads the header; a video whose
   * header has no duration (a WebM file that a browser recorded) is decoded to measure it. A failure leaves the facts
   * unknown and does not fail the import.
   * @param dir - the `.dreamverse/assets/` directory of the importing project.
   * @param id - an asset that the directory holds.
   */
  private async probeMedia(dir: string, id: AssetId): Promise<void> {
    const asset = this.folder(dir).get(id) as Asset
    const mediaType = asset.mime.split('/')[0]
    if (mediaType !== 'video' && mediaType !== 'image' && mediaType !== 'audio') return
    if (mediaType === 'audio' ? asset.duration_sec !== null
      : asset.width !== null && asset.height !== null && (mediaType !== 'video' || asset.duration_sec !== null)) return
    try {
      const file = join(dir, OBJECTS_DIR, id)
      const probed = await this.ctx.dvFfmpeg.probe(file)
      const durationSec = mediaType === 'video' ? probed.videoDurationSec ?? probed.durationSec ?? await this.decodedDuration(file)
        : mediaType === 'audio' ? probed.durationSec : null
      this.describe(dir, asset, { width: probed.width, height: probed.height, durationSec })
    } catch (error) {
      this.ctx.logger('dvAssetPool').warn('could not read the media facts of asset %s: %s', id, error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Decode a video's first video stream and read the last progress time ffmpeg reports.
   * @param file - a video file.
   * @returns the duration in seconds, or null when ffmpeg reports none.
   */
  private async decodedDuration(file: string): Promise<number | null> {
    const result = await this.ctx.dvFfmpeg.run({
      argv: ['ffmpeg', '-v', 'error', '-i', '{{in:0}}', '-map', '0:v:0', '-f', 'null', '-progress', 'pipe:1', '-'],
      inputs: [file], outputs: [], dir: tmpdir(),
    })
    const times = [...result.stdout.matchAll(/^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)$/gm)]
    const last = times.at(-1)
    if (last === undefined) return null
    const seconds = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null
  }

  /** The `asset.grab_still` operation. */
  private grabStillOperation(): OperationSpec {
    return {
      name: 'asset.grab_still',
      component: 'asset',
      version: '1',
      description: 'Grab one frame of a video as a PNG still, to look at it or to use it as a reference.',
      inputs: { video: { type: 'video', required: true, description: 'The video.' } },
      params: {
        at: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
          description: "'first', 'last', or a time in seconds (a number, or a numeric string such as '6.3'); default last.",
        },
      },
      outputs: [{ role: 'still', type: 'image' }],
      deterministic: true,
      resource: 'cpu',
      summarize: record => `still at ${String(stillAt(record.params['at']))}`,
      execute: async (context): Promise<OperationResult> => {
        const video = context.inputs.find(input => input.role === 'video')?.resolved_asset
        if (video === undefined || video === null) throw new Error('Input "video" is required.')
        const still = await this.grabStill(video, stillAt(context.params['at']), context.scratchDir)
        return { outputs: [context.importAsset({ path: still }, { mime: 'image/png', name: STILL_FILE })] }
      },
    }
  }

  /**
   * The `asset.cut_segment` operation: ffmpeg seeks after `-i` and re-encodes, so the segment starts and ends on the
   * exact frames; the audio stream is kept. A call whose times are not `0 <= in_sec < out_sec` is refused before any
   * record, and a range that holds no video frame fails the record without importing a file.
   * @returns the operation spec.
   */
  private cutSegmentOperation(): OperationSpec {
    return {
      name: 'asset.cut_segment',
      component: 'asset',
      version: '1',
      description: 'Cut the part of a video between two times into a new video asset with its sound, for example to use it as a reference.',
      inputs: { video: { type: 'video', required: true, description: 'The video.' } },
      params: {
        in_sec: { type: 'number', required: true, description: 'Where the segment starts, in seconds from the video\'s start.' },
        out_sec: { type: 'number', required: true, description: 'Where the segment ends, in seconds from the video\'s start; after in_sec.' },
      },
      outputs: [{ role: 'segment', type: 'video' }],
      deterministic: true,
      resource: 'cpu',
      summarize: record => `segment ${String(record.params['in_sec'])}–${String(record.params['out_sec'])} s`,
      precondition: (request): Promise<void> => {
        const inSec = Number(request.params['in_sec'])
        const outSec = Number(request.params['out_sec'])
        if (inSec < 0) throw new ProjectError('invalid_params', `The in point ${String(inSec)}s is before the video's start.`)
        if (outSec <= inSec) throw new ProjectError('invalid_params', `The out point ${String(outSec)}s is not after the in point ${String(inSec)}s.`)
        return Promise.resolve()
      },
      execute: async (context): Promise<OperationResult> => {
        const video = context.inputs.find(input => input.role === 'video')?.resolved_asset
        if (video === undefined || video === null) throw new Error('Input "video" is required.')
        const inSec = Number(context.params['in_sec'])
        const outSec = Number(context.params['out_sec'])
        // The seek comes after `-i` so the decoder reads the frames before the cut and the cut lands on the exact frame.
        const segment = (await this.ctx.dvFfmpeg.run({
          argv: [
            'ffmpeg', '-y', '-loglevel', 'error', '-i', '{{in:0}}', '-ss', String(inSec), '-to', String(outSec),
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', `{{out:${SEGMENT_FILE}}}`,
          ],
          inputs: [this.path(video)], outputs: [SEGMENT_FILE], dir: context.scratchDir,
        })).outputs[0] as string
        // ffmpeg writes a file without streams when the range starts after the video's end.
        const probed = await this.ctx.dvFfmpeg.probe(segment)
        if (probed.width === null || probed.height === null) throw new Error(`The video has no frame between ${String(inSec)}s and ${String(outSec)}s.`)
        const durationSec = probed.videoDurationSec ?? probed.durationSec
        return {
          outputs: [context.importAsset({ path: segment }, {
            mime: 'video/mp4', name: SEGMENT_FILE, width: probed.width, height: probed.height, ...durationSec === null ? {} : { durationSec },
          })],
        }
      },
    }
  }

  /** Answer `GET /dv/assets/<AssetId>` with the whole file and its media type; other paths under the prefix are 404. */
  private serveFile(request: IncomingMessage, response: ServerResponse): void {
    /* v8 ignore next -- Node sets `url` on every request it parses. */
    const url = new URL(request.url ?? '/', 'http://localhost')
    const match = FILE_ROUTE.exec(url.pathname)
    const found = match === null ? undefined : this.locate(brandString<AssetId>(String(match[1])))
    if (request.method !== 'GET' || found === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found')
      return
    }
    const filePath = join(found.dir, OBJECTS_DIR, found.asset.id)
    response.writeHead(200, {
      'content-type': found.asset.mime,
      'content-length': String(statSync(filePath).size),
      'cache-control': 'public, max-age=31536000, immutable',
    })
    createReadStream(filePath).pipe(response)
  }
}
