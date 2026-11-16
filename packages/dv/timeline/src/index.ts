/**
 * The Timeline component of DreamVerse as the `dvTimeline` Cordis service: the timelines of a project (each one edited
 * video, shown by its name, or as 时间线 {n} for a timeline t<n> without one) and their clips (an asset with in and out
 * points) and sounds (an audio asset on a numbered sound track, from a start time). The clips of the 视频 track play one
 * after another and cover every other video track; the video tracks under it hold clips at their own start times, which
 * show after the 视频 track's end, and a clip of a track with a lower number hides the picture and audio of the tracks with
 * higher numbers. Every track the user or the agent adds goes at the bottom of the editor. It owns twenty-five edit
 * operations, which change only records and never create a file:
 * - `timeline.create`, `timeline.update`, `timeline.rename`, `timeline.delete` act on a whole timeline;
 * - `timeline.clip_insert`, `timeline.clip_move`, `timeline.clip_remove`, `timeline.clip_split`, `timeline.clip_trim`,
 *   `timeline.clip_replace` edit its clips, each named by its ID (`cl1`, `cl2`, …) in the `clip` param;
 * - `timeline.sound_add`, `timeline.sound_remove`, `timeline.sound_split`, `timeline.sound_move`, `timeline.sound_trim`
 *   add, remove, split, move and trim its sounds, each named by its ID (`sd1`, `sd2`, …) in the `sound` param, and
 *   `timeline.sound_track_remove`, `timeline.sound_track_rename` act on one sound track;
 * - `timeline.track_clip_add`, `timeline.track_clip_move` put a video asset on a video track under the 视频 track and
 *   move it, `timeline.video_track_move` moves one of those tracks to another number, which sets which track covers
 *   which, and `timeline.video_track_remove` deletes one; remove, split, trim and replace also work on their clips;
 * - `timeline.main_track_remove` deletes the 视频 track's clips and makes the first video track under it the 视频 track,
 *   and `timeline.main_track_swap` swaps the 视频 track with that video track;
 * - `timeline.track_add` adds an empty video track or sound track;
 * - `timeline.mute` mutes or unmutes the own audio of the 视频 track's clips, of one video track under it, or one sound
 *   track.
 *
 * Its twenty-sixth operation, `timeline.export`, writes a timeline to one video file with `dvFfmpeg` and imports the file
 * into the asset pool (see `export.ts`): the video tracks under the 视频 track after its end, without the sounds and
 * without the audio of muted video tracks.
 * While `@dv/canvas` is loaded, `timeline.place` puts one timeline on the canvas as a node of kind `timeline` (see
 * `place.ts`).
 *
 * The operations that add clips assign the new clip IDs and store them in the record's `report.clips`, and
 * `timeline.sound_add` and `timeline.sound_split` store the new sound ID in `report.sounds`; the `timeline` reducer
 * folds the records into the `timeline` slice. `timeline.create` and `timeline.update` declare the `clip` input
 * role in `pendingInputRoles`: a clip input may name a render that is not done, and the clip is a placeholder until
 * the render is done. `dvProject` turns each operation into its agent tool
 * (`dv_timeline_create`, `dv_timeline_clip_move`, `dv_timeline_export`, ...). While the DSH skill registry is mounted,
 * the component registers the `timeline-editing` skill: the user's editing phrasings mapped to the exact `dv_*` calls.
 *
 * @module @dv/timeline
 */
import { readFileSync } from 'node:fs'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, OperationContext, OperationResult, OperationSpec, ProjectId, ProjectRecord } from '@dv/project'
import { exportOperation, exportTimeline } from './export.ts'
import { placeOperation, TIMELINE_NODE_MAKER } from './place.ts'
import {
  addedClipCount, afterCall, clipProblem, mainClipStarts, namedTimeline, NEW_CLIP, OPERATIONS, reportedClips, reportedSounds,
  soundLengthProblem, timelineReducer, trackClipProblem,
} from './reducer.ts'
import type { ClipId, SoundId, Timeline } from './types.ts'

export type { Clip, ClipId, ClipStatus, Sound, SoundId, Timeline, TimelineId, TimelineState, TrackClip, TrackKind } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Timeline component: the timelines of a project and their clips. */
    dvTimeline: DvTimeline
  }
}

/** `dvTimeline` plugin configuration; the component has no deployment-varying settings. */
export type Config = Record<string, unknown>

