/**
 * The timeline editor: one tab per timeline of the project, a 16:9 preview that fills the free height and plays the
 * selected timeline across its clips (with skip, play, playback-speed, and full-screen controls under it), a toolbar, a
 * ruler, the 视频 track with filmstrip clips sized by duration, and a display-only 原声 track with one block per clip that
 * shows the waveform of the clip's own audio once it decodes, and under it the sound tracks, whose sound blocks play in
 * step with the preview (`sound-playback.ts`). A drag handle above the track area sets the track area's height, which
 * each browser remembers. Every edit is one `/api/dv/operation` call of a `timeline.*` operation with
 * `surface: 'timeline'`; the clip operations name the clip by its clip ID, the sound operations name the sound by its
 * sound ID or the sound track by its number, and every edit goes after the current position of the project's history,
 * the state the editor shows. A selected stale clip offers "仍然保留", which keeps the record that made its asset
 * (`proj.stale_accept`). A placeholder clip, whose render is still running (渲染中…) or failed (渲染失败), keeps its place and
 * its planned length on the track; it cannot be trimmed or split, playback skips it, and export waits until every clip
 * is ready.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, FocusEvent, KeyboardEvent, PointerEvent, ReactNode, RefObject } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { Timeline } from '@dv/timeline/types'
import { assetUrl } from '@dv/ui-kit/api.ts'
import type { DvClient } from '@dv/ui-kit/api.ts'
import { readStored, writeStored } from '@dv/ui-kit/storage.ts'
import { timelineName } from '@dv/ui-kit/timeline.ts'
import { assetIndex } from '@dv/ui-kit/state.ts'
import type { OperationRequest, WireState } from '@dv/ui-kit/types.ts'
import { DV_ASSET_DRAG_TYPE } from '@dv/ui-kit/workspace-events.ts'
import { useFirstFrames } from './first-frame.ts'
import { useTimelinePlayer } from './player.ts'
import { clipPeaks, useAudioEnvelope } from '@dv/ui-kit/waveform.ts'
import { useSoundPlayback } from './sound-playback.ts'
import {
  audioAssets, clipIndexAt, dropPosition, nextTimelineId, placeSounds, placeTimeline, timecode, timelinesOf, videoAssets,
} from './timelines.ts'
import type { TrackClip } from './timelines.ts'
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

/** An edge or body drag on a clip, in progress. */
interface ClipDrag {
  kind: 'move' | 'trimStart' | 'trimEnd'
  position: number
  startX: number
  dx: number
}

