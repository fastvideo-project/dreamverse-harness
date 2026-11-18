/**
 * The timeline editor: one tab per timeline of the project, a 16:9 preview that fills the free height and plays the
 * selected timeline (with skip, play, playback-speed, and full-screen controls under it), a toolbar, a ruler, the video
 * tracks with filmstrip clips sized by duration at their start times, and the sound tracks, whose sound blocks play in
 * step with the preview (`sound-playback.ts`). A video clip's own audio has no row of its own: it plays with the clip,
 * and the clip's track header mutes it. A clip, a sound and the asset lists show an asset under the name the user gave
 * its canvas node, else under the asset's own name.
 *
 * Every video track works the same way. With one video track it is 视频; with more, they are 视频 1, 视频 2, … from the
 * top. Where a track has a clip, it covers every track under it; a gap shows the track under it, and the preview shows
 * and plays the clip of the track with the lowest number at the playhead. A clip moves in time by a drag, to another
 * video track by a drag up or down, and its edges trim it; the other clips keep their times, so nothing closes a gap,
 * and the server refuses a clip that would overlap another clip of its track. A dragged clip or sound snaps when its
 * start or end comes within `SNAP_PX` of the edge of another clip or sound, the playhead, or 0 s. Each video track header mutes the own
 * audio of its clips, deletes the track, adds a video after its last clip, and its 上移 / 下移 change which track covers
 * which (`timeline.video_track_move`). Each sound track header mutes, renames or deletes its track. Beside each mute
 * button, the volume button opens a slider that sets the track's volume from `MIN_VOLUME_DB` to 0 dB, which the preview
 * plays while the slider moves and which one `timeline.volume` stores when the pointer or the key lets go. A sound moves in
 * time and to another sound track by a drag, its edges trim it, and it splits at the playhead. The preview plays muted
 * audio silent.
 *
 * Every track the toolbar's 添加轨道 menu adds, a video track or a sound track, goes at the bottom, and the rows keep the
 * order the tracks were added in (the timeline's `track_order`). Each item of the menu writes one `timeline.track_add`,
 * which stores an empty track, so a new track stays after a reload and the menu can add several in a row. A right click
 * in the track area opens a menu of what the clip, header, row or free spot under it offers, each item writing what the
 * matching button writes. A drag handle above the track area sets the track area's height, which each browser remembers.
 *
 * Every edit is one `/api/dv/operation` call of a `timeline.*` operation with `surface: 'timeline'`; the clip operations
 * name the clip by its clip ID, the sound operations name the sound by its sound ID or the sound track by its number, and
 * every edit goes after the current position of the project's history, the state the editor shows. A selected stale clip
 * offers "仍然保留", which keeps the record that made its asset (`proj.stale_accept`). A placeholder clip, whose render
 * is still running (渲染中…) or failed (渲染失败), keeps its place and its planned length on its track; it cannot be
 * trimmed or split, the preview shows its status where it covers, and export waits until every clip is ready.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, DragEvent, FocusEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, RefObject, UIEvent } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { MinVolumeDb, Timeline, TrackKind } from '@dv/timeline/types'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { assetLabel, assetLabelParts } from '@dv/ui-kit/canvas-nodes.ts'
import { mediaTypeOf } from '@dv/ui-kit/media-type.ts'
import type { DvClient } from '@dv/ui-kit/api.ts'
import { readStored, writeStored } from '@dv/ui-kit/storage.ts'
import { timelineName } from '@dv/ui-kit/timeline.ts'
import { assetIndex } from '@dv/ui-kit/state.ts'
import type { OperationRequest, WireState } from '@dv/ui-kit/types.ts'
import { DV_ASSET_DRAG_TYPE, DV_ASSET_MIME_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { useFilmstrips } from './filmstrip.ts'
import { useTimelinePlayer } from './player.ts'
import { clipPeaks, useAudioEnvelope } from '@dv/ui-kit/waveform.ts'
import { useSoundPlayback } from './sound-playback.ts'
import { clipStalled, trackClipPreload, useTrackClipPlayback } from './track-clip-playback.ts'
import {
  audioAssets, coveredClips, nextTimelineId, placeClips, placeSounds, quietedTracks, shortName, snapStart, timecode, timelinesOf,
  topClipAt, trackGain, trackRows, videoAssets,
} from './timelines.ts'
import type { PlacedClip, TrackSound } from './timelines.ts'
import type { DvTimelineKey } from './locales.ts'

/** The editor's inputs: the project it shows, the chat session it writes for, the state, and the write runner. */
export interface TimelineEditorProps {
  client: DvClient
  t: Translate<DvTimelineKey>
  project: string
  /** The chat session the editor sits beside, recorded as the `session` of the editor's writes. */
  session?: string | null
  /** The project's current state. */
  state: WireState
  /** Run one write and refetch the state; resolves to whether the write succeeded. */
  run: (work: () => Promise<unknown>) => Promise<boolean>
  /**
   * The selected timeline of the project, or null before one is selected. The editor shows the project's first timeline
   * while the selection names none or a timeline that the project lost.
   */
  selected: string | null
  /** Select the timeline that the user picked or created, or the one shown before a create that failed. */
  select: (timelineId: string | null) => void
  /** The clip that the editor selects and seeks to once it shows the clip's timeline, or null. */
  clipFocus?: { timelineId: string; clipId: string } | null
  /** Drop {@link TimelineEditorProps.clipFocus} once the editor took it. */
  takeClipFocus?: () => void
  /**
   * Draw the editor inside a canvas card instead of a panel: no timeline tabs and no track-area resize, the track area
   * fills the editor, the preview renders into `viewer` (none while it is null), centered on it and `previewWidth` wide
   * (default: as wide as `viewer`), with the first ready clip's aspect ratio and a progress bar that a press moves the
   * playhead along, the editor and the preview draw everything `scale` times larger (default 1) while still filling
   * their boxes, so their text grows with the node, the menus open inside the editor, and
   * pointer positions are divided by the canvas zoom that scales the editor; the toolbar ends with 打开编辑器 / Open
   * editor, which calls `open`. The editor marks its root `data-node-keys`, its ruler, clips, sounds and sound track
   * headers `data-node-interactive`, so the canvas leaves their keys and presses to it and moves the node on a press
   * anywhere else; the track area scrolls both ways without a scrollbar, by wheel or touchpad. Absent for the panel of the 时间线 tab and
   * center view.
   */
  card?: { viewer: HTMLElement | null; open: () => void; previewWidth?: number; scale?: number }
}

/** The fields of an operation request a gesture fills in. */
export type Gesture = Omit<OperationRequest, 'project' | 'surface' | 'session'>

/**
 * The operation request of one gesture.
 * @param project - the project.
 * @param session - the chat session the editor sits beside, recorded as the record's `session`; null for none.
 * @param gesture - the operation, inputs, params, and intent.
 * @returns the request body.
 */
export function request(project: string, session: string | null, gesture: Gesture): OperationRequest {
  return { project, surface: 'timeline', ...session === null ? {} : { session }, ...gesture }
}

/** An edge or body drag on a clip or a sound, in progress; a body drag also moves up or down, to another track of its kind. */
interface BlockDrag {
  kind: 'move' | 'trimStart' | 'trimEnd'
  /** The dragged clip's clip ID or the dragged sound's sound ID. */
  id: string
  startX: number
  startY: number
  dx: number
  dy: number
}

/**
 * What a right click in the track area opened its menu on: a sound, a clip, a video track header, a sound track header,
 * or a free spot of a video or sound lane at a time in seconds, with the point on screen where the click landed.
 */
type TrackMenu =
  | { kind: 'sound'; sound: TrackSound }
  | { kind: 'clip'; clip: PlacedClip }
  | { kind: 'videoTrack'; track: number }
  | { kind: 'soundTrack'; track: number }
  | { kind: 'videoLane'; track: number; atSec: number; clientX: number; clientY: number }
  | { kind: 'soundLane'; track: number; atSec: number; clientX: number; clientY: number }

/** The widest the asset picker and the sound dialog usually draw, in pixels; they open that far from the area's right edge. */
const PICKER_WIDTH = 220

/** Width of the track-header column, in pixels; it holds a track's name and, under it, the track's buttons. */
const GUTTER = 144
/** Default zoom, in pixels per second. */
const DEFAULT_PX = 40
/** Height of the ruler, in pixels. */
const RULER_HEIGHT = 26
/**
 * Height of each video track and each sound track, in pixels; their headers hold the track's name with its buttons on a
 * second line under it.
 */
const ROW_HEIGHT = 56
/** Height of the file-name strip at the top of a sound block, in pixels. */
const SOUND_NAME_HEIGHT = 14
/** Vertical gap between the rows of the track area, in pixels. */
const ROW_GAP = 6
/** Bottom padding of the scrolling track rows, in pixels; it keeps the horizontal scrollbar off the audio track. */
const TRACK_PADDING = 14
/** Milliseconds the track area's scrollbars stay shown after its last scroll. */
const SCROLLBAR_HIDE_MS = 800
/** The smallest preview height the track-area drag handle leaves, in pixels. */
const MIN_PREVIEW_HEIGHT = 160
/** Pixels one ArrowUp or ArrowDown press on the focused drag handle adds to or takes from the track area. */
const RESIZE_STEP = 16
/** `localStorage` key of the track area's height in pixels, remembered per browser. */
const TRACK_HEIGHT_KEY = 'dv-timeline-track-height'
/** Pixels within which the start or end of a dragged clip or sound snaps to another block's edge, the playhead, or 0 s. */
const SNAP_PX = 8
/** The lowest track volume, in dB, that `timeline.volume` takes; 0 dB plays the audio as recorded. */
const MIN_VOLUME_DB: MinVolumeDb = -40
/** Pixels a pointer may move from its press before the press counts as a drag, and sideways before a drag moves a block in time. */
const DRAG_PX = 3

/**
 * The open volume slider of a track: the volume it shows while the user moves it, and the volume it last wrote or found
 * stored when it opened.
 */
interface VolumeSlider {
  kind: 'video' | 'sound'
  track: number
  db: number
  written: number
}
/** Seconds the skip-back and skip-forward buttons (and J, L, Shift+←, Shift+→) move the playhead. */
const SKIP_SECONDS = 5
/** Playback speeds the speed button cycles through. */
const PLAYBACK_RATES = [0.5, 1, 1.5, 2] as const
/** `sessionStorage` key of the playback speed, kept for the browser tab's session. */
const PLAYBACK_RATE_KEY = 'dv-timeline-playback-rate'
/** Width of one waveform bar and of the gap after it, in pixels. */
const WAVE_BAR = 2
const WAVE_GAP = 1

// The editor reads the DreamVerse theme variables that `@dv/ui-shell` defines for the light and the dark theme.
const palette = {
  bg: 'var(--dv-bg)',
  panel: 'var(--dv-surface-1)',
  fill: 'var(--dv-surface-3)',
  line: 'var(--dv-line)',
  lineStrong: 'var(--dv-line-strong)',
  fg: 'var(--dv-text)',
  muted: 'var(--dv-text-2)',
  accent: 'var(--dv-accent)',
  accentFg: 'var(--dv-accent-text)',
  danger: 'var(--dv-danger)',
  dangerSoft: 'var(--dv-danger-soft)',
  take: 'var(--dv-node-3)',
  audio: 'var(--dv-waveform)',
  audioSoft: 'var(--dv-waveform-soft)',
  /** The 声音 row's dot and block top bar: the canvas audio color. */
  sound: 'var(--dv-node-8)',
  media: 'var(--dv-media-bg)',
  mono: 'var(--dv-font-mono)',
}

// Hover fills, focus rings, and the trim-handle highlight need pseudo-classes, which inline styles cannot express. A
// `.dv-tl-btn` element gets its transparent fill here, so its inline style must not set `background`.
const EDITOR_CSS = `
.dv-tl-editor .dv-tl-no-scrollbar { scrollbar-width: none; }
.dv-tl-editor .dv-tl-no-scrollbar::-webkit-scrollbar { display: none; }
.dv-tl-editor .dv-tl-autohide-scrollbar { scrollbar-width: thin; scrollbar-color: transparent transparent; }
.dv-tl-editor .dv-tl-autohide-scrollbar[data-scrolling] { scrollbar-color: var(--dv-line-strong) transparent; }
.dv-tl-editor .dv-tl-autohide-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
.dv-tl-editor .dv-tl-autohide-scrollbar::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; }
.dv-tl-editor .dv-tl-autohide-scrollbar[data-scrolling]::-webkit-scrollbar-thumb { background: var(--dv-line-strong); }
.dv-tl-editor .dv-tl-btn { background: transparent; transition: background-color 120ms var(--dv-ease); }
.dv-tl-editor .dv-tl-btn:not(:disabled):hover { background: var(--dv-surface-3); }
.dv-tl-editor :focus-visible { outline: 2px solid var(--dv-accent); outline-offset: 1px; }
.dv-tl-editor .dv-tl-trim { background: var(--dv-line-strong); transition: background-color 120ms var(--dv-ease); }
.dv-tl-editor .dv-tl-trim:hover { background: var(--dv-accent); }
.dv-tl-editor input[type="range"] { accent-color: var(--dv-accent); }
.dv-tl-editor .dv-tl-resize { background: var(--dv-line); transition: background-color 120ms var(--dv-ease); }
.dv-tl-editor .dv-tl-resize::before { content: ""; position: absolute; left: 0; right: 0; top: -4px; bottom: -4px; }
.dv-tl-editor .dv-tl-resize:hover, .dv-tl-editor .dv-tl-resize[data-dragging="true"] { background: var(--dv-accent); }
@media (prefers-reduced-motion: reduce) {
  .dv-tl-editor .dv-tl-btn, .dv-tl-editor .dv-tl-trim, .dv-tl-editor .dv-tl-resize { transition: none; }
}
`

/** A secondary button: 28 px high with a 1 px border; pair it with the `dv-tl-btn` class for its fill. */
const button: CSSProperties = {
  boxSizing: 'border-box', height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6,
  color: palette.fg, border: `1px solid ${palette.lineStrong}`, borderRadius: 'var(--dv-radius-md)', font: 'inherit', fontSize: 13, lineHeight: '20px', cursor: 'pointer',
}
/** A 32 px icon-only button with no border. */
const iconButton: CSSProperties = { width: 32, height: 32, padding: 0, justifyContent: 'center', border: 'none', color: palette.muted }
/** A text-only button. */
const textButton: CSSProperties = { border: 'none', color: palette.muted }
/** A full-width row of a menu or a picker list. */
const menuItem: CSSProperties = { ...button, border: 'none', display: 'flex', width: '100%', textAlign: 'left' }
/** The box of the toolbar's track menu and track layer list, opening under their buttons over the track area. */
const toolPopoverStyle: CSSProperties = {
  position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 20, minWidth: 160, padding: 6, background: palette.panel,
  border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-xl)', boxShadow: 'var(--dv-shadow-2)',
}
/** A one-line note centered over the preview frame. */
const viewerNote: CSSProperties = {
  position: 'absolute', inset: 0, margin: 'auto', height: 20, padding: '0 16px', textAlign: 'center', color: palette.muted,
}

