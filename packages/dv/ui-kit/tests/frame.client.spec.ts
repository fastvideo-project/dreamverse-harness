/** The sizing of a canvas media node. */
import { describe, expect, it } from 'vitest'
import { mediaSizing, WIDE_RATIO } from '../src/client/frame.ts'

describe('mediaSizing', () => {
  it('sizes a media node at the picture aspect ratio clamped between 3:4 and 16:9, 208 wide by default and 104 at the narrowest', () => {
    expect(mediaSizing({ width: 768, height: 1024 }, WIDE_RATIO, 0)).toEqual({
      kind: 'media', defaultSize: { width: 208, height: 277 }, minSize: { width: 104, height: 139 }, aspectRatio: { ratio: 3 / 4, fixedHeight: 0 },
    })
    expect(mediaSizing({ width: 2560, height: 720 }, 1, 0).aspectRatio.ratio).toBe(16 / 9)
    expect(mediaSizing({ width: 720, height: 1920 }, 1, 0).aspectRatio.ratio).toBe(3 / 4)
  })

  it('takes the fallback ratio for a picture of unknown size, and adds the fixed bars to each height', () => {
    expect(mediaSizing(undefined, WIDE_RATIO, 0).defaultSize).toEqual({ width: 208, height: 117 })
    expect(mediaSizing({ width: null, height: 1080 }, 2, 30)).toEqual({
      kind: 'media', defaultSize: { width: 208, height: 134 }, minSize: { width: 104, height: 82 }, aspectRatio: { ratio: 2, fixedHeight: 30 },
    })
  })
})
