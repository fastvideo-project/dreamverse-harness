/**
 * Geometry of one timeline in the timeline editor: which timelines a state holds, how long each clip plays after its in
 * and out points, where it starts on its video track, which clip the user sees at a given time, and the order of the
 * track rows.
 */
import type { Timeline, TimelineState, TrackKind } from '@dv/timeline/types'
import { assetLabel } from '@dv/ui-kit/canvas-nodes.ts'
import { FALLBACK_CLIP_SECONDS } from '@dv/ui-kit/timeline.ts'
import type { Asset, WireState } from '@dv/ui-kit/types.ts'

declare module '@dv/ui-kit/types.ts' { interface ComponentStates { timeline: TimelineState } }

/**
 * Whether a clip can play: `ready` when it has its asset, `rendering` while the render it waits for is pending or
 * running, `failed` when that render ended without the asset. Derived from the clip's source record, never stored.
 */
export type ClipStatus = 'ready' | 'rendering' | 'failed'

/** One clip placed on its video track, with its in and out points resolved to numbers. */
export interface PlacedClip {
  /** The clip ID, which the clip operations take in their `clip` param. */
  clip: string
  /** The asset the clip plays; null for a placeholder clip, whose render is not done. */
  assetId: string | null
  status: ClipStatus
  /** The video track that holds the clip: 0 for the top track, 视频 1. */
  track: number
  /** The recorded in point, or null when the clip starts at the asset's start. */
  rawIn: number | null
  /** The recorded out point, or null when the clip ends at the asset's end. */
  rawOut: number | null
  /** Asset time where the clip starts playing. */
  inSec: number
  /** Asset time where the clip stops playing. */
  outSec: number
  /** Length of the whole asset; for a placeholder clip, the `duration_sec` param of the render it waits for. */
  assetSeconds: number
  /** Seconds the clip plays: `outSec - inSec`. */
  seconds: number
  /** Timeline time where the clip starts playing. */
  startSec: number
  /** The image the producing record left beside the clip, used as the track thumbnail. */
  thumbnail: string | null
  stale: boolean
}

/**
 * The timelines of a state.
 * @param state - the project state.
 * @returns the timelines in creation order.
 */
export function timelinesOf(state: WireState): Timeline[] {
  return state.components.timeline?.timelines ?? []
}

/**
 * The first free timeline ID of the form `t<n>`, starting after the current count.
 * @param timelines - the existing timelines.
 * @returns the ID for a new timeline.
 */
export function nextTimelineId(timelines: Timeline[]): string {
  const taken = new Set<string>(timelines.map(timeline => timeline.id))
  let n = timelines.length + 1
  while (taken.has(`t${String(n)}`)) n += 1
  return `t${String(n)}`
}

/**
 * Place the clips of one timeline, as the reducer's `placeClips` does: each from its `start_sec`, or where the clip before
 * it on its track ends when that is later, so a render that came out longer than planned pushes the later clips of its
 * track back. A placeholder clip (no asset yet) takes its length and its status from the render record it waits for; a
 * clip whose asset length the state does not know plays `FALLBACK_CLIP_SECONDS` of it.
 * @param state - the project state, for asset durations, thumbnails, and stale marks.
 * @param timeline - the timeline, or null when the project has none.
 * @returns the clips in the order the timeline stores them, the number of video tracks (one past the highest track that
 *   holds a clip or a mute, and at least the `video` entries of `track_order`, which keep empty tracks), and the timeline
 *   time at which the last clip ends.
 */
