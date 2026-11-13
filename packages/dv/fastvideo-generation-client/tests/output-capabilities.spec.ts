/** Native geometry replaces smoke defaults without changing reference capability or model identity. */
import { describe, expect, it } from 'vitest'
import { outputFacts } from '../src/output-capabilities.ts'
import type { ModelFacts } from '../src/types.ts'

const base: ModelFacts = { modelId: 'custom-omni', aspectRatios: ['16:9'], resolutions: ['480p'],
  minDurationSec: 5, maxDurationSec: 5, frameSizes: { '16:9': { '480p': [832, 480] } },
  numFramesByDurationSec: { 5: 124 }, maxReferences: 12, referenceMediaTypes: { image: { maxCount: 9 } } }
const metadata = { schema_version: 1, fps: 24, duration_seconds: { min: 5, max: 15 },
  num_frames_by_duration_seconds: Object.fromEntries(Array.from({ length: 11 }, (_, index) => {
    const seconds = index + 5
    return [String(seconds), Math.ceil((seconds * 24 - 5) / 17) * 17 + 5]
  })), recommended_frame_sizes: { '16:9': { '480p': [832, 480], '768p': [1344, 768] }, '9:16': { '480p': [480, 832], '768p': [768, 1344] } } }

describe('native output capability discovery', () => {
  it('discovers 768p and longer clips while retaining identity and reference limits', () => {
    const discovered = outputFacts(base, metadata)
    expect(discovered).toMatchObject({ modelId: base.modelId, maxReferences: 12, referenceMediaTypes: base.referenceMediaTypes,
      minDurationSec: 5, maxDurationSec: 15, aspectRatios: ['16:9', '9:16'], resolutions: ['480p', '768p'] })
    expect(discovered.frameSizes['16:9']?.['768p']).toEqual([1344, 768])
    expect(discovered.numFramesByDurationSec).toMatchObject({ 5: 124, 10: 243, 15: 362 })
    expect(base.resolutions).toEqual(['480p'])
  })
  it('retains configured facts when an older server has no metadata', () => {
    expect(outputFacts(base, undefined)).toBe(base)
    expect(outputFacts(base, null)).toBe(base)
  })
  it.each([{}, [], { ...metadata, schema_version: 2 }, { ...metadata, duration_seconds: { min: 5, max: 4 } },
    { ...metadata, num_frames_by_duration_seconds: { 5: 124 } },
    { ...metadata, recommended_frame_sizes: { '16:9': { '768p': [NaN, 768] } } },
    { ...metadata, recommended_frame_sizes: { '16:9': { '768p': [1344, 768] }, '9:16': { '480p': [480, 832] } } },
    { ...metadata, recommended_frame_sizes: {} },
    { ...metadata, recommended_frame_sizes: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`${index + 1}:1`, { '480p': [480, 480] }])) },
    { ...metadata, recommended_frame_sizes: { '0:9': { '480p': [480, 832] } } },
    { ...metadata, recommended_frame_sizes: { wide: { '480p': [832, 480] } } },
    { ...metadata, recommended_frame_sizes: { '16:9': {} } },
    { ...metadata, recommended_frame_sizes: { '16:9': Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`${index}p`, [832, 480]])) } }])('rejects malformed metadata: %j', (value) => {
    expect(() => outputFacts(base, value)).toThrow('invalid video output capabilities')
  })
})