/**
 * A toolbar button style that looks inactive when the button is disabled.
 * @param disabled - whether the button is disabled.
 * @param extra - style overrides.
 * @returns the style.
 */
function buttonStyle(disabled: boolean, extra: CSSProperties = {}): CSSProperties {
  return { ...button, ...extra, ...disabled ? { opacity: 0.4, cursor: 'default' } : {} }
}

/** Stroke paths of the editor's 16 px icons, in a 24-unit box. */
const ICON_PATHS = {
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  split: 'M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  delete: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  skipBack: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  skipForward: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  export: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  add: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6 6 18',
  sound: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  soundOff: 'M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
  music: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  layers: 'M12 3 2 8l10 5 10-5zM2 16l10 5 10-5M2 12l10 5 10-5',
  volume: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4',
  up: 'm18 15-6-6-6 6',
  down: 'm6 9 6 6 6-6',
}

/** The opacity of the blocks of a muted track. */
const MUTED_OPACITY = 0.45

/**
 * A 24 px icon button of a track header. A double click on it does not reach the header, which opens the rename box.
 * @param props - the icon, the label, whether a toggle is on (omitted for a plain button), whether the dialog it opens is
 * open (omitted for a button that opens none), and the click handler; a null handler disables the button.
 * @returns the element.
 */
function TrackButton({ icon, label, pressed, expanded, onClick }: {
  icon: keyof typeof ICON_PATHS
  label: string
  pressed?: boolean
  expanded?: boolean
  onClick: ((event: MouseEvent<HTMLButtonElement>) => void) | null
}): ReactNode {
  return (
    <button
      type="button" className="dv-tl-btn" aria-label={label} title={label} aria-pressed={pressed} aria-expanded={expanded} disabled={onClick === null}
      onClick={onClick ?? undefined} onDoubleClick={(event) => { event.stopPropagation() }}
      style={{ ...buttonStyle(onClick === null, iconButton), flex: 'none', width: 24, height: 24, ...pressed === true ? { color: palette.fg } : {} }}
    >
      <Icon name={icon} />
    </button>
  )
}

/**
 * A 16 px stroke icon in the current text color.
 * @param props - the icon's name.
 * @returns the element.
 */
function Icon({ name }: { name: keyof typeof ICON_PATHS }): ReactNode {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}

/**
 * An icon-only toolbar button; its label is both the accessible name and the hover tooltip.
 * @param props - the icon, the label, and the click handler; a null handler disables the button.
 * @returns the element.
 */
function IconButton(
  { icon, label, onClick }: { icon: keyof typeof ICON_PATHS; label: string; onClick: (() => void) | null },
): ReactNode {
  const disabled = onClick === null
  return (
    <button type="button" className="dv-tl-btn" aria-label={label} title={label} disabled={disabled} onClick={onClick ?? undefined} style={buttonStyle(disabled, iconButton)}>
      <Icon name={icon} />
    </button>
  )
}

/**
 * Close an open popover when a pointerdown lands outside all of the given elements. The listener runs in the capture
 * phase, so a press on a clip, a trim handle, or another surface that stops the event's propagation still closes it.
 * @param open - whether the popover is showing; false detaches the listener.
 * @param inside - the elements where a press keeps the popover open.
 * @param close - called on a press outside every element in `inside`; the listener keeps the `inside` and `close` of
 * the render that opened the popover, so both use only refs and state setters.
 */
function useDismissOnOutsidePress(open: boolean, inside: ReadonlyArray<RefObject<HTMLElement | null>>, close: () => void): void {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: globalThis.PointerEvent): void => {
      const { target } = event
      if (target instanceof Node && inside.some(ref => ref.current?.contains(target) === true)) return
      close()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => { window.removeEventListener('pointerdown', onPointerDown, true) }
  }, [open])
}

/**
 * The track area's height after a resize: the requested height, lowered so the preview keeps at least
 * `MIN_PREVIEW_HEIGHT`, and raised to the height the toolbar, the ruler and the first track row need. The track area's minimum
 * wins when the editor is too short for both.
 * @param requested - the height the drag or key press asks for, in pixels.
 * @param available - the height the preview and the track area share, in pixels.
 * @param minTrack - the height the toolbar, the ruler and the first track row need, in pixels.
 * @returns the height to apply, in pixels.
 */
export function clampTrackHeight(requested: number, available: number, minTrack: number): number {
  return Math.round(Math.max(minTrack, Math.min(requested, available - MIN_PREVIEW_HEIGHT)))
}

/**
 * The track area's height this browser remembers.
 * @returns the height in pixels, or null when none is stored or storage is unavailable.
 */
function readTrackHeight(): number | null {
  const stored = Number(readStored('local', TRACK_HEIGHT_KEY))
  return Number.isFinite(stored) && stored > 0 ? stored : null
}

/**
 * Remember the track area's height in this browser.
 * @param height - the height in pixels.
 */
function storeTrackHeight(height: number): void {
  writeStored('local', TRACK_HEIGHT_KEY, String(height))
}

/**
 * The playback speed of this browser tab's session.
 * @returns a speed of `PLAYBACK_RATES`; 1 when none is stored or storage is unavailable.
 */
function readPlaybackRate(): number {
  const stored = Number(readStored('session', PLAYBACK_RATE_KEY))
  return PLAYBACK_RATES.find(rate => rate === stored) ?? 1
}

/**
 * Keep the playback speed for this browser tab's session.
 * @param rate - the speed.
 */
function storePlaybackRate(rate: number): void {
  writeStored('session', PLAYBACK_RATE_KEY, String(rate))
}

/**
 * The waveform of one sound block: one bar per `WAVE_BAR + WAVE_GAP` pixels of the block's width, each the peak of the
 * sound's audio over that slice of its played range. It draws nothing while the audio decodes or when the
 * asset has no decodable audio, so the block stays plain.
 * @param props - the clip's asset, its in and out points, and its width and height in pixels.
 * @returns the element, or null.
 */
// Memoized, because playback re-renders the editor on every animation frame while a waveform depends only on its clip.
const AudioWaveform = memo(function AudioWaveform(
  { assetId, inSec, outSec, width, height }: { assetId: string; inSec: number; outSec: number; width: number; height: number },
): ReactNode {
  const envelope = useAudioEnvelope(assetId)
  const bars = Math.max(1, Math.floor(width / (WAVE_BAR + WAVE_GAP)))
  // Bars are mirrored around the middle and at least 1 px tall, so a silent stretch still shows a center line.
  const path = useMemo(() => envelope === null ? null : clipPeaks(envelope, inSec, outSec, bars).map((peak, bar) => {
    const barHeight = Math.max(1, peak * (height - 4))
    return `M${String(bar * (WAVE_BAR + WAVE_GAP))} ${String((height - barHeight) / 2)}h${String(WAVE_BAR)}v${String(barHeight)}h-${String(WAVE_BAR)}z`
  }).join(''), [envelope, inSec, outSec, bars, height])
  if (path === null) return null
  return (
    <svg
      data-testid="dv-timeline-waveform" viewBox={`0 0 ${String(bars * (WAVE_BAR + WAVE_GAP))} ${String(height)}`} preserveAspectRatio="none" aria-hidden
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      <path d={path} fill={palette.audio} />
    </svg>
  )
})

/**
 * The clip the user selected: its timeline and its clip ID, so neither an edit elsewhere nor a timeline switch can move
 * the selection onto another clip, and a placeholder clip stays selected when its render finishes.
 */
interface SelectedClip {
  timelineId: string | null
  clip: string
}

/**
 * Capture the pointer on the event's element so moves outside it still arrive.
 * @param event - the pointer-down event.
 */
function capture(event: PointerEvent<HTMLElement>): void {
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
  } catch (error: unknown) {
    // jsdom has no pointer capture; the drag then only follows moves over the element.
    void error
  }
}

/**
 * Round a time to hundredths of a second for recorded params.
 * @param seconds - the time.
 * @returns the rounded time.
 */
function round(seconds: number): number {
  return Math.round(seconds * 100) / 100
}

/**
 * The ruler's steps for a zoom level. Labels need no step above 10 s: at the narrowest zoom (5 px per second), 10 s
 * labels sit 50 px apart, past the 48 px minimum.
 * @param px - pixels per second, from 5 to 200.
 * @returns seconds between ticks and seconds between labels.
 */
function rulerSteps(px: number): { tick: number; label: number } {
  return { tick: px >= 8 ? 1 : 5, label: 5 * px >= 48 ? 5 : 10 }
}

/**
 * The timeline editor.
 * @param props - the client, copy, project, state, and write runner.
 * @returns the element.
 */
