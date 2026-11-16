/** Validation of the native `video_output_capabilities` metadata and the output facts read from it. */
import { describe, expect, it } from 'vitest'
import { outputFacts } from '../src/output-capabilities.ts'

const metadata = { schema_version: 1, fps: 24, duration_seconds: { min: 5, max: 15 },
  num_frames_by_duration_seconds: Object.fromEntries(Array.from({ length: 11 }, (_, index) => {
    const seconds = index + 5
    return [String(seconds), Math.ceil((seconds * 24 - 5) / 17) * 17 + 5]
  })), recommended_frame_sizes: { '16:9': { '480p': [832, 480], '768p': [1344, 768] }, '9:16': { '480p': [480, 832], '768p': [768, 1344] } } }

describe('native output capability discovery', () => {
  it('reads 768p and longer clips in the server order', () => {
    const discovered = outputFacts(metadata)
    expect(discovered).toMatchObject({ minDurationSec: 5, maxDurationSec: 15, aspectRatios: ['16:9', '9:16'], resolutions: ['480p', '768p'] })
    expect(discovered.frameSizes['16:9']?.['768p']).toEqual([1344, 768])
    expect(discovered.numFramesByDurationSec).toMatchObject({ 5: 124, 10: 243, 15: 362 })
  })
  it('keeps the server order of aspect ratios and of the first aspect ratio\'s resolutions', () => {
    const reordered = { ...metadata, recommended_frame_sizes: { '9:16': { '768p': [768, 1344], '480p': [480, 832] },
      '16:9': { '480p': [832, 480], '768p': [1344, 768] }, '1:1': { '768p': [768, 768], '480p': [480, 480] } } }
    expect(outputFacts(reordered)).toMatchObject({ aspectRatios: ['9:16', '16:9', '1:1'], resolutions: ['768p', '480p'] })
  })
  it.each([{}, [], 'metadata', { ...metadata, schema_version: 2 }, { ...metadata, duration_seconds: { min: 5, max: 4 } },
    { ...metadata, num_frames_by_duration_seconds: { 5: 124 } },
    { ...metadata, recommended_frame_sizes: { '16:9': { '768p': [NaN, 768] } } },
    { ...metadata, recommended_frame_sizes: { '16:9': { '768p': [1344, 768] }, '9:16': { '480p': [480, 832] } } },
    { ...metadata, recommended_frame_sizes: {} },
    { ...metadata, recommended_frame_sizes: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`${index + 1}:1`, { '480p': [480, 480] }])) },
    { ...metadata, recommended_frame_sizes: { '0:9': { '480p': [480, 832] } } },
    { ...metadata, recommended_frame_sizes: { wide: { '480p': [832, 480] } } },
    { ...metadata, recommended_frame_sizes: { '16:9': {} } },
    { ...metadata, recommended_frame_sizes: { '16:9': Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`${index}p`, [832, 480]])) } }])('rejects malformed metadata: %j', (value) => {
    expect(() => outputFacts(value)).toThrow('FastVideo returned invalid video output capabilities.')
  })
})
