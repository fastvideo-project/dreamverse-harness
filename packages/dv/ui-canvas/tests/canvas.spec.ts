/** The rules of `dv_canvas_move` and the parsers of the values that cross the wire between the two canvas halves. */
import { describe, expect, it } from 'vitest'
import { cardsAfter, parseDrawn, parseMoved, parseQuery, planMove, refusalSentence } from '../src/canvas.ts'
import type { CanvasCard } from '../src/types.ts'

/** A drawn card at (x, y) with a frame of 208 × 100 below its caption. */
function card(id: string, x: number, y: number): CanvasCard {
  return { id, type: 'text', title: id, record: null, x, y, width: 208, height: 100, rendering: false }
}

const CARDS = [card('a', 0, 0), card('b', 240, 0), card('c', 0, 200)]

describe('planMove', () => {
  it('places the listed nodes at their corners 24 units apart, and keeps an overlap between two cards that do not move', () => {
    expect(planMove([...CARDS, card('d', 10, 210)], [{ node: 'a', x: 500, y: 0 }, { node: 'b', x: 500, y: 144 }]))
      .toEqual({ kind: 'move', positions: { a: { x: 500, y: 0 }, b: { x: 500, y: 144 } } })
  })

  it('refuses a node listed twice, then an unknown node, then a moved card that overlaps another or comes within 24 units', () => {
    expect(planMove(CARDS, [{ node: 'a', x: 0, y: 0 }, { node: 'zz', x: 0, y: 0 }, { node: 'a', x: 1, y: 1 }]))
      .toEqual({ kind: 'duplicate_nodes', ids: ['a'] })
    expect(planMove(CARDS, [{ node: 'zz', x: 0, y: 0 }])).toEqual({ kind: 'unknown_nodes', ids: ['zz'], known: ['a', 'b', 'c'] })
    expect(planMove(CARDS, [{ node: 'c', x: 100, y: 50 }]))
      .toEqual({ kind: 'too_close', pairs: [[card('a', 0, 0), card('c', 100, 50)], [card('b', 240, 0), card('c', 100, 50)]] })
    expect(planMove(CARDS, [{ node: 'c', x: 0, y: 143 }])).toEqual({ kind: 'too_close', pairs: [[card('a', 0, 0), card('c', 0, 143)]] })
  })
})

describe('refusalSentence', () => {
  it('names the bad input and the next step, and says that nothing moved', () => {
    expect(refusalSentence({ kind: 'duplicate_nodes', ids: ['a', 'b'] }))
      .toBe('The moves list these nodes more than once: a, b. List each node once. Nothing was moved.')
    expect(refusalSentence({ kind: 'unknown_nodes', ids: ['zz'], known: ['a', 'b'] }))
      .toBe('The canvas has no node zz. Its nodes are: a, b. Nothing was moved.')
    expect(refusalSentence({ kind: 'too_close', pairs: [[card('a', 0, 0), card('c', 100, 50)]] })).toBe(
      'The move would leave cards closer than 24 units: a (x 0, y 0, frame 208 wide and 100 tall) and c (x 100, y 50, frame 208 wide and 100 tall). '
      + 'Keep at least 24 units between the cards and call dv_canvas_move again. Nothing was moved.',
    )
  })
})

describe('cardsAfter', () => {
  it('moves the listed cards and keeps the others and the order', () => {
    expect(cardsAfter(CARDS, { b: { x: 600, y: 10 } })).toEqual([card('a', 0, 0), card('b', 600, 10), card('c', 0, 200)])
  })
})

describe('the wire parsers', () => {
  it('read the id and the stream of a read frame or an answer, and refuse any other data', () => {
    expect(parseQuery({ id: 'r1', stream: 'k1', extra: 1 })).toEqual({ id: 'r1', stream: 'k1' })
    for (const input of [null, 'r1', {}, { id: 1 }, { id: 'r1' }, { id: 'r1', stream: 2 }]) expect(parseQuery(input)).toBeNull()
  })

  it('read the cards of an answer of the named project, and refuse another project or a malformed card', () => {
    const rendering = { ...card('d', 0, 400), record: 'r1', rendering: true }
    expect(parseDrawn({ project: 'p1', cards: [...CARDS, rendering] }, 'p1')).toEqual([...CARDS, rendering])
    expect(parseDrawn({ project: 'p2', cards: CARDS }, 'p1')).toBeNull()
    const broken = [
      null, 'cards', { project: 'p1' }, { project: 'p1', cards: {} }, { project: 'p1', cards: [null] },
      { project: 'p1', cards: [{ ...card('a', 0, 0), x: Number.NaN }] }, { project: 'p1', cards: [{ ...card('a', 0, 0), title: 3 }] },
      { project: 'p1', cards: [{ ...card('a', 0, 0), record: 3 }] }, { project: 'p1', cards: [{ ...card('a', 0, 0), height: '1' }] },
      { project: 'p1', cards: [{ ...card('a', 0, 0), rendering: 'no' }] },
    ]
    for (const value of broken) expect(parseDrawn(value, 'p1')).toBeNull()
  })

  it('read a stored move, and refuse one without a project or with a malformed position', () => {
    expect(parseMoved({ project: 'p1', positions: { a: { x: 1, y: 2 } } })).toEqual({ project: 'p1', positions: { a: { x: 1, y: 2 } } })
    for (const output of [null, { positions: {} }, { project: 'p1' }, { project: 'p1', positions: { a: { x: 1 } } }]) {
      expect(parseMoved(output)).toBeNull()
    }
  })
})
