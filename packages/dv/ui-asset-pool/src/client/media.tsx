/**
 * The media types that enter a project through `asset.import` (image, video and audio) and their `dv.media.view`
 * entries. Each view fills the box of the surface that renders it: a still at purpose 'thumb' and 'card', a playable
 * form at purpose 'player' and 'loop'.
 *
 * @module @dv/ui-asset-pool/media
 */
import { useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { IconMicrophoneOutlineRegular, IconPaperclipOutlineRegular, IconPlayOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { Asset, WireState } from '@dv/ui-kit/types.ts'
import { clipPeaks, useAudioEnvelope } from '@dv/ui-kit/waveform.ts'
import type { MediaType } from '@dv/ui-media/contract'

const ID = '@dv/ui-asset-pool'

const fill: CSSProperties = { display: 'block', width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }
const playBadge: CSSProperties = {
  position: 'absolute', right: 4, bottom: 4, width: 18, height: 18, borderRadius: 9999,
  display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255, 255, 255, 0.9)', color: '#0A0B0D',
}
const playable: CSSProperties = { display: 'block', width: '100%', height: '100%', objectFit: 'contain' }

function videoStill(asset: Asset, state: WireState): string | null {
  const maker = state.components.proj.records.find(record => record.id === asset.created_by)
  const images = new Set(state.assets.filter(each => each.mime.startsWith('image/')).map(each => each.id))
  return maker?.outputs.find(id => images.has(id)) ?? null
}

/** A media type and the `dv.media.view` entry that draws it, registered together under the type's `id`. */
export interface MediaTypeEntry {
  type: MediaType
  View: (props: PropsRuntime<'dv.media.view'>) => ReactNode
}

/**
 * The image, video and audio media types. An image is its own poster; a video's poster is an image output of the record
 * that made it, and a video without one, such as an imported video, has no poster.
 */
export const MEDIA_TYPES: readonly MediaTypeEntry[] = [
  { type: { id: 'image', owner: ID, icon: IconPaperclipOutlineRegular, poster: asset => asset.id }, View: ImageView },
  { type: { id: 'video', owner: ID, icon: IconPlayOutlineRegular, poster: videoStill }, View: VideoView },
  { type: { id: 'audio', owner: ID, icon: IconMicrophoneOutlineRegular }, View: AudioView },
]

/**
 * An image: cover-fitted as a still, contained at full size as a player, which reports its loaded size. An image that
 * the browser cannot decode reports that it cannot draw.
 * @param props - the asset, the purpose, the size callback and the failure report.
 * @returns the element.
 */
export function ImageView({ asset, purpose, onSize, unsupported }: PropsRuntime<'dv.media.view'>): ReactNode {
  if (purpose === 'thumb' || purpose === 'card') {
    return <img src={assetUrl(asset.id)} alt="" loading="lazy" decoding="async" style={fill} draggable={false} onError={unsupported} />
  }
  return (
    <img
      src={assetUrl(asset.id)} alt={asset.name} style={playable} draggable={false} onError={unsupported}
      onLoad={(event) => { onSize?.({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }) }}
    />
  )
}

function PlayIcon(): ReactNode {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L8.5 4.6A1 1 0 0 0 7 5.5z" />
    </svg>
  )
}

/**
 * A video: its first frame, muted and decorative, as a still, with a play badge when the surface asks for one; with
 * controls and sound as a player; with controls, muted and looping, behind the poster, at purpose 'loop'. A playable
 * form reports its loaded size. A video that the browser cannot decode, such as HEVC in a browser without the codec,
 * reports that it cannot draw.
 * @param props - the asset, the purpose, the poster, the play badge, the size callback and the failure report.
 * @returns the element.
 */
