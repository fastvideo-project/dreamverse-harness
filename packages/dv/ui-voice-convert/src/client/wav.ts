/**
 * 16-bit PCM WAV encoding of a browser recording. A browser's `MediaRecorder` writes WebM or MP4 audio whose header
 * often has no duration; the Voice tab decodes the recording and stores it as WAV, so the asset pool reads its duration
 * and the voice model reads it without a container decoder.
 *
 * @module @fastvideo/dreamverse-ui-voice-convert/wav
 */

/**
 * Mix channels to one by averaging them sample by sample.
 * @param channels - the channels, each of the same length.
 * @returns the mono samples; the one channel itself when there is one.
 */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const [first] = channels
  if (first === undefined) return new Float32Array(0)
  if (channels.length === 1) return first
  const mono = new Float32Array(first.length)
  for (const channel of channels) {
    for (let index = 0; index < mono.length; index++) mono[index] = (mono[index] as number) + (channel[index] as number) / channels.length
  }
  return mono
}

/**
 * Encode mono samples as a 16-bit PCM WAV file. Samples outside [-1, 1] are clipped.
 * @param samples - the samples, in [-1, 1].
 * @param sampleRate - samples per second.
 * @returns the file's bytes: a 44-byte header and the data.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string): void => {
    for (let index = 0; index < value.length; index++) view.setUint8(at + index, value.charCodeAt(index))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => {
    const clipped = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + index * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true)
  })
  return bytes
}
