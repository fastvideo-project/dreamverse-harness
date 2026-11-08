/**
 * One microphone take at a time: start, stop into a WAV file with a playable URL, and drop it. The URLs it made are
 * revoked when the component unmounts.
 *
 * @module @fastvideo/dreamverse-ui-voice-convert/useTake
 */
import { useEffect, useRef, useState } from 'react'
import type { Recorder } from './VoicePanel.tsx'

/** A finished take: the WAV file and its object URL for the player. */
export interface Take {
  file: File
  url: string
}

/** The take controls of {@link useTake}. */
export interface TakeControls {
  /** Whether the microphone is recording. */
  recording: boolean
  /** The finished take waiting to be kept or dropped. */
  take: Take | null
  start: () => void
  /** Stop the recording into a take; nothing while the microphone is not recording. */
  stop: () => void
  drop: () => void
}

/**
 * The take controls over a microphone.
 * @param recorder - the microphone.
 * @param fail - called with a microphone failure.
 * @returns the controls.
 */
export function useTake(recorder: Recorder, fail: (error: unknown) => void): TakeControls {
  const [stopper, setStopper] = useState<(() => Promise<File>) | null>(null)
  const [take, setTake] = useState<Take | null>(null)
  const urls = useRef<string[]>([])
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url) }, [])
  return {
    recording: stopper !== null,
    take,
    start: () => {
      setTake(null)
      recorder.start().then((stop) => { setStopper(() => stop) }, fail)
    },
    stop: () => {
      if (stopper === null) return
      setStopper(null)
      stopper().then((file) => {
        const url = URL.createObjectURL(file)
        urls.current.push(url)
        setTake({ file, url })
      }, fail)
    },
    drop: () => { setTake(null) },
  }
}
