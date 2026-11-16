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
 * One clip of a timeline: an asset that plays from `in_sec` to `out_sec`. A clip whose `asset` is null is a placeholder:
 * it waits for the render output that `source` names.
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
}

/**
 * The ID of a sound, such as `sd2`: unique within the project and never reused. `timeline.sound_add` assigns it and
 * stores it in the record's `report.sounds`.
 */
export type SoundId = Branded<'DvSoundId'>

/**
 * One sound of a timeline's 声音 (Sound) row: an audio asset that plays from `in_sec` to `out_sec`, starting `start_sec`
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
  /** The sound track that holds the sound: 0 for the first track under 原声, 1 for the next one, and so on. */
  track: number
}

/**
 * One clip of a video track under the 视频 track: an asset that plays from `in_sec` to `out_sec`, starting `start_sec`
 * seconds after the timeline's start. The clips of one track do not overlap. The 视频 track covers every video track
 * while it has a clip, so a track clip shows only after the 视频 track's last clip ends. There, the user sees and hears
 * the clip of the track with the lowest number, and the clips of the tracks with higher numbers stay hidden and silent.
 */
export interface TrackClip {
  id: ClipId
  /** The video asset the clip plays. */
  asset: AssetId
  /** Where playback starts inside the asset, in seconds; null for the asset's start. */
  in_sec: number | null
  /** Where playback ends inside the asset, in seconds; null for the asset's end. */
  out_sec: number | null
  /** The timeline time at which the clip starts, in seconds; 0 or more. */
  start_sec: number
  /** The video track that holds the clip: 0 for the first track added under the 视频 track, 1 for the next, and so on. */
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
 * One edited video of a project: the clips of its 视频 track in playback order, the clips of the video tracks under it,
 * the sounds of its sound tracks, the order of those tracks, its name, and which of its audio is muted; an empty name
 * shows as 时间线 {n} for ID t<n>.
 */
export interface Timeline {
  id: TimelineId
  name: string
  /** The clips of the 视频 track, which play one after another from the timeline's start. */
  clips: Clip[]
  /** The clips of the video tracks under the 视频 track, in the order they were added. */
  track_clips: TrackClip[]
  /** The numbers of the video tracks under the 视频 track whose clips play silent, ascending. */
  muted_video_tracks: number[]
  /**
   * The kinds of the video tracks and sound tracks under the 视频 track and its 原声 row, top to bottom, in the order
   * they were added: the n-th `video` entry is video track n and the n-th `sound` entry is sound track n. It holds one entry
   * per stored track. A `sound` entry keeps its sound track stored while the track is empty; a new timeline starts with
   * one, for an empty sound track 0, and has no sound track once that one is removed.
   */
  track_order: TrackKind[]
  /** The sounds of the sound tracks, in the order they were added. */
  sounds: Sound[]
  /** The names of the sound tracks by track number; a missing or empty name shows as 声音 {n}. */
  sound_track_names: string[]
  /** Whether the own audio of the 视频 track's clips is muted: the preview plays them silent, and export leaves it out. */
  video_muted: boolean
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