/** Loader validation. */
export const Config: z<Config> = z.object({})

/** The skill that maps the user's editing phrasings to the timeline, render and project tool calls. */
const TIMELINE_EDITING_SKILL = {
  name: 'timeline-editing',
  description: 'Cheat sheet from the user\'s editing phrasings to the exact dv_* calls and their required arguments: trims, retakes, '
    + 'reference and style changes, reordering, deletion, going back to an earlier take, muting, and export.',
  whenToUse: 'The user asks for a change to an existing shot or timeline in a DreamVerse project and you need the exact tool call.',
  content: readFileSync(new URL('../skills/timeline-editing/SKILL.md', import.meta.url), 'utf8'),
  source: 'runtime',
}

/** The `timeline` param of `timeline.clip_insert`, which may omit it. */
const TIMELINE_PARAM = {
  timeline: { type: 'string', description: 'The timeline to edit, such as t1 (see `timelines` in dv_proj_state). Defaults to the first timeline.' },
} as const

/** The `sound` param: the sound's ID, which also names the timeline that holds it. */
const SOUND_PARAM = {
  sound: { type: 'string', required: true, description: 'The sound ID, such as sd2 (see `sounds` of `timelines` in dv_proj_state).' },
} as const

/** The `clip` param: the clip's ID, which also names the timeline that holds it. */
const CLIP_PARAM = {
  clip: { type: 'string', required: true, description: 'The clip ID, such as cl3 (see `clips` of `timelines` in dv_proj_state).' },
} as const

/**
 * The params and the input role of `timeline.create` and `timeline.update`: the clips in playback order. The `clip` role
 * is a pending input role, so a clip may name a render that has not finished.
 */
const LAYOUT = {
  inputs: {
    clip: {
      type: 'video', many: true,
      description: 'The clips in order, as render outputs; a render that is not done yet becomes a placeholder clip until it is done.',
    },
  },
  pendingInputRoles: ['clip'],
  params: {
    assets: { type: 'array', items: { type: 'string' }, description: 'Clip asset IDs in playback order.' },
  },
} as const

/** The timeline a record names, as a summary prefix such as `t2 `; empty when it names none. */
function prefix(record: ProjectRecord): string {
  const id = namedTimeline(record.params)
  return id === null ? '' : `${id} `
}

/** The number of clips a create or update record lays out, for summaries. */
function laidOut(record: ProjectRecord): number {
  return Array.isArray(record.params['assets']) ? record.params['assets'].length : record.inputs.length
}

/** The clip ID a finished insert record assigned, followed by a space; empty before the record finishes. */
function clipOf(record: ProjectRecord): string {
  const id = reportedClips(record)[0]
  return id === undefined ? '' : `${id} `
}

/** What a `timeline.mute` record mutes, for its summary: `video audio`, `video track 1` or `sound track 0`. */
function muteTarget(record: ProjectRecord): string {
  if (record.params['target'] === 'video') return 'video audio'
  return `${record.params['target'] === 'video_track' ? 'video' : 'sound'} track ${shown(record.params['track'])}`
}

/** A params field as display text. */
function shown(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '?'
}

/**
 * One Timeline operation: a record-only edit that the service's `execute` validates. It is not `deterministic`: whether
 * a call applies depends on the state, and the clips it adds get new IDs, so the runner runs every call.
 * @param spec - the operation's own fields.
 * @param execute - the service's check and clip ID assignment.
 * @returns the operation spec.
 */
function edit(
  spec: Pick<OperationSpec, 'name' | 'description' | 'params' | 'summarize'>
    & Partial<Pick<OperationSpec, 'inputs' | 'version' | 'pendingInputRoles' | 'label'>>,
  execute: OperationSpec['execute'],
): OperationSpec {
  return {
    inputs: {}, version: '2', ...spec, component: 'timeline', outputs: [], deterministic: false, resource: 'none',
    execute,
  }
}

/** The operations that can change where the track clips play, so their result is checked for overlaps. */
const TRACK_CLIP_EDITS: readonly string[] = [
  OPERATIONS.trackClipAdd, OPERATIONS.trackClipMove, OPERATIONS.trim, OPERATIONS.replace,
]

/** The `track` param of the operations that name a video track under the 视频 track. */
const VIDEO_TRACK_PARAM = {
  type: 'integer',
  description: 'The video track under the main video track: 0 for the first one; an existing track or the one after the last '
    + '(see `video_tracks` in dv_proj_state).',
} as const

