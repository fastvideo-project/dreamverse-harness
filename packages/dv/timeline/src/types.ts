/**
 * Types of the Timeline component: the timeline, clip and sound shapes of its state slice, and the slice declaration
 * that adds `timeline` to the project state of `@dv/project`.
 *
 * The slice fields use snake_case because the project state goes to the browser views and the agent.
 *
 * @module @dv/timeline/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AssetId, RecordId } from '@dv/project/types'

/** The ID of a timeline, such as `t1`; the operations name it in their `timeline` param. */
export type TimelineId = Branded<'DvTimelineId'>

/**
 * The ID of a clip, such as `cl3`: unique within the project and never reused; the clip operations name a clip by it in
 * their `clip` param.
 */
export type ClipId = Branded<'DvClipId'>

/**
 * One clip of a timeline: an asset on a video track that plays from `in_sec` to `out_sec`, starting `start_sec` seconds
 * after the timeline's start. A clip whose `asset` is null is a placeholder: it waits for the render output that `source`
 * names, and takes the length that render plans until it is done.
 *
 * Every video track works the same way. Where a clip plays, it covers the clips of every track with a higher number, so
 * the user sees and hears the clip of the track with the lowest number at each time, and nothing where no clip plays.
 * The clips of one track do not overlap: a clip that the clip before it on its track runs past, as a render that came out
 * longer than planned does, starts where that clip ends instead.
 */
export interface Clip {
  id: ClipId
  /** The asset the clip plays; null until the render that `source` names is done. A clip is ready when it is not null. */
  asset: AssetId | null
  /** The render output the clip waits for or was laid out from; null for a clip of an existing asset. */
  source: { record: RecordId; output: number } | null
  /** Where playback starts inside the asset, in seconds; null for the asset's start. */
  in_sec: number | null
  /** Where playback ends inside the asset, in seconds; null for the asset's end. */
  out_sec: number | null
  /** The timeline time at which the clip starts, in seconds; 0 or more. */
  start_sec: number
  /** The video track that holds the clip: 0 for 视频 1, the top track, 1 for 视频 2, and so on. */
  track: number
}

/**
 * The ID of a sound, such as `sd2`: unique within the project and never reused. `timeline.sound_add` assigns it and
 * stores it in the record's `report.sounds`.
 */
export type SoundId = Branded<'DvSoundId'>

/**
 * One sound of a timeline's sound tracks: an audio asset that plays from `in_sec` to `out_sec`, starting `start_sec`
 * seconds after the timeline's start. Sounds may overlap each other and the clips; the clips' own audio plays under them.
 */
export interface Sound {
  id: SoundId
  /** The audio asset the sound plays. */
  asset: AssetId
  /** Where playback starts inside the asset, in seconds; null for the asset's start. */
  in_sec: number | null
  /** Where playback ends inside the asset, in seconds; null for the asset's end. */
  out_sec: number | null
  /** The timeline time at which the sound starts, in seconds; 0 or more. */
  start_sec: number
  /** The sound track that holds the sound: 0 for the first sound track, 1 for the next one, and so on. */
  track: number
}

/** The kind of a track that the user or the agent adds: a video track or a sound track. */
export type TrackKind = 'video' | 'sound'

/**
 * The status of a clip, derived from its source record and never stored: `ready` when the clip has an asset, `rendering`
 * while the source record is pending or running, `failed` when it ended without the output.
 */
export type ClipStatus = 'ready' | 'rendering' | 'failed'

/**
 * One edited video of a project: the clips of its video tracks, the sounds of its sound tracks, the order of those tracks,
 * its name, and which of its tracks are muted; an empty name shows as 时间线 {n} for ID t<n>.
 */
export interface Timeline {
  id: TimelineId
  name: string
  /** The clips of every video track, in the order they were added. */
  clips: Clip[]
  /** The numbers of the video tracks whose clips' own audio plays silent, ascending; 0 is 视频 1. */
  muted_video_tracks: number[]
  /**
   * The kinds of the video tracks and sound tracks, top to bottom, in the order they were added: the n-th `video` entry
   * is video track n and the n-th `sound` entry is sound track n. It holds one entry per stored track; an entry keeps its
   * track stored while the track is empty. A new timeline starts with `['video', 'sound']`: an empty 视频 1 and an empty
   * sound track 0.
   */
  track_order: TrackKind[]
  /** The sounds of the sound tracks, in the order they were added. */
  sounds: Sound[]
  /** The names of the sound tracks by track number; a missing or empty name shows as 声音 {n}. */
  sound_track_names: string[]
  /** The numbers of the muted sound tracks, ascending: the preview plays their sounds silent. */
  muted_sound_tracks: number[]
}

/** The Timeline component's slice: every timeline of the project, in creation order. */
export interface TimelineState {
  timelines: Timeline[]
}

declare module '@dv/project/types' {
  interface ComponentStates {
    /** The timelines of the project (Timeline). */
    timeline: TimelineState
  }
}
