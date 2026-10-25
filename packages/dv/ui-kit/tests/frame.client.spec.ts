/** The frame height of a canvas node's picture. */
import { describe, expect, it } from 'vitest'
import { frameHeight, NODE_FRAME_HEIGHT } from '../src/client/frame.ts'

describe('frameHeight', () => {
  it('sizes the 208-unit frame at the picture aspect ratio', () => {
    expect(frameHeight({ width: 1920, height: 1080 }, 50)).toBe(NODE_FRAME_HEIGHT)
    expect(frameHeight({ width: 1024, height: 1024 }, 50)).toBe(208)
    expect(frameHeight({ width: 768, height: 1024 }, 50)).toBe(277)
  })

  it('clamps the aspect ratio between 3:4 and 16:9', () => {
    expect(frameHeight({ width: 2560, height: 720 }, 50)).toBe(117)
    expect(frameHeight({ width: 720, height: 1920 }, 50)).toBe(277)
  })

  it('returns the fallback for a picture of unknown size', () => {
    expect(frameHeight({ width: null, height: 1080 }, 50)).toBe(50)
    expect(frameHeight({ width: 1920, height: null }, 50)).toBe(50)
    expect(frameHeight(undefined, 50)).toBe(50)
  })
})