/** The Timeline service: the reducer, the twenty-five edit operations and the export operation. */
export default class DvTimeline extends Service {
  static inject = ['dvProject', 'dvAssetPool', 'dvFfmpeg']
  static Config = Config

  /** The highest clip number this service assigned per project, for calls whose records have not finished yet. */
  private readonly assigned = new Map<ProjectId, number>()
  /** The highest sound number this service assigned per project, for calls whose records have not finished yet. */
  private readonly assignedSounds = new Map<ProjectId, number>()

  constructor(ctx: Context) {
    super(ctx, 'dvTimeline')
    ctx.effect(() => ctx.dvProject.registerComponent('timeline'), 'dvTimeline component')
    ctx.effect(() => ctx.dvProject.registerReducer('timeline', timelineReducer), 'dvTimeline reducer')
    for (const spec of [...this.operations(), exportOperation(ctx)]) {
      ctx.effect(() => ctx.dvProject.registerOperation(spec), `dvTimeline ${spec.name}`)
    }
    ctx.inject(['skills'], (child) => {
      child.effect(() => child.skills.register(TIMELINE_EDITING_SKILL), `dvTimeline ${TIMELINE_EDITING_SKILL.name}`)
    })
    // A timeline goes on the canvas as a node of the canvas's node list, so the placement exists while the canvas is loaded.
    ctx.inject(['dvCanvasNodes'], (canvas) => {
      canvas.effect(() => canvas.dvCanvasNodes.registerMaker(TIMELINE_NODE_MAKER), 'dvTimeline canvas nodes')
      canvas.effect(() => canvas.dvProject.registerOperation(placeOperation()), 'dvTimeline timeline.place')
    })
  }

  /**
   * Export a timeline to one MP4 file: trim each clip with an in or out point to that range, then join all clips in
   * playback order; a timeline whose clips' own audio is muted gives a file without audio.
   * @param timeline - the timeline with at least one clip, each of which has an asset.
   * @param dir - an existing directory for the trimmed clips and the joined file, usually the operation's `scratchDir`.
   * @returns the path of the joined file inside `dir`.
   * @throws Error for a timeline without clips or with a placeholder clip; FfmpegError when ffmpeg cannot trim or join
   *   the clips.
   */
  exportTimeline(timeline: Timeline, dir: string): Promise<string> {
    return exportTimeline(this.ctx, timeline, dir)
  }

  /**
   * Assign new clip IDs in a project. The number after `cl` is one more than the highest number that any Timeline
   * record of the project stored in `report.clips`, anywhere in its history (including records an undo took back), and
   * than any number this service assigned to a call still running. So no two clips of a project ever share an ID, even
   * after an undo.
   * @param project - the project.
   * @param count - how many IDs to assign.
   * @returns the IDs in order.
   */
  private assignClipIds(project: ProjectId, count: number): ClipId[] {
    let highest = this.assigned.get(project) ?? 0
    for (const entry of this.ctx.dvProject.listHistory({ project, component: 'timeline' })) {
      for (const id of reportedClips(entry.record)) highest = Math.max(highest, Number(/^cl(\d+)$/.exec(id)?.[1] ?? 0))
    }
    const ids = Array.from({ length: count }, (_, index) => brandString<ClipId>(`cl${String(highest + index + 1)}`))
    this.assigned.set(project, highest + count)
    return ids
  }

  /**
   * Assign a new sound ID in a project: `sd` and one more than the highest number of any sound ID that a Timeline record
   * of the project stored in `report.sounds`, or that this service assigned to a call still running.
   * @param project - the project.
   * @returns the ID.
   */
  private assignSoundId(project: ProjectId): SoundId {
    let highest = this.assignedSounds.get(project) ?? 0
    for (const entry of this.ctx.dvProject.listHistory({ project, component: 'timeline' })) {
      for (const id of reportedSounds(entry.record)) highest = Math.max(highest, Number(/^sd(\d+)$/.exec(id)?.[1] ?? 0))
    }
    this.assignedSounds.set(project, highest + 1)
    return brandString<SoundId>(`sd${String(highest + 1)}`)
  }

