/** The parsers of the values that cross the wire between the two canvas halves. */
import { describe, expect, it } from 'vitest'
import { parseDrawn, parseQuery } from '../src/canvas.ts'
import type { CanvasCard } from '../src/types.ts'

/** A drawn card at (x, y) with a frame of 208 × 100 below its caption. */
function card(id: string, x: number, y: number): CanvasCard {
  return { id, type: 'text', title: id, shown: id, versions: 1, x, y, width: 208, height: 100, rendering: false }
}

const CARDS = [card('a', 0, 0), card('b', 240, 0), card('c', 0, 200)]

describe('the wire parsers', () => {
  it('read the id and the stream of a read frame or an answer, and refuse any other data', () => {
    expect(parseQuery({ id: 'r1', stream: 'k1', extra: 1 })).toEqual({ id: 'r1', stream: 'k1' })
    for (const input of [null, 'r1', {}, { id: 1 }, { id: 'r1' }, { id: 'r1', stream: 2 }]) expect(parseQuery(input)).toBeNull()
  })

  it('read the cards of an answer of the named project, and refuse another project or a malformed card', () => {
    const rendering = { ...card('d', 0, 400), shown: 'r2', versions: 2, rendering: true }
    expect(parseDrawn({ project: 'p1', cards: [...CARDS, rendering] }, 'p1')).toEqual([...CARDS, rendering])
    expect(parseDrawn({ project: 'p2', cards: CARDS }, 'p1')).toBeNull()
    const broken = [
      null, 'cards', { project: 'p1' }, { project: 'p1', cards: {} }, { project: 'p1', cards: [null] },
      { project: 'p1', cards: [{ ...card('a', 0, 0), x: Number.NaN }] }, { project: 'p1', cards: [{ ...card('a', 0, 0), title: 3 }] },
      { project: 'p1', cards: [{ ...card('a', 0, 0), shown: null }] }, { project: 'p1', cards: [{ ...card('a', 0, 0), versions: '2' }] },
      { project: 'p1', cards: [{ ...card('a', 0, 0), height: '1' }] }, { project: 'p1', cards: [{ ...card('a', 0, 0), rendering: 'no' }] },
    ]
    for (const value of broken) expect(parseDrawn(value, 'p1')).toBeNull()
  })
})
