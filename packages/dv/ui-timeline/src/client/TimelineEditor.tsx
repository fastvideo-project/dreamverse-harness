/**
 * The timeline editor: one tab per timeline of the project, a 16:9 preview that fills the free height and plays the
 * selected timeline across its clips (with skip, play, playback-speed, and full-screen controls under it), a toolbar, a
 * ruler, the 视频 track with filmstrip clips sized by duration, a display-only 原声 track with one block per clip that
 * shows the waveform of the clip's own audio once it decodes, and under it the video tracks with their clips at their
 * start times and the sound tracks, whose sound blocks play in step with the preview (`sound-playback.ts`). The 视频
 * track header's speaker button mutes the clips' own audio, and each sound track header's speaker button mutes that
 * track, through `timeline.mute`; the preview plays muted audio silent.
 * Each sound track header also has a delete button. A sound moves in time and to another sound track by a drag, its
 * edges trim it, and it splits at the playhead. A drag handle
 * above the track area sets the track area's height, which each browser remembers. Every edit is one
 * `/api/dv/operation` call of a `timeline.*` operation with `surface: 'timeline'`; the clip operations name the clip by
 * its clip ID, the sound operations name the sound by its sound ID or the sound track by its number, and every edit
 * goes after the current position of the project's history, the state the editor shows. A selected stale clip offers
 * "仍然保留", which keeps the record that made its asset (`proj.stale_accept`). A placeholder clip, whose render is still
 * running (渲染中…) or failed (渲染失败), keeps its place and its planned length on the track; it cannot be trimmed or split,
 * playback skips it, and export waits until every clip is ready.
 *
 * Every track the toolbar's 添加轨道 menu adds, a video track or a sound track, goes at the bottom, and the rows under the
 * 原声 row keep the order the tracks were added in (the timeline's `track_order`). Once there is another video track, the
 * 视频 track is 视频 1 and the video tracks are 视频 2, 视频 3, … in the order they were added. The 视频 track covers them
 * while it has a clip; after its end, the preview shows and plays the clip of the video track with the lowest number
 * there. Each item of the 添加轨道 menu writes one `timeline.track_add`, which stores an empty track, so a new track stays
 * after a reload and the menu can add several in a row. A track clip moves in time by a drag, to another video track
 * by a drag up or down, and its edges trim it; each track header mutes or deletes its track, and deleting the 视频 track
 * makes video track 0 the 视频 track (`timeline.main_track_remove`). A right click in the track area opens a menu of
 * what the clip, header, row or free spot under it offers, each item writing what the matching button writes.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, DragEvent, FocusEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, RefObject, UIEvent } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { Timeline, TrackKind } from '@dv/timeline/types'
import { assetUrl } from '@dv/ui-kit/api.ts'
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
import { trackClipPreload, useTrackClipPlayback } from './track-clip-playback.ts'
import {
  audioAssets, clipIndexAt, dropPosition, nextTimelineId, placeSounds, placeTimeline, placeTrackClips, timecode, timelinesOf,
  topTrackClipAt, trackRows, videoAssets,
} from './timelines.ts'
import type { PlacedTrackClip, TrackClip, TrackSound } from './timelines.ts'
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
  /**
   * Select the timeline that the user picked or created, or the one shown before a create that failed. Absent in a card,
   * whose editor shows no timeline tabs.
   */
  select?: (timelineId: string | null) => void
  /** The clip that the editor selects and seeks to once it shows the clip's timeline, or null. */
  clipFocus?: { timelineId: string; clipId: string } | null
  /** Drop {@link TimelineEditorProps.clipFocus} once the editor took it. */
  takeClipFocus?: () => void
  /**
   * Draw the editor inside a canvas card instead of a panel; absent for the panel of the 时间线 tab and center view. A
   * card has no timeline tabs and no track-area resize, and its track area fills the editor and scrolls both ways
   * without a scrollbar, by wheel or touchpad. The preview renders into `viewer` (none while it is null), centered on
   * it and `previewWidth` wide (default: as wide as `viewer`), with the first ready clip's aspect ratio and a progress
   * bar that a press moves the playhead along. The editor and the preview draw everything `scale` times larger
   * (default 1) while still filling their boxes, so their text grows with the node. The menus open inside the editor,
   * pointer positions are divided by the canvas zoom that scales the editor, and the toolbar ends with 打开编辑器 /
   * Open editor, which calls `open`. The editor marks its root and the preview `data-node-keys`, and its ruler, clips,
   * sounds and sound track headers `data-node-interactive`, so the canvas leaves their keys and presses to it and
   * moves the node on a press anywhere else.
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

/** An edge or body drag on a clip of the 视频 track, in progress; a body drag of a ready clip also moves up or down. */
interface ClipDrag {
  kind: 'move' | 'trimStart' | 'trimEnd'
  position: number
  startX: number
  startY: number
  dx: number
  dy: number
}

/**
 * An edge or body drag on a clip of a video track under the 视频 track or on a sound, in progress; a body drag also moves
 * up or down, to another video track or sound track.
 */
interface BlockDrag {
  kind: ClipDrag['kind']
  /** The dragged clip's clip ID or the dragged sound's sound ID. */
  id: string
  startX: number
  startY: number
  dx: number
  dy: number
}

/**
 * What a right click in the track area opened its menu on: a sound, a clip of the 视频 track or of a video track under
 * it, a video track header (`main` for the 视频 track's), a sound track header, the 原声 row, or a free spot of a video
 * or sound lane at a time in seconds, with the point on screen where the click landed.
 */
type TrackMenu =
  | { kind: 'sound'; sound: TrackSound }
  | { kind: 'clip'; clip: TrackClip }
  | { kind: 'trackClip'; clip: PlacedTrackClip }
  | { kind: 'videoTrack'; track: number | 'main' }
  | { kind: 'soundTrack'; track: number }
  | { kind: 'audio' }
  | { kind: 'videoLane'; track: number | 'main'; atSec: number; clientX: number; clientY: number }
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
 * Height of the 视频 track and of each sound track, in pixels; their headers hold the track's name with its buttons on a
 * second line under it.
 */
const ROW_HEIGHT = 56
/** Height of the 原声 track, which has no buttons, in pixels. */
const AUDIO_HEIGHT = 36
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
@media (hover: hover) { .dv-tl-editor .dv-tl-btn:not(:disabled):hover { background: var(--dv-surface-3); } }
.dv-tl-editor :focus-visible { outline: 2px solid var(--dv-accent); outline-offset: 1px; }
.dv-tl-editor .dv-tl-trim { background: var(--dv-line-strong); transition: background-color 120ms var(--dv-ease); }
@media (hover: hover) { .dv-tl-editor .dv-tl-trim:hover { background: var(--dv-accent); } }
.dv-tl-editor input[type="range"] { accent-color: var(--dv-accent); }
.dv-tl-editor .dv-tl-resize { background: var(--dv-line); transition: background-color 120ms var(--dv-ease); }
.dv-tl-editor .dv-tl-resize::before { content: ""; position: absolute; left: 0; right: 0; top: -4px; bottom: -4px; }
.dv-tl-editor .dv-tl-resize[data-dragging="true"] { background: var(--dv-accent); }
@media (hover: hover) { .dv-tl-editor .dv-tl-resize:hover { background: var(--dv-accent); } }
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
  border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-menu)', boxShadow: 'var(--dv-shadow-2)',
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
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
 * `MIN_PREVIEW_HEIGHT`, and raised to the height the toolbar, the ruler and the 视频 track need. The track area's minimum
 * wins when the editor is too short for both.
 * @param requested - the height the drag or key press asks for, in pixels.
 * @param available - the height the preview and the track area share, in pixels.
 * @param minTrack - the height the toolbar, the ruler and the 视频 track need, in pixels.
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
 * The waveform of one clip on the 原声 track: one bar per `WAVE_BAR + WAVE_GAP` pixels of the clip's width, each the
 * peak of the clip's audio over that slice of its played range. It draws nothing while the audio decodes or when the
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
 * The clip the user selected: its timeline, its position when selected, and its clip ID, so neither an edit elsewhere
 * nor a timeline switch can move the selection onto another clip, and a placeholder clip stays selected when its render
 * finishes.
 */
