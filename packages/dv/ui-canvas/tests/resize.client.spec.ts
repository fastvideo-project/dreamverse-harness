/** The box of a canvas node after a corner drag. */
import { describe, expect, it } from 'vitest'
import type { NodeSizing } from '../src/client/contract/index.ts'
import { resizedBox } from '../src/client/resize.ts'

const WINDOW: NodeSizing = { kind: 'window', defaultSize: { width: 208, height: 106 }, minSize: { width: 104, height: 58 } }
const MEDIA: NodeSizing = {
  kind: 'media', defaultSize: { width: 208, height: 147 }, minSize: { width: 104, height: 88.5 }, aspectRatio: { ratio: 16 / 9, fixedHeight: 30 },
}
const origin = { x: 100, y: 200, width: 208, height: 106 }

describe('resizedBox', () => {
  it('gives a window node the width and the height that the pointer asks for, apart', () => {
    expect(resizedBox(WINDOW, origin, 'se', 50, 0)).toEqual({ x: 100, y: 200, width: 258, height: 106 })
    expect(resizedBox(WINDOW, origin, 'se', 0, 40)).toEqual({ x: 100, y: 200, width: 208, height: 146 })
    expect(resizedBox(WINDOW, origin, 'se', -20, 60)).toEqual({ x: 100, y: 200, width: 188, height: 166 })
  })

  it('keeps the corner opposite the dragged one in place', () => {
    expect(resizedBox(WINDOW, origin, 'nw', -50, -40)).toEqual({ x: 50, y: 160, width: 258, height: 146 })
    expect(resizedBox(WINDOW, origin, 'ne', 50, -40)).toEqual({ x: 100, y: 160, width: 258, height: 146 })
    expect(resizedBox(WINDOW, origin, 'sw', -50, 40)).toEqual({ x: 50, y: 200, width: 258, height: 146 })
  })

  it('stops a window node at each side of its minimum size', () => {
    expect(resizedBox(WINDOW, origin, 'se', -500, -10)).toEqual({ x: 100, y: 200, width: 104, height: 96 })
    expect(resizedBox(WINDOW, origin, 'nw', 10, 500)).toEqual({ x: 110, y: 248, width: 198, height: 58 })
  })

  it('keeps a media node at height = width / ratio + fixedHeight along the axis the pointer moved more', () => {
    const start = { x: 0, y: 0, width: 208, height: 147 }
    const along = (dx: number, dy: number) => {
      const box = resizedBox(MEDIA, start, 'se', dx, dy)
      return [box.width, box.height - (box.width / (16 / 9) + 30)]
    }
    expect(along(160, 10)).toEqual([368, 0])
    // 90 units down asks for (147 + 90 - 30) × 16/9 = 368 units of width.
    expect(along(10, 90)).toEqual([368, 0])
    expect(resizedBox(MEDIA, start, 'nw', -160, 0)).toEqual({ x: -160, y: 147 - 237, width: 368, height: 237 })
  })

  it('stops a media node at the narrowest width that keeps both sides of its minimum size', () => {
    expect(resizedBox(MEDIA, { x: 0, y: 0, width: 208, height: 147 }, 'se', -300, 0)).toEqual({ x: 0, y: 0, width: 104, height: 88.5 })
    const tall: NodeSizing = { ...MEDIA, minSize: { width: 104, height: 120 } }
    expect(resizedBox(tall, { x: 0, y: 0, width: 208, height: 147 }, 'se', -300, 0)).toEqual({ x: 0, y: 0, width: 160, height: 120 })
  })
})