  /**
   * Check a call against the timeline it edits, and assign the IDs of the clips or the sound it adds; the record fails
   * with the reason when the call cannot apply, when the asset of `timeline.sound_add` is not an audio file or the asset
   * of `timeline.track_clip_add`, or of `timeline.clip_replace` of a video track's clip, not a video, when a sound split or
   * trim does not fit the sound's asset, or when the call would leave a track clip overlapping another clip of its
   * track, starting before the timeline's start, or with an unknown length. The edit itself is the record: the reducer
   * applies it.
   * @param context - the running call.
   * @returns no outputs; `report.clips` holds the assigned clip IDs of a call that adds clips, `report.sounds` the
   *   assigned sound ID of `timeline.sound_add` or of the second part of `timeline.sound_split`, and `report.starts` the
   *   times at which `timeline.main_track_swap` puts the 视频 track's clips on video track 0.
   * @throws Error with the reason a call cannot apply.
   */
  private execute(context: OperationContext): Promise<OperationResult> {
    const call = { operation: context.record?.operation ?? null, params: context.params, inputs: context.inputs }
    const problem = clipProblem(context.state.components.timeline, call)
    if (problem !== null) return Promise.reject(new Error(problem))
    const durationOf = (asset: AssetId): number | null => this.ctx.dvAssetPool.get(asset).duration_sec
    if (call.operation === OPERATIONS.soundSplit || call.operation === OPERATIONS.soundTrim) {
      const misfit = soundLengthProblem(context.state.components.timeline, call, durationOf)
      if (misfit !== null) return Promise.reject(new Error(misfit))
    }
    if (call.operation === OPERATIONS.soundAdd) {
      const asset = String(call.params['asset'])
      if (this.ctx.dvAssetPool.mediaType(brandString<AssetId>(asset)) !== 'audio') {
        return Promise.reject(new Error(`Asset ${asset} is not an audio file.`))
      }
    }
    if (call.operation === OPERATIONS.soundAdd || call.operation === OPERATIONS.soundSplit) {
      return Promise.resolve({ outputs: [], report: { sounds: [this.assignSoundId(context.project)] } })
    }
    // A clip of a video track plays only a video: one that an add puts there, or one that replaces a track clip's asset.
    const replacesTrackClip = call.operation === OPERATIONS.replace
      && context.state.components.timeline.timelines.some(timeline => timeline.track_clips.some(clip => clip.id === call.params['clip']))
    const asset = brandString<AssetId>(String(call.params['asset']))
    if ((call.operation === OPERATIONS.trackClipAdd || replacesTrackClip) && this.ctx.dvAssetPool.mediaType(asset) !== 'video') {
      return Promise.reject(new Error(`Asset ${asset} is not a video.`))
    }
    if (call.operation === OPERATIONS.mainTrackSwap) {
      // `clipProblem` found the named timeline.
      const timeline = context.state.components.timeline.timelines.find(entry => entry.id === namedTimeline(call.params)) as Timeline
      const starts = mainClipStarts(timeline, durationOf)
      return typeof starts === 'string' ? Promise.reject(new Error(starts)) : Promise.resolve({ outputs: [], report: { starts } })
    }
    if (TRACK_CLIP_EDITS.includes(String(call.operation))) {
      const before = context.state.components.timeline
      // The new clip of an add gets its ID only once the call applies, so the check names it by a stand-in ID.
      const after = afterCall(before, { ...call, operation: String(call.operation), report: { clips: [NEW_CLIP] } })
      const changed = call.operation === OPERATIONS.trackClipAdd ? NEW_CLIP : brandString<ClipId>(String(call.params['clip']))
      for (const timeline of after.timelines) {
        if (before.timelines.some(entry => entry.track_clips === timeline.track_clips)) continue
        const problem = trackClipProblem(timeline, durationOf, changed)
        if (problem !== null) return Promise.reject(new Error(problem))
      }
    }
    const count = addedClipCount(call)
    const adds = [OPERATIONS.create, OPERATIONS.update, OPERATIONS.insert, OPERATIONS.split, OPERATIONS.trackClipAdd]
      .includes(call.operation as never)
    return Promise.resolve(adds ? { outputs: [], report: { clips: this.assignClipIds(context.project, count) } } : { outputs: [] })
  }

