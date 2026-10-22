/**
 * The media views of the media types that enter a project through `asset.import`: images, videos and audio. Each view
 * fills the box of the surface that renders the `dv.media` occurrence: a still at purpose 'thumb' and 'card' (the audio
 * card shows its waveform and a play button), a playable form at purpose 'player' and 'loop'.
 *
 * @module @dv/ui-asset-pool/media
 */
import { useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { Asset, WireState } from '@dv/ui-kit/types.ts'
import { clipPeaks, useAudioEnvelope } from '@dv/ui-kit/waveform.ts'
import type { MediaType } from '@dv/ui-media/contract'

const fill: CSSProperties = { display: 'block', width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }
const playable: CSSProperties = { display: 'block', width: '100%', maxHeight: '70vh', objectFit: 'contain' }

/**
 * The still of a video: an image output of the record that made it, such as a take's last frame; null for a video
 * without one, such as an imported video.
 * @param asset - the video asset.
 * @param state - the project state.
 * @returns the still's asset ID, or null.
 */
function videoStill(asset: Asset, state: WireState): string | null {
  const maker = state.components.proj.records.find(record => record.id === asset.created_by)
  const images = new Set(state.assets.filter(each => each.mime.startsWith('image/')).map(each => each.id))
  return maker?.outputs.find(id => images.has(id)) ?? null
}

/** The three media types; the `@` menu shows an image itself and a video by the image output of its producer. */
export const MEDIA_TYPES: readonly MediaType[] = [
  { id: 'image', label: () => ['图片', 'Image'], icon: 'image', poster: asset => asset.id },
  { id: 'video', label: () => ['视频', 'Video'], icon: 'video', poster: videoStill },
  { id: 'audio', label: () => ['音频', 'Audio'], icon: 'audio' },
]

/**
 * An image: cover-fitted as a still, contained at full size as a player, which reports its loaded size. An image that
 * the browser cannot decode reports that it cannot draw.
 * @param props - the asset, the purpose, the size callback and the failure report.
 * @returns the element.
 */
export function ImageView({ asset, purpose, onSize, unsupported }: PropsRuntime<'dv.media.view'>): ReactNode {
  if (purpose === 'thumb' || purpose === 'card') return <img src={assetUrl(asset.id)} alt="" style={fill} draggable={false} onError={unsupported} />
  return (
    <img
      src={assetUrl(asset.id)} alt={asset.name} style={playable} draggable={false} onError={unsupported}
      onLoad={(event) => { onSize?.({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }) }}
    />
  )
}

/**
 * A video: its first frame, muted, as a still; with controls and sound as a player; with controls, muted and looping,
 * behind the poster, at purpose 'loop'. A playable form reports its loaded size. A video that the browser cannot decode,
 * such as HEVC in a browser without the codec, reports that it cannot draw.
 * @param props - the asset, the purpose, the poster, the size callback and the failure report.
 * @returns the element.
 */
export function VideoView({ asset, purpose, poster, onSize, unsupported }: PropsRuntime<'dv.media.view'>): ReactNode {
  if (purpose === 'thumb' || purpose === 'card') return <video src={`${assetUrl(asset.id)}#t=0.1`} muted preload="metadata" style={fill} onError={unsupported} />
  const loop = purpose === 'loop'
  return (
    <video
      src={assetUrl(asset.id)} poster={loop && poster !== undefined ? assetUrl(poster) : undefined} controls autoPlay
      muted={loop} loop={loop} style={playable} onError={unsupported}
      onLoadedMetadata={(event) => { onSize?.({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight }) }}
    />
  )
}

/** Bars of the card waveform, and the width of one bar and its gap, in viewBox units. */
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
    return <span aria-label={asset.name} style={{ display: 'flex', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', background: 'var(--dv-surface-3)', color: 'var(--dv-text-2)' }}>♪</span>
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
  // Bars are mirrored around the middle and at least 1 unit tall, so a silent stretch still shows a center line.
  const path = envelope === null ? null : clipPeaks(envelope, 0, asset.duration_sec ?? envelope.peaks.length / envelope.rate, BARS)
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
            <path d={path} fill="var(--dv-kind-audio)" />
          </svg>
        )}
      <audio
        ref={player} src={assetUrl(asset.id)} preload="none" style={{ display: 'none' }}
        onPlay={() => { setPlaying(true) }} onPause={() => { setPlaying(false) }} onEnded={() => { setPlaying(false) }}
      />
    </span>
  )
}