export function placeClips(state: WireState, timeline: Timeline | null): { clips: PlacedClip[]; tracks: number; end: number } {
  const assets = new Map(state.assets.map(asset => [asset.id, asset]))
  const proj = state.components.proj
  const records = new Map(proj.records.map(record => [record.id, record]))
  const stored = timeline?.clips ?? []
  const ends = new Map<number, number>()
  const placed = new Map<string, PlacedClip>()
  for (const clip of stored.toSorted((a, b) => a.start_sec - b.start_sec)) {
    const source = clip.source === null ? undefined : records.get(clip.source.record)
    const renderSeconds = source?.params['duration_sec']
    const assetSeconds = clip.asset === null
      ? typeof renderSeconds === 'number' ? renderSeconds : FALLBACK_CLIP_SECONDS
      : assets.get(clip.asset)?.duration_sec ?? FALLBACK_CLIP_SECONDS
    const inSec = clip.in_sec ?? 0
    const outSec = clip.out_sec ?? assetSeconds
    const seconds = Math.max(0.1, outSec - inSec)
    const startSec = Math.max(clip.start_sec, ends.get(clip.track) ?? 0)
    ends.set(clip.track, startSec + seconds)
    const rendering = source === undefined || source.status === 'pending' || source.status === 'running'
    const status: ClipStatus = clip.asset !== null ? 'ready' : rendering ? 'rendering' : 'failed'
    const producerId = (clip.asset === null ? clip.source?.record : proj.created_by[clip.asset]) ?? null
    const producer = producerId === null ? undefined : records.get(producerId)
    placed.set(clip.id, {
      clip: clip.id, assetId: clip.asset, status, track: clip.track, rawIn: clip.in_sec, rawOut: clip.out_sec, inSec, outSec,
      assetSeconds, seconds, startSec, thumbnail: producer?.outputs.find(id => assets.get(id)?.mime.startsWith('image/')) ?? null,
      stale: producerId !== null && producerId in proj.stale,
    })
  }
  const clips = stored.map(clip => placed.get(clip.id) as PlacedClip)
  // The same count as the reducer's `videoTrackCount`, which a browser package cannot import.
  const tracks = Math.max(
    0, (timeline?.track_order ?? []).filter(kind => kind === 'video').length, ...clips.map(clip => clip.track + 1),
    ...[...timeline?.muted_video_tracks ?? [], ...quietedTracks(timeline?.video_track_volumes ?? [])].map(track => track + 1),
  )
  return { clips, tracks, end: Math.max(0, ...clips.map(clip => clip.startSec + clip.seconds)) }
}

/**
 * The clip the user sees and hears at a timeline time: the clip of the track with the lowest number that plays then,
 * a placeholder clip included, which shows its status there. At the end of the last clip, where the playhead stops, the
 * clip that ends there stays the one the user sees, so the preview holds its last frame.
 * @param clips - the placed clips.
 * @param position - timeline time in seconds.
 * @returns the clip, or undefined when no clip plays then.
 */
export function topClipAt(clips: readonly PlacedClip[], position: number): PlacedClip | undefined {
  const end = Math.max(0, ...clips.map(clip => clip.startSec + clip.seconds))
  const shows = (clip: PlacedClip): boolean => position >= end
    ? clip.startSec + clip.seconds >= end
    : position >= clip.startSec && position < clip.startSec + clip.seconds
  return clips.filter(shows)
    .reduce<PlacedClip | undefined>((top, clip) => top === undefined || clip.track < top.track ? clip : top, undefined)
}

/**
 * Whether the clips of the tracks with lower numbers than a clip's cover its whole span, so it never shows.
 * @param clips - the placed clips.
 * @param clip - one of them.
 * @returns true when no moment of the clip's span is free of a clip of a lower track.
 */
export function coveredAbove(clips: readonly PlacedClip[], clip: PlacedClip): boolean {
  const end = clip.startSec + clip.seconds
  let at = clip.startSec
  for (const above of clips.filter(each => each.track < clip.track).toSorted((a, b) => a.startSec - b.startSec)) {
    if (above.startSec + above.seconds <= at) continue
    if (above.startSec > at + 0.005) return false
    at = above.startSec + above.seconds
    if (at >= end - 0.005) return true
  }
  return false
}

/** The most characters of a name that a clip block shows before the `…` of a cut name. */
const CLIP_NAME_CHARS = 8

