/**
 * The Timeline component of DreamVerse as the `dvTimeline` Cordis service: the timelines of a project (each one edited
 * video, shown by its name, or as 时间线 {n} for a timeline t<n> without one) and their clips (an asset with in and out
 * points) and sounds (an audio asset on a numbered sound track, from a start time). It owns fifteen edit operations,
 * which change only records and never create a file:
 * - `timeline.create`, `timeline.update`, `timeline.rename`, `timeline.delete` act on a whole timeline;
 * - `timeline.clip_insert`, `timeline.clip_move`, `timeline.clip_remove`, `timeline.clip_split`, `timeline.clip_trim`,
 *   `timeline.clip_replace` edit its clips, each named by its ID (`cl1`, `cl2`, …) in the `clip` param;
 * - `timeline.sound_add`, `timeline.sound_remove` add and remove its sounds, each named by its ID (`sd1`, `sd2`, …) in
 *   the `sound` param, and `timeline.sound_track_remove`, `timeline.sound_track_rename` act on one sound track;
 * - `timeline.mute` mutes or unmutes the clips' own audio or one sound track.
 *
 * Its sixteenth operation, `timeline.export`, writes a timeline to one video file with `dvFfmpeg` and imports the file
 * into the asset pool (see `export.ts`); the video leaves out the sounds, and the clips' own audio while it is muted.
 *
 * The operations that add clips assign the new clip IDs and store them in the record's `report.clips`, and
 * `timeline.sound_add` stores the new sound ID in `report.sounds`; the `timeline` reducer folds the records into the
 * `timeline` slice. `timeline.create` and `timeline.update` declare the `clip` input
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
import {
  addedClipCount, clipProblem, namedTimeline, OPERATIONS, reportedClips, reportedSounds, timelineReducer,
} from './reducer.ts'
import type { ClipId, SoundId, Timeline } from './types.ts'

export type { Clip, ClipId, ClipStatus, Sound, SoundId, Timeline, TimelineId, TimelineState } from './types.ts'

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

/** The Timeline service: the reducer, the fifteen edit operations and the export operation. */
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
   * with the reason when the call cannot apply, or when the asset of `timeline.sound_add` is not an audio file. The
   * edit itself is the record: the reducer applies it.
   * @param context - the running call.
   * @returns no outputs; `report.clips` holds the assigned clip IDs of a call that adds clips, and `report.sounds` the
   *   assigned sound ID of `timeline.sound_add`.
   * @throws Error with the reason a call cannot apply.
   */
  private execute(context: OperationContext): Promise<OperationResult> {
    const call = { operation: context.record?.operation ?? null, params: context.params, inputs: context.inputs }
    const problem = clipProblem(context.state.components.timeline, call)
    if (problem !== null) return Promise.reject(new Error(problem))
    if (call.operation === OPERATIONS.soundAdd) {
      const asset = String(call.params['asset'])
      if (this.ctx.dvAssetPool.mediaType(brandString<AssetId>(asset)) !== 'audio') {
        return Promise.reject(new Error(`Asset ${asset} is not an audio file.`))
      }
      return Promise.resolve({ outputs: [], report: { sounds: [this.assignSoundId(context.project)] } })
    }
    const count = addedClipCount(call)
    const adds = [OPERATIONS.create, OPERATIONS.update, OPERATIONS.insert, OPERATIONS.split].includes(call.operation as never)
    return Promise.resolve(adds ? { outputs: [], report: { clips: this.assignClipIds(context.project, count) } } : { outputs: [] })
  }

  /** The fifteen edit operations, in the order the agent's tool list shows them. */
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
        description: 'Move a clip to another position on its timeline (1 = first); the other clips shift.',
        params: { ...CLIP_PARAM, to: { type: 'integer', required: true, description: 'The position the clip takes.' } },
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
        params: { sound: { type: 'string', required: true, description: 'The sound ID, such as sd2 (see `sounds` of `timelines` in dv_proj_state).' } },
        summarize: record => `sound ${shown(record.params['sound'])} removed`,
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
        version: '1',
        description: 'Mute or unmute audio of a timeline. Target `video` is the clips\' own audio: while it is muted, the user hears '
          + 'the clips silent when playing the timeline, and the exported video has no audio. Target `sound` is one sound track: '
          + 'while it is muted, the user does not hear its sounds when playing the timeline (the exported video does not include '
          + 'sounds yet).',
        params: {
          timeline: { type: 'string', required: true, description: 'The timeline, such as t1.' },
          target: { type: 'string', enum: ['video', 'sound'], required: true, description: '`video` for the clips\' own audio, `sound` for one sound track.' },
          track: {
            type: 'integer',
            description: 'For target `sound`: the sound track, 0 for the first; an existing track or the one after the last (see `sound_tracks` in dv_proj_state).',
          },
          muted: { type: 'boolean', required: true, description: 'true mutes, false unmutes.' },
        },
        summarize: record => `${prefix(record)}${record.params['target'] === 'video' ? 'video audio' : `sound track ${shown(record.params['track'])}`} `
          + (record.params['muted'] === true ? 'muted' : 'unmuted'),
      }, execute),
    ]
  }
}