export function TimelineEditor(props: TimelineEditorProps): ReactNode {
  const { client, t, project, session = null, state, run, selected: activeId, select, clipFocus = null, takeClipFocus, card } = props
  const timelines = useMemo(() => timelinesOf(state), [state])
  const timeline = timelines.find(entry => entry.id === activeId) ?? timelines[0] ?? null
  const placed = useMemo(() => placeClips(state, timeline), [state, timeline])
  const { clips, end: videoSpan } = placed
  const covered = useMemo(() => coveredClips(clips), [clips])
  const assets = useMemo(() => assetIndex(state), [state])
  // The name each asset shows: the name of its canvas node when the user gave one, else the asset's own name. An
  // asset that the project no longer has shows its ID.
  const labels = useMemo(() => new Map(state.assets.map(asset => [asset.id, assetLabel(state, asset)])), [state])
  const labelOf = (id: string): string => labels.get(id) ?? id
  // The name a clip block shows: each part of the asset's name cut short on its own, so the block of an earlier take
  // of a named node still shows the start of the take's own name after the node's.
  const shortLabels = useMemo(
    () => new Map(state.assets.map(asset => [asset.id, assetLabelParts(state, asset).map(shortName).join(' · ')])), [state],
  )
  // Every ready clip shows its video's frames across its width once they are read (`clipPicture`).
  const videoUrls = [...new Set(clips.flatMap(clip => clip.assetId === null ? [] : [assetUrl(clip.assetId)]))]
  const strips = useFilmstrips(videoUrls)
  const candidates = useMemo(() => videoAssets(state), [state])
  const audioCandidates = useMemo(() => audioAssets(state), [state])
  // The lengths that the sound elements measured, for audio assets whose length the state does not know.
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(new Map())
  const { sounds, end: soundsEnd } = useMemo(() => placeSounds(state, timeline, measured), [state, timeline, measured])
  // The preview plays to the end of the last clip; the lanes also reach the last sound.
  const span = Math.max(videoSpan, soundsEnd)
  const timelineId = timeline?.id ?? null
  const [playbackRate, setPlaybackRate] = useState(readPlaybackRate)
  const frame = useRef<HTMLDivElement | null>(null)
  // Playback waits while the clip the user sees is still loading, so the playhead does not run ahead of the picture.
  const shownClip = useRef<string | null>(null)
  const player = useTimelinePlayer(timelineId, videoSpan, playbackRate, () => shownClip.current !== null
    && clipStalled(frame.current?.querySelector<HTMLVideoElement>(`video[data-track-clip="${shownClip.current}"]`)))
  // The clip the user sees and hears at the playhead: the clip of the track with the lowest number that plays there.
  const topClip = topClipAt(clips, player.position)
  shownClip.current = topClip?.clip ?? null
  // A card's preview mounts its video elements when the node is selected; they show the frame at the playhead then.
  const cardScale = card?.scale ?? 1
  // A press on the card preview's progress bar moves the playhead to the same share of the timeline.
  const seekAlong = (event: PointerEvent<HTMLElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    player.seek((event.clientX - box.left) / Math.max(box.width, 1) * videoSpan)
  }
  // In a card, the elements that take their own presses carry the canvas's marks; a press anywhere else moves the node.
  const owned = card === undefined ? {} : { 'data-node-interactive': '' }
  // The track whose volume slider is open, with the volume the slider shows while the user moves it and the volume it
  // last wrote or found stored when it opened, which a write compares with because the stored state arrives later.
  const [volumeSlider, setVolumeSlider] = useState<VolumeSlider | null>(null)
  const volumeRef = useRef<HTMLDivElement | null>(null)
  const volumeButton = useRef<HTMLButtonElement | null>(null)
  useDismissOnOutsidePress(volumeSlider !== null, [volumeRef, volumeButton], () => { setVolumeSlider(null) })
  /**
   * @param kind - a video track or a sound track.
   * @param track - its number.
   * @returns its volume in dB: the open slider's while it is this track's, else the stored one.
   */
  const volumeDb = (kind: 'video' | 'sound', track: number): number => volumeSlider?.kind === kind && volumeSlider.track === track
    ? volumeSlider.db
    : (kind === 'video' ? timeline?.video_track_volumes : timeline?.sound_track_volumes)?.[track] ?? 0
  const soundBox = useRef<HTMLDivElement | null>(null)
  // The preview plays each track at its volume, and at the slider's while the user moves it.
  useTrackClipPlayback(
    frame, clips, player.position, player.playing, playbackRate, topClip?.clip ?? null, track => trackGain(volumeDb('video', track)),
  )
  const mutedVideoTracks = timeline?.muted_video_tracks ?? []
  // The kinds of the stored tracks, top to bottom; without a timeline, one video track and one sound track.
  const trackOrder = timeline?.track_order ?? ['video', 'sound']
  const videoTrackCount = Math.max(placed.tracks, trackOrder.filter(kind => kind === 'video').length)
  // One video track is 视频; with more, they are 视频 1, 视频 2, … from the top.
  const videoTrackName = (track: number): string => videoTrackCount <= 1 ? t('track.video') : t('track.videoN', { n: track + 1 })
  const [trackDrag, setTrackDrag] = useState<BlockDrag | null>(null)
  const [soundDrag, setSoundDrag] = useState<BlockDrag | null>(null)
  // The video track the asset picker adds to.
  const [pickTrack, setPickTrack] = useState(0)
  // The time a lane's right-click menu chose for the asset picker or the sound dialog to add at; null adds after the
  // track's last clip or sound, as its ＋ does.
  const [pickAt, setPickAt] = useState<number | null>(null)
  const [pickingSound, setPickingSound] = useState(false)
  const upload = useRef<HTMLInputElement | null>(null)
  const soundPickerRef = useRef<HTMLDivElement | null>(null)
  // The sound track ＋ that opened the sound dialog; each track has its own ＋.
  const soundAddRef = useRef<HTMLButtonElement | null>(null)
  // Sound tracks: the tracks the timeline stores, up to the last track with a sound, a name, a mute, or a volume below
  // 0 dB, and the empty tracks `track_order` lists; the same count as the reducer's `soundTrackCount`.
  const trackNames = timeline?.sound_track_names ?? []
  const mutedTracks = timeline?.muted_sound_tracks ?? []
  const trackCount = Math.max(
    trackNames.length, ...sounds.map(sound => sound.track + 1),
    ...[...mutedTracks, ...quietedTracks(timeline?.sound_track_volumes ?? [])].map(track => track + 1),
    trackOrder.filter(kind => kind === 'sound').length,
  )
  const trackName = (track: number): string => trackNames[track] || t('track.soundN', { n: track + 1 })
  useSoundPlayback(
    soundBox, sounds, player.position, player.playing, playbackRate,
    Array.from({ length: trackCount }, (_, track) => trackGain(volumeDb('sound', track))),
  )
  const [renamingTrack, setRenamingTrack] = useState<{ track: number; name: string } | null>(null)
  // The rows top to bottom, and the top of each in pixels from the first row's top.
  const shownRows = trackRows(trackOrder, videoTrackCount, trackCount)
  const rowTops = shownRows.map((row, index) => ({ ...row, top: index * (ROW_HEIGHT + ROW_GAP) }))
  const videoRowTops = rowTops.filter(row => row.kind === 'video')
  const soundRowTops = rowTops.filter(row => row.kind === 'sound')
  /**
   * The row of a kind nearest where a vertical drag puts a block's row; on a tie, the one in the drag's direction.
   * @param tops - the rows the block may end on, with their tops.
   * @param track - the dragged block's row.
   * @param dy - the pixels the drag moved, negative upward.
   * @returns the nearest row.
   */
  const nearestRow = <T,>(tops: ReadonlyArray<{ track: T; top: number }>, track: T, dy: number): T => {
    const target = (tops.find(row => row.track === track) as { top: number }).top + dy
    const gap = (row: { top: number }): number => Math.abs(row.top - target)
    const nearer = (row: { top: number }, best: { top: number }): boolean => dy > 0 ? gap(row) <= gap(best) : gap(row) < gap(best)
    return tops.reduce((best, row) => nearer(row, best) ? row : best).track
  }
  // A clip ends on a video track's row, and a sound on a sound track's.
  const nearestVideoRow = (track: number, dy: number): number => nearestRow(videoRowTops, track, dy)
  const nearestSoundTrack = (track: number, dy: number): number => nearestRow(soundRowTops, track, dy)
  // The track the add dialog adds to, the selected sound, and the open right-click menu of the track area.
  const [soundTrack, setSoundTrack] = useState(0)
  const [chosenSound, setChosenSound] = useState<string | null>(null)
  const selectedSound = sounds.find(sound => sound.sound === chosenSound)
  const [trackMenu, setTrackMenu] = useState<{ on: TrackMenu; x: number; y: number } | null>(null)
  // Where the asset picker or the sound dialog opens in the area under the toolbar: beside the ＋ that opened it, or at the
  // point where a lane menu was opened. From a point in the area's lower half it opens upward, so it stays in view.
  const [pickAnchor, setPickAnchor] = useState<{ left: number; edge: 'top' | 'bottom'; offset: number }>({ left: 8, edge: 'top', offset: 8 })
  const pickArea = useRef<HTMLDivElement | null>(null)
  const trackMenuRef = useRef<HTMLDivElement | null>(null)
  const cycleRate = (): void => {
    const next = PLAYBACK_RATES.find(rate => rate > playbackRate) ?? PLAYBACK_RATES[0]
    setPlaybackRate(next)
    storePlaybackRate(next)
  }
  const [px, setPx] = useState(DEFAULT_PX)
  const [chosenClip, setChosenClip] = useState<SelectedClip | null>(null)
  const selectedClip = chosenClip?.timelineId === timelineId ? clips.find(clip => clip.clip === chosenClip.clip) : undefined
  const chooseClip = (clip: string): void => {
    setChosenSound(null)
    setChosenClip({ timelineId, clip })
  }
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [menu, setMenu] = useState<{ entry: Timeline; x: number; y: number } | null>(null)
  // The toolbar's 添加轨道 / Add track menu and 轨道层级 / Track layers list, each with its button.
  const [toolPopover, setToolPopover] = useState<'add' | 'layers' | null>(null)
  const toolPopoverRef = useRef<HTMLDivElement | null>(null)
  const toolButtons = useRef<HTMLSpanElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  // The notice of the latest drop the editor refused: a file, a non-video asset on the video track, or a non-audio asset
  // on a sound track. Each refusal sets a new object, so a repeated refusal restarts the notice's timer.
  const [dropNotice, setDropNotice] = useState<{ text: 'track.fileDrop' | 'track.videoDrop' | 'track.soundDrop' } | null>(null)
  const [picking, setPicking] = useState(false)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const addRef = useRef<HTMLButtonElement | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  // The editor's track area shows its scrollbars while it scrolls and for `SCROLLBAR_HIDE_MS` after; the attribute is
  // set on the element directly, so a scroll does not render the editor again.
  const scrollbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (scrollbarTimer.current !== null) clearTimeout(scrollbarTimer.current) }, [])
  const showScrollbars = (element: HTMLDivElement): void => {
    element.setAttribute('data-scrolling', '')
    if (scrollbarTimer.current !== null) clearTimeout(scrollbarTimer.current)
    scrollbarTimer.current = setTimeout(() => { element.removeAttribute('data-scrolling') }, SCROLLBAR_HIDE_MS)
  }
  const lane = useRef<HTMLDivElement | null>(null)
  const scrubbing = useRef(false)
  const root = useRef<HTMLDivElement | null>(null)
  // A transform, such as the canvas zoom around a card, scales the editor on screen; pointer distances are divided by it.
  const screenScale = (): number => {
    const element = root.current as HTMLDivElement
    return element.offsetWidth > 0 ? element.getBoundingClientRect().width / element.offsetWidth : 1
  }
  // Where a menu opens for a right click: at the pointer on screen in the panel, inside the editor in a card, where an
  // ancestor's transform would misplace a fixed menu.
  const menuPoint = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    if (card === undefined) return { x: event.clientX, y: event.clientY }
    const box = (root.current as HTMLDivElement).getBoundingClientRect()
    const scale = screenScale()
    return { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale }
  }
  const viewerBox = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const rows = useRef<HTMLDivElement | null>(null)
  // The track area's height in pixels; null keeps its natural height.
  const [trackHeight, setTrackHeight] = useState<number | null>(readTrackHeight)
  // A track-area drag: where it started and the resize bounds, read once when it starts.
  const [resizing, setResizing] = useState<
    { startY: number; startHeight: number; bounds: { available: number; minTrack: number } | null } | null
  >(null)

  // The clip selection, the asset picker, the tab menu, the rename box, and the export link belong to one timeline.
  useEffect(() => {
    setChosenClip(null); setPicking(false); setPickingSound(false); setExported(null); setMenu(null); setRenaming(null)
    setChosenSound(null); setTrackMenu(null); setRenamingTrack(null)
    setPickTrack(0); setPickAt(null); setToolPopover(null); setVolumeSlider(null)
  }, [timelineId])

  useEffect(() => {
    if (clipFocus === null || clipFocus.timelineId !== timelineId) return
    takeClipFocus?.()
    const clip = clips.find(each => each.clip === clipFocus.clipId)
    if (clip === undefined) return
    chooseClip(clip.clip)
    player.seek(clip.startSec)
  }, [clipFocus, timelineId, clips])

  // The drop notice disappears after a few seconds.
  useEffect(() => {
    if (dropNotice === null) return
    const timer = setTimeout(() => { setDropNotice(null) }, 4000)
    return () => { clearTimeout(timer) }
  }, [dropNotice])

  // A press outside the tab menu or Escape closes it.
  useDismissOnOutsidePress(menu !== null, [menuRef], () => { setMenu(null) })
  // A press outside the toolbar's track menu or layer list and its buttons, or Escape, closes it.
  useDismissOnOutsidePress(toolPopover !== null, [toolPopoverRef, toolButtons], () => { setToolPopover(null) })
  useEffect(() => {
    if (toolPopover === null) return
    const close = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) setToolPopover(null)
    }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close) }
  }, [toolPopover])
  useEffect(() => {
    if (menu === null) return
    const close = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) setMenu(null)
    }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close) }
  }, [menu])
  // The same for the track area's right-click menu.
  useEffect(() => {
    if (trackMenu === null) return
    const close = (event: Event): void => {
      const inside = event.target instanceof Node && trackMenuRef.current?.contains(event.target) === true
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !inside) setTrackMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close) }
  }, [trackMenu])

  // Closing the asset picker from its close button or Escape returns focus to the ＋ that opened it, or to the editor
  // when a right-click menu opened it.
  const closePicker = (): void => {
    setPicking(false)
    ;(addRef.current ?? root.current)?.focus()
  }
  // ＋ counts as part of the picker for presses, focus, and Escape.
  const inPicker = (node: Node): boolean => [pickerRef, addRef].some(ref => ref.current?.contains(node) === true)
  // Focus that leaves the picker and ＋ closes the picker. A press on a part of the picker that cannot take focus moves
  // focus to an element that contains the picker, which keeps it open.
  const closeOnFocusOut = (event: FocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget
    if (picking && next instanceof Node && !inPicker(next) && !next.contains(pickerRef.current)) setPicking(false)
    if (pickingSound && next instanceof Node && !inSoundPicker(next) && !next.contains(soundPickerRef.current)) setPickingSound(false)
  }
  // A press outside the asset picker closes it without inserting. A press on ＋ counts as inside, so its click toggles
  // the picker closed instead of reopening it.
  useDismissOnOutsidePress(picking, [pickerRef, addRef], () => { setPicking(false) })
  // The open picker takes focus. Escape closes it only while focus is in the picker, on ＋, or on an element that
  // contains the picker, such as the editor after a press on the picker's title, and never during IME composition. The
  // capture-phase listener consumes that Escape, so the tab menu and outer dialogs stay open.
  useEffect(() => {
    if (!picking) return
    // The first button is the close button; focus the first asset when the picker lists one.
    const buttons = pickerRef.current?.querySelectorAll('button')
    const first = buttons?.[1] ?? buttons?.[0]
    first?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return
      const focused = document.activeElement
      const owned = focused === null || inPicker(focused) || focused.contains(pickerRef.current)
      if (!owned) return
      event.preventDefault()
      event.stopPropagation()
      closePicker()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [picking])

  // The sound dialog closes the same way as the asset picker: its close button, Escape, a press outside it, or focus
  // that leaves it and its ＋. Closing it from the close button or Escape returns focus to that ＋.
  const closeSoundPicker = (): void => {
    setPickingSound(false)
    ;(soundAddRef.current ?? root.current)?.focus()
  }
  const inSoundPicker = (node: Node): boolean => [soundPickerRef, soundAddRef].some(ref => ref.current?.contains(node) === true)
  useDismissOnOutsidePress(pickingSound, [soundPickerRef, soundAddRef], () => { setPickingSound(false) })
  useEffect(() => {
    if (!pickingSound) return
    soundPickerRef.current?.querySelectorAll('button')[1]?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return
      const focused = document.activeElement
      const owned = focused === null || inSoundPicker(focused) || focused.contains(soundPickerRef.current)
      if (!owned) return
      event.preventDefault()
      event.stopPropagation()
      closeSoundPicker()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [pickingSound])

  // The open volume slider takes focus. Escape closes it while focus is in it or on its button, and returns focus to
  // the button.
  const volumeOpen = volumeSlider === null ? null : `${volumeSlider.kind} ${String(volumeSlider.track)}`
  useEffect(() => {
    if (volumeOpen === null) return
    volumeRef.current?.querySelector('input')?.focus()
    const owned = (focused: Element | null): boolean => [volumeRef, volumeButton].some(ref => ref.current?.contains(focused) === true)
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing || !owned(document.activeElement)) return
      event.preventDefault()
      event.stopPropagation()
      setVolumeSlider(null)
      volumeButton.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [volumeOpen])

  // A timeline without a stored name shows the numbered default name of its ID in the interface language.
  const numbered = (n: number): string => t('tabs.defaultTitle', { n })
  const nameOf = (entry: Timeline): string => timelineName(entry, numbered)
  const shownName = timeline === null ? '' : nameOf(timeline)
  // An add or a track operation names the shown timeline; the other clip operations name the clip by its clip ID, which
  // names its timeline.
  const runOperation = (operation: string, params: Record<string, unknown>, intent: string): Promise<boolean> => {
    const named = [
      'timeline.clip_add', 'timeline.sound_add', 'timeline.sound_track_remove', 'timeline.sound_track_rename', 'timeline.mute',
      'timeline.volume', 'timeline.video_track_remove', 'timeline.track_add', 'timeline.video_track_move',
    ].includes(operation)
    const scoped = timeline === null || !named ? params : { timeline: timeline.id, ...params }
    return run(() => client.runOperation(request(project, session, { operation, params: scoped, intent })))
  }
  // A new sound goes right after the last sound of its track, or at the playhead on an empty track, or where a lane's
  // right-click menu was opened; an uploaded file is imported first and then added the same way.
  const trackEnd = Math.max(0, ...sounds.filter(sound => sound.track === soundTrack).map(sound => sound.startSec + sound.seconds))
  const soundStart = round(pickAt ?? (sounds.some(sound => sound.track === soundTrack) ? trackEnd : player.position))
  // While a sound add runs, and until the refreshed state shows its sound, every ＋ of the sound tracks is disabled, so
  // the next add starts after it instead of at the same time. A failed add enables them again.
  const [addingAt, setAddingAt] = useState<number | null>(null)
  useEffect(() => { if (addingAt !== null && sounds.length !== addingAt) setAddingAt(null) }, [sounds.length])
  const addingSound = (work: Promise<boolean>): void => {
    setAddingAt(sounds.length)
    void work.then((ok) => { if (!ok) setAddingAt(null) })
  }
  const addSound = (asset: string): void => {
    setPickingSound(false)
    const at = soundStart
    addingSound(runOperation('timeline.sound_add', { asset, start_sec: at, track: soundTrack }, t('intent.soundAdd', { at: timecode(at) })))
  }
  const removeSound = (sound: (typeof sounds)[number]): void => {
    setTrackMenu(null)
    void runOperation('timeline.sound_remove', { sound: sound.sound }, t('intent.soundRemove', { name: sound.name }))
      .then((ok) => { if (ok) setChosenSound(null) })
  }
  const startTrackRename = (track: number): void => {
    setTrackMenu(null)
    setRenamingTrack({ track, name: trackName(track) })
  }
  const commitTrackRename = (edit: { track: number; name: string }): void => {
    setRenamingTrack(null)
    const name = edit.name.trim()
    if (name === '' || name === trackName(edit.track)) return
    void runOperation('timeline.sound_track_rename', { track: edit.track, name }, t('intent.trackRename', { name }))
  }
  // While a track delete or a mute runs, and until the refreshed state replaces the timeline it was computed from, the
  // speaker and delete buttons are disabled: a second click would compute from the same state, so a double click would
  // delete the track that moved up into the deleted one's place, or send the same mute twice. A failed write enables
  // them again.
  const [headerWriteOf, setHeaderWriteOf] = useState<Timeline | null>(null)
  const headerBusy = headerWriteOf !== null && headerWriteOf === timeline
  const headerWrite = (work: Promise<boolean>): void => {
    setHeaderWriteOf(timeline)
    void work.then((ok) => { if (!ok) setHeaderWriteOf(null) })
  }
  // A track is deleted with its sounds and its mute, and the later tracks move up with their mutes.
  const removeTrack = (track: number): void => {
    headerWrite(runOperation('timeline.sound_track_remove', { track }, t('intent.trackRemove', { n: track + 1 })))
  }
  // A speaker button writes one `timeline.mute`; the button shows the new state once the refreshed state has it.
  const toggleTrackMute = (track: number): void => {
    const muted = !mutedTracks.includes(track)
    const name = trackName(track)
    headerWrite(runOperation('timeline.mute', { target: 'sound', track, muted }, t(muted ? 'intent.muteTrack' : 'intent.unmuteTrack', { name })))
  }
  const toggleVideoTrackMute = (track: number): void => {
    const muted = !mutedVideoTracks.includes(track)
    const name = videoTrackName(track)
    headerWrite(runOperation('timeline.mute', { target: 'video_track', track, muted }, t(muted ? 'intent.muteTrack' : 'intent.unmuteTrack', { name })))
  }
  /**
   * Write one `timeline.volume` when the slider lets go at a volume other than the one it last wrote or found stored.
   * @param slider - the open slider.
   */
  const storeVolume = (slider: VolumeSlider): void => {
    const { kind, track, db } = slider
    if (db === slider.written) return
    setVolumeSlider({ ...slider, written: db })
    const name = kind === 'video' ? videoTrackName(track) : trackName(track)
    headerWrite(runOperation(
      'timeline.volume', { target: kind === 'video' ? 'video_track' : 'sound', track, volume_db: db }, t('intent.volume', { name, db: String(db) }),
    ))
  }
  // A video track is deleted with its clips and its mute, and the tracks with higher numbers move up.
  const removeVideoTrack = (track: number): void => {
    headerWrite(runOperation('timeline.video_track_remove', { track }, t('intent.videoTrackRemove', { name: videoTrackName(track) })))
  }
  // An arrow of the track layers list, or 上移 / 下移 in a video track header's menu, swaps a video track with the one
  // above or below it, which swaps which of the two covers the other.
  const moveVideoTrack = (track: number, to: number): void => {
    const name = videoTrackName(track)
    headerWrite(runOperation('timeline.video_track_move', { track, to }, t(to < track ? 'intent.videoTrackUp' : 'intent.videoTrackDown', { name })))
  }
  /**
   * @param track - a video track.
   * @returns what moving the track one row up does, or null when it cannot move up now.
   */
  const layerUp = (track: number): (() => void) | null => headerBusy || track === 0 ? null : () => { moveVideoTrack(track, track - 1) }
  /**
   * @param track - a video track.
   * @returns what moving the track one row down does, or null when it cannot move down now.
   */
  const layerDown = (track: number): (() => void) | null =>
    headerBusy || track >= videoTrackCount - 1 ? null : () => { moveVideoTrack(track, track + 1) }
  // Each item of the 添加轨道 menu writes one `timeline.track_add`, which adds an empty track at the bottom.
  const addTrack = (kind: TrackKind): void => {
    setToolPopover(null)
    headerWrite(runOperation('timeline.track_add', { kind }, t(kind === 'video' ? 'intent.videoTrackAdd' : 'intent.soundTrackAdd')))
  }
  const addTrackDisabled = timeline === null || headerBusy
  // A video goes on a video track where it was dropped, or from the picker after the track's last clip, else at the playhead.
  const addClip = (asset: string, track: number, at: number): void => {
    const startSec = round(Math.max(0, at))
    void runOperation('timeline.clip_add', { asset, track, start_sec: startSec }, t('intent.trackClipAdd', { name: videoTrackName(track), at: timecode(startSec) }))
  }
  const trackEndOf = (track: number): number | null => {
    const ends = clips.filter(clip => clip.track === track).map(clip => clip.startSec + clip.seconds)
    return ends.length === 0 ? null : Math.max(...ends)
  }
  // A removed clip leaves a gap: the other clips keep their times.
  const removeClip = (clip: PlacedClip): void => {
    void runOperation('timeline.clip_remove', { clip: clip.clip }, t('intent.trackClipRemove', { name: videoTrackName(clip.track) }))
      .then((ok) => { if (ok) setChosenClip(null) })
  }
  // The asset that an asset tile drop carries and its media type, read from the drag data; the drop then belongs to the
  // track it landed on. Null for a drop that carries no asset, which the editor root handles.
  const takeDrop = (event: DragEvent<HTMLDivElement>): { id: string; type: string } | null => {
    const id = event.dataTransfer.getData(DV_ASSET_DRAG_TYPE)
    if (id.length === 0) return null
    event.preventDefault()
    event.stopPropagation()
    return { id, type: mediaTypeOf(event.dataTransfer.getData(DV_ASSET_MIME_DRAG_TYPE)) }
  }
  // An audio tile dropped on a sound track adds its audio to that track where it was dropped. While another sound add
  // runs, the drop adds nothing, as the disabled ＋ of the tracks does.
  const dropSound = (event: DragEvent<HTMLDivElement>, track: number): void => {
    const dropped = takeDrop(event)
    if (dropped === null) return
    if (dropped.type !== 'audio') {
      setDropNotice({ text: 'track.soundDrop' })
      return
    }
    if (timeline === null || addingAt !== null) return
    const at = round(Math.max(0, (event.clientX - event.currentTarget.getBoundingClientRect().left) / screenScale() / px))
    addingSound(runOperation('timeline.sound_add', { asset: dropped.id, start_sec: at, track }, t('intent.soundAdd', { at: timecode(at) })))
  }
  // A video tile dropped on a video track goes on that track where it was dropped.
  const dropClip = (event: DragEvent<HTMLDivElement>, track: number): void => {
    const dropped = takeDrop(event)
    if (dropped === null) return
    if (dropped.type !== 'video') {
      setDropNotice({ text: 'track.videoDrop' })
      return
    }
    addClip(dropped.id, track, (event.clientX - event.currentTarget.getBoundingClientRect().left) / screenScale() / px)
  }
  const uploadSound = (file: File): void => {
    setPickingSound(false)
    const at = soundStart
    addingSound(run(async () => {
      const { asset } = await client.importAsset(project, file, 'asset_pool', session)
      const params = { timeline: timelineId, asset, start_sec: at, track: soundTrack }
      await client.runOperation(request(project, session, { operation: 'timeline.sound_add', params, intent: t('intent.soundAdd', { at: timecode(at) }) }))
    }))
  }

  // A created timeline stores no name; `nameOf` shows the numbered default name of its ID.
  const createTimeline = (): void => {
    const id = nextTimelineId(timelines)
    const name = timelineName({ id, name: '' }, numbered)
    select(id)
    void run(() => client.runOperation(request(project, session, { operation: 'timeline.create', params: { timeline: id, assets: [] }, intent: t('intent.create', { name }) })))
      .then((ok) => {
        if (ok) return
        select(timelineId)
      })
  }
  const startRename = (entry: Timeline): void => {
    setMenu(null)
    setRenaming({ id: entry.id, name: nameOf(entry) })
  }
  const commitRename = (edit: { id: string; name: string }): void => {
    setRenaming(null)
    const entry = timelines.find(item => item.id === edit.id)
    const name = edit.name.trim()
    if (entry === undefined || name === '' || name === nameOf(entry)) return
    void run(() => client.runOperation(request(project, session, { operation: 'timeline.rename', params: { timeline: edit.id, name }, intent: t('intent.rename', { name }) })))
  }
  const deleteTimeline = (entry: Timeline): void => {
    setMenu(null)
    const name = nameOf(entry)
    if (!window.confirm(t('tabs.deleteConfirm', { name }))) return
    void run(() => client.runOperation(request(project, session, { operation: 'timeline.delete', params: { timeline: entry.id }, intent: t('intent.delete', { name }) })))
  }
  // Undo and redo move the whole project's current position one step, whichever view made the step.
  const undo = (): void => { void run(() => client.undo(project)) }
  const redo = (): void => { void run(() => client.redo(project)) }
  const canRedo = state.head !== state.tip
  // The record behind the selected clip's asset, while it is stale: the record "keep anyway" accepts.
  const staleRecord = selectedClip?.stale === true && selectedClip.assetId !== null
    ? state.components.proj.created_by[selectedClip.assetId]
    : undefined
  const keepStale = (record: string): void => {
    void run(() => client.acceptStale(project, record, 'timeline', session))
  }
  // Whether the playhead is inside a clip or a sound, away from its edges, where a split leaves two parts.
  const playheadInside = (clip: { startSec: number; seconds: number }): boolean =>
    player.position > clip.startSec + 0.05 && player.position < clip.startSec + clip.seconds - 0.05
  // The split button splits the selected sound or clip, or with nothing selected the clip the user sees at the playhead;
  // a placeholder cannot be split.
  const splittable = (clip: PlacedClip | undefined): PlacedClip | undefined =>
    clip?.status === 'ready' && playheadInside(clip) ? clip : undefined
  const splitTarget = selectedSound !== undefined ? undefined : splittable(selectedClip ?? topClip)
  const splitSelectedSound = selectedSound !== undefined && playheadInside(selectedSound) ? selectedSound : undefined
  const splitClip = (clip: PlacedClip): void => {
    const atSec = round(clip.inSec + player.position - clip.startSec)
    void runOperation('timeline.clip_split', { clip: clip.clip, at_sec: atSec }, t('intent.trackClipSplit', { name: videoTrackName(clip.track), at: timecode(player.position) }))
  }
  // A sound splits at the playhead into two sounds of its asset; the second gets a new sound ID.
  const splitSound = (sound: TrackSound): void => {
    const atSec = round(sound.inSec + player.position - sound.startSec)
    void runOperation('timeline.sound_split', { sound: sound.sound, at_sec: atSec }, t('intent.soundSplit', { name: sound.name, at: timecode(player.position) }))
  }
  // Export is one `timeline.export` call: it trims the clips with an in or out point and plays each at its time.
  // It waits while any clip is a placeholder; the toolbar says how many.
  const waiting = clips.filter(clip => clip.status !== 'ready').length
  const exportId = exporting || clips.length === 0 || waiting > 0 ? null : timelineId
  const exportTimeline = (id: string): void => {
    setExporting(true)
    setExported(null)
    void run(async () => {
      const exported = await client.runOperation(request(project, session, {
        operation: 'timeline.export', params: { timeline: id }, intent: t('intent.export', { name: shownName }),
      }))
      setExported(exported.outputs[0] ?? null)
    }).finally(() => { setExporting(false) })
  }

  // The ruler is the lane, so its own box gives the time under the pointer.
  const seekFromPointer = (event: PointerEvent<HTMLElement>): void => {
    player.seek((event.clientX - event.currentTarget.getBoundingClientRect().left) / screenScale() / px)
  }

  /**
   * Where a block dragged in time starts: the pointer's offset added to its start, no earlier than 0 s, snapped to the
   * edges of every other clip and sound, the playhead, and 0 s within `SNAP_PX`. A drag that moved the pointer no more
   * than `DRAG_PX` sideways, such as a press or a move to another track, keeps the start.
   * @param block - the dragged clip or sound.
   * @param id - its clip ID or sound ID, whose own edges are no targets.
   * @param dx - the pixels the pointer moved.
   * @returns the start in seconds.
   */
  const movedStart = (block: { startSec: number; seconds: number }, id: string, dx: number): number => {
    if (Math.abs(dx) <= DRAG_PX) return block.startSec
    const edges = [...clips.filter(clip => clip.clip !== id), ...sounds.filter(sound => sound.sound !== id)]
      .flatMap(other => [other.startSec, other.startSec + other.seconds])
    return snapStart(Math.max(0, block.startSec + dx / px), block.seconds, [0, player.position, ...edges], SNAP_PX / px)
  }

  // A pointer-up ends a clip drag: a body drag moves the clip in time and to the video track nearest the row it ends on
  // (or selects it when it did not move); an edge drag trims, and a start trim moves the clip's start by the same amount.
  const finishClipDrag = (clip: PlacedClip, current: BlockDrag): void => {
    setTrackDrag(null)
    const moved = Math.abs(current.dx) > DRAG_PX || Math.abs(current.dy) > DRAG_PX
    if (!moved) {
      if (current.kind === 'move') { chooseClip(clip.clip); root.current?.focus() }
      return
    }
    const deltaSec = current.dx / px
    if (current.kind === 'move') {
      const startSec = round(movedStart(clip, clip.clip, current.dx))
      const track = nearestVideoRow(clip.track, current.dy)
      // A drag that ends where it started, on the same row at the same time, writes nothing.
      if (track === clip.track && startSec === round(clip.startSec)) return
      const params = { clip: clip.clip, start_sec: startSec, ...track === clip.track ? {} : { track } }
      // A moved clip is selected once the move is done, instead of a sound picked meanwhile.
      void runOperation('timeline.clip_move', params, t('intent.trackClipMove', { name: videoTrackName(track), at: timecode(startSec) }))
        .then((ok) => { if (ok) chooseClip(clip.clip) })
      return
    }
    const inSec = current.kind === 'trimStart'
      ? round(Math.max(0, clip.inSec - clip.startSec, Math.min(clip.inSec + deltaSec, clip.outSec - 0.1)))
      : clip.rawIn
    const outSec = current.kind === 'trimEnd' ? round(Math.max(clip.inSec + 0.1, Math.min(clip.outSec + deltaSec, clip.assetSeconds))) : clip.rawOut
    // An unset end of the range is left out: the operation reads a missing in or out point as the asset's own end.
    const range = { ...inSec === null ? {} : { in_sec: inSec }, ...outSec === null ? {} : { out_sec: outSec } }
    void runOperation('timeline.clip_trim', { clip: clip.clip, ...range }, t('intent.trackClipTrim', { name: videoTrackName(clip.track) }))
  }
  /**
   * The pointer handlers of a drag on a clip or on a sound: a primary press starts it, a move follows the
   * pointer (up and down too for a body drag), and the release finishes it.
   * @param id - the block's clip ID or sound ID.
   * @param kind - a body or an edge drag.
   * @param current - the drag in progress on that kind of block.
   * @param set - stores the drag in progress.
   * @param finish - ends the drag with its last offset.
   * @returns the handlers.
   */
  const blockDragHandlers = (
    id: string, kind: BlockDrag['kind'], current: BlockDrag | null, set: (drag: BlockDrag) => void, finish: (drag: BlockDrag) => void,
  ) => {
    const ours = (drag: BlockDrag | null): drag is BlockDrag => drag !== null && drag.id === id && drag.kind === kind
    const offset = (drag: BlockDrag, event: PointerEvent<HTMLElement>): BlockDrag => ({
      ...drag, dx: (event.clientX - drag.startX) / screenScale(), dy: kind === 'move' ? (event.clientY - drag.startY) / screenScale() : 0,
    })
    return {
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        event.stopPropagation()
        if (event.button !== 0) return
        capture(event)
        set({ kind, id, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 })
      },
      onPointerMove: (event: PointerEvent<HTMLElement>) => {
        if (ours(current)) set(offset(current, event))
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => {
        if (!ours(current)) return
        event.stopPropagation()
        finish(offset(current, event))
      },
    }
  }
  const clipHandlers = (clip: PlacedClip, kind: BlockDrag['kind']) =>
    blockDragHandlers(clip.clip, kind, trackDrag, setTrackDrag, (drag) => { finishClipDrag(clip, drag) })
  const soundHandlers = (sound: TrackSound, kind: BlockDrag['kind']) =>
    blockDragHandlers(sound.sound, kind, soundDrag, setSoundDrag, (drag) => { finishSoundDrag(sound, drag) })
  /**
   * One clip block or one sound block, with the live offset of its drag applied: a body drag follows the pointer and
   * shows the snap that the drop will make (`movedStart`), a start trim stops at the asset's start and the timeline's
   * start, and an end trim at the asset's end.
   * @param block - the placed clip or sound.
   * @param drag - the drag in progress on this block, or null.
   * @returns the block's position and size.
   */
  const placedBlockGeometry = (
    block: { startSec: number; seconds: number; inSec: number; assetSeconds: number }, drag: BlockDrag | null,
  ): CSSProperties => {
    let left = block.startSec * px
    let width = block.seconds * px
    let transform: string | undefined
    if (drag?.kind === 'move') {
      const dx = (movedStart(block, drag.id, drag.dx) - block.startSec) * px
      transform = `translate(${String(dx)}px, ${String(drag.dy)}px)`
    }
    if (drag?.kind === 'trimStart') {
      const dx = Math.max(-Math.min(block.inSec, block.startSec) * px, Math.min(drag.dx, width - 4))
      left += dx
      width -= dx
    }
    if (drag?.kind === 'trimEnd') width = Math.max(4, Math.min(width + drag.dx, (block.assetSeconds - block.inSec) * px))
    return { position: 'absolute', top: 0, bottom: 0, left, width, ...transform === undefined ? {} : { transform, zIndex: 3, opacity: 0.85 } }
  }

  // A pointer-up ends a sound drag: a body drag moves the sound in time and to the sound track nearest the row it ends
  // on; an edge drag trims it, and a start trim moves its start by the same amount. A press without a move leaves the
  // click to select it.
  const finishSoundDrag = (sound: TrackSound, current: BlockDrag): void => {
    setSoundDrag(null)
    if (Math.abs(current.dx) <= DRAG_PX && Math.abs(current.dy) <= DRAG_PX) return
    const deltaSec = current.dx / px
    if (current.kind === 'move') {
      const startSec = round(movedStart(sound, sound.sound, current.dx))
      const track = nearestSoundTrack(sound.track, current.dy)
      if (track === sound.track && startSec === round(sound.startSec)) return
      const params = { sound: sound.sound, start_sec: startSec, ...track === sound.track ? {} : { track } }
      void runOperation('timeline.sound_move', params, t('intent.soundMove', { name: sound.name, track: trackName(track), at: timecode(startSec) }))
      return
    }
    const outSec = sound.inSec + sound.seconds
    const inSec = current.kind === 'trimStart'
      ? round(Math.max(0, sound.inSec - sound.startSec, Math.min(sound.inSec + deltaSec, outSec - 0.1)))
      : sound.rawIn
    const trimmedOut = current.kind === 'trimEnd' ? round(Math.max(sound.inSec + 0.1, Math.min(outSec + deltaSec, sound.assetSeconds))) : sound.rawOut
    const range = { ...inSec === null ? {} : { in_sec: inSec }, ...trimmedOut === null ? {} : { out_sec: trimmedOut } }
    void runOperation('timeline.sound_trim', { sound: sound.sound, ...range }, t('intent.soundTrim', { name: sound.name }))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedSound !== undefined) {
      event.preventDefault()
      removeSound(selectedSound)
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedClip !== undefined) {
      event.preventDefault()
      removeClip(selectedClip)
    } else if (event.key === ' ' && event.target === event.currentTarget) {
      event.preventDefault()
      if (player.playing) player.pause()
      else player.play()
    } else if (event.target === event.currentTarget && (event.key === 'j' || event.key === 'l' || (event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')))) {
      event.preventDefault()
      player.skip(event.key === 'j' || event.key === 'ArrowLeft' ? -SKIP_SECONDS : SKIP_SECONDS)
    }
  }

  const fit = (): void => {
    const width = (scroller.current as HTMLDivElement).clientWidth - GUTTER - 60
    if (width > 0 && span > 0) setPx(Math.round(Math.max(5, Math.min(200, width / span))))
  }
  // Each timeline opens fitted to the track width once it has clips, and stays fitted while the panel resizes until the
  // user picks a zoom with the slider.
  const fittedTimeline = useRef<string | null>(null)
  const autoFit = useRef(true)
  const fitLatest = useRef(fit)
  fitLatest.current = fit
  useEffect(() => {
    if (fittedTimeline.current === timelineId || videoSpan <= 0) return
    fittedTimeline.current = timelineId
    autoFit.current = true
    fit()
  }, [timelineId, videoSpan])
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (autoFit.current) fitLatest.current() })
    observer.observe(scroller.current as HTMLDivElement)
    return () => { observer.disconnect() }
  }, [])

  // The bounds of a track-area resize, read from the laid-out editor: the preview and the track area share the height
  // from the preview's top to the editor's bottom, less the 1 px drag handle; the track area needs its toolbar, its
  // horizontal scrollbar, and the ruler and the first track row with the bottom padding, and scrolls to the rows under
  // them.
  // Null before layout (or under jsdom, which lays out nothing).
  const resizeBounds = (): { available: number; minTrack: number } | null => {
    const panelElement = panel.current as HTMLDivElement
    const available = (root.current as HTMLDivElement).getBoundingClientRect().bottom
      - (viewerBox.current as HTMLElement).getBoundingClientRect().top - 1
    if (available <= 0) return null
    const minTrack = panelElement.offsetHeight - (scroller.current as HTMLDivElement).clientHeight
      + Math.min((rows.current as HTMLDivElement).offsetHeight, RULER_HEIGHT + ROW_GAP + ROW_HEIGHT) + TRACK_PADDING
    return { available, minTrack }
  }
  const resizeTo = (requested: number, bounds = resizeBounds()): number => {
    const height = bounds === null ? Math.round(requested) : clampTrackHeight(requested, bounds.available, bounds.minTrack)
    setTrackHeight(height)
    return height
  }
  // A remembered or dragged height is clamped again whenever the editor resizes, so a shorter window keeps the preview.
  // A card has no track-area resize.
  useEffect(() => {
    if (card !== undefined) return undefined
    const observer = new ResizeObserver(() => {
      const bounds = resizeBounds()
      if (bounds !== null) setTrackHeight(height => height === null ? null : clampTrackHeight(height, bounds.available, bounds.minTrack))
    })
    observer.observe(root.current as HTMLDivElement)
    return () => { observer.disconnect() }
  }, [])
  // Dragging the handle up makes the track area taller; ArrowUp and ArrowDown on the focused handle step it. Each
  // finished change is remembered for this browser.
  const resizeHandle = (
    <div
      role="separator" aria-orientation="horizontal" aria-label={t('track.resize')} title={t('track.resize')} tabIndex={0}
      {...trackHeight === null ? {} : { 'aria-valuenow': trackHeight }}
      className="dv-tl-resize" data-dragging={resizing !== null} data-testid="dv-timeline-resize"
      onPointerDown={(event) => {
        event.preventDefault()
        capture(event)
        setResizing({ startY: event.clientY, startHeight: (panel.current as HTMLDivElement).offsetHeight, bounds: resizeBounds() })
      }}
      onPointerMove={(event) => {
        if (resizing !== null) resizeTo(resizing.startHeight - (event.clientY - resizing.startY), resizing.bounds)
      }}
      onPointerUp={(event) => {
        if (resizing === null) return
        setResizing(null)
        storeTrackHeight(resizeTo(resizing.startHeight - (event.clientY - resizing.startY), resizing.bounds))
      }}
      onPointerCancel={() => {
        setResizing(null)
        if (trackHeight !== null) storeTrackHeight(trackHeight)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        event.stopPropagation()
        const from = trackHeight ?? (panel.current as HTMLDivElement).offsetHeight
        storeTrackHeight(resizeTo(from + (event.key === 'ArrowUp' ? RESIZE_STEP : -RESIZE_STEP)))
      }}
      style={{ flex: 'none', position: 'relative', zIndex: 6, height: 1, cursor: 'row-resize', touchAction: 'none' }}
    />
  )

  // The preview frame, with the clips' video elements, goes full screen; a refused request leaves the preview inline.
  const toggleFullscreen = (): void => {
    const element = frame.current as HTMLDivElement
    const change = document.fullscreenElement === element ? document.exitFullscreen() : element.requestFullscreen()
    void change.catch((error: unknown) => { void error })
  }

  const laneWidth = Math.max(span * px + 80, 200)
  // The ruler's ticks and labels depend only on the zoom and the lane width, so playback, which re-renders the editor
  // on every animation frame, reuses them.
  const rulerMarks = useMemo(() => {
    const steps = rulerSteps(px)
    const ticks = Array.from({ length: Math.floor(laneWidth / px / steps.tick) + 1 }, (_, i) => i * steps.tick)
    return (
      <>
        {ticks.map(sec => (
          <span key={sec} style={{ position: 'absolute', left: sec * px, bottom: 0, width: 1, height: sec % steps.label === 0 ? 9 : 4, background: palette.lineStrong }} />
        ))}
        {ticks.filter(sec => sec % steps.label === 0).map(sec => (
          <span key={`label-${String(sec)}`} style={{ position: 'absolute', left: sec * px, top: 3, marginLeft: 4, fontFamily: palette.mono, fontSize: 11, lineHeight: '14px', fontVariantNumeric: 'tabular-nums', color: palette.muted, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            {timecode(sec).replace(/\.\d+$/, '')}
          </span>
        ))}
      </>
    )
  }, [px, laneWidth])

  // The tiles of every ready clip whose video's strip is complete, by clip ID: one per frame, each as wide as the block
  // is high at the video's aspect ratio and showing the frame nearest the asset time at the tile's middle. They are built
  // again only when the clips, the strips or the zoom change, not on every frame of playback.
  const stripTiles = useMemo(() => {
    const ready = clips.flatMap(clip => clip.assetId === null ? [] : [{ ...clip, assetId: clip.assetId }])
    return new Map(ready.flatMap(({ clip, assetId, inSec, seconds }) => {
      const strip = strips.get(assetUrl(assetId))
      if (strip === undefined || !strip.complete) return []
      const tileWidth = (ROW_HEIGHT - 2) * strip.aspect
      const tiles = Array.from({ length: Math.max(1, Math.ceil(seconds * px / tileWidth)) }, (_, index) => {
        const at = Math.min(inSec + (index + 0.5) * tileWidth / px, inSec + seconds)
        const frame = Math.min(strip.frames.length - 1, Math.round(at / strip.step))
        return (
          <span
            key={index} data-filmstrip-frame={frame}
            style={{ position: 'absolute', top: 0, bottom: 0, left: index * tileWidth, width: tileWidth, background: `url("${strip.frames[frame] as string}") center / cover no-repeat`, pointerEvents: 'none' }}
          />
        )
      })
      return [[clip, tiles] as const]
    }))
  }, [clips, strips, px])
  /**
   * The picture of a ready clip block: its tiles once its video's strip is complete; until then, its still image or else
   * its video's first frame, which the block repeats across its width, and null while neither is read.
   * @param clip - the clip's ID, its video asset, and the still image its record left, or null.
   * @returns the image to repeat, or the tiles.
   */
  const clipPicture = (
    clip: { clip: string; assetId: string; thumbnail: string | null },
  ): { still: string | null; tiles: ReactNode[] | null } => {
    const tiles = stripTiles.get(clip.clip)
    if (tiles !== undefined) return { still: null, tiles }
    const first = strips.get(assetUrl(clip.assetId))?.frames[0] ?? null
    return { still: clip.thumbnail !== null ? assetUrl(clip.thumbnail) : first, tiles: null }
  }

  // A right click in the track area opens the menu of what it landed on at the pointer, instead of the browser's menu.
  const openMenu = (event: MouseEvent<HTMLElement>, on: TrackMenu): void => {
    event.preventDefault()
    event.stopPropagation()
    setTrackMenu({ on, ...menuPoint(event) })
  }
  // The lane time under a right click, in seconds.
  const laneTime = (event: MouseEvent<HTMLElement>): number =>
    round(Math.max(0, (event.clientX - event.currentTarget.getBoundingClientRect().left) / screenScale() / px))
  /**
   * Open the asset picker or the sound dialog at a point on screen, kept inside the area under the toolbar.
   * @param x - where its left edge goes.
   * @param top - where its top goes when it opens downward.
   * @param bottom - where its bottom goes when it opens upward.
   */
  const anchorPicker = (x: number, top: number, bottom: number): void => {
    const box = (pickArea.current as HTMLDivElement).getBoundingClientRect()
    const scale = screenScale()
    const left = Math.max(8, Math.min((x - box.left) / scale, box.width / scale - PICKER_WIDTH - 8))
    setPickAnchor(top - box.top > box.height / 2
      ? { left, edge: 'bottom', offset: (box.bottom - bottom) / scale }
      : { left, edge: 'top', offset: (top - box.top) / scale })
  }
  // A ＋ opens its picker or dialog to its right, level with its row.
  const anchorBeside = (element: HTMLElement): void => {
    const box = element.getBoundingClientRect()
    anchorPicker(box.right + 4, box.top, box.bottom)
  }
  // A lane menu's 在这里添加 opens the asset picker or the sound dialog of that track where the menu was opened, which then
  // adds at that time.
  const pickFor = (on: Extract<TrackMenu, { kind: 'videoLane' }>): void => {
    addRef.current = null
    anchorPicker(on.clientX, on.clientY, on.clientY)
    setPickingSound(false); setPickTrack(on.track); setPickAt(on.atSec); setPicking(true)
  }
  const pickSoundFor = (on: Extract<TrackMenu, { kind: 'soundLane' }>): void => {
    soundAddRef.current = null
    anchorPicker(on.clientX, on.clientY, on.clientY)
    setPicking(false); setSoundTrack(on.track); setPickAt(on.atSec); setPickingSound(true)
  }
  /**
   * One item of the track area's right-click menu; choosing it closes the menu.
   * @param label - the item's text.
   * @param action - what the item does; null disables it.
   * @param danger - whether the item deletes something, which shows it in the danger color.
   * @returns the element.
   */
  const menuButton = (label: string, action: (() => void) | null, danger = false): ReactNode => (
    <button
      key={label} type="button" role="menuitem" className="dv-tl-btn" disabled={action === null}
      onClick={action === null ? undefined : () => { setTrackMenu(null); action() }}
      style={buttonStyle(action === null, { ...menuItem, ...danger ? { color: palette.danger } : {} })}
    >
      {label}
    </button>
  )
  const muteItem = (muted: boolean, toggle: () => void): ReactNode =>
    menuButton(t(muted ? 'menu.unmute' : 'menu.mute'), timeline === null || headerBusy ? null : toggle)
  /**
   * The items of the right-click menu: a clip or a sound splits at the playhead or goes, a track header mutes, moves (a
   * video track) or renames (a sound track) or deletes its track, and a free spot of a lane adds a video or a sound there
   * or adds a track at the bottom.
   * @param on - what the menu was opened on.
   * @returns the menu's items.
   */
  const menuItems = (on: TrackMenu): ReactNode[] => {
    const addTracks = [
      menuButton(t('menu.addVideoTrack'), addTrackDisabled ? null : () => { addTrack('video') }),
      menuButton(t('menu.addSoundTrack'), addTrackDisabled ? null : () => { addTrack('sound') }),
    ]
    if (on.kind === 'sound') {
      const { sound } = on
      return [
        menuButton(t('menu.split'), playheadInside(sound) ? () => { splitSound(sound) } : null),
        menuButton(t('menu.delete'), () => { removeSound(sound) }, true),
      ]
    }
    if (on.kind === 'clip') {
      const { clip } = on
      return [
        menuButton(t('menu.split'), splittable(clip) === undefined ? null : () => { splitClip(clip) }),
        menuButton(t('menu.delete'), () => { removeClip(clip) }, true),
      ]
    }
    if (on.kind === 'videoTrack') {
      const { track } = on
      return [
        muteItem(mutedVideoTracks.includes(track), () => { toggleVideoTrackMute(track) }),
        menuButton(t('menu.moveUp'), layerUp(track)),
        menuButton(t('menu.moveDown'), layerDown(track)),
        menuButton(t('menu.deleteVideoTrack'), timeline === null || headerBusy ? null : () => { removeVideoTrack(track) }, true),
      ]
    }
    if (on.kind === 'soundTrack') {
      const { track } = on
      return [
        muteItem(mutedTracks.includes(track), () => { toggleTrackMute(track) }),
        menuButton(t('menu.renameTrack'), () => { startTrackRename(track) }),
        menuButton(t('menu.deleteTrack'), timeline === null || headerBusy ? null : () => { removeTrack(track) }, true),
      ]
    }
    if (on.kind === 'videoLane') return [menuButton(t('menu.addVideo'), () => { pickFor(on) }), ...addTracks]
    // The last kind left; a new kind fails to compile here until it gets its items above.
    const lane: Extract<TrackMenu, { kind: 'soundLane' }> = on
    return [menuButton(t('menu.addSound'), addingAt === null ? () => { pickSoundFor(lane) } : null), ...addTracks]
  }

  // Timeline tabs: click selects, double-click renames in place, right-click opens a menu with rename and delete.
  const tabs = (
    <div role="tablist" aria-label={t('tabs.aria')} style={{ display: 'flex', gap: 4, padding: '6px 12px', borderBottom: `1px solid ${palette.line}`, background: palette.panel, alignItems: 'center', flexWrap: 'wrap' }}>
      {timelines.map(entry => renaming?.id === entry.id ? (
        <input
          key={entry.id} autoFocus value={renaming.name} aria-label={t('tabs.renameAria')}
          onChange={(event) => { setRenaming({ id: entry.id, name: event.target.value }) }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') commitRename(renaming)
            if (event.key === 'Escape') setRenaming(null)
          }}
          onBlur={() => { commitRename(renaming) }}
          style={{ ...button, width: 120, background: palette.panel, cursor: 'text' }}
        />
      ) : (
        <button
          key={entry.id} type="button" role="tab" aria-selected={entry === timeline} data-timeline={entry.id}
          onClick={() => { select(entry.id) }}
          onDoubleClick={() => { startRename(entry) }}
          onContextMenu={(event) => {
            event.preventDefault()
            const box = event.currentTarget.getBoundingClientRect()
            setMenu({ entry, x: box.left, y: box.bottom })
          }}
          className="dv-tl-btn"
          style={{
            ...button, ...textButton,
            ...entry === timeline ? { background: palette.fill, color: palette.fg, fontWeight: 500 } : {},
          }}
        >
          {nameOf(entry)}
        </button>
      ))}
      <button type="button" className="dv-tl-btn" onClick={createTimeline} style={{ ...button, ...textButton }}>{t('tabs.new')}</button>
      {menu !== null ? (
        <div ref={menuRef} role="menu" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 20, background: palette.panel, border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-xl)', padding: 6, boxShadow: 'var(--dv-shadow-2)', minWidth: 140 }}>
          <button type="button" role="menuitem" className="dv-tl-btn" onClick={() => { startRename(menu.entry) }} style={menuItem}>{t('tabs.rename')}</button>
          <button type="button" role="menuitem" className="dv-tl-btn" onClick={() => { deleteTimeline(menu.entry) }} style={{ ...menuItem, color: palette.danger }}>{t('tabs.delete')}</button>
        </div>
      ) : null}
    </div>
  )

  // The preview fills the height the tracks leave: a 16:9 frame at full height, narrowed to the available width, on the
  // media surround, with the play button, the timecode, and the full-screen button under it.
  const canPlay = clips.some(clip => clip.status === 'ready')
  // In a card the preview sits above the node: as wide as the node, its picture at the aspect ratio of the first ready
  // clip of the top track that has one.
  const firstReady = clips.filter(clip => clip.assetId !== null).toSorted((a, b) => a.track - b.track || a.startSec - b.startSec)[0]
  const firstAsset = firstReady?.assetId === null || firstReady === undefined ? undefined : assets.get(firstReady.assetId)
  const cardRatio = firstAsset !== undefined && firstAsset.width !== null && firstAsset.height !== null && firstAsset.height > 0
    ? `${String(firstAsset.width)} / ${String(firstAsset.height)}`
    : '16 / 9'
  const viewerStyle: CSSProperties = card === undefined
    ? { flex: '1 1 auto', minHeight: 140, display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 24px 12px', background: palette.media }
    : {
      display: 'flex', flexDirection: 'column', gap: 6, padding: 8, marginBottom: 8, boxSizing: 'border-box', borderRadius: 'var(--dv-radius-lg)',
      background: palette.media, boxShadow: `0 0 0 1px ${palette.line}, var(--dv-shadow-2)`,
      // Laid out `scale` times narrower and drawn `scale` times larger, growing up from the node's top edge.
      width: card.previewWidth === undefined ? `${String(100 / cardScale)}%` : card.previewWidth / cardScale,
      marginLeft: '50%', transform: `translateX(-50%) scale(${String(cardScale)})`, transformOrigin: 'bottom center',
    }
  const frameStyle: CSSProperties = card === undefined ? { height: '100%', maxWidth: '100%', aspectRatio: '16 / 9' } : { width: '100%', aspectRatio: cardRatio }
  const viewer = (
    <section ref={viewerBox} aria-label={t('viewer.aria')} data-testid="dv-timeline-preview" style={viewerStyle}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          ref={frame} data-testid="dv-timeline-viewer"
          style={{ position: 'relative', ...frameStyle, borderRadius: 'var(--dv-radius-md)', overflow: 'hidden', background: palette.media, boxShadow: `0 0 0 1px ${palette.line}, var(--dv-shadow-1)` }}
        >
          {/* Each clip has its own element; only the clip of the top track at the playhead shows, plays and is heard, and
              only a clip that can show soon loads its whole file. */}
          {clips.flatMap(clip => clip.assetId === null ? [] : [(
            <video
              key={clip.clip} data-track-clip={clip.clip} src={assetUrl(clip.assetId)} playsInline
              preload={trackClipPreload(clip, player.position, covered)}
              muted={clip.clip !== topClip?.clip || mutedVideoTracks.includes(clip.track)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: palette.media, visibility: clip.clip === topClip?.clip ? 'visible' : 'hidden' }}
            />
          )])}
          {clips.length === 0 ? <p data-testid="dv-timeline-viewer-empty" style={viewerNote}>{t(timeline === null ? 'viewer.noTimelines' : 'viewer.empty')}</p> : null}
          {topClip !== undefined && topClip.status !== 'ready' ? (
            <p data-testid="dv-timeline-viewer-placeholder" style={viewerNote}>
              {t('viewer.placeholder', { name: videoTrackName(topClip.track), status: t(topClip.status === 'failed' ? 'track.renderFailed' : 'track.rendering') })}
            </p>
          ) : null}
        </div>
      </div>
      {card === undefined ? null : (
        <div
          role="slider" aria-label={t('viewer.progress')} aria-valuemin={0} aria-valuemax={Math.round(videoSpan)} aria-valuenow={Math.round(player.position)}
          data-testid="dv-timeline-progress" onPointerDown={seekAlong}
          style={{ flex: 'none', position: 'relative', height: 14, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, background: 'rgba(255, 255, 255, 0.25)' }} />
          <span style={{ position: 'absolute', left: 0, width: `${String(videoSpan > 0 ? Math.min(1, player.position / videoSpan) * 100 : 0)}%`, height: 4, borderRadius: 2, background: palette.accent }} />
        </div>
      )}
      {/* Three columns keep the transport group centered whatever the widths of the timecode and the right group. */}
      <div style={{ flex: 'none', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, color: palette.fg }}>
        <span data-testid="dv-timeline-time" style={{ justifySelf: 'start', fontFamily: palette.mono, fontSize: 13, lineHeight: '20px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {timecode(player.position)}{' '}<span style={{ color: palette.muted }}>{`/ ${timecode(videoSpan)}`}</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconButton icon="skipBack" label={t('viewer.skipBack')} onClick={videoSpan <= 0 ? null : () => { player.skip(-SKIP_SECONDS) }} />
          <button
            type="button" disabled={!canPlay} aria-label={player.playing ? t('tool.pause') : t('tool.play')} title={player.playing ? t('tool.pause') : t('tool.play')}
            onClick={() => { if (player.playing) player.pause(); else player.play() }}
            style={{ ...buttonStyle(!canPlay, iconButton), borderRadius: 9999, background: palette.fg, color: palette.media }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d={player.playing ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M7 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L8.5 4.6A1 1 0 0 0 7 5.5z'} />
            </svg>
          </button>
          <IconButton icon="skipForward" label={t('viewer.skipForward')} onClick={videoSpan <= 0 ? null : () => { player.skip(SKIP_SECONDS) }} />
        </div>
        <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button" className="dv-tl-btn" data-testid="dv-timeline-speed" aria-label={t('viewer.speed', { rate: playbackRate })} title={t('viewer.speed', { rate: playbackRate })} onClick={cycleRate}
            style={{ ...button, ...textButton, minWidth: 44, justifyContent: 'center', fontFamily: palette.mono, fontSize: 12, lineHeight: '16px', fontVariantNumeric: 'tabular-nums' }}
          >
            {t('viewer.speedValue', { rate: playbackRate })}
          </button>
          <IconButton icon="fullscreen" label={t('viewer.fullscreen')} onClick={toggleFullscreen} />
        </div>
      </div>
    </section>
  )

  const toolbar = (
    <div role="toolbar" aria-label={t('tool.aria')} style={{ display: 'flex', gap: 2, alignItems: 'center', padding: '6px 12px', borderBottom: `1px solid ${palette.line}`, flexWrap: 'wrap' }}>
      <IconButton icon="undo" label={t('tool.undo')} onClick={undo} />
      <IconButton icon="redo" label={t('tool.redo')} onClick={canRedo ? redo : null} />
      <span style={{ width: 1, height: 18, background: palette.lineStrong, margin: '0 6px' }} />
      <IconButton
        icon="split" label={t('tool.split')}
        onClick={splitSelectedSound !== undefined
          ? () => { splitSound(splitSelectedSound) }
          : splitTarget === undefined ? null : () => { splitClip(splitTarget) }}
      />
      {selectedSound !== undefined
        ? <IconButton icon="delete" label={t('tool.deleteSound')} onClick={() => { removeSound(selectedSound) }} />
        : <IconButton icon="delete" label={t('tool.delete')} onClick={selectedClip === undefined ? null : () => { removeClip(selectedClip) }} />}
      <span ref={toolButtons} style={{ position: 'relative', display: 'inline-flex', gap: 2 }}>
        <button
          type="button" className="dv-tl-btn" aria-label={t('track.addTrack')} title={t('track.addTrack')} aria-haspopup="menu" aria-expanded={toolPopover === 'add'}
          disabled={timeline === null} onClick={() => { setToolPopover(toolPopover === 'add' ? null : 'add') }} style={buttonStyle(timeline === null, iconButton)}
        >
          <Icon name="add" />
        </button>
        <button
          type="button" className="dv-tl-btn" aria-label={t('track.layers')} title={t('track.layers')} aria-expanded={toolPopover === 'layers'}
          onClick={() => { setToolPopover(toolPopover === 'layers' ? null : 'layers') }} style={buttonStyle(false, iconButton)}
        >
          <Icon name="layers" />
        </button>
        {toolPopover === 'add' ? (
          <div ref={toolPopoverRef} role="menu" aria-label={t('track.addTrack')} style={toolPopoverStyle}>
            <button
              type="button" role="menuitem" className="dv-tl-btn" style={buttonStyle(addTrackDisabled, menuItem)} disabled={addTrackDisabled}
              onClick={() => { addTrack('video') }}
            >
              <Icon name="film" />{t('track.menuVideo')}
            </button>
            <button
              type="button" role="menuitem" className="dv-tl-btn" style={buttonStyle(addTrackDisabled, menuItem)} disabled={addTrackDisabled}
              onClick={() => { addTrack('sound') }}
            >
              <Icon name="music" />{t('track.menuAudio')}
            </button>
          </div>
        ) : null}
        {toolPopover === 'layers' ? (
          <div ref={toolPopoverRef} role="dialog" aria-label={t('track.layers')} style={{ ...toolPopoverStyle, padding: 0, minWidth: 200, overflow: 'hidden' }}>
            <p style={{ margin: 0, padding: '8px 12px', fontSize: 12, lineHeight: '16px', fontWeight: 500, color: palette.muted, background: palette.fill }}>{t('track.layers')}</p>
            {/* The video tracks in the order the picture stacks them: each track covers every track after it. Under each
                name, the names of its clips' assets in play order show which track a move put where. */}
            <ol style={{ listStyle: 'none', margin: 0, padding: 6 }}>
              {Array.from({ length: videoTrackCount }, (_, track) => track).map((track) => {
                const name = videoTrackName(track)
                const ids = clips.filter(clip => clip.track === track).sort((a, b) => a.startSec - b.startSec).map(clip => clip.assetId)
                  .filter((id): id is string => id !== null)
                const contents = [...new Set(ids)].map(labelOf).join(t('track.layerJoin'))
                return (
                  <li key={name} data-layer={name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px 6px 8px', fontSize: 13, lineHeight: '20px', color: palette.fg }}>
                    <Icon name="film" />
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      {name}
                      <span data-layer-contents style={{ maxWidth: 220, fontSize: 11, lineHeight: '14px', color: palette.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {contents === '' ? t('track.layerEmpty') : contents}
                      </span>
                    </span>
                    <TrackButton icon="up" label={t('track.layerUp', { name })} onClick={layerUp(track)} />
                    <TrackButton icon="down" label={t('track.layerDown', { name })} onClick={layerDown(track)} />
                  </li>
                )
              })}
            </ol>
          </div>
        ) : null}
      </span>
      {staleRecord !== undefined
        ? <button type="button" className="dv-tl-btn" style={{ ...button, marginLeft: 6, color: palette.danger }} onClick={() => { keepStale(staleRecord) }}>{t('tool.keepAnyway')}</button>
        : null}
      <span style={{ flex: 1 }} />
      {waiting > 0 ? <span data-testid="dv-timeline-export-waiting" style={{ color: palette.muted, fontSize: 12, lineHeight: '16px', marginRight: 6 }}>{t('tool.exportWaiting', { count: waiting })}</span> : null}
      <button
        type="button" className="dv-tl-btn" style={buttonStyle(exportId === null)} disabled={exportId === null}
        onClick={exportId === null ? undefined : () => { exportTimeline(exportId) }}
      >
        <Icon name="export" />{exporting ? t('tool.exporting') : t('tool.export')}
      </button>
      {exported !== null ? <a href={assetUrl(exported)} target="_blank" rel="noreferrer" data-testid="dv-timeline-exported" style={{ color: palette.accentFg, marginLeft: 6 }}>{t('tool.exported')}</a> : null}
      <span style={{ width: 1, height: 18, background: palette.lineStrong, margin: '0 6px' }} />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: palette.muted, fontSize: 12, lineHeight: '16px' }}>
        {t('tool.zoom')}
        <input type="range" min={5} max={200} value={px} onChange={(event) => { autoFit.current = false; setPx(Number(event.target.value)) }} style={{ width: 110 }} />
      </label>
      <button type="button" className="dv-tl-btn" style={{ ...button, ...textButton }} onClick={() => { autoFit.current = true; fit() }}>{t('tool.fit')}</button>
      {card === undefined ? null : <button type="button" className="dv-tl-btn" style={{ ...button, ...textButton }} onClick={card.open}>{t('tool.openEditor')}</button>}
    </div>
  )

  const playheadLeft = player.position * px
  // A track header: the track's color and its name, cut with an ellipsis, on the first line, and its buttons on a second
  // line under the name, so the buttons never cover the name.
  const trackHeader = (color: string, name: string, buttons: ReactNode): ReactNode => (
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '0 6px 0 14px', fontSize: 12, lineHeight: '16px' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 2, background: color }} />
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      </span>
      {/* The icons' left edge lines up with the color mark: each 16 px icon sits 4 px inside its 24 px button. */}
      <span style={{ display: 'flex', gap: 4, marginLeft: -4 }}>{buttons}</span>
    </span>
  )
  const muteButton = (muted: boolean, name: string, toggle: (() => void) | null): ReactNode => (
    <TrackButton icon={muted ? 'soundOff' : 'sound'} label={t('track.mute', { name })} pressed={muted} onClick={toggle} />
  )
  // The volume button opens the track's volume slider beside it, or closes it when it is open.
  const volumeButtonOf = (kind: 'video' | 'sound', track: number, name: string): ReactNode => {
    const open = volumeSlider?.kind === kind && volumeSlider.track === track
    return (
      <TrackButton
        icon="volume" label={t('track.volume', { name, db: String(volumeDb(kind, track)) })} expanded={open}
        onClick={timeline === null || headerBusy ? null : (event) => {
          volumeButton.current = event.currentTarget
          anchorBeside(event.currentTarget)
          const db = volumeDb(kind, track)
          setVolumeSlider(open ? null : { kind, track, db, written: db })
        }}
      />
    )
  }
  // The video tracks by number: each header mutes the own audio of its clips or deletes its track and has a ＋ that adds a
  // video after the track's last clip, right of the delete button as on every track, and each lane takes a dropped video.
  const videoTrackRows = Array.from({ length: videoTrackCount }, (_, track) => {
    const name = videoTrackName(track)
    const muted = mutedVideoTracks.includes(track)
    const onTrack = clips.filter(clip => clip.track === track)
    return [
      <span
        key={`video-head-${String(track)}`} data-video-track-head={track} {...owned} style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}
        onContextMenu={(event) => { openMenu(event, { kind: 'videoTrack', track }) }}
      >
        {trackHeader(palette.take, name, (
          <>
            {muteButton(muted, name, timeline === null || headerBusy ? null : () => { toggleVideoTrackMute(track) })}
            {volumeButtonOf('video', track, name)}
            <TrackButton icon="delete" label={t('track.deleteVideoTrack', { name })} onClick={timeline === null || headerBusy ? null : () => { removeVideoTrack(track) }} />
            <TrackButton
              icon="add" label={t('track.addToTrack', { name })} expanded={picking && pickTrack === track}
              onClick={timeline === null ? null : (event) => {
                addRef.current = event.currentTarget
                anchorBeside(event.currentTarget)
                setPickingSound(false); setPicking(!picking || pickTrack !== track); setPickTrack(track); setPickAt(null)
              }}
            />
          </>
        ))}
      </span>,
      <div
        key={`video-lane-${String(track)}`} role="list" aria-label={videoTrackCount <= 1 ? t('track.aria') : t('track.videoTrackAria', { n: track + 1 })} data-video-track={track}
        style={{ position: 'relative' }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes(DV_ASSET_DRAG_TYPE)) event.preventDefault() }}
        onDrop={(event) => { dropClip(event, track) }}
        onContextMenu={(event) => { if (timeline !== null) openMenu(event, { kind: 'videoLane', track, atSec: laneTime(event), clientX: event.clientX, clientY: event.clientY }) }}
      >
        {onTrack.map((clip) => {
          const ready = clip.assetId !== null
          const statusText = clip.status === 'failed' ? t('track.renderFailed') : t('track.rendering')
          const assetName = clip.assetId === null ? statusText : labelOf(clip.assetId)
          // Trim handles take at most a quarter of the clip each, so a short clip keeps a body to select and drag.
          const handle = Math.max(2, Math.min(7, Math.floor(clip.seconds * px / 4)))
          const isSelected = clip.clip === selectedClip?.clip
          // The caption and the visible label both name any state that changes what the clip can do. The block shows a
          // long asset name cut short; the caption and the accessible name keep all of it.
          const states = clip.stale ? [t('track.stale')] : []
          const label = [assetName, ...states].join(' · ')
          const shown = [clip.assetId === null ? statusText : shortLabels.get(clip.assetId) ?? shortName(assetName), ...states].join(' · ')
          const caption = [`${assetName} · ${clip.seconds.toFixed(1)}s`, ...states].join(' · ')
          // A placeholder clip is striped, in the danger color when its render failed.
          const placeholderFill = `repeating-linear-gradient(135deg, ${clip.status === 'failed' ? palette.dangerSoft : palette.lineStrong} 0 8px, ${palette.fill} 8px 16px)`
          const picture = clip.assetId === null ? { still: null, tiles: null } : clipPicture({ ...clip, assetId: clip.assetId })
          return (
            <div
              key={clip.clip} role="listitem" {...owned} aria-label={t('track.trackClipAria', { track: name, name: label })} aria-pressed={isSelected}
              data-clip={clip.clip} data-clip-status={clip.status} data-clip-stale={clip.stale} title={caption} {...clipHandlers(clip, 'move')}
              onContextMenu={(event) => { chooseClip(clip.clip); openMenu(event, { kind: 'clip', clip }) }}
              style={{
                ...isSelected ? { zIndex: 1 } : {}, ...placedBlockGeometry(clip, trackDrag?.id === clip.clip ? trackDrag : null), boxSizing: 'border-box', borderRadius: 'var(--dv-radius-sm)', overflow: 'hidden', cursor: 'grab', touchAction: 'none',
                background: !ready ? placeholderFill : picture.still === null ? palette.fill : `${palette.fill} url("${picture.still}") left center / auto 100% repeat-x`,
                // A border in the track color keeps a visible gap between neighboring clips.
                border: `1px solid ${palette.panel}`, ...muted ? { opacity: MUTED_OPACITY } : {},
                boxShadow: [isSelected ? `0 0 0 2px ${palette.accent}` : null, `inset 0 0 0 ${clip.stale ? `2px ${palette.danger}` : `1px ${palette.line}`}`].filter(shadow => shadow !== null).join(', '),
              }}
            >
              {picture.still === null && picture.tiles === null && clip.assetId !== null ? <video src={assetUrl(clip.assetId)} preload="metadata" muted style={{ height: '100%', pointerEvents: 'none' }} /> : null}
              {picture.tiles}
              <span style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: clip.status === 'failed' ? palette.danger : palette.take, pointerEvents: 'none' }} />
              <span style={{ position: 'absolute', left: handle + 3, bottom: 4, maxWidth: `calc(100% - ${String(handle * 2 + 6)}px)`, boxSizing: 'border-box', padding: '0 5px', borderRadius: 4, background: palette.panel, color: palette.fg, fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>
                {shown}
              </span>
              {ready ? (
                <>
                  <span aria-label={t('track.trimStart', { name: assetName })} data-trim="start" className="dv-tl-trim" {...clipHandlers(clip, 'trimStart')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: handle, cursor: 'col-resize' }} />
                  <span aria-label={t('track.trimEnd', { name: assetName })} data-trim="end" className="dv-tl-trim" {...clipHandlers(clip, 'trimEnd')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: handle, cursor: 'col-resize' }} />
                </>
              ) : null}
            </div>
          )
        })}
      </div>,
    ]
  })
  // The sound tracks by number: each header mutes, renames or deletes its track, and each lane holds its sounds.
  const soundTrackRows = Array.from({ length: trackCount }, (_, track) => [
    <span
      key={`head-${String(track)}`} data-sound-track-head={track} {...owned} style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}
      onDoubleClick={() => { startTrackRename(track) }}
      onContextMenu={(event) => { openMenu(event, { kind: 'soundTrack', track }) }}
    >
      {renamingTrack?.track === track ? (
        <input
          autoFocus value={renamingTrack.name} aria-label={t('track.renameAria')}
          onChange={(event) => { setRenamingTrack({ track, name: event.target.value }) }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') commitTrackRename(renamingTrack)
            if (event.key === 'Escape') setRenamingTrack(null)
          }}
          onBlur={() => { commitTrackRename(renamingTrack) }}
          // A double click selects a word and a right click opens the text menu; neither reaches the track header.
          onDoubleClick={(event) => { event.stopPropagation() }}
          onContextMenu={(event) => { event.stopPropagation() }}
          style={{ ...button, width: GUTTER - 16, marginLeft: 8, padding: '0 4px', background: palette.panel, cursor: 'text', fontSize: 12 }}
        />
      ) : trackHeader(palette.sound, trackName(track), (
        <>
          {muteButton(
            mutedTracks.includes(track), trackName(track), timeline === null || headerBusy ? null : () => { toggleTrackMute(track) },
          )}
          {volumeButtonOf('sound', track, trackName(track))}
          <TrackButton icon="delete" label={t('track.deleteNamed', { name: trackName(track) })} onClick={timeline === null || headerBusy ? null : () => { removeTrack(track) }} />
          <TrackButton
            icon="add" label={t('track.addSound')} expanded={pickingSound && soundTrack === track}
            onClick={timeline === null || addingAt !== null ? null : (event) => {
              soundAddRef.current = event.currentTarget
              anchorBeside(event.currentTarget)
              setPicking(false); setSoundTrack(track); setPickAt(null); setPickingSound(!pickingSound || soundTrack !== track)
            }}
          />
        </>
      ))}
    </span>,
    <div
      key={`lane-${String(track)}`} role="group" aria-label={t('track.soundN', { n: track + 1 })} data-sound-track={track} style={{ position: 'relative' }}
      onDrop={(event) => { dropSound(event, track) }}
      onContextMenu={(event) => { if (timeline !== null) openMenu(event, { kind: 'soundLane', track, atSec: laneTime(event), clientX: event.clientX, clientY: event.clientY }) }}
    >
      {sounds.filter(sound => sound.track === track).map((sound) => {
        const handle = Math.max(2, Math.min(7, Math.floor(sound.seconds * px / 4)))
        return (
          <div
            key={sound.sound} data-sound={sound.sound} {...owned} title={t('track.soundItem', { name: sound.name })} aria-pressed={sound.sound === chosenSound}
            {...soundHandlers(sound, 'move')}
            onClick={(event) => {
              event.stopPropagation(); setChosenClip(null); setChosenSound(sound.sound); root.current?.focus()
            }}
            onContextMenu={(event) => {
              setChosenClip(null); setChosenSound(sound.sound)
              openMenu(event, { kind: 'sound', sound })
            }}
            style={{
              boxSizing: 'border-box', cursor: 'grab', touchAction: 'none',
              display: 'flex', flexDirection: 'column', borderRadius: 'var(--dv-radius-sm)', border: `1px solid ${palette.sound}`, background: palette.audioSoft,
              overflow: 'hidden', ...sound.sound === chosenSound ? { boxShadow: `0 0 0 2px ${palette.accent}`, zIndex: 1 } : {},
              ...mutedTracks.includes(track) ? { opacity: MUTED_OPACITY } : {},
              // A dragged sound draws over the others, as a dragged clip does.
              ...placedBlockGeometry(sound, soundDrag?.id === sound.sound ? soundDrag : null),
            }}
          >
            {/* As in common editors, the file name sits in its own strip above the waveform, cut with an ellipsis. */}
            <span style={{ flex: 'none', height: SOUND_NAME_HEIGHT, padding: '0 4px', fontSize: 11, lineHeight: `${String(SOUND_NAME_HEIGHT)}px`, color: palette.fg, background: palette.panel, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {sound.name}
            </span>
            <span style={{ position: 'relative', flex: 1, minHeight: 0 }}>
              <AudioWaveform
                assetId={sound.assetId} inSec={sound.inSec} outSec={sound.inSec + sound.seconds} width={sound.seconds * px}
                height={ROW_HEIGHT - 2 - SOUND_NAME_HEIGHT}
              />
            </span>
            <span data-trim="start" className="dv-tl-trim" {...soundHandlers(sound, 'trimStart')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: handle, cursor: 'col-resize' }} />
            <span data-trim="end" className="dv-tl-trim" {...soundHandlers(sound, 'trimEnd')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: handle, cursor: 'col-resize' }} />
          </div>
        )
      })}
    </div>,
  ])
  // The track rows, top to bottom in the order the tracks were added.
  const trackRowElements = shownRows.map(row => row.kind === 'video' ? videoTrackRows[row.track] : soundTrackRows[row.track])
  // The heights of the ruler and the rows, top to bottom, and where the line under each row sits.
  const rowHeights = [RULER_HEIGHT, ...shownRows.map(() => ROW_HEIGHT)]
  const rowLines = rowHeights.map((_, index) =>
    rowHeights.slice(0, index + 1).reduce((sum, height) => sum + height, 0) + index * ROW_GAP + ROW_GAP / 2)
  // The playhead spans the ruler and every row.
  const playheadHeight = rowHeights.reduce((sum, height) => sum + height, 0) + (rowHeights.length - 1) * ROW_GAP
  const tracks = (
    <div
      ref={scroller}
      {...card === undefined
        ? { className: 'dv-tl-autohide-scrollbar', onScroll: (event: UIEvent<HTMLDivElement>) => { showScrollbars(event.currentTarget) } }
        : { 'data-dv-scroll-island': '', className: 'dv-tl-no-scrollbar' }}
      style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', position: 'relative', paddingBottom: TRACK_PADDING }}
    >
      {/* A line in the middle of the gap under each row, across the header column and the lanes, and a line at the
          header column's right edge, drawn under the rows. */}
      <div aria-hidden data-testid="dv-timeline-grid" style={{ position: 'absolute', top: 0, left: 0, width: GUTTER + laneWidth, minWidth: '100%', height: rowLines.at(-1), pointerEvents: 'none' }}>
        {rowLines.map(top => <span key={top} style={{ position: 'absolute', left: 0, right: 0, top, height: 1, background: palette.line }} />)}
        <span style={{ position: 'absolute', top: 0, bottom: 0, left: GUTTER - 1, width: 1, background: palette.line }} />
      </div>
      <div ref={rows} style={{ position: 'relative', display: 'grid', gridTemplateColumns: `${String(GUTTER)}px ${String(laneWidth)}px`, gridTemplateRows: rowHeights.map(height => `${String(height)}px`).join(' '), rowGap: ROW_GAP, minWidth: GUTTER + laneWidth }}>
        <span />
        <div
          ref={lane} data-testid="dv-timeline-ruler" {...owned} style={{ position: 'relative', cursor: 'ew-resize' }}
          onPointerDown={(event) => { capture(event); scrubbing.current = true; seekFromPointer(event) }}
          onPointerMove={(event) => { if (scrubbing.current) seekFromPointer(event) }}
          onPointerUp={() => { scrubbing.current = false }}
        >
          {rulerMarks}
        </div>
        {trackRowElements}
      </div>
      <div
        aria-label={t('track.playhead')} data-testid="dv-timeline-playhead"
        style={{ position: 'absolute', top: 0, height: playheadHeight, left: GUTTER + playheadLeft, width: 2, marginLeft: -1, background: palette.accent, pointerEvents: 'none', zIndex: 4 }}
      >
        <span style={{ position: 'absolute', top: 0, left: -5, width: 12, height: 12, background: palette.accent, borderRadius: '3px 3px 6px 6px' }} />
      </div>
    </div>
  )

  // The toolbar, the tracks, and the asset picker share one panel; the picker opens in the area under the toolbar,
  // outside the horizontally scrolling tracks, so the scroll area does not clip it and a wrapped toolbar does not cover
  // it. The picker opens at `pickAnchor` and ends at least 8 px inside the area, whose bottom sits on the window's bottom
  // edge, and only its list scrolls, so its title and close button stay in view. Focus that leaves the picker and ＋ closes it. A
  // resized panel gives its extra height to the scrolling track rows, which keep their own heights at the top.
  /**
   * @param tallest - the picker's or the dialog's height when the area has room for it, in pixels.
   * @returns its position at `pickAnchor`, and a height that keeps it 8 px inside the area.
   */
  const pickerPlace = (tallest: number): CSSProperties => ({
    position: 'absolute', left: pickAnchor.left, [pickAnchor.edge]: pickAnchor.offset,
    maxHeight: `min(${String(tallest)}px, calc(100% - ${String(pickAnchor.offset + 8)}px))`,
  })
  // The picker's title says where the picked asset goes: after the track's last clip, or the time a lane menu was opened at.
  const pickTitle = pickAt === null ? t('track.pick') : t('track.pickAt', { at: timecode(pickAt) })
  const editPanel = (
    <div ref={panel} style={{ ...card === undefined ? { ...trackHeight === null ? { flex: '0 1 auto', minHeight: 0 } : { flex: 'none', height: trackHeight } } : { flex: '1 1 auto', minHeight: 0 }, display: 'flex', flexDirection: 'column', background: palette.panel }}>
      {toolbar}
      <div ref={pickArea} data-testid="dv-timeline-track-area" onBlur={closeOnFocusOut} style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {tracks}
        {volumeSlider === null ? null : (() => {
          const name = volumeSlider.kind === 'video' ? videoTrackName(volumeSlider.track) : trackName(volumeSlider.track)
          return (
            <div
              ref={volumeRef} role="dialog" aria-label={t('track.volumeSlider', { name })}
              style={{
                ...pickerPlace(80), width: 220, boxSizing: 'border-box', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
                background: palette.panel, border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-lg)', boxShadow: 'var(--dv-shadow-2)', zIndex: 5,
              }}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, lineHeight: '16px' }}>
                <span style={{ minWidth: 0, color: palette.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('track.volumeSlider', { name })}</span>
                <span style={{ fontFamily: palette.mono }}>{t('track.volumeDb', { db: String(volumeSlider.db) })}</span>
              </span>
              <input
                type="range" min={MIN_VOLUME_DB} max={0} step={1} value={volumeSlider.db} aria-label={t('track.volumeSlider', { name })}
                onChange={(event) => { setVolumeSlider({ ...volumeSlider, db: Number(event.target.value) }) }}
                onPointerUp={() => { storeVolume(volumeSlider) }} onKeyUp={() => { storeVolume(volumeSlider) }}
                style={{ width: '100%', margin: 0, accentColor: palette.accent }}
              />
              <span style={{ display: 'flex', justifyContent: 'space-between', fontFamily: palette.mono, fontSize: 11, lineHeight: '14px', color: palette.muted }}>
                <span>{t('track.volumeDb', { db: String(MIN_VOLUME_DB) })}</span>
                <span>{t('track.volumeMax')}</span>
              </span>
            </div>
          )
        })()}
        {pickingSound ? (
          <div
            ref={soundPickerRef} role="dialog" aria-label={t('track.addSound')}
            style={{ ...pickerPlace(234), boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: palette.panel, border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-lg)', boxShadow: 'var(--dv-shadow-1)', padding: 6, zIndex: 5, minWidth: 200 }}
          >
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
              <p style={{ flex: 1, margin: 0, color: palette.muted, fontSize: 12, lineHeight: '16px' }}>{t('track.soundStart', { at: timecode(soundStart) })}</p>
              <IconButton icon="close" label={t('track.pickClose')} onClick={closeSoundPicker} />
            </div>
            <div style={{ minHeight: 0, overflow: 'auto' }}>
              <button type="button" className="dv-tl-btn" style={{ ...menuItem, marginTop: 4 }} onClick={() => { upload.current?.click() }}>
                {t('track.uploadAudio')}
              </button>
              <input
                ref={upload} type="file" accept="audio/*" hidden aria-label={t('track.uploadAudio')}
                onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file !== undefined) uploadSound(file) }}
              />
              {audioCandidates.length === 0 ? <p style={{ margin: '4px 0 0' }}>{t('track.noAudio')}</p> : audioCandidates.map(entry => (
                <button key={entry.id} type="button" className="dv-tl-btn" style={{ ...menuItem, marginTop: 4 }} onClick={() => { addSound(entry.id) }}>
                  {labelOf(entry.id)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {picking ? (
          <div
            ref={pickerRef} role="dialog" aria-label={pickTitle}
            style={{ ...pickerPlace(194), boxSizing: 'border-box', display: 'flex', flexDirection: 'column', background: palette.panel, border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-lg)', boxShadow: 'var(--dv-shadow-1)', padding: 6, zIndex: 5, minWidth: 180 }}
          >
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
              <p style={{ flex: 1, margin: 0, color: palette.muted, fontSize: 12, lineHeight: '16px' }}>{pickTitle}</p>
              <IconButton icon="close" label={t('track.pickClose')} onClick={closePicker} />
            </div>
            <div style={{ minHeight: 0, overflow: 'auto' }}>
              {candidates.length === 0 ? <p style={{ margin: 0 }}>{t('track.noAssets')}</p> : candidates.map(entry => (
                <button
                  key={entry.id} type="button" className="dv-tl-btn" style={{ ...menuItem, marginTop: 4 }}
                  onClick={() => {
                    setPicking(false)
                    addClip(entry.id, pickTrack, pickAt ?? trackEndOf(pickTrack) ?? player.position)
                  }}
                >
                  {labelOf(entry.id)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div ref={soundBox} hidden>
        {sounds.map(sound => (
          <audio
            key={sound.sound} data-sound={sound.sound} src={assetUrl(sound.assetId)} preload="metadata" muted={mutedTracks.includes(sound.track)}
            onLoadedMetadata={(event) => {
              const seconds = event.currentTarget.duration
              if (Number.isFinite(seconds) && seconds > 0) setMeasured(current => new Map(current).set(sound.assetId, seconds))
            }}
          />
        ))}
      </div>
      {trackMenu !== null ? (
        <div ref={trackMenuRef} role="menu" style={{ position: card === undefined ? 'fixed' : 'absolute', left: trackMenu.x, top: trackMenu.y, zIndex: 20, background: palette.panel, border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-xl)', padding: 6, boxShadow: 'var(--dv-shadow-2)', minWidth: 140 }}>
          {menuItems(trackMenu.on)}
        </div>
      ) : null}
    </div>
  )

  // File and asset drags stop at the editor, so the chat composer's document-level drop listener never attaches a file
  // dropped here. Only asset tiles can land on the track; a dropped file gets a notice.
  const ownsDrag = (event: DragEvent<HTMLDivElement>): boolean => event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes(DV_ASSET_DRAG_TYPE)
  const holdDrag = (event: DragEvent<HTMLDivElement>): void => {
    if (!ownsDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
  }
  const dropOutside = (event: DragEvent<HTMLDivElement>): void => {
    if (!ownsDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer.types.includes('Files') && !event.dataTransfer.types.includes(DV_ASSET_DRAG_TYPE)) setDropNotice({ text: 'track.fileDrop' })
  }

  return (
    <div
      onDragEnter={holdDrag} onDragOver={holdDrag} onDrop={dropOutside}
      ref={root} tabIndex={0} onKeyDown={onKeyDown} data-testid="dv-timeline-editor" className="dv-tl-editor" {...card === undefined ? {} : { 'data-node-keys': '' }}
      style={{
        display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative', background: palette.bg,
        // A card lays the editor out `scale` times smaller than its box and draws it `scale` times larger, filling the box.
        ...card === undefined
          ? {}
          : { width: `${String(100 / cardScale)}%`, height: `${String(100 / cardScale)}%`, transform: `scale(${String(cardScale)})`, transformOrigin: '0 0' },
        color: palette.fg, fontFamily: 'var(--dv-font-sans)', fontSize: 13, lineHeight: '20px', outline: 'none',
      }}
    >
      <style>{EDITOR_CSS}</style>
      {card === undefined ? tabs : null}
      {dropNotice !== null ? <p role="status" style={{ margin: 0, padding: '4px 12px', color: palette.muted, fontSize: 12, lineHeight: '16px' }}>{t(dropNotice.text)}</p> : null}
      {card === undefined ? viewer : card.viewer === null ? null : createPortal(viewer, card.viewer)}
      {card === undefined ? resizeHandle : null}
      {editPanel}
    </div>
  )
}