/** Splits a name into whole characters as the user reads them, so an emoji or a letter with a combining mark stays whole. */
const CHARACTERS = new Intl.Segmenter()

/**
 * A name as a clip block shows it, so a long file name does not fill the block: the first `CLIP_NAME_CHARS` characters
 * and then `…`. A name of up to one character more shows whole, since the cut would not make it shorter.
 * @param name - the name.
 * @returns the name, cut when the cut makes it shorter.
 */
export function shortName(name: string): string {
  const characters = Array.from(CHARACTERS.segment(name), part => part.segment)
  return characters.length <= CLIP_NAME_CHARS + 1 ? name : `${characters.slice(0, CLIP_NAME_CHARS).join('')}…`
}

/**
 * The clips that never show, since the clips of the tracks with lower numbers cover their whole span. The editor works
 * this out once per change of the clips, not on every frame of playback.
 * @param clips - the placed clips.
 * @returns their clip IDs.
 */
export function coveredClips(clips: readonly PlacedClip[]): ReadonlySet<string> {
  return new Set(clips.filter(clip => coveredAbove(clips, clip)).map(clip => clip.clip))
}

/** One row of the editor's track area: a video track or a sound track by its number. */
export interface TrackRow {
  kind: TrackKind
  track: number
}

/**
 * The rows of the video tracks and sound tracks, top to bottom: the stored tracks in the timeline's `track_order`, then,
 * at the bottom, any counted track the order does not list.
 * @param order - the timeline's `track_order`.
 * @param videoTracks - how many video tracks the editor shows.
 * @param soundTracks - how many sound tracks the editor shows, at least as many as the order lists.
 * @returns the rows.
 */
export function trackRows(order: readonly TrackKind[], videoTracks: number, soundTracks: number): TrackRow[] {
  const next: Record<TrackKind, number> = { video: 0, sound: 0 }
  const rows = order.map((kind): TrackRow => ({ kind, track: next[kind]++ }))
  const rest = (kind: TrackKind, count: number): TrackRow[] =>
    Array.from({ length: Math.max(0, count - next[kind]) }, (_, index) => ({ kind, track: next[kind] + index }))
  return [...rows, ...rest('video', videoTracks), ...rest('sound', soundTracks)]
}

/**
 * Where a dragged block of `seconds` starts when the pointer puts its start at `start`: when its start or its end comes
 * within `tolerance` of a target, the block moves so that this edge sits on the nearest target; otherwise it starts at
 * `start`. A snap that would put the start before 0 is skipped.
 * @param start - the start that the pointer gives, in seconds, 0 or more.
 * @param seconds - the block's length.
 * @param targets - the times an edge may snap to, such as the edges of the other blocks, the playhead, and 0.
 * @param tolerance - the largest distance, in seconds, at which an edge snaps.
 * @returns the block's start in seconds.
 */
export function snapStart(start: number, seconds: number, targets: readonly number[], tolerance: number): number {
  let best = start
  let distance = tolerance
  for (const target of targets) {
    for (const candidate of [target, target - seconds]) {
      const gap = Math.abs(candidate - start)
      if (candidate >= 0 && gap <= distance) {
        best = candidate
        distance = gap
      }
    }
  }
  return best
}

/**
 * @param volumes - track volumes in dB by track number.
 * @returns each track number that has a volume below 0 dB; such a track counts as stored, as a muted track does.
 */
export function quietedTracks(volumes: readonly number[]): number[] {
  return volumes.flatMap((volume, track) => volume === 0 ? [] : [track])
}

/**
 * The playback volume of a track volume, as `HTMLMediaElement.volume` takes it.
 * @param volumeDb - the track's volume in dB, 0 or less.
 * @returns the amplitude factor, 1 at 0 dB.
 */
export function trackGain(volumeDb: number): number {
  return 10 ** (volumeDb / 20)
}