export function VideoView({ asset, purpose, poster, playBadge: badge, onSize, unsupported }: PropsRuntime<'dv.media.view'>): ReactNode {
  if (purpose === 'thumb' || purpose === 'card') {
    // `#t=0.1` asks the browser to decode a frame past the first keyframe's black lead-in.
    const still = <video src={`${assetUrl(asset.id)}#t=0.1`} muted preload="metadata" playsInline aria-hidden style={fill} onError={unsupported} />
    if (badge === undefined) return still
    return <span style={{ position: 'relative', display: 'block', width: '100%', height: '100%' }}>{still}<span style={playBadge}><PlayIcon /></span></span>
  }
  const loop = purpose === 'loop'
  return (
    <video
      src={assetUrl(asset.id)} poster={loop && poster !== undefined ? assetUrl(poster) : undefined} controls autoPlay
      muted={loop} loop={loop} style={playable} onError={unsupported}
      onLoadedMetadata={(event) => { onSize?.({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight }) }}
    />
  )
}

const BARS = 48
const BAR = 3
const GAP = 1

/**
 * An audio asset: a note glyph as a thumbnail; its waveform with a play button as a card; an audio player with sound
 * as a player, which reports that it cannot draw an audio file that the browser cannot play. The waveform draws once
 * the audio decodes, and nothing while it decodes or when it has no audio.
 * @param props - the asset, the purpose and the failure report.
 * @returns the element.
 */
export function AudioView({ asset, purpose, unsupported }: PropsRuntime<'dv.media.view'>): ReactNode {
  if (purpose === 'thumb') {
    return <span aria-hidden style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', background: 'var(--dv-surface-3)', color: 'var(--dv-text-2)' }}>♪</span>
  }
  if (purpose === 'player' || purpose === 'loop') return <audio src={assetUrl(asset.id)} controls style={{ display: 'block', width: '100%', alignSelf: 'center' }} onError={unsupported} />
  return <AudioCard asset={asset} />
}

/**
 * The card form of an audio asset: the waveform of the whole asset, and a button that plays or pauses it with sound.
 * @param props - the asset.
 * @returns the element.
 */
function AudioCard({ asset }: { asset: PropsRuntime<'dv.media.view'>['asset'] }): ReactNode {
  const pick = useText()
  const envelope = useAudioEnvelope(asset.id)
  const player = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const peaks = envelope === null ? [] : clipPeaks(envelope, 0, asset.duration_sec ?? envelope.peaks.length / envelope.rate, BARS)
  const path = peaks.length === 0 ? null : peaks
    .map((peak, bar) => {
      const height = Math.max(1, peak * 36)
      return `M${String(bar * (BAR + GAP))} ${String((40 - height) / 2)}h${String(BAR)}v${String(height)}h-${String(BAR)}z`
    }).join('')
  const toggle = (): void => {
    const element = player.current
    if (element?.paused === true) void element.play().catch((error: unknown) => { void error })
    else element?.pause()
  }
  return (
    <span style={{ position: 'relative', display: 'flex', width: '100%', height: '100%', alignItems: 'center', gap: 8, padding: '0 10px', boxSizing: 'border-box', background: 'var(--dv-surface-3)' }}>
      <button
        type="button" aria-label={playing ? pick('暂停', 'Pause') : pick('播放', 'Play')} aria-pressed={playing}
        style={{ flex: 'none', width: 28, height: 28, border: 'none', borderRadius: 14, background: 'var(--dv-surface-1)', color: 'var(--dv-text)', cursor: 'pointer' }}
        onPointerDown={(event) => { event.stopPropagation() }} onClick={(event) => { event.stopPropagation(); toggle() }}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      {path === null
        ? <span style={{ flex: 1 }} />
        : (
          <svg data-testid="dv-audio-waveform" viewBox={`0 0 ${String(BARS * (BAR + GAP))} 40`} preserveAspectRatio="none" aria-hidden style={{ flex: 1, height: '60%' }}>
            <path d={path} fill="var(--dv-waveform)" />
          </svg>
        )}
      <audio
        ref={player} src={assetUrl(asset.id)} preload="none" style={{ display: 'none' }}
        onPlay={() => { setPlaying(true) }} onPause={() => { setPlaying(false) }} onEnded={() => { setPlaying(false) }}
        onError={() => { setPlaying(false) }}
      />
    </span>
  )
}
