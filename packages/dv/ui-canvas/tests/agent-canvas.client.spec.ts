/** The agent's cards of a canvas, and the registry that holds the canvas streams, answers their reads, and draws their moves. */
import { describe, expect, it } from 'vitest'
import { CanvasViews, cardsOf } from '../src/client/agent-canvas.ts'
import type { CanvasLink, MountedCanvas, StreamListener } from '../src/client/agent-canvas.ts'
import type { CanvasNode } from '../src/client/graph.ts'
import type { CanvasCard, CanvasDrawn } from '../src/types.ts'

/** A drawn card of 208 × 100 at (x, y). */
function card(id: string, x: number, y: number): CanvasCard {
  return { id, type: 'text', title: id, record: null, x, y, width: 208, height: 100, rendering: false }
}

const CARDS = [card('a', 0, 0), card('b', 240, 0), card('c', 0, 200)]

/** A mounted canvas over fixed cards that records what it places. */
function mounted(projectId: string, cards: CanvasCard[], session: string | null = 's1') {
  const placed: Array<Record<string, { x: number; y: number }>> = []
  const canvas: MountedCanvas = { projectId, session, cards: () => cards, place: (positions) => { placed.push({ ...positions }) } }
  return { canvas, placed }
}

/** A link that records the streams it opens and the answers it sends. */
function scripted() {
  const streams: Array<{ key: string; listener: StreamListener; open: boolean }> = []
  const answers: CanvasDrawn[] = []
  const link: CanvasLink = {
    open: (project, session, listener) => {
      const stream = { key: `${project} ${String(session)}`, listener, open: true }
      streams.push(stream)
      return () => { stream.open = false }
    },
    answer: (drawn) => { answers.push(drawn) },
  }
  const stream = (key: string): StreamListener => {
    const found = streams.find(each => each.open && each.key === key)
    if (found === undefined) throw new Error(`no open stream ${key}`)
    return found.listener
  }
  return { views: new CanvasViews(link), streams, answers, stream }
}

describe('cardsOf', () => {
  it('lists each node with its type, record, drawn position, stored or default card width, height at that width, and rendering flag', () => {
    const node = {
      id: 'r1', type: 'take', title: 'Take 1', record: { id: 'r1' },
      flags: { rendering: true }, x: 5, y: 6,
    } as CanvasNode
    const plain = { ...node, id: 'n2', record: null, flags: { rendering: false } } as CanvasNode
    expect(cardsOf([node, plain], current => current.id === 'r1' ? { x: 10, y: 20, width: 312 } : current, (_, width) => width / 2)).toEqual([
      { id: 'r1', type: 'take', title: 'Take 1', record: 'r1', x: 10, y: 20, width: 312, height: 156, rendering: true },
      { id: 'n2', type: 'take', title: 'Take 1', record: null, x: 5, y: 6, width: 208, height: 104, rendering: false },
    ])
  })
})

describe('CanvasViews', () => {
  it('opens one stream per project and session for the first canvas, and closes it after the last one unmounts', () => {
    const { views, streams } = scripted()
    const first = views.mount(mounted('p1', CARDS).canvas)
    const second = views.mount(mounted('p1', CARDS).canvas)
    const elsewhere = views.mount(mounted('p1', CARDS, null).canvas)
    expect(streams.map(({ key, open }) => [key, open])).toEqual([['p1 s1', true], ['p1 null', true]])
    first()
    second()
    second()
    elsewhere()
    expect(streams.map(({ open }) => open)).toEqual([false, false])
    views.mount(mounted('p1', CARDS).canvas)
    expect(streams.map(({ key, open }) => [key, open])).toEqual([['p1 s1', false], ['p1 null', false], ['p1 s1', true]])
  })

  it('answers a read with the first canvas of the stream, draws nothing, and ignores a read after the last canvas left', () => {
    const { views, answers, stream } = scripted()
    const other = mounted('p2', [card('x', 0, 0)])
    const center = mounted('p1', CARDS)
    const tab = mounted('p1', [])
    for (const each of [other, center, tab]) views.mount(each.canvas)
    stream('p1 s1').read({ id: 'r1', stream: 'k1' })
    stream('p2 s1').read({ id: 'r2', stream: 'k2' })
    expect(answers).toEqual([
      { id: 'r1', stream: 'k1', project: 'p1', cards: CARDS }, { id: 'r2', stream: 'k2', project: 'p2', cards: [card('x', 0, 0)] },
    ])
    expect([other.placed, center.placed, tab.placed]).toEqual([[], [], []])
  })

  it('draws a stored move on every canvas of the stream, and ignores a frame of another project or a malformed one', () => {
    const { views, stream } = scripted()
    const other = mounted('p2', CARDS)
    const center = mounted('p1', CARDS)
    const tab = mounted('p1', CARDS)
    for (const each of [other, center, tab]) views.mount(each.canvas)
    const at = { a: { x: 600, y: 0 } }
    stream('p1 s1').moved({ project: 'p1', positions: at })
    stream('p1 s1').moved({ project: 'p2', positions: at })
    stream('p2 s1').moved({ project: 'p2', positions: { a: { x: 1 } } })
    expect([other.placed, center.placed, tab.placed]).toEqual([[], [at], [at]])
  })
})