interface SelectedClip {
  timelineId: string | null
  position: number
  clip: string
}

/**
 * The position of the selected clip in the clips shown now: the position of the clip with the selected clip ID, else
 * none.
 * @param clips - the placed clips.
 * @param timelineId - the shown timeline.
 * @param chosen - the selected clip, or null.
 * @returns the position, or null.
 */
function resolveSelection(clips: TrackClip[], timelineId: string | null, chosen: SelectedClip | null): number | null {
  if (chosen === null || chosen.timelineId !== timelineId) return null
  return clips.find(clip => clip.clip === chosen.clip)?.position ?? null
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
  const { clips, total } = useMemo(() => placeTimeline(state, timeline), [state, timeline])
  const assets = useMemo(() => assetIndex(state), [state])
  const placedTracks = useMemo(() => placeTrackClips(state, timeline), [state, timeline])
  // Every ready clip shows its video's frames across its width once they are read (`clipPicture`).
  const videoUrls = [...new Set(clips.flatMap(clip => clip.assetId === null ? [] : [assetUrl(clip.assetId)])
    .concat(placedTracks.clips.map(clip => assetUrl(clip.assetId))))]
  const strips = useFilmstrips(videoUrls)
  const candidates = useMemo(() => videoAssets(state), [state])
  const audioCandidates = useMemo(() => audioAssets(state), [state])
  // The lengths that the sound elements measured, for audio assets whose length the state does not know.
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(new Map())
  const { sounds, end: soundsEnd } = useMemo(() => placeSounds(state, timeline, measured), [state, timeline, measured])
  const { clips: trackClips, tracks: videoTrackCount, end: trackClipsEnd } = placedTracks
  // The preview plays to the end of the longest video track; the lanes also reach the last sound.
  const videoSpan = Math.max(total, trackClipsEnd)
  const span = Math.max(videoSpan, soundsEnd)
  const timelineId = timeline?.id ?? null
  const [playbackRate, setPlaybackRate] = useState(readPlaybackRate)
  const player = useTimelinePlayer(timelineId, clips, total, playbackRate, videoSpan)
  // The track clip the user sees at the playhead after the 视频 track's end, which hides the tracks with higher numbers.
  const topClip = topTrackClipAt(trackClips, player.position, total)
  // Past the 视频 track's last clip, while a track clip still follows, the 视频 track shows nothing.
  const pastMain = player.position >= total && videoSpan > total + 0.05
  // A card's preview mounts its video elements when the node is selected; they show the frame at the playhead then.
  const cardViewer = card?.viewer ?? null
  const cardScale = card?.scale ?? 1
  // A press on the card preview's progress bar moves the playhead to the same share of the timeline.
  const seekAlong = (event: PointerEvent<HTMLElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    player.seek((event.clientX - box.left) / Math.max(box.width, 1) * videoSpan)
  }
  // In a card, the elements that take their own presses carry the canvas's marks; a press anywhere else moves the node.
  const owned = card === undefined ? {} : { 'data-node-interactive': '' }
  useEffect(() => { if (cardViewer !== null) player.seek(player.position) }, [cardViewer])
  const soundBox = useRef<HTMLDivElement | null>(null)
  useSoundPlayback(soundBox, sounds, player.position, player.playing, playbackRate)
  const frame = useRef<HTMLDivElement | null>(null)
  useTrackClipPlayback(frame, trackClips, player.position, player.playing, playbackRate, topClip?.clip ?? null)
  const mutedVideoTracks = timeline?.muted_video_tracks ?? []
  const videoTrackName = (track: number): string => t('track.videoN', { n: track + 2 })
  const mainTrackName = videoTrackCount === 0 ? t('track.video') : t('track.videoN', { n: 1 })
  const [chosenTrackClip, setChosenTrackClip] = useState<string | null>(null)
  const selectedTrackClip = trackClips.find(clip => clip.clip === chosenTrackClip)
  const [trackDrag, setTrackDrag] = useState<BlockDrag | null>(null)
  const [soundDrag, setSoundDrag] = useState<BlockDrag | null>(null)
  // The video track the asset picker adds to, or null for the 视频 track.
  const [pickTrack, setPickTrack] = useState<number | null>(null)
  // The time a lane's right-click menu chose for the asset picker or the sound dialog to add at; null adds after the
  // track's last clip or sound, as its ＋ does.
  const [pickAt, setPickAt] = useState<number | null>(null)
  const [pickingSound, setPickingSound] = useState(false)
  const upload = useRef<HTMLInputElement | null>(null)
  const soundPickerRef = useRef<HTMLDivElement | null>(null)
  // The sound track ＋ that opened the sound dialog; each track has its own ＋.
  const soundAddRef = useRef<HTMLButtonElement | null>(null)
  // The kinds of the stored tracks under the 原声 row, top to bottom; without a timeline, the one sound track it shows.
  const trackOrder = timeline?.track_order ?? ['sound']
  // Sound tracks: the tracks the timeline stores, up to the last track with a sound, a name, or a mute, and the empty
  // tracks `track_order` lists; the same count as the reducer's `soundTrackCount`.
  const trackNames = timeline?.sound_track_names ?? []
  const mutedTracks = timeline?.muted_sound_tracks ?? []
  const videoMuted = timeline?.video_muted ?? false
  const trackCount = Math.max(
    trackNames.length, ...sounds.map(sound => sound.track + 1), ...mutedTracks.map(track => track + 1),
    trackOrder.filter(kind => kind === 'sound').length,
  )
  const trackName = (track: number): string => trackNames[track] || t('track.soundN', { n: track + 1 })
  const [renamingTrack, setRenamingTrack] = useState<{ track: number; name: string } | null>(null)
  // The tops of the rows under the 原声 row, in pixels from the 视频 track's top; the 原声 row is lower than a track row.
  const rowTops = trackRows(trackOrder, videoTrackCount, trackCount)
    .map((row, index) => ({ ...row, top: ROW_HEIGHT + AUDIO_HEIGHT + 2 * ROW_GAP + index * (ROW_HEIGHT + ROW_GAP) }))
  // The tops of the 视频 track's row (`main`) and of each video track's row.
  const videoRowTops: Array<{ track: number | 'main'; top: number }> = [
    { track: 'main', top: 0 },
    ...rowTops.flatMap(row => row.kind === 'video' ? [{ track: row.track, top: row.top }] : []),
  ]
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
  // A clip ends on the 视频 track's row (`main`) or a video track's, and a sound on a sound track's.
  const nearestVideoRow = (track: number | 'main', dy: number): number | 'main' => nearestRow(videoRowTops, track, dy)
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
  const selected = resolveSelection(clips, timelineId, chosenClip)
  const setSelected = (position: number | null): void => {
    if (position !== null) { setChosenSound(null); setChosenTrackClip(null) }
    const clip = clips.find(placed => placed.position === position)
    setChosenClip(position === null || clip === undefined ? null : { timelineId, position, clip: clip.clip })
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
  const [dropNotice, setDropNotice] = useState<{ text: 'track.fileDrop' | 'track.videoDrop' | 'track.videoOnly' | 'track.soundDrop' } | null>(null)
  const [drag, setDrag] = useState<ClipDrag | null>(null)
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
    setChosenTrackClip(null); setPickTrack(null); setPickAt(null); setToolPopover(null)
    soundAdds.current += 1; setPendingSound(null)
  }, [timelineId])

  useEffect(() => {
    if (clipFocus === null || clipFocus.timelineId !== timelineId) return
    takeClipFocus?.()
    const clip = clips.find(placed => placed.clip === clipFocus.clipId)
    if (clip === undefined) return
    setChosenSound(null); setChosenTrackClip(null)
    setChosenClip({ timelineId, position: clip.position, clip: clip.clip })
    player.seek(clip.startSec)
  }, [clipFocus, timelineId, clips])

  // Keep the stored selection on the position it resolved to after an edit elsewhere.
  useEffect(() => {
    if (chosenClip === null || selected === chosenClip.position) return
    setChosenClip(selected === null ? null : { ...chosenClip, position: selected })
  }, [chosenClip, selected])

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

  // A timeline without a stored name shows the numbered default name of its ID in the interface language.
  const numbered = (n: number): string => t('tabs.defaultTitle', { n })
  const nameOf = (entry: Timeline): string => timelineName(entry, numbered)
  const shownName = timeline === null ? '' : nameOf(timeline)
  // An insert names the shown timeline; the other clip operations name the clip by its clip ID, which names its timeline.
  const runOperation = (operation: string, params: Record<string, unknown>, intent: string): Promise<boolean> => {
    const named = [
      'timeline.clip_insert', 'timeline.sound_track_remove', 'timeline.sound_track_rename', 'timeline.mute',
      'timeline.track_clip_add', 'timeline.video_track_remove', 'timeline.track_add', 'timeline.video_track_move',
      'timeline.main_track_remove', 'timeline.main_track_swap',
    ].includes(operation)
    const scoped = timeline === null || !named ? params : { timeline: timeline.id, ...params }
    return run(() => client.runOperation(request(project, session, { operation, params: scoped, intent })))
  }
  // A new sound goes right after the last sound of its track, or at the playhead on an empty track, or where a lane's
  // right-click menu was opened; an uploaded file is imported first and then added the same way.
  const trackEnd = Math.max(0, ...sounds.filter(sound => sound.track === soundTrack).map(sound => sound.startSec + sound.seconds))
  const soundStart = round(pickAt ?? (sounds.some(sound => sound.track === soundTrack) ? trackEnd : player.position))
  // Every ＋ of the sound tracks is disabled while a sound add runs, and then until the shown sounds include the sound ID
  // that its record names, so the next add starts after that sound instead of at the same time. A failed add, a record
  // that names no sound ID, and a switch to another timeline enable them at once. `pendingSound` is `true` while the add
  // runs, then the awaited sound ID; `soundAdds` counts the adds and timeline switches, so an add that ends after a
  // switch to another timeline leaves `pendingSound` alone.
  const [pendingSound, setPendingSound] = useState<true | string | null>(null)
  const soundAdds = useRef(0)
  useEffect(() => {
    if (sounds.some(sound => sound.sound === pendingSound)) setPendingSound(null)
  }, [pendingSound, sounds])
  const addingSound = (work: () => Promise<string | null>): void => {
    const add = ++soundAdds.current
    setPendingSound(true)
    let added: string | null = null
    void run(async () => { added = await work() }).then((ok) => {
      if (soundAdds.current === add) setPendingSound(ok ? added : null)
    })
  }
  // A sound add whose record failed, such as one naming an asset that is not audio, throws the record's error, so the
  // view shows it as its notice and the ＋ buttons are enabled again. A finished record names the new sound ID first in
  // its `report.sounds`.
  const writeSound = async (asset: string, at: number, track: number): Promise<string | null> => {
    const params = { timeline: timelineId, asset, start_sec: at, track }
    const record = await client.runOperation(request(project, session, { operation: 'timeline.sound_add', params, intent: t('intent.soundAdd', { at: timecode(at) }) }))
    if (record.status === 'failed') throw new Error(record.error?.message ?? record.status)
    const reported = record.report?.['sounds']
    const sound: unknown = Array.isArray(reported) ? reported[0] : undefined
    return typeof sound === 'string' ? sound : null
  }
  const addSound = (asset: string): void => {
    setPickingSound(false)
    const at = soundStart
    addingSound(() => writeSound(asset, at, soundTrack))
  }
  const removeSound = (sound: TrackSound): void => {
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
  const toggleVideoMute = (): void => {
    headerWrite(runOperation('timeline.mute', { target: 'video', muted: !videoMuted }, t(videoMuted ? 'intent.unmuteVideo' : 'intent.muteVideo')))
  }
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
  // A video track is deleted with its clips and its mute, and the tracks with higher numbers move up.
  const removeVideoTrack = (track: number): void => {
    headerWrite(runOperation('timeline.video_track_remove', { track }, t('intent.videoTrackRemove', { n: track + 2 })))
  }
  // The 视频 track's delete button deletes its clips, and video track 0, if there is one, becomes the 视频 track.
  const mainTrackRemovable = clips.length > 0 || videoTrackCount > 0
  const removeMainTrack = (): void => {
    headerWrite(runOperation('timeline.main_track_remove', {}, t('intent.mainTrackRemove', { name: mainTrackName })))
  }
  // An arrow of the track layers list, or 上移 / 下移 in a video track header's menu, swaps a video track with the one
  // above or below it, which swaps which of the two covers the other. Between the 视频 track and video track 0, the swap
  // is `timeline.main_track_swap`, which needs every clip of the 视频 track rendered.
  const moveVideoTrack = (track: number, to: number): void => {
    const name = videoTrackName(track)
    headerWrite(runOperation('timeline.video_track_move', { track, to }, t(to < track ? 'intent.videoTrackUp' : 'intent.videoTrackDown', { name })))
  }
  const swapMainTrack = (): void => {
    headerWrite(runOperation('timeline.main_track_swap', {}, t('intent.mainTrackSwap', { name: mainTrackName, other: videoTrackName(0) })))
  }
  const mainTrackSwappable = videoTrackCount > 0 && clips.every(clip => clip.assetId !== null)
  /**
   * @param track - a video track under the 视频 track, or null for the 视频 track.
   * @returns what moving the track one row up does, or null when it cannot move up now.
   */
  const layerUp = (track: number | null): (() => void) | null => {
    if (track === null || headerBusy) return null
    if (track === 0) return mainTrackSwappable ? swapMainTrack : null
    return () => { moveVideoTrack(track, track - 1) }
  }
  /**
   * @param track - a video track under the 视频 track, or null for the 视频 track.
   * @returns what moving the track one row down does, or null when it cannot move down now.
   */
  const layerDown = (track: number | null): (() => void) | null => {
    if (headerBusy) return null
    if (track === null) return mainTrackSwappable ? swapMainTrack : null
    return track === videoTrackCount - 1 ? null : () => { moveVideoTrack(track, track + 1) }
  }
  // Each item of the 添加轨道 menu writes one `timeline.track_add`, which adds an empty track at the bottom.
  const addTrack = (kind: TrackKind): void => {
    setToolPopover(null)
    headerWrite(runOperation('timeline.track_add', { kind }, t(kind === 'video' ? 'intent.videoTrackAdd' : 'intent.soundTrackAdd')))
  }
  const addTrackDisabled = timeline === null || headerBusy
  // A video goes on a video track where it was dropped, or from the picker after the track's last clip, else at the playhead.
  const addTrackClip = (asset: string, track: number, at: number): void => {
    const startSec = round(Math.max(0, at))
    void runOperation('timeline.track_clip_add', { asset, track, start_sec: startSec }, t('intent.trackClipAdd', { name: videoTrackName(track), at: timecode(startSec) }))
  }
  const trackClipEnd = (track: number): number | null => {
    const ends = trackClips.filter(clip => clip.track === track).map(clip => clip.startSec + clip.seconds)
    return ends.length === 0 ? null : Math.max(...ends)
  }
  const removeTrackClip = (clip: PlacedTrackClip): void => {
    void runOperation('timeline.clip_remove', { clip: clip.clip }, t('intent.trackClipRemove', { name: videoTrackName(clip.track) }))
      .then((ok) => { if (ok) setChosenTrackClip(null) })
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
    if (timeline === null || pendingSound !== null) return
    const at = round(Math.max(0, (event.clientX - event.currentTarget.getBoundingClientRect().left) / screenScale() / px))
    addingSound(() => writeSound(dropped.id, at, track))
  }
  // A video tile dropped on a video track under the 视频 track goes on that track where it was dropped.
  const dropTrackClip = (event: DragEvent<HTMLDivElement>, track: number): void => {
    const dropped = takeDrop(event)
    if (dropped === null) return
    if (dropped.type !== 'video') {
      setDropNotice({ text: 'track.videoDrop' })
      return
    }
    addTrackClip(dropped.id, track, (event.clientX - event.currentTarget.getBoundingClientRect().left) / screenScale() / px)
  }
  const uploadSound = (file: File): void => {
    setPickingSound(false)
    const at = soundStart
    addingSound(async () => {
      const { asset } = await client.importAsset(project, file, 'asset_pool', session)
      return writeSound(asset, at, soundTrack)
    })
  }

  // A created timeline stores no name; `nameOf` shows the numbered default name of its ID.
  const createTimeline = (): void => {
    const id = nextTimelineId(timelines)
    const name = timelineName({ id, name: '' }, numbered)
    select?.(id)
    void run(() => client.runOperation(request(project, session, { operation: 'timeline.create', params: { timeline: id, assets: [] }, intent: t('intent.create', { name }) })))
      .then((ok) => {
        if (ok) return
        select?.(timelineId)
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
  const remove = (clip: TrackClip): void => {
    void runOperation('timeline.clip_remove', { clip: clip.clip }, t('intent.remove', { position: clip.position })).then((ok) => { if (ok) setSelected(null) })
  }
  const insert = (at: number, asset: string): void => {
    void runOperation('timeline.clip_insert', { at, asset }, t('intent.insert', { at }))
  }
  // The record behind the selected clip's asset, while it is stale: the record "keep anyway" accepts.
  const selectedClip = clips.find(placed => placed.position === selected)
  const staleRecord = selectedClip?.stale === true && selectedClip.assetId !== null
    ? state.components.proj.created_by[selectedClip.assetId]
    : undefined
  const keepStale = (record: string): void => {
    void run(() => client.acceptStale(project, record, 'timeline', session))
  }
  // The clip under the playhead; a placeholder there blanks the viewer and cannot be split. A selected track clip under the
  // playhead is the one the split button splits.
  const playheadClip = clips[clipIndexAt(clips, player.position)]
  const splitClip = playheadClip?.status === 'ready' && selectedTrackClip === undefined && selectedSound === undefined ? playheadClip : undefined
  // Whether the playhead is inside a clip or a sound, away from its edges, where a split leaves two parts.
  const playheadInside = (clip: { startSec: number; seconds: number }): boolean =>
    player.position > clip.startSec + 0.05 && player.position < clip.startSec + clip.seconds - 0.05
  const splitTrack = selectedTrackClip !== undefined && playheadInside(selectedTrackClip) ? selectedTrackClip : undefined
  const splitSelectedSound = selectedSound !== undefined && playheadInside(selectedSound) ? selectedSound : undefined
  const splitTrackClip = (clip: PlacedTrackClip): void => {
    const atSec = round(clip.inSec + player.position - clip.startSec)
    void runOperation('timeline.clip_split', { clip: clip.clip, at_sec: atSec }, t('intent.trackClipSplit', { name: videoTrackName(clip.track), at: timecode(player.position) }))
  }
  // A sound splits at the playhead into two sounds of its asset; the second gets a new sound ID.
  const splitSound = (sound: TrackSound): void => {
    const atSec = round(sound.inSec + player.position - sound.startSec)
    void runOperation('timeline.sound_split', { sound: sound.sound, at_sec: atSec }, t('intent.soundSplit', { name: sound.name, at: timecode(player.position) }))
  }
  const splitAtPlayhead = (clip: TrackClip): void => {
    const atSec = round(clip.inSec + player.position - clip.startSec)
    if (atSec <= clip.inSec + 0.05 || atSec >= clip.outSec - 0.05) return
    void runOperation('timeline.clip_split', { clip: clip.clip, at_sec: atSec }, t('intent.split', { position: clip.position, at: atSec }))
  }

  // Export is one `timeline.export` call: it trims the clips with an in or out point and joins all clips.
  // It waits while any clip is a placeholder; the toolbar names the rendering clips and the failed clips in separate notes.
  const waiting = clips.filter(clip => clip.status === 'rendering').map(clip => clip.position)
  const failed = clips.filter(clip => clip.status === 'failed').map(clip => clip.position)
  const exportId = exporting || clips.length === 0 || waiting.length > 0 || failed.length > 0 ? null : timelineId
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

  // A pointer-up ends a clip drag: a body drag reorders, or moves a ready clip to the video track nearest the row it
  // ends on (or selects when it did not move); an edge drag trims.
  const finishDrag = (clip: TrackClip, current: ClipDrag): void => {
    setDrag(null)
    const moved = Math.abs(current.dx) > 3 || Math.abs(current.dy) > 3
    const deltaSec = current.dx / px
    if (current.kind === 'move') {
      if (!moved) {
        setSelected(clip.position)
        return
      }
      const row = clip.assetId === null ? 'main' : nearestVideoRow('main', current.dy)
      if (row !== 'main') {
        const startSec = round(Math.max(0, clip.startSec + deltaSec))
        void runOperation('timeline.track_clip_move', { clip: clip.clip, start_sec: startSec, track: row }, t('intent.trackClipMove', { name: videoTrackName(row), at: timecode(startSec) }))
        return
      }
      const to = dropPosition(clips, clip.startSec + clip.seconds / 2 + deltaSec, clip.position)
      if (to !== clip.position) {
        void runOperation('timeline.clip_move', { clip: clip.clip, to }, t('intent.move', { from: clip.position, to }))
          .then((ok) => {
            if (ok) { setChosenSound(null); setChosenTrackClip(null); setChosenClip({ timelineId, position: to, clip: clip.clip }) }
          })
      }
      return
    }
    if (!moved) return
    const inSec = current.kind === 'trimStart' ? round(Math.max(0, Math.min(clip.inSec + deltaSec, clip.outSec - 0.1))) : clip.rawIn
    const outSec = current.kind === 'trimEnd' ? round(Math.max(clip.inSec + 0.1, Math.min(clip.outSec + deltaSec, clip.assetSeconds))) : clip.rawOut
    // An unset end of the range is left out: the operation reads a missing in or out point as the asset's own end.
    const range = { ...inSec === null ? {} : { in_sec: inSec }, ...outSec === null ? {} : { out_sec: outSec } }
    void runOperation('timeline.clip_trim', { clip: clip.clip, ...range }, t('intent.trim', { position: clip.position }))
  }

  // A body drag of a ready clip also follows the pointer up and down; a placeholder and an edge drag stay in the row.
  const dragOffset = (current: ClipDrag, event: PointerEvent<HTMLElement>): ClipDrag => {
    const clip = clips.find(each => each.position === current.position)
    const vertical = current.kind === 'move' && clip?.assetId !== null
    const dy = vertical ? (event.clientY - current.startY) / screenScale() : 0
    return { ...current, dx: (event.clientX - current.startX) / screenScale(), dy }
  }
  const clipHandlers = (clip: TrackClip, kind: ClipDrag['kind']) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.stopPropagation()
      if (event.button !== 0) return
      capture(event)
      setDrag({ kind, position: clip.position, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 })
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (drag === null || drag.position !== clip.position || drag.kind !== kind) return
      setDrag(dragOffset(drag, event))
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (drag === null || drag.position !== clip.position || drag.kind !== kind) return
      event.stopPropagation()
      finishDrag(clip, dragOffset(drag, event))
    },
  })

  // A pointer-up ends a track clip drag: a body drag moves the clip in time and to the video track nearest the row it
  // ends on, or into the 视频 track where its middle lands (or selects it when it did not move); an edge drag trims, and
  // a start trim moves the clip's start by the same amount.
  const finishTrackDrag = (clip: PlacedTrackClip, current: BlockDrag): void => {
    setTrackDrag(null)
    const moved = Math.abs(current.dx) > 3 || Math.abs(current.dy) > 3
    if (!moved) {
      if (current.kind === 'move') { setChosenClip(null); setChosenSound(null); setChosenTrackClip(clip.clip); root.current?.focus() }
      return
    }
    const deltaSec = current.dx / px
    const name = videoTrackName(clip.track)
    if (current.kind === 'move') {
      const row = nearestVideoRow(clip.track, current.dy)
      // Dropped on the 视频 track, the clip goes in where its middle lands, as a dropped asset does.
      if (row === 'main') {
        const to = dropPosition(clips, clip.startSec + deltaSec + clip.seconds / 2, null)
        void runOperation('timeline.clip_move', { clip: clip.clip, to }, t('intent.toMainTrack', { name: mainTrackName, position: to }))
        return
      }
      const startSec = round(Math.max(0, clip.startSec + deltaSec))
      const track = row
      // A drag that ends where it started, on the same row at the same time, writes nothing.
      if (track === clip.track && startSec === round(clip.startSec)) return
      const params = { clip: clip.clip, start_sec: startSec, ...track === clip.track ? {} : { track } }
      void runOperation('timeline.track_clip_move', params, t('intent.trackClipMove', { name: videoTrackName(track), at: timecode(startSec) }))
      return
    }
    const inSec = current.kind === 'trimStart'
      ? round(Math.max(0, clip.inSec - clip.startSec, Math.min(clip.inSec + deltaSec, clip.outSec - 0.1)))
      : clip.rawIn
    const outSec = current.kind === 'trimEnd' ? round(Math.max(clip.inSec + 0.1, Math.min(clip.outSec + deltaSec, clip.assetSeconds))) : clip.rawOut
    const range = { ...inSec === null ? {} : { in_sec: inSec }, ...outSec === null ? {} : { out_sec: outSec } }
    void runOperation('timeline.clip_trim', { clip: clip.clip, ...range }, t('intent.trackClipTrim', { name }))
  }
  /**
   * The pointer handlers of a drag on a clip of a video track or on a sound: a primary press starts it, a move follows the
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
  const trackClipHandlers = (clip: PlacedTrackClip, kind: BlockDrag['kind']) =>
    blockDragHandlers(clip.clip, kind, trackDrag, setTrackDrag, (drag) => { finishTrackDrag(clip, drag) })
  const soundHandlers = (sound: TrackSound, kind: BlockDrag['kind']) =>
    blockDragHandlers(sound.sound, kind, soundDrag, setSoundDrag, (drag) => { finishSoundDrag(sound, drag) })
  /**
   * One clip block of a video track under the 视频 track, or one sound block, with the live offset of its drag applied: a
   * body drag follows the pointer, a start trim stops at the asset's start and the timeline's start, and an end trim at the
   * asset's end.
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
    if (drag?.kind === 'move') transform = `translate(${String(Math.max(-left, drag.dx))}px, ${String(drag.dy)}px)`
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
    if (Math.abs(current.dx) <= 3 && Math.abs(current.dy) <= 3) return
    const deltaSec = current.dx / px
    if (current.kind === 'move') {
      const startSec = round(Math.max(0, sound.startSec + deltaSec))
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
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedTrackClip !== undefined) {
      event.preventDefault()
      removeTrackClip(selectedTrackClip)
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedClip !== undefined) {
      event.preventDefault()
      remove(selectedClip)
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
    if (fittedTimeline.current === timelineId || total <= 0) return
    fittedTimeline.current = timelineId
    autoFit.current = true
    fit()
  }, [timelineId, total])
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (autoFit.current) fitLatest.current() })
    observer.observe(scroller.current as HTMLDivElement)
    return () => { observer.disconnect() }
  }, [])

  // The bounds of a track-area resize, read from the laid-out editor: the preview and the track area share the height
  // from the preview's top to the editor's bottom, less the 1 px drag handle; the track area needs its toolbar, its
  // horizontal scrollbar, and the ruler and the 视频 track with the bottom padding, and scrolls to the rows under them.
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

  // The preview frame, with both video elements, goes full screen; a refused request leaves the preview inline.
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
          <span key={`label-${String(sec)}`} style={{ position: 'absolute', left: sec * px, top: 3, marginLeft: 4, fontFamily: palette.mono, fontSize: 12, lineHeight: '16px', fontVariantNumeric: 'tabular-nums', color: palette.muted, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
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
    const placed = [...clips.flatMap(clip => clip.assetId === null ? [] : [{ ...clip, assetId: clip.assetId }]), ...trackClips]
    return new Map(placed.flatMap(({ clip, assetId, inSec, seconds }) => {
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
  }, [clips, trackClips, strips, px])
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

  /** One clip block on V1 or A1, with the live offset of a drag applied. */
  const blockGeometry = (clip: TrackClip): CSSProperties => {
    let left = clip.startSec * px
    let width = clip.seconds * px
    let transform: string | undefined
    if (drag !== null && drag.position === clip.position) {
      if (drag.kind === 'move') transform = `translate(${String(drag.dx)}px, ${String(drag.dy)}px)`
      if (drag.kind === 'trimStart') { const dx = Math.max(-clip.inSec * px, Math.min(drag.dx, width - 4)); left += dx; width -= dx }
      if (drag.kind === 'trimEnd') width = Math.max(4, Math.min(width + drag.dx, (clip.assetSeconds - clip.inSec) * px))
    }
    return { position: 'absolute', top: 0, bottom: 0, left, width, ...transform === undefined ? {} : { transform, zIndex: 3, opacity: 0.85 } }
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
    setPickingSound(false); setPickTrack(on.track === 'main' ? null : on.track); setPickAt(on.atSec); setPicking(true)
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
   * The items of the right-click menu: a clip or a sound splits at the playhead or goes, a track header mutes, moves (a video track
   * under the 视频 track) or renames (a sound track) or deletes its track, the 原声 row mutes, and a free spot of a lane
   * adds a video or a sound there or adds a track at the bottom.
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
        menuButton(t('menu.split'), clip.status === 'ready' && playheadInside(clip) ? () => { splitAtPlayhead(clip) } : null),
        menuButton(t('menu.delete'), () => { remove(clip) }, true),
      ]
    }
    if (on.kind === 'trackClip') {
      const { clip } = on
      return [
        menuButton(t('menu.split'), playheadInside(clip) ? () => { splitTrackClip(clip) } : null),
        menuButton(t('menu.delete'), () => { removeTrackClip(clip) }, true),
      ]
    }
    if (on.kind === 'videoTrack') {
      const { track } = on
      const layer = track === 'main' ? null : track
      return [
        track === 'main' ? muteItem(videoMuted, toggleVideoMute) : muteItem(mutedVideoTracks.includes(track), () => { toggleVideoTrackMute(track) }),
        menuButton(t('menu.moveUp'), layerUp(layer)),
        menuButton(t('menu.moveDown'), layerDown(layer)),
        track === 'main'
          ? menuButton(t('menu.deleteVideoTrack'), headerBusy || !mainTrackRemovable ? null : removeMainTrack, true)
          : menuButton(t('menu.deleteVideoTrack'), headerBusy ? null : () => { removeVideoTrack(track) }, true),
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
    if (on.kind === 'audio') return [muteItem(videoMuted, toggleVideoMute)]
    if (on.kind === 'videoLane') return [menuButton(t('menu.addVideo'), () => { pickFor(on) }), ...addTracks]
    // The last kind left; a new kind fails to compile here until it gets its items above.
    const lane: Extract<TrackMenu, { kind: 'soundLane' }> = on
    return [menuButton(t('menu.addSound'), pendingSound === null ? () => { pickSoundFor(lane) } : null), ...addTracks]
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
          onClick={() => { select?.(entry.id) }}
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
        <div ref={menuRef} role="menu" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 20, background: palette.panel, border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-menu)', padding: 6, boxShadow: 'var(--dv-shadow-2)', minWidth: 140 }}>
          <button type="button" role="menuitem" className="dv-tl-btn" onClick={() => { startRename(menu.entry) }} style={menuItem}>{t('tabs.rename')}</button>
          <button type="button" role="menuitem" className="dv-tl-btn" onClick={() => { deleteTimeline(menu.entry) }} style={{ ...menuItem, color: palette.danger }}>{t('tabs.delete')}</button>
        </div>
      ) : null}
    </div>
  )

  // The preview fills the height the tracks leave: a 16:9 frame at full height, narrowed to the available width, on the
  // media surround, with the play button, the timecode, and the full-screen button under it.
  const canPlay = clips.some(clip => clip.status === 'ready') || trackClips.length > 0
  // In a card the preview sits above the node: as wide as the node, its picture at the first ready clip's aspect ratio.
  const firstReady = clips.find(clip => clip.assetId !== null)
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
    <section
      ref={viewerBox} aria-label={t('viewer.aria')} data-testid="dv-timeline-preview" style={viewerStyle}
      // The portaled preview of a card sits outside the editor's root, so it carries the class and the key mark itself.
      {...card === undefined ? {} : { className: 'dv-tl-editor', 'data-node-keys': '' }}
    >
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          ref={frame} data-testid="dv-timeline-viewer"
          style={{ position: 'relative', ...frameStyle, borderRadius: 'var(--dv-radius-md)', overflow: 'hidden', background: palette.media, boxShadow: `0 0 0 1px ${palette.line}, var(--dv-shadow-1)` }}
        >
          {[0, 1].map((which) => {
            const shown = player.front === which && playheadClip?.status === 'ready' && topClip === undefined && !pastMain
            return (
              <video
                key={which} ref={player.elements[which as 0 | 1]} muted={videoMuted || topClip !== undefined} playsInline preload="auto"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', visibility: shown ? 'visible' : 'hidden' }}
              />
            )
          })}
          {/* Each track clip has its own element; only the clip of the highest track at the playhead shows, plays and is
              heard, and only a clip that can show soon loads its whole file. */}
          {trackClips.map(clip => (
            <video
              key={clip.clip} data-track-clip={clip.clip} src={assetUrl(clip.assetId)} playsInline
              preload={trackClipPreload(clip, player.position, total)}
              muted={clip.clip !== topClip?.clip || mutedVideoTracks.includes(clip.track)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: palette.media, visibility: clip.clip === topClip?.clip ? 'visible' : 'hidden' }}
            />
          ))}
          {clips.length === 0 && trackClips.length === 0 ? <p data-testid="dv-timeline-viewer-empty" style={viewerNote}>{t(timeline === null ? 'viewer.noTimelines' : 'viewer.empty')}</p> : null}
          {playheadClip !== undefined && playheadClip.status !== 'ready' && topClip === undefined && !pastMain ? (
            <p data-testid="dv-timeline-viewer-placeholder" style={viewerNote}>
              {t('viewer.placeholder', { position: playheadClip.position, status: t(playheadClip.status === 'failed' ? 'track.renderFailed' : 'track.rendering') })}
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
        onClick={splitTrack !== undefined
          ? () => { splitTrackClip(splitTrack) }
          : splitSelectedSound !== undefined
            ? () => { splitSound(splitSelectedSound) }
            : splitClip === undefined ? null : () => { splitAtPlayhead(splitClip) }}
      />
      {selectedSound !== undefined
        ? <IconButton icon="delete" label={t('tool.deleteSound')} onClick={() => { removeSound(selectedSound) }} />
        : selectedTrackClip !== undefined
          ? <IconButton icon="delete" label={t('tool.delete')} onClick={() => { removeTrackClip(selectedTrackClip) }} />
          : <IconButton icon="delete" label={t('tool.delete')} onClick={selectedClip === undefined ? null : () => { remove(selectedClip) }} />}
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
              {[null, ...Array.from({ length: videoTrackCount }, (_, track) => track)].map((track) => {
                const name = track === null ? mainTrackName : videoTrackName(track)
                const ids = (track === null
                  ? clips.map(clip => clip.assetId)
                  : trackClips.filter(clip => clip.track === track).sort((a, b) => a.startSec - b.startSec).map(clip => clip.assetId)
                ).filter((id): id is string => id !== null)
                const contents = [...new Set(ids)].map(id => assets.get(id)?.name ?? id).join(t('track.layerJoin'))
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
      {waiting.length > 0 ? <span data-testid="dv-timeline-export-waiting" style={{ color: palette.muted, fontSize: 12, lineHeight: '16px', marginRight: 6 }}>{t('tool.exportWaiting', { positions: waiting.join(', ') })}</span> : null}
      {failed.length > 0 ? <span data-testid="dv-timeline-export-failed" style={{ color: palette.danger, fontSize: 12, lineHeight: '16px', marginRight: 6 }}>{t('tool.exportFailed', { positions: failed.join(', ') })}</span> : null}
      <button
        type="button" className="dv-tl-btn" style={buttonStyle(exportId === null)} disabled={exportId === null}
        onClick={exportId === null ? undefined : () => { exportTimeline(exportId) }}
      >
        <Icon name="export" />{exporting ? t('tool.exporting') : t('tool.export')}
      </button>
      {sounds.length > 0 ? <span data-testid="dv-timeline-export-no-sounds" style={{ color: palette.muted, fontSize: 12, lineHeight: '16px', marginLeft: 6 }}>{t('tool.exportNoSounds')}</span> : null}
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
  // The playhead spans the ruler and every track row.
  const playheadHeight = RULER_HEIGHT + ROW_GAP + AUDIO_HEIGHT + (1 + videoTrackCount + trackCount) * (ROW_GAP + ROW_HEIGHT)
  // A track header: the track's color and its name, cut with an ellipsis, on the first line, and its buttons on a second
  // line under the name, so the buttons never cover the name.
  const trackHeader = (color: string, name: string, buttons: ReactNode = null): ReactNode => (
    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '0 6px 0 14px', fontSize: 12, lineHeight: '16px' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 2, background: color }} />
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      </span>
      {/* The icons' left edge lines up with the color mark: each 16 px icon sits 4 px inside its 24 px button. */}
      {buttons === null ? null : <span style={{ display: 'flex', gap: 4, marginLeft: -4 }}>{buttons}</span>}
    </span>
  )
  const muteButton = (muted: boolean, name: string, toggle: (() => void) | null): ReactNode => (
    <TrackButton icon={muted ? 'soundOff' : 'sound'} label={t('track.mute', { name })} pressed={muted} onClick={toggle} />
  )
  // The video tracks under the 视频 track by number: each header mutes or deletes its track and has a ＋ that adds a video
  // after the track's last clip, right of the delete button as on every track, and each lane takes a dropped video.
  const videoTrackRows = Array.from({ length: videoTrackCount }, (_, track) => {
    const name = videoTrackName(track)
    const muted = mutedVideoTracks.includes(track)
    return [
      <span
        key={`video-head-${String(track)}`} data-video-track-head={track} {...owned} style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}
        onContextMenu={(event) => { openMenu(event, { kind: 'videoTrack', track }) }}
      >
        {trackHeader(palette.take, name, (
          <>
            {muteButton(muted, name, headerBusy ? null : () => { toggleVideoTrackMute(track) })}
            <TrackButton icon="delete" label={t('track.deleteVideoTrack', { name })} onClick={headerBusy ? null : () => { removeVideoTrack(track) }} />
            <TrackButton
              icon="add" label={t('track.addToTrack', { name })} expanded={picking && pickTrack === track}
              onClick={(event) => {
                addRef.current = event.currentTarget
                anchorBeside(event.currentTarget)
                setPickingSound(false); setPicking(!picking || pickTrack !== track); setPickTrack(track); setPickAt(null)
              }}
            />
          </>
        ))}
      </span>,
      <div
        key={`video-lane-${String(track)}`} role="list" aria-label={t('track.videoTrackAria', { n: track + 2 })} data-video-track={track}
        style={{ position: 'relative' }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes(DV_ASSET_DRAG_TYPE)) event.preventDefault() }}
        onDrop={(event) => { dropTrackClip(event, track) }}
        onContextMenu={(event) => { openMenu(event, { kind: 'videoLane', track, atSec: laneTime(event), clientX: event.clientX, clientY: event.clientY }) }}
      >
        {trackClips.filter(clip => clip.track === track).map((clip) => {
          const assetName = assets.get(clip.assetId)?.name ?? clip.assetId
          const handle = Math.max(2, Math.min(7, Math.floor(clip.seconds * px / 4)))
          const isSelected = clip.clip === chosenTrackClip
          const picture = clipPicture(clip)
          // The hover text names the asset and the seconds the clip plays, like the caption of a 视频 track clip.
          const caption = `${assetName} · ${clip.seconds.toFixed(1)}s`
          return (
            <div
              key={clip.clip} role="listitem" {...owned} aria-label={t('track.trackClipAria', { track: name, name: assetName })} aria-pressed={isSelected}
              data-track-clip-block={clip.clip} data-clip-stale={clip.stale} title={caption} {...trackClipHandlers(clip, 'move')}
              onContextMenu={(event) => {
                setChosenClip(null); setChosenSound(null); setChosenTrackClip(clip.clip)
                openMenu(event, { kind: 'trackClip', clip })
              }}
              style={{
                ...isSelected ? { zIndex: 1 } : {}, ...placedBlockGeometry(clip, trackDrag?.id === clip.clip ? trackDrag : null), boxSizing: 'border-box', borderRadius: 'var(--dv-radius-sm)', overflow: 'hidden', cursor: 'grab', touchAction: 'none',
                background: picture.still === null ? palette.fill : `${palette.fill} url("${picture.still}") left center / auto 100% repeat-x`,
                border: `1px solid ${palette.panel}`, ...muted ? { opacity: MUTED_OPACITY } : {},
                boxShadow: [isSelected ? `0 0 0 2px ${palette.accent}` : null, `inset 0 0 0 ${clip.stale ? `2px ${palette.danger}` : `1px ${palette.line}`}`].filter(shadow => shadow !== null).join(', '),
              }}
            >
              {picture.still === null && picture.tiles === null ? <video src={assetUrl(clip.assetId)} preload="metadata" muted style={{ height: '100%', pointerEvents: 'none' }} /> : null}
              {picture.tiles}
              <span style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: palette.take, pointerEvents: 'none' }} />
              <span style={{ position: 'absolute', left: handle + 3, bottom: 4, maxWidth: `calc(100% - ${String(handle * 2 + 6)}px)`, boxSizing: 'border-box', padding: '0 5px', borderRadius: 4, background: palette.panel, color: palette.fg, fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>
                {assetName}
              </span>
              <span data-trim="start" className="dv-tl-trim" {...trackClipHandlers(clip, 'trimStart')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: handle, cursor: 'col-resize' }} />
              <span data-trim="end" className="dv-tl-trim" {...trackClipHandlers(clip, 'trimEnd')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: handle, cursor: 'col-resize' }} />
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
          <TrackButton icon="delete" label={t('track.deleteNamed', { name: trackName(track) })} onClick={timeline === null || headerBusy ? null : () => { removeTrack(track) }} />
          <TrackButton
            icon="add" label={t('track.addSound')} expanded={pickingSound && soundTrack === track}
            onClick={timeline === null || pendingSound !== null ? null : (event) => {
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
              event.stopPropagation(); setChosenClip(null); setChosenTrackClip(null); setChosenSound(sound.sound); root.current?.focus()
            }}
            onContextMenu={(event) => {
              setChosenClip(null); setChosenTrackClip(null); setChosenSound(sound.sound)
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
            {/* The file name sits in its own strip above the waveform, cut with an ellipsis. */}
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
  // The rows under the 原声 row, top to bottom in the order the tracks were added.
  const rowsUnderAudio = trackRows(trackOrder, videoTrackCount, trackCount)
    .map(row => row.kind === 'video' ? videoTrackRows[row.track] : soundTrackRows[row.track])
  // The heights of the ruler and the track rows, top to bottom, and where the line under each row sits.
  const rowHeights = [RULER_HEIGHT, ROW_HEIGHT, AUDIO_HEIGHT, ...Array.from({ length: videoTrackCount + trackCount }, () => ROW_HEIGHT)]
  const rowLines = rowHeights.map((_, index) =>
    rowHeights.slice(0, index + 1).reduce((sum, height) => sum + height, 0) + index * ROW_GAP + ROW_GAP / 2)
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
        <span
          data-main-track-head {...owned} style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}
          onContextMenu={(event) => { openMenu(event, { kind: 'videoTrack', track: 'main' }) }}
        >
          {trackHeader(palette.take, mainTrackName, (
            <>
              {muteButton(videoMuted, mainTrackName, timeline === null || headerBusy ? null : toggleVideoMute)}
              <TrackButton
                icon="delete" label={t('track.deleteVideoTrack', { name: mainTrackName })}
                onClick={headerBusy || !mainTrackRemovable ? null : removeMainTrack}
              />
              <TrackButton
                icon="add" label={t('track.add')} expanded={picking && pickTrack === null}
                onClick={timeline === null ? null : (event) => {
                  addRef.current = event.currentTarget
                  anchorBeside(event.currentTarget)
                  setPickingSound(false); setPicking(!picking || pickTrack !== null); setPickTrack(null); setPickAt(null)
                }}
              />
            </>
          ))}
        </span>
        <div
          role="list" aria-label={t('track.aria')} style={{ position: 'relative' }}
          onContextMenu={(event) => { if (timeline !== null) openMenu(event, { kind: 'videoLane', track: 'main', atSec: laneTime(event), clientX: event.clientX, clientY: event.clientY }) }}
          onDragOver={(event) => { if (event.dataTransfer.types.includes(DV_ASSET_DRAG_TYPE)) event.preventDefault() }}
          onDrop={(event) => {
            const dropped = takeDrop(event)
            if (dropped === null) return
            if (dropped.type !== 'video') {
              setDropNotice({ text: dropped.type === 'audio' ? 'track.videoDrop' : 'track.videoOnly' })
              return
            }
            const box = (lane.current as HTMLDivElement).getBoundingClientRect()
            insert(dropPosition(clips, (event.clientX - box.left) / screenScale() / px, null), dropped.id)
          }}
        >
          {clips.map((clip) => {
            const ready = clip.assetId !== null
            const statusText = clip.status === 'failed' ? t('track.renderFailed') : t('track.rendering')
            const name = clip.assetId === null ? statusText : assets.get(clip.assetId)?.name ?? clip.assetId
            // Trim handles take at most a quarter of the clip each, so a short clip keeps a body to select and drag.
            const handle = Math.max(2, Math.min(7, Math.floor(clip.seconds * px / 4)))
            // The caption and the visible label both name any state that changes what the clip can do.
            const states = [...ready ? [] : [statusText], ...clip.stale ? [t('track.stale')] : []]
            const caption = [`${String(clip.position)} · ${clip.seconds.toFixed(1)}s`, ...states].join(' · ')
            const label = [t('track.clipLabel', { position: clip.position }), ...states].join(' · ')
            // A placeholder clip is striped, in the danger color when its render failed.
            const placeholderFill = `repeating-linear-gradient(135deg, ${clip.status === 'failed' ? palette.dangerSoft : palette.lineStrong} 0 8px, ${palette.fill} 8px 16px)`
            const isSelected = selected === clip.position
            const picture = clip.assetId === null
              ? { still: null, tiles: null }
              : clipPicture({ ...clip, assetId: clip.assetId })
            return (
              <div
                key={clip.clip} role="listitem" {...owned} aria-label={t('track.clipAria', { position: clip.position, name })} aria-pressed={isSelected}
                data-clip={clip.clip} data-clip-position={clip.position} data-clip-status={clip.status} data-clip-stale={clip.stale} title={caption} {...clipHandlers(clip, 'move')}
                onContextMenu={(event) => { setSelected(clip.position); openMenu(event, { kind: 'clip', clip }) }}
                style={{
                  ...isSelected ? { zIndex: 1 } : {}, ...blockGeometry(clip), boxSizing: 'border-box', borderRadius: 'var(--dv-radius-sm)', overflow: 'hidden', cursor: 'grab', touchAction: 'none',
                  background: !ready ? placeholderFill : picture.still === null ? palette.fill : `${palette.fill} url("${picture.still}") left center / auto 100% repeat-x`,
                  // A border in the track color keeps a visible gap between neighboring clips.
                  border: `1px solid ${palette.panel}`,
                  boxShadow: [isSelected ? `0 0 0 2px ${palette.accent}` : null, `inset 0 0 0 ${clip.stale ? `2px ${palette.danger}` : `1px ${palette.line}`}`].filter(shadow => shadow !== null).join(', '),
                }}
              >
                {picture.still === null && picture.tiles === null && clip.assetId !== null ? <video src={assetUrl(clip.assetId)} preload="metadata" muted style={{ height: '100%', pointerEvents: 'none' }} /> : null}
                {picture.tiles}
                <span style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 3, background: clip.status === 'failed' ? palette.danger : palette.take, pointerEvents: 'none' }} />
                <span style={{ position: 'absolute', left: handle + 3, bottom: 4, maxWidth: `calc(100% - ${String(handle * 2 + 6)}px)`, boxSizing: 'border-box', padding: '0 5px', borderRadius: 4, background: palette.panel, color: palette.fg, fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>
                  {label}
                </span>
                {ready ? (
                  <>
                    <span aria-label={t('track.trimStart', { position: clip.position })} data-trim="start" className="dv-tl-trim" {...clipHandlers(clip, 'trimStart')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: handle, cursor: 'col-resize' }} />
                    <span aria-label={t('track.trimEnd', { position: clip.position })} data-trim="end" className="dv-tl-trim" {...clipHandlers(clip, 'trimEnd')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: handle, cursor: 'col-resize' }} />
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
        <span data-audio-head {...owned} style={{ display: 'flex', alignItems: 'center', minWidth: 0 }} onContextMenu={(event) => { openMenu(event, { kind: 'audio' }) }}>
          {trackHeader(palette.audio, t('track.audio'))}
        </span>
        <div
          data-audio-lane {...owned} style={{ position: 'relative', ...videoMuted ? { opacity: MUTED_OPACITY } : {} }} aria-hidden
          onContextMenu={(event) => { openMenu(event, { kind: 'audio' }) }}
        >
          {clips.map(clip => (
            <div
              key={clip.clip}
              style={{ ...blockGeometry(clip), boxSizing: 'border-box', borderRadius: 'var(--dv-radius-sm)', border: `1px solid ${palette.panel}`, background: palette.audioSoft, overflow: 'hidden' }}
            >
              {clip.status === 'ready' && clip.assetId !== null
                ? (
                  <AudioWaveform
                    assetId={clip.assetId} inSec={clip.inSec} outSec={clip.outSec} width={clip.seconds * px} height={AUDIO_HEIGHT - 2}
                  />
                )
                : null}
            </div>
          ))}
        </div>
        {rowsUnderAudio}
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
  // The picker's title says where the picked asset goes: the end of the track, or the time a lane menu was opened at.
  const pickTitle = pickAt === null ? t('track.pick') : t('track.pickAt', { at: timecode(pickAt) })
  const editPanel = (
    <div ref={panel} style={{ ...card === undefined ? { ...trackHeight === null ? { flex: '0 1 auto', minHeight: 0 } : { flex: 'none', height: trackHeight } } : { flex: '1 1 auto', minHeight: 0 }, display: 'flex', flexDirection: 'column', background: palette.panel }}>
      {toolbar}
      <div ref={pickArea} data-testid="dv-timeline-track-area" onBlur={closeOnFocusOut} style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {tracks}
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
                  {entry.name}
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
                    if (pickTrack === null) insert(pickAt === null ? clips.length + 1 : dropPosition(clips, pickAt, null), entry.id)
                    else addTrackClip(entry.id, pickTrack, pickAt ?? trackClipEnd(pickTrack) ?? player.position)
                  }}
                >
                  {entry.name}
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
        <div ref={trackMenuRef} role="menu" style={{ position: card === undefined ? 'fixed' : 'absolute', left: trackMenu.x, top: trackMenu.y, zIndex: 20, background: palette.panel, border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-menu)', padding: 6, boxShadow: 'var(--dv-shadow-2)', minWidth: 140 }}>
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