/** Width of the track-header column, in pixels. */
const GUTTER = 96
/** Default zoom, in pixels per second. */
const DEFAULT_PX = 40
/** Row heights of the track area, in pixels: the ruler, the video track, and the audio track. */
const RULER_HEIGHT = 26
const VIDEO_HEIGHT = 56
const AUDIO_HEIGHT = 36
/** Height of the row under the sound tracks that holds 添加音轨 / Add track, in pixels. */
const ADD_TRACK_HEIGHT = 28
/** Height of the file-name strip at the top of a sound block, in pixels. */
const SOUND_NAME_HEIGHT = 14
/** Vertical gap between the rows of the track area, in pixels. */
const ROW_GAP = 6
/** Bottom padding of the scrolling track rows, in pixels; it keeps the horizontal scrollbar off the audio track. */
const TRACK_PADDING = 14
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
 * `MIN_PREVIEW_HEIGHT`, and raised to the height the toolbar and track rows need. The track rows' minimum wins when the
 * editor is too short for both.
 * @param requested - the height the drag or key press asks for, in pixels.
 * @param available - the height the preview and the track area share, in pixels.
 * @param minTrack - the height the toolbar and the track rows need, in pixels.
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
  const { client, t, project, session = null, state, run, selected: activeId, select, clipFocus = null, takeClipFocus } = props
  const timelines = useMemo(() => timelinesOf(state), [state])
  const timeline = timelines.find(entry => entry.id === activeId) ?? timelines[0] ?? null
  const { clips, total } = useMemo(() => placeTimeline(state, timeline), [state, timeline])
  const assets = useMemo(() => assetIndex(state), [state])
  // A clip without a still image repeats its video's first frame across its width.
  const unstilled = clips.flatMap(clip => clip.thumbnail === null && clip.assetId !== null ? [assetUrl(clip.assetId)] : [])
  const frames = useFirstFrames(unstilled)
  const candidates = useMemo(() => videoAssets(state), [state])
  const audioCandidates = useMemo(() => audioAssets(state), [state])
  // The lengths that the sound elements measured, for audio assets whose length the state does not know.
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(new Map())
  const { sounds, end: soundsEnd } = useMemo(() => placeSounds(state, timeline, measured), [state, timeline, measured])
  const span = Math.max(total, soundsEnd)
  const timelineId = timeline?.id ?? null
  const [playbackRate, setPlaybackRate] = useState(readPlaybackRate)
  const player = useTimelinePlayer(timelineId, clips, total, playbackRate)
  const soundBox = useRef<HTMLDivElement | null>(null)
  useSoundPlayback(soundBox, sounds, player.position, player.playing, playbackRate)
  const [pickingSound, setPickingSound] = useState(false)
  const upload = useRef<HTMLInputElement | null>(null)
  const soundPickerRef = useRef<HTMLDivElement | null>(null)
  // The sound track ＋ that opened the sound dialog; each track has its own ＋.
  const soundAddRef = useRef<HTMLButtonElement | null>(null)
  // Sound tracks: the tracks the timeline stores (up to the last track with a sound or a name), at least one, and at
  // most one more empty track that lives only in this view until it gets a sound or a name; the timeline operations
  // accept a track up to the one after the last stored track.
  const [shownTracks, setShownTracks] = useState(1)
  const trackNames = timeline?.sound_track_names ?? []
  const savedTracks = Math.max(trackNames.length, ...sounds.map(sound => sound.track + 1))
  const storedTracks = Math.max(1, savedTracks)
  const trackName = (track: number): string => trackNames[track] || t('track.soundN', { n: track + 1 })
  const [renamingTrack, setRenamingTrack] = useState<{ track: number; name: string } | null>(null)
  const trackCount = Math.max(storedTracks, shownTracks)
  // The track the add dialog adds to, the selected sound, and the open sound or track menu.
  const [soundTrack, setSoundTrack] = useState(0)
  const [chosenSound, setChosenSound] = useState<string | null>(null)
  const selectedSound = sounds.find(sound => sound.sound === chosenSound)
  const [soundMenu, setSoundMenu] = useState<
    { kind: 'sound'; sound: (typeof sounds)[number]; x: number; y: number } | { kind: 'track'; track: number; x: number; y: number } | null
  >(null)
  const soundMenuRef = useRef<HTMLDivElement | null>(null)
  const cycleRate = (): void => {
    const next = PLAYBACK_RATES.find(rate => rate > playbackRate) ?? PLAYBACK_RATES[0]
    setPlaybackRate(next)
    storePlaybackRate(next)
  }
  const [px, setPx] = useState(DEFAULT_PX)
  const [chosenClip, setChosenClip] = useState<SelectedClip | null>(null)
  const selected = resolveSelection(clips, timelineId, chosenClip)
  const setSelected = (position: number | null): void => {
    if (position !== null) setChosenSound(null)
    const clip = clips.find(placed => placed.position === position)
    setChosenClip(position === null || clip === undefined ? null : { timelineId, position, clip: clip.clip })
  }
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [menu, setMenu] = useState<{ entry: Timeline; x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [dropNotice, setDropNotice] = useState(false)
  const [drag, setDrag] = useState<ClipDrag | null>(null)
  const [picking, setPicking] = useState(false)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const addRef = useRef<HTMLButtonElement | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const lane = useRef<HTMLDivElement | null>(null)
  const frame = useRef<HTMLDivElement | null>(null)
  const scrubbing = useRef(false)
  const root = useRef<HTMLDivElement | null>(null)
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
    setChosenSound(null); setSoundMenu(null); setShownTracks(1); setRenamingTrack(null)
  }, [timelineId])

  useEffect(() => {
    if (clipFocus === null || clipFocus.timelineId !== timelineId) return
    takeClipFocus?.()
    const clip = clips.find(placed => placed.clip === clipFocus.clipId)
    if (clip === undefined) return
    setChosenSound(null)
    setChosenClip({ timelineId, position: clip.position, clip: clip.clip })
    player.seek(clip.startSec)
  }, [clipFocus, timelineId, clips])

  // Keep the stored selection on the position it resolved to after an edit elsewhere.
  useEffect(() => {
    if (chosenClip === null || selected === chosenClip.position) return
    setChosenClip(selected === null ? null : { ...chosenClip, position: selected })
  }, [chosenClip, selected])

  // The file-drop notice disappears after a few seconds.
  useEffect(() => {
    if (!dropNotice) return
    const timer = setTimeout(() => { setDropNotice(false) }, 4000)
    return () => { clearTimeout(timer) }
  }, [dropNotice])

  // A press outside the tab menu or Escape closes it.
  useDismissOnOutsidePress(menu !== null, [menuRef], () => { setMenu(null) })
  useEffect(() => {
    if (menu === null) return
    const close = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) setMenu(null)
    }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close) }
  }, [menu])
  // The same for the sound and track menu.
  useEffect(() => {
    if (soundMenu === null) return
    const close = (event: Event): void => {
      const inside = event.target instanceof Node && soundMenuRef.current?.contains(event.target) === true
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !inside) setSoundMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close) }
  }, [soundMenu])

  // Closing the asset picker from its close button or Escape returns focus to ＋.
  const closePicker = (): void => {
    setPicking(false)
    addRef.current?.focus()
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
    soundAddRef.current?.focus()
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
    const named = ['timeline.clip_insert', 'timeline.sound_add', 'timeline.sound_track_remove', 'timeline.sound_track_rename'].includes(operation)
    const scoped = timeline === null || !named ? params : { timeline: timeline.id, ...params }
    return run(() => client.runOperation(request(project, session, { operation, params: scoped, intent })))
  }
  // A new sound goes right after the last sound of its track, or at the playhead on an empty track; an uploaded file is
  // imported first and then added the same way.
  const trackEnd = Math.max(0, ...sounds.filter(sound => sound.track === soundTrack).map(sound => sound.startSec + sound.seconds))
  const soundStart = round(sounds.some(sound => sound.track === soundTrack) ? trackEnd : player.position)
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
    setSoundMenu(null)
    void runOperation('timeline.sound_remove', { sound: sound.sound }, t('intent.soundRemove', { name: sound.name }))
      .then((ok) => { if (ok) setChosenSound(null) })
  }
  const startTrackRename = (track: number): void => {
    setSoundMenu(null)
    setRenamingTrack({ track, name: trackName(track) })
  }
  const commitTrackRename = (edit: { track: number; name: string }): void => {
    setRenamingTrack(null)
    const name = edit.name.trim()
    if (name === '' || name === trackName(edit.track)) return
    void runOperation('timeline.sound_track_rename', { track: edit.track, name }, t('intent.trackRename', { name }))
  }
  // A stored track is deleted with its sounds and the later tracks move up; an empty track added in this view just goes.
  const removeTrack = (track: number): void => {
    setSoundMenu(null)
    setShownTracks(Math.max(1, trackCount - 1))
    if (track < savedTracks) void runOperation('timeline.sound_track_remove', { track }, t('intent.trackRemove', { n: track + 1 }))
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
  // The clip under the playhead; a placeholder there blanks the viewer and cannot be split.
  const playheadClip = clips[clipIndexAt(clips, player.position)]
  const splitClip = playheadClip?.status === 'ready' ? playheadClip : undefined
  const splitAtPlayhead = (clip: TrackClip): void => {
    const atSec = round(clip.inSec + player.position - clip.startSec)
    if (atSec <= clip.inSec + 0.05 || atSec >= clip.outSec - 0.05) return
    void runOperation('timeline.clip_split', { clip: clip.clip, at_sec: atSec }, t('intent.split', { position: clip.position, at: atSec }))
  }

  // Export is one `timeline.export` call: it trims the clips with an in or out point and joins all clips.
  // It waits while any clip is a placeholder; the toolbar names those clips.
  const waiting = clips.filter(clip => clip.status !== 'ready').map(clip => clip.position)
  const exportId = exporting || clips.length === 0 || waiting.length > 0 ? null : timelineId
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
    player.seek((event.clientX - event.currentTarget.getBoundingClientRect().left) / px)
  }

  // A pointer-up ends a clip drag: a body drag reorders (or selects when it did not move); an edge drag trims.
  const finishDrag = (clip: TrackClip, current: ClipDrag): void => {
    setDrag(null)
    const moved = Math.abs(current.dx) > 3
    const deltaSec = current.dx / px
    if (current.kind === 'move') {
      if (!moved) {
        setSelected(clip.position)
        return
      }
      const to = dropPosition(clips, clip.startSec + clip.seconds / 2 + deltaSec, clip.position)
      if (to !== clip.position) {
        void runOperation('timeline.clip_move', { clip: clip.clip, to }, t('intent.move', { from: clip.position, to }))
          .then((ok) => { if (ok) { setChosenSound(null); setChosenClip({ timelineId, position: to, clip: clip.clip }) } })
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

  const clipHandlers = (clip: TrackClip, kind: ClipDrag['kind']) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      event.stopPropagation()
      capture(event)
      setDrag({ kind, position: clip.position, startX: event.clientX, dx: 0 })
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (drag === null || drag.position !== clip.position || drag.kind !== kind) return
      setDrag({ ...drag, dx: event.clientX - drag.startX })
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (drag === null || drag.position !== clip.position || drag.kind !== kind) return
      event.stopPropagation()
      finishDrag(clip, { ...drag, dx: event.clientX - drag.startX })
    },
  })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedSound !== undefined) {
      event.preventDefault()
      removeSound(selectedSound)
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
  // horizontal scrollbar, and its rows with their padding. Null before layout (or under jsdom, which lays out nothing).
  const resizeBounds = (): { available: number; minTrack: number } | null => {
    const panelElement = panel.current as HTMLDivElement
    const available = (root.current as HTMLDivElement).getBoundingClientRect().bottom
      - (viewerBox.current as HTMLElement).getBoundingClientRect().top - 1
    if (available <= 0) return null
    const minTrack = panelElement.offsetHeight - (scroller.current as HTMLDivElement).clientHeight
      + (rows.current as HTMLDivElement).offsetHeight + TRACK_PADDING
    return { available, minTrack }
  }
  const resizeTo = (requested: number, bounds = resizeBounds()): number => {
    const height = bounds === null ? Math.round(requested) : clampTrackHeight(requested, bounds.available, bounds.minTrack)
    setTrackHeight(height)
    return height
  }
  // A remembered or dragged height is clamped again whenever the editor resizes, so a shorter window keeps the preview.
  useEffect(() => {
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
          <span key={`label-${String(sec)}`} style={{ position: 'absolute', left: sec * px, top: 3, marginLeft: 4, fontFamily: palette.mono, fontSize: 11, lineHeight: '14px', fontVariantNumeric: 'tabular-nums', color: palette.muted, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            {timecode(sec).replace(/\.\d+$/, '')}
          </span>
        ))}
      </>
    )
  }, [px, laneWidth])

  /** One clip block on V1 or A1, with the live offset of a drag applied. */
  const blockGeometry = (clip: TrackClip): CSSProperties => {
    let left = clip.startSec * px
    let width = clip.seconds * px
    let transform: string | undefined
    if (drag !== null && drag.position === clip.position) {
      if (drag.kind === 'move') transform = `translateX(${String(drag.dx)}px)`
      if (drag.kind === 'trimStart') { const dx = Math.max(-clip.inSec * px, Math.min(drag.dx, width - 4)); left += dx; width -= dx }
      if (drag.kind === 'trimEnd') width = Math.max(4, Math.min(width + drag.dx, (clip.assetSeconds - clip.inSec) * px))
    }
    return { position: 'absolute', top: 0, bottom: 0, left, width, ...transform === undefined ? {} : { transform, zIndex: 3, opacity: 0.85 } }
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
        <div ref={menuRef} role="menu" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 20, background: palette.panel, border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-menu)', padding: 6, boxShadow: 'var(--dv-shadow-2)', minWidth: 140 }}>
          <button type="button" role="menuitem" className="dv-tl-btn" onClick={() => { startRename(menu.entry) }} style={menuItem}>{t('tabs.rename')}</button>
          <button type="button" role="menuitem" className="dv-tl-btn" onClick={() => { deleteTimeline(menu.entry) }} style={{ ...menuItem, color: palette.danger }}>{t('tabs.delete')}</button>
        </div>
      ) : null}
    </div>
  )

  // The preview fills the height the tracks leave: a 16:9 frame at full height, narrowed to the available width, on the
  // media surround, with the play button, the timecode, and the full-screen button under it.
  const canPlay = clips.some(clip => clip.status === 'ready')
  const viewer = (
    <section ref={viewerBox} aria-label={t('viewer.aria')} style={{ flex: '1 1 auto', minHeight: 140, display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 24px 12px', background: palette.media }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          ref={frame} data-testid="dv-timeline-viewer"
          style={{ position: 'relative', height: '100%', maxWidth: '100%', aspectRatio: '16 / 9', borderRadius: 'var(--dv-radius-md)', overflow: 'hidden', background: palette.media, boxShadow: `0 0 0 1px ${palette.line}, var(--dv-shadow-1)` }}
        >
          {[0, 1].map(which => (
            <video
              key={which} ref={player.elements[which as 0 | 1]} muted={false} playsInline preload="auto"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', visibility: player.front === which && playheadClip?.status === 'ready' ? 'visible' : 'hidden' }}
            />
          ))}
          {clips.length === 0 ? <p data-testid="dv-timeline-viewer-empty" style={viewerNote}>{t(timeline === null ? 'viewer.noTimelines' : 'viewer.empty')}</p> : null}
          {playheadClip !== undefined && playheadClip.status !== 'ready' ? (
            <p data-testid="dv-timeline-viewer-placeholder" style={viewerNote}>
              {t('viewer.placeholder', { position: playheadClip.position, status: t(playheadClip.status === 'failed' ? 'track.renderFailed' : 'track.rendering') })}
            </p>
          ) : null}
        </div>
      </div>
      {/* Three columns keep the transport group centered whatever the widths of the timecode and the right group. */}
      <div style={{ flex: 'none', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, color: palette.fg }}>
        <span data-testid="dv-timeline-time" style={{ justifySelf: 'start', fontFamily: palette.mono, fontSize: 13, lineHeight: '20px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {timecode(player.position)}{' '}<span style={{ color: palette.muted }}>{`/ ${timecode(total)}`}</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconButton icon="skipBack" label={t('viewer.skipBack')} onClick={total <= 0 ? null : () => { player.skip(-SKIP_SECONDS) }} />
          <button
            type="button" disabled={!canPlay} aria-label={player.playing ? t('tool.pause') : t('tool.play')} title={player.playing ? t('tool.pause') : t('tool.play')}
            onClick={() => { if (player.playing) player.pause(); else player.play() }}
            style={{ ...buttonStyle(!canPlay, iconButton), borderRadius: 9999, background: palette.fg, color: palette.media }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d={player.playing ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M7 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L8.5 4.6A1 1 0 0 0 7 5.5z'} />
            </svg>
          </button>
          <IconButton icon="skipForward" label={t('viewer.skipForward')} onClick={total <= 0 ? null : () => { player.skip(SKIP_SECONDS) }} />
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
      <IconButton icon="split" label={t('tool.split')} onClick={splitClip === undefined ? null : () => { splitAtPlayhead(splitClip) }} />
      {selectedSound !== undefined
        ? <IconButton icon="delete" label={t('tool.deleteSound')} onClick={() => { removeSound(selectedSound) }} />
        : <IconButton icon="delete" label={t('tool.delete')} onClick={selectedClip === undefined ? null : () => { remove(selectedClip) }} />}
      {staleRecord !== undefined
        ? <button type="button" className="dv-tl-btn" style={{ ...button, marginLeft: 6, color: palette.danger }} onClick={() => { keepStale(staleRecord) }}>{t('tool.keepAnyway')}</button>
        : null}
      <span style={{ flex: 1 }} />
      {waiting.length > 0 ? <span data-testid="dv-timeline-export-waiting" style={{ color: palette.muted, fontSize: 12, lineHeight: '16px', marginRight: 6 }}>{t('tool.exportWaiting', { positions: waiting.join(', ') })}</span> : null}
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
    </div>
  )

  const playheadLeft = player.position * px
  // The playhead spans the ruler and both tracks.
  const playheadHeight = RULER_HEIGHT + ROW_GAP + VIDEO_HEIGHT + ROW_GAP + AUDIO_HEIGHT + trackCount * (ROW_GAP + AUDIO_HEIGHT)
  const trackHeader = (color: string, name: string): ReactNode => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 14, fontSize: 12, lineHeight: '16px' }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      {name}
    </span>
  )
  const tracks = (
    <div ref={scroller} style={{ flex: '1 1 auto', minHeight: 0, overflowX: 'auto', overflowY: 'hidden', position: 'relative', paddingBottom: TRACK_PADDING }}>
      <div ref={rows} style={{ display: 'grid', gridTemplateColumns: `${String(GUTTER)}px ${String(laneWidth)}px`, gridTemplateRows: [RULER_HEIGHT, VIDEO_HEIGHT, AUDIO_HEIGHT, ...Array.from({ length: trackCount }, () => AUDIO_HEIGHT), ADD_TRACK_HEIGHT].map(height => `${String(height)}px`).join(' '), rowGap: ROW_GAP, minWidth: GUTTER + laneWidth }}>
        <span />
        <div
          ref={lane} data-testid="dv-timeline-ruler" style={{ position: 'relative', borderBottom: `1px solid ${palette.line}`, cursor: 'ew-resize' }}
          onPointerDown={(event) => { capture(event); scrubbing.current = true; seekFromPointer(event) }}
          onPointerMove={(event) => { if (scrubbing.current) seekFromPointer(event) }}
          onPointerUp={() => { scrubbing.current = false }}
        >
          {rulerMarks}
        </div>
        {trackHeader(palette.take, t('track.video'))}
        <div
          role="list" aria-label={t('track.aria')} style={{ position: 'relative' }}
          onDragOver={(event) => { if (event.dataTransfer.types.includes(DV_ASSET_DRAG_TYPE)) event.preventDefault() }}
          onDrop={(event) => {
            const asset = event.dataTransfer.getData(DV_ASSET_DRAG_TYPE)
            if (asset.length === 0) return
            event.preventDefault()
            event.stopPropagation()
            const box = (lane.current as HTMLDivElement).getBoundingClientRect()
            insert(dropPosition(clips, (event.clientX - box.left) / px, null), asset)
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
            // The still image of the clip, else its video's first frame once read, repeated across the clip.
            const firstFrame = clip.assetId === null ? null : frames.get(assetUrl(clip.assetId)) ?? null
            const clipFrame = clip.thumbnail !== null ? assetUrl(clip.thumbnail) : firstFrame
            return (
              <div
                key={clip.clip} role="listitem" aria-label={t('track.clipAria', { position: clip.position, name })} aria-pressed={isSelected}
                data-clip={clip.clip} data-clip-position={clip.position} data-clip-status={clip.status} data-clip-stale={clip.stale} title={caption} {...clipHandlers(clip, 'move')}
                style={{
                  ...isSelected ? { zIndex: 1 } : {}, ...blockGeometry(clip), boxSizing: 'border-box', borderRadius: 'var(--dv-radius-sm)', overflow: 'hidden', cursor: 'grab', touchAction: 'none',
                  background: !ready ? placeholderFill : clipFrame === null ? palette.fill : `${palette.fill} url("${clipFrame}") left center / auto 100% repeat-x`,
                  // A border in the track color keeps a visible gap between neighboring clips.
                  border: `1px solid ${palette.panel}`,
                  boxShadow: [isSelected ? `0 0 0 2px ${palette.accent}` : null, `inset 0 0 0 ${clip.stale ? `2px ${palette.danger}` : `1px ${palette.line}`}`].filter(shadow => shadow !== null).join(', '),
                }}
              >
                {clipFrame === null && clip.assetId !== null ? <video src={assetUrl(clip.assetId)} preload="metadata" muted style={{ height: '100%', pointerEvents: 'none' }} /> : null}
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
          {timeline === null ? null : (
            <button
              ref={addRef} type="button" className="dv-tl-btn" aria-label={t('track.add')} title={t('track.add')} aria-expanded={picking} onClick={() => { setPickingSound(false); setPicking(!picking) }}
              style={{ ...button, position: 'absolute', left: total * px + 8, top: (VIDEO_HEIGHT - 32) / 2, width: 32, height: 32, padding: 0, justifyContent: 'center', color: palette.muted }}
            >
              <Icon name="add" />
            </button>
          )}
        </div>
        {trackHeader(palette.audio, t('track.audio'))}
        <div style={{ position: 'relative' }} aria-hidden>
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
        {Array.from({ length: trackCount }, (_, track) => [
          <span
            key={`head-${String(track)}`} data-sound-track-head={track} style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}
            onDoubleClick={() => { startTrackRename(track) }}
            onContextMenu={(event) => { event.preventDefault(); setSoundMenu({ kind: 'track', track, x: event.clientX, y: event.clientY }) }}
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
            ) : trackHeader(palette.sound, trackName(track))}
          </span>,
          <div key={`lane-${String(track)}`} role="group" aria-label={t('track.soundN', { n: track + 1 })} data-sound-track={track} style={{ position: 'relative' }}>
            {timeline === null ? null : (
              <button
                type="button" className="dv-tl-btn" aria-label={t('track.addSound')} title={t('track.addSound')} disabled={addingAt !== null}
                onClick={(event) => {
                  soundAddRef.current = event.currentTarget
                  setPicking(false); setSoundTrack(track); setPickingSound(!pickingSound || soundTrack !== track)
                }}
                aria-expanded={pickingSound && soundTrack === track}
                style={{ ...button, position: 'absolute', left: span * px + 8, top: (AUDIO_HEIGHT - 32) / 2, width: 32, height: 32, padding: 0, justifyContent: 'center', color: palette.muted, zIndex: 1 }}
              >
                <Icon name="add" />
              </button>
            )}
            {sounds.filter(sound => sound.track === track).map(sound => (
              <div
                key={sound.sound} data-sound={sound.sound} title={t('track.soundItem', { name: sound.name })} aria-pressed={sound.sound === chosenSound}
                onClick={(event) => { event.stopPropagation(); setChosenClip(null); setChosenSound(sound.sound); root.current?.focus() }}
                onContextMenu={(event) => {
                  event.preventDefault(); setChosenClip(null); setChosenSound(sound.sound)
                  setSoundMenu({ kind: 'sound', sound, x: event.clientX, y: event.clientY })
                }}
                style={{
                  position: 'absolute', top: 0, bottom: 0, left: sound.startSec * px, width: sound.seconds * px, boxSizing: 'border-box', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', borderRadius: 'var(--dv-radius-sm)', border: `1px solid ${palette.sound}`, background: palette.audioSoft,
                  overflow: 'hidden', ...sound.sound === chosenSound ? { boxShadow: `0 0 0 2px ${palette.accent}`, zIndex: 1 } : {},
                }}
              >
                {/* As in common editors, the file name sits in its own strip above the waveform, cut with an ellipsis. */}
                <span style={{ flex: 'none', height: SOUND_NAME_HEIGHT, padding: '0 4px', fontSize: 11, lineHeight: `${String(SOUND_NAME_HEIGHT)}px`, color: palette.fg, background: palette.panel, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {sound.name}
                </span>
                <span style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                  <AudioWaveform
                    assetId={sound.assetId} inSec={0} outSec={sound.seconds} width={sound.seconds * px}
                    height={AUDIO_HEIGHT - 2 - SOUND_NAME_HEIGHT}
                  />
                </span>
              </div>
            ))}
          </div>,
        ])}
        <span style={{ display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
          {timeline === null ? null : (
            <button
              type="button" className="dv-tl-btn" style={{ ...button, ...textButton, fontSize: 12, whiteSpace: 'nowrap' }}
              disabled={trackCount > storedTracks} onClick={() => { setShownTracks(trackCount + 1) }}
            >
              <Icon name="add" />{t('track.addTrack')}
            </button>
          )}
        </span>
        <span />
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
  // it. The picker ends 8 px above the panel's bottom, which sits on the window's bottom edge, and only its list
  // scrolls, so its title and close button stay in view. Focus that leaves the picker and ＋ closes it. A
  // resized panel gives its extra height to the scrolling track rows, which keep their own heights at the top.
  const editPanel = (
    <div ref={panel} style={{ flex: 'none', ...trackHeight === null ? {} : { height: trackHeight }, display: 'flex', flexDirection: 'column', background: palette.panel }}>
      {toolbar}
      <div onBlur={closeOnFocusOut} style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {tracks}
        {pickingSound ? (
          <div
            ref={soundPickerRef} role="dialog" aria-label={t('track.addSound')}
            style={{ position: 'absolute', right: 12, top: 8, boxSizing: 'border-box', maxHeight: 'min(234px, calc(100% - 16px))', display: 'flex', flexDirection: 'column', background: palette.panel, border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-lg)', boxShadow: 'var(--dv-shadow-1)', padding: 6, zIndex: 5, minWidth: 200 }}
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
            ref={pickerRef} role="dialog" aria-label={t('track.pick')}
            style={{ position: 'absolute', right: 12, top: 8, boxSizing: 'border-box', maxHeight: 'min(194px, calc(100% - 16px))', display: 'flex', flexDirection: 'column', background: palette.panel, border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-lg)', boxShadow: 'var(--dv-shadow-1)', padding: 6, zIndex: 5, minWidth: 180 }}
          >
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
              <p style={{ flex: 1, margin: 0, color: palette.muted, fontSize: 12, lineHeight: '16px' }}>{t('track.pick')}</p>
              <IconButton icon="close" label={t('track.pickClose')} onClick={closePicker} />
            </div>
            <div style={{ minHeight: 0, overflow: 'auto' }}>
              {candidates.length === 0 ? <p style={{ margin: 0 }}>{t('track.noAssets')}</p> : candidates.map(entry => (
                <button
                  key={entry.id} type="button" className="dv-tl-btn" style={{ ...menuItem, marginTop: 4 }}
                  onClick={() => { setPicking(false); insert(clips.length + 1, entry.id) }}
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
            key={sound.sound} data-sound={sound.sound} src={assetUrl(sound.assetId)} preload="metadata"
            onLoadedMetadata={(event) => {
              const seconds = event.currentTarget.duration
              if (Number.isFinite(seconds) && seconds > 0) setMeasured(current => new Map(current).set(sound.assetId, seconds))
            }}
          />
        ))}
      </div>
      {soundMenu !== null ? (
        <div ref={soundMenuRef} role="menu" style={{ position: 'fixed', left: soundMenu.x, top: soundMenu.y, zIndex: 20, background: palette.panel, border: `1px solid ${palette.line}`, borderRadius: 'var(--dv-radius-xl)', padding: 6, boxShadow: 'var(--dv-shadow-2)', minWidth: 140 }}>
          {soundMenu.kind === 'sound'
            ? <button type="button" role="menuitem" className="dv-tl-btn" onClick={() => { removeSound(soundMenu.sound) }} style={{ ...menuItem, color: palette.danger }}>{t('menu.delete')}</button>
            : (
              <>
                <button type="button" role="menuitem" className="dv-tl-btn" onClick={() => { startTrackRename(soundMenu.track) }} style={menuItem}>
                  {t('menu.renameTrack')}
                </button>
                <button type="button" role="menuitem" className="dv-tl-btn" onClick={() => { removeTrack(soundMenu.track) }} style={{ ...menuItem, color: palette.danger }}>{t('menu.deleteTrack')}</button>
              </>
            )}
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
    if (event.dataTransfer.types.includes('Files') && !event.dataTransfer.types.includes(DV_ASSET_DRAG_TYPE)) setDropNotice(true)
  }

  return (
    <div
      onDragEnter={holdDrag} onDragOver={holdDrag} onDrop={dropOutside}
      ref={root} tabIndex={0} onKeyDown={onKeyDown} data-testid="dv-timeline-editor" className="dv-tl-editor"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: palette.bg, color: palette.fg, fontFamily: 'var(--dv-font-sans)', fontSize: 13, lineHeight: '20px', outline: 'none' }}
    >
      <style>{EDITOR_CSS}</style>
      {tabs}
      {dropNotice ? <p role="status" style={{ margin: 0, padding: '4px 12px', color: palette.muted, fontSize: 12, lineHeight: '16px' }}>{t('track.fileDrop')}</p> : null}
      {viewer}
      {resizeHandle}
      {editPanel}
    </div>
  )
}