  /** The twenty-five edit operations, in the order the agent's tool list shows them. */
  private operations(): OperationSpec[] {
    const execute = (context: OperationContext): Promise<OperationResult> => this.execute(context)
    return [
      edit({
        name: OPERATIONS.create,
        label: { zh: '新建时间线', en: 'Create timeline' },
        description: 'Create a timeline (one edited video of the project) from clips in order. Pass a new `timeline` ID (t2, t3, ...) '
          + 'and a `name`; omit the ID for the project\'s first timeline, t1. To replace the clips of an existing timeline, call '
          + 'dv_timeline_update. An empty `assets` list makes an empty timeline.',
        inputs: LAYOUT.inputs,
        pendingInputRoles: [...LAYOUT.pendingInputRoles],
        params: {
          timeline: { type: 'string', description: 'The ID of the timeline to create, such as t2. Defaults to t1.' },
          name: { type: 'string', description: 'The name the interface shows, such as Ending. Without a name '
            + 'the interface shows a numbered name in the interface language, such as Timeline 2 for t2.' },
          ...LAYOUT.params,
        },
        summarize: record => `${prefix(record)}timeline of ${String(laidOut(record))} clips`,
      }, execute),
      edit({
        name: OPERATIONS.update,
        label: { zh: '修改时间线', en: 'Update timeline' },
        description: 'Replace all clips of an existing timeline with clips in order; its name stays. Every clip gets a new clip ID.',
        inputs: LAYOUT.inputs,
        pendingInputRoles: [...LAYOUT.pendingInputRoles],
        params: { timeline: { type: 'string', required: true, description: 'The timeline to update, such as t1.' }, ...LAYOUT.params },
        summarize: record => `${prefix(record)}timeline updated (${String(laidOut(record))} clips)`,
      }, execute),
      edit({
        name: OPERATIONS.rename,
        label: { zh: '重命名时间线', en: 'Rename timeline' },
        version: '1',
        description: 'Change the name of a timeline.',
        params: {
          timeline: { type: 'string', required: true, description: 'The timeline to rename, such as t1.' },
          name: { type: 'string', required: true, description: 'The name.' },
        },
        summarize: record => `${prefix(record)}renamed to ${shown(record.params['name'])}`,
      }, execute),
      edit({
        name: OPERATIONS.delete,
        label: { zh: '删除时间线', en: 'Delete timeline' },
        version: '1',
        description: 'Delete a whole timeline from the project. Its clip assets stay in the project. Only call this when the user '
          + 'asked to delete the timeline.',
        params: { timeline: { type: 'string', required: true, description: 'The timeline to delete, such as t2.' } },
        summarize: record => `${prefix(record)}deleted`,
      }, execute),
      edit({
        name: OPERATIONS.insert,
        label: { zh: '插入片段', en: 'Insert clip' },
        description: 'Insert an asset as a clip into a timeline at a position (1 = first); later clips shift. Use at = clip count + 1 '
          + 'to append. Inserting into a timeline that does not exist creates it. The clip gets a new clip ID.',
        params: {
          ...TIMELINE_PARAM,
          at: { type: 'integer', required: true, description: 'The position the clip takes.' },
          asset: { type: 'string', required: true, description: 'The asset ID.' },
        },
        summarize: record => `${prefix(record)}clip ${clipOf(record)}inserted at ${shown(record.params['at'])}`,
      }, execute),
      edit({
        name: OPERATIONS.move,
        label: { zh: '移动片段', en: 'Move clip' },
        description: 'Move a clip to another position of the main video track (1 = first); the other clips shift. A clip of a video '
          + 'track under it moves into the main video track at that position.',
        params: { ...CLIP_PARAM, to: { type: 'integer', required: true, description: 'The position the clip takes on the main video track.' } },
        summarize: record => `clip ${shown(record.params['clip'])} moved to ${shown(record.params['to'])}`,
      }, execute),
      edit({
        name: OPERATIONS.remove,
        label: { zh: '移除片段', en: 'Remove clip' },
        description: 'Take a clip out of its timeline; later clips shift. The asset stays in the project.',
        params: { ...CLIP_PARAM },
        summarize: record => `clip ${shown(record.params['clip'])} removed`,
      }, execute),
      edit({
        name: OPERATIONS.split,
        label: { zh: '拆分片段', en: 'Split clip' },
        description: 'Split one clip in two at a time inside its asset (seconds from the asset\'s start, not from the timeline\'s '
          + 'start). Both parts play the same asset: the first keeps the clip ID and ends at at_sec, the second gets a new clip ID '
          + 'and starts there.',
        params: {
          ...CLIP_PARAM,
          at_sec: { type: 'number', required: true, description: 'Seconds inside the clip\'s asset, between its in and out points.' },
        },
        summarize: record => `clip ${shown(record.params['clip'])} split at ${shown(record.params['at_sec'])}s`,
      }, execute),
      edit({
        name: OPERATIONS.trim,
        label: { zh: '裁剪片段', en: 'Trim clip' },
        description: 'Set the in and out points of a clip (seconds inside its asset) without changing the asset; no file is created. '
          + 'An omitted point plays from the asset\'s start or to its end.',
        params: {
          ...CLIP_PARAM,
          in_sec: { type: 'number', description: 'Where the clip starts inside its asset.' },
          out_sec: { type: 'number', description: 'Where the clip ends inside its asset.' },
        },
        summarize: record => `clip ${shown(record.params['clip'])} trimmed`,
      }, execute),
      edit({
        name: OPERATIONS.replace,
        label: { zh: '替换片段', en: 'Replace clip' },
        description: 'Put a different asset in a clip; the clip keeps its ID and its in and out points reset.',
        params: { ...CLIP_PARAM, asset: { type: 'string', required: true, description: 'The asset ID.' } },
        summarize: record => `clip ${shown(record.params['clip'])} replaced`,
      }, execute),
      edit({
        name: OPERATIONS.soundAdd,
        label: { zh: '添加声音', en: 'Add sound' },
        version: '1',
        description: 'Add an audio asset to a sound track of a timeline, starting start_sec seconds after the timeline\'s start. '
          + 'It may overlap clips and other sounds and gets a new sound ID. The exported video does not include sounds yet.',
        params: {
          timeline: { type: 'string', required: true, description: 'The timeline, such as t1.' },
          asset: { type: 'string', required: true, description: 'The audio asset ID.' },
          start_sec: { type: 'number', required: true, description: 'Seconds from the timeline\'s start; 0 or more.' },
          track: {
            type: 'integer',
            description: 'The sound track, 0 (default) for the first; an existing track or the one after the last (see `sound_tracks` in dv_proj_state).',
          },
        },
        summarize: record => `${prefix(record)}sound ${reportedSounds(record)[0] ?? ''} added at ${shown(record.params['start_sec'])}s`,
      }, execute),
      edit({
        name: OPERATIONS.soundRemove,
        label: { zh: '删除声音', en: 'Remove sound' },
        version: '1',
        description: 'Remove a sound from its timeline. The audio asset stays in the project.',
        params: SOUND_PARAM,
        summarize: record => `sound ${shown(record.params['sound'])} removed`,
      }, execute),
      edit({
        name: OPERATIONS.soundSplit,
        label: { zh: '拆分声音', en: 'Split sound' },
        version: '1',
        description: 'Split one sound in two at a time inside its audio asset (seconds from the asset\'s start, not from the timeline\'s '
          + 'start). Both parts play the same asset where the sound played: the first keeps the sound ID and ends at at_sec, the '
          + 'second gets a new sound ID and starts there. No file is created.',
        params: {
          ...SOUND_PARAM,
          at_sec: { type: 'number', required: true, description: 'Seconds inside the sound\'s asset, between its in and out points.' },
        },
        summarize: record => `sound ${shown(record.params['sound'])} split at ${shown(record.params['at_sec'])}s`,
      }, execute),
      edit({
        name: OPERATIONS.soundMove,
        label: { zh: '移动声音', en: 'Move sound' },
        version: '1',
        description: 'Move one sound to another start time, and with track to another sound track: an existing track or the one after '
          + 'the last. Sounds may overlap.',
        params: {
          ...SOUND_PARAM,
          start_sec: { type: 'number', required: true, description: 'The timeline time at which the sound starts, in seconds; 0 or more.' },
          track: { type: 'integer', description: 'The sound track, 0 for the first (see `sound_tracks` in dv_proj_state); omit to keep it.' },
        },
        summarize: record => `sound ${shown(record.params['sound'])} moved to ${shown(record.params['start_sec'])}s`
          + (record.params['track'] === undefined ? '' : ` on sound track ${shown(record.params['track'])}`),
      }, execute),
      edit({
        name: OPERATIONS.soundTrim,
        label: { zh: '裁剪声音', en: 'Trim sound' },
        version: '1',
        description: 'Set the in and out points of a sound (seconds inside its audio asset); no file is created. A missing point means '
          + 'the asset\'s start or end. Moving the in point moves the sound\'s start by the same amount, so the rest plays where it did.',
        params: {
          ...SOUND_PARAM,
          in_sec: { type: 'number', description: 'Where the sound starts inside its asset; omit for the asset\'s start.' },
          out_sec: { type: 'number', description: 'Where the sound ends inside its asset; omit for the asset\'s end.' },
        },
        summarize: record => `sound ${shown(record.params['sound'])} trimmed`,
      }, execute),
      edit({
        name: OPERATIONS.soundTrackRemove,
        label: { zh: '删除音轨', en: 'Delete sound track' },
        version: '1',
        description: 'Delete one sound track of a timeline with all its sounds; every later track moves up one. The audio assets stay.',
        params: {
          timeline: { type: 'string', required: true, description: 'The timeline, such as t1.' },
          track: { type: 'integer', required: true, description: 'The sound track, 0 for the first.' },
        },
        summarize: record => `${prefix(record)}sound track ${shown(record.params['track'])} deleted`,
      }, execute),
      edit({
        name: OPERATIONS.soundTrackRename,
        label: { zh: '重命名音轨', en: 'Rename sound track' },
        version: '1',
        description: 'Name one sound track of a timeline: an existing track or the one after the last. An empty name clears the name.',
        params: {
          timeline: { type: 'string', required: true, description: 'The timeline, such as t1.' },
          track: { type: 'integer', required: true, description: 'The sound track, 0 for the first.' },
          name: { type: 'string', required: true, description: 'The name, such as Narration.' },
        },
        summarize: record => `${prefix(record)}sound track ${shown(record.params['track'])} renamed to ${shown(record.params['name'])}`,
      }, execute),
      edit({
        name: OPERATIONS.mute,
        label: { zh: '静音或取消静音', en: 'Mute or unmute' },
        version: '2',
        description: 'Mute or unmute audio of a timeline. Target `video` is the own audio of the main video track\'s clips, and '
          + 'target `video_track` that of one video track under it: while it is muted, the user hears those clips silent when '
          + 'playing the timeline, and the exported video leaves their audio out. Target `sound` is one sound track: while it is '
          + 'muted, the user does not hear its sounds when playing the timeline (the exported video does not include sounds yet).',
        params: {
          timeline: { type: 'string', required: true, description: 'The timeline, such as t1.' },
          target: {
            type: 'string', enum: ['video', 'video_track', 'sound'], required: true,
            description: '`video` for the main video track\'s clips, `video_track` for one video track under it, `sound` for one sound track.',
          },
          track: {
            type: 'integer',
            description: 'For target `video_track`: the video track, 0 for the first one (see `video_tracks` in dv_proj_state). For '
              + 'target `sound`: the sound track, 0 for the first; an existing track or the one after the last (see `sound_tracks`).',
          },
          muted: { type: 'boolean', required: true, description: 'true mutes, false unmutes.' },
        },
        summarize: record => `${prefix(record)}${muteTarget(record)} ${record.params['muted'] === true ? 'muted' : 'unmuted'}`,
      }, execute),
      edit({
        name: OPERATIONS.trackClipAdd,
        label: { zh: '添加到视频轨', en: 'Add clip to a video track' },
        version: '1',
        description: 'Put a video asset on a video track under the main video track, starting start_sec seconds after the timeline\'s '
          + 'start. The main video track covers it while the main track has a clip, so the user sees and hears it only after the main '
          + 'track\'s last clip ends, and only where no track with a lower number has a clip; track 0 is the first track under the '
          + 'main one. It must not overlap another clip of its track. It gets a new clip ID; dv_timeline_clip_trim, '
          + 'dv_timeline_clip_split, dv_timeline_clip_replace and dv_timeline_clip_remove work on it.',
        params: {
          timeline: { type: 'string', required: true, description: 'The timeline, such as t1.' },
          asset: { type: 'string', required: true, description: 'The video asset ID.' },
          start_sec: { type: 'number', required: true, description: 'Seconds from the timeline\'s start; 0 or more.' },
          track: { ...VIDEO_TRACK_PARAM, required: true },
        },
        summarize: record => `${prefix(record)}clip ${clipOf(record)}added to video track ${shown(record.params['track'])} at ${shown(record.params['start_sec'])}s`,
      }, execute),
      edit({
        name: OPERATIONS.trackClipMove,
        label: { zh: '移动视频轨片段', en: 'Move clip on video tracks' },
        version: '1',
        description: 'Move a clip of a video track under the main video track to another start time, and to another of those tracks '
          + 'when `track` is given. A clip of the main video track moves out of it onto `track`, which it then needs. It must not '
          + 'overlap another clip of the track it lands on.',
        params: {
          ...CLIP_PARAM,
          start_sec: { type: 'number', required: true, description: 'Seconds from the timeline\'s start; 0 or more.' },
          track: { ...VIDEO_TRACK_PARAM, description: `${VIDEO_TRACK_PARAM.description} Defaults to the clip's own track.` },
        },
        summarize: record => `clip ${shown(record.params['clip'])} moved to ${shown(record.params['start_sec'])}s`
          + (record.params['track'] === undefined ? '' : ` on video track ${shown(record.params['track'])}`),
      }, execute),
      edit({
        name: OPERATIONS.videoTrackRemove,
        label: { zh: '删除视频轨', en: 'Delete video track' },
        version: '1',
        description: 'Delete one video track under the main video track with all its clips; every one of those tracks with a higher '
          + 'number moves up one. The assets stay.',
        params: {
          timeline: { type: 'string', required: true, description: 'The timeline, such as t1.' },
          track: { ...VIDEO_TRACK_PARAM, required: true, description: 'The video track under the main video track, 0 for the first one.' },
        },
        summarize: record => `${prefix(record)}video track ${shown(record.params['track'])} deleted`,
      }, execute),
      edit({
        name: OPERATIONS.videoTrackMove,
        label: { zh: '移动视频轨', en: 'Move video track' },
        version: '1',
        description: 'Move one video track under the main video track to another number, with its clips and its mute. A track with a '
          + 'lower number covers the tracks with higher numbers after the main track ends; the tracks between the two numbers move '
          + 'one number toward the old one. The main video track covers them all; dv_timeline_main_track_swap swaps it with track 0.',
        params: {
          timeline: { type: 'string', required: true, description: 'The timeline, such as t1.' },
          track: { ...VIDEO_TRACK_PARAM, required: true, description: 'The video track to move, 0 for the first one.' },
          to: { ...VIDEO_TRACK_PARAM, required: true, description: 'Its new number: an existing video track, 0 to cover all the others.' },
        },
        summarize: record => `${prefix(record)}video track ${shown(record.params['track'])} moved to ${shown(record.params['to'])}`,
      }, execute),
      edit({
        name: OPERATIONS.mainTrackRemove,
        label: { zh: '删除主视频轨', en: 'Delete main video track' },
        version: '1',
        description: 'Delete all clips of the main video track; video track 0 under it then becomes the main video track. Its clips '
          + 'play one after another in the order of their start times, without the gaps between them, and keep their clip IDs; its '
          + 'mute becomes the mute of the main track\'s own audio, and every other video track moves up one number. Without video '
          + 'tracks, the main video track stays empty. The assets stay.',
        params: { timeline: { type: 'string', required: true, description: 'The timeline, such as t1.' } },
        summarize: record => `${prefix(record)}main video track deleted`,
      }, execute),
      edit({
        name: OPERATIONS.mainTrackSwap,
        label: { zh: '对调主视频轨', en: 'Swap main video track' },
        version: '1',
        description: 'Swap the main video track with video track 0 under it, so the other one covers. The main track\'s clips go onto '
          + 'video track 0 at the times they play now; the clips of video track 0 become the main track\'s clips, one after another '
          + 'in the order of their start times, without the gaps between them. Both keep their clip IDs, and the two mutes swap. '
          + 'Refused while a clip of the main track is still rendering.',
        params: { timeline: { type: 'string', required: true, description: 'The timeline, such as t1.' } },
        summarize: record => `${prefix(record)}main video track swapped with video track 0`,
      }, execute),
      edit({
        name: OPERATIONS.trackAdd,
        label: { zh: '添加轨道', en: 'Add track' },
        version: '1',
        description: 'Add an empty video track or sound track to a timeline, under all its tracks. Adding a clip or a sound to the '
          + 'track after the last also adds a track, so call this only for an empty track.',
        params: {
          timeline: { type: 'string', required: true, description: 'The timeline, such as t1.' },
          kind: {
            type: 'string', required: true, enum: ['video', 'sound'],
            description: 'video for a video track under the main video track, sound for a sound track.',
          },
        },
        summarize: record => `${prefix(record)}${shown(record.params['kind'])} track added`,
      }, execute),
    ]
  }
}