/**
 * The playhead time after a skip, clamped to the timeline.
 * @param position - the playhead time in seconds.
 * @param seconds - the skip, negative to go back.
 * @param total - the timeline's length in seconds.
 * @returns the time in seconds, from 0 to `total`.
 */
export function skipTarget(position: number, seconds: number, total: number): number {
  return Math.max(0, Math.min(position + seconds, total))
}

/**
 * Format a time as `mm:ss.cc`: minutes padded to two digits, seconds to hundredths.
 * @param seconds - a position or duration.
 * @returns the text.
 */
export function timecode(seconds: number): string {
  // Rounding to hundredths first keeps 59.999 s from printing as `00:60.00`.
  const hundredths = Math.round(seconds * 100)
  const minutes = Math.floor(hundredths / 6000)
  const rest = (hundredths - minutes * 6000) / 100
  return `${String(minutes).padStart(2, '0')}:${rest < 10 ? '0' : ''}${rest.toFixed(2)}`
}

/**
 * The video assets of a state, newest first, for the video tracks.
 * @param state - the project state.
 * @returns the video assets.
 */
export function videoAssets(state: WireState): Asset[] {
  return assetsOfType(state, 'video/')
}

/**
 * The audio assets of a state, newest first, for the 声音 row.
 * @param state - the project state.
 * @returns the audio assets.
 */
export function audioAssets(state: WireState): Asset[] {
  return assetsOfType(state, 'audio/')
}

/**
 * @param state - the project state.
 * @param prefix - a MIME type prefix such as `video/`.
 * @returns the assets whose MIME type starts with the prefix, newest first.
 */
function assetsOfType(state: WireState, prefix: string): Asset[] {
  return state.assets.filter(asset => asset.mime.startsWith(prefix)).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** One sound placed on the 声音 row. */
export interface TrackSound {
  /** The sound ID. */
  sound: string
  /** The audio asset. */
  assetId: string
  /** The asset's file name. */
  name: string
  /** The timeline time at which the sound starts. */
  startSec: number
  /** The recorded in point, or null when the sound starts at the asset's start. */
  rawIn: number | null
  /** The recorded out point, or null when the sound ends at the asset's end. */
  rawOut: number | null
  /** Where the sound starts inside its asset, in seconds. */
  inSec: number
  /** How long the sound plays. */
  seconds: number
  /** Length of the whole asset. */
  assetSeconds: number
  /** The sound track that holds it, 0 for the first. */
  track: number
}

/**
 * Place the sounds of a timeline. A sound plays its asset from its in point to its out point; an unset out point is the
 * asset's `duration_sec`, while that is unknown the length its `<audio>` element measured, else `FALLBACK_CLIP_SECONDS`.
 * @param state - the project state.
 * @param timeline - the shown timeline.
 * @param measured - the lengths the sound elements measured, by asset.
 * @returns the sounds and the timeline time at which the last one ends.
 */
export function placeSounds(
  state: WireState, timeline: Timeline | null, measured: ReadonlyMap<string, number>,
): { sounds: TrackSound[]; end: number } {
  const assets = new Map(state.assets.map(asset => [asset.id, asset]))
  const sounds = (timeline?.sounds ?? []).map((sound) => {
    const asset = assets.get(sound.asset)
    const assetSeconds = asset?.duration_sec ?? measured.get(sound.asset) ?? FALLBACK_CLIP_SECONDS
    const inSec = sound.in_sec ?? 0
    const outSec = sound.out_sec ?? assetSeconds
    const name = asset === undefined ? sound.asset : assetLabel(state, asset)
    return {
      sound: sound.id, assetId: sound.asset, name, startSec: sound.start_sec, rawIn: sound.in_sec, rawOut: sound.out_sec, inSec,
      seconds: Math.max(0.1, outSec - inSec), assetSeconds, track: sound.track,
    }
  })
  return { sounds, end: Math.max(0, ...sounds.map(sound => sound.startSec + sound.seconds)) }
}
