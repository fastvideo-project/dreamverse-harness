/** The agent's cards of a canvas, and the registry that holds the canvas streams and answers their reads. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasViews, cardsOf, httpLink } from '../src/client/agent-canvas.ts'
import type { CanvasLink, MountedCanvas, StreamListener } from '../src/client/agent-canvas.ts'
import { buildCanvasGraph } from '../src/client/graph.ts'
import type { CanvasNode } from '../src/client/graph.ts'
import { fixtureState, OPERATIONS } from '../../ui-kit/tests/fixture.client.tsx'
import type { CanvasCard, CanvasDrawn } from '../src/types.ts'

/** A drawn card of 208 × 100 at (x, y). */
function card(id: string, x: number, y: number): CanvasCard {
  return { id, type: 'text', title: id, shown: id, versions: 1, x, y, width: 208, height: 100, rendering: false }
}

const CARDS = [card('a', 0, 0), card('b', 240, 0), card('c', 0, 200)]

/** A mounted canvas over fixed cards. */
function mounted(projectId: string, cards: CanvasCard[], session: string | null = 's1') {
  const canvas: MountedCanvas = { projectId, session, cards: () => cards }
  return { canvas }
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
  it('lists each node with its type, shown version, version count, drawn box, and rendering flag', () => {
    const { nodes } = buildCanvasGraph(fixtureState(), OPERATIONS, 'en', { nodeTypes: [], recordsInUse: [], versionKinds: [] })
    const shots = nodes.filter(node => node.type === 'shot')
    const boxOf = (current: CanvasNode) => current.id === 'g1' ? { x: 10, y: 20, width: 312, height: 150 } : { x: 5, y: 6, width: 208, height: 117 }
    expect(cardsOf(shots, boxOf)).toEqual([
      { id: 'g1', type: 'shot', title: 'shot.render', shown: 'g3', versions: 2, x: 10, y: 20, width: 312, height: 150, rendering: true },
      { id: 'g2', type: 'shot', title: 'shot.render', shown: 'g2', versions: 1, x: 5, y: 6, width: 208, height: 117, rendering: false },
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

  it('answers no read that reaches a stream after its last canvas left', () => {
    const { views, answers, stream } = scripted()
    const remove = views.mount(mounted('p1', CARDS).canvas)
    const listener = stream('p1 s1')
    remove()
    listener.read({ id: 'late', stream: 'k1' })
    expect(answers).toEqual([])
  })

  it('answers a read with the first canvas of the stream', () => {
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
  })
})

describe('httpLink', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('opens the canvas stream of a project beside a chat session, hands on each well-formed read, and closes the stream', () => {
    const opened: Array<{ url: string; source: EventTarget & { closed: boolean } }> = []
    vi.stubGlobal('EventSource', class extends EventTarget {
      closed = false
      constructor(url: string) {
        super()
        opened.push({ url, source: this })
      }

      close(): void { this.closed = true }
    })
    const reads: unknown[] = []
    const close = httpLink.open('p1', 's5', { read: (query) => { reads.push(query) } })
    httpLink.open('p2', null, { read: () => undefined })
    expect(opened.map(each => each.url)).toEqual(['/api/dv/canvas/agent?project=p1&session=s5', '/api/dv/canvas/agent?project=p2'])
    const source = opened[0]?.source
    source?.dispatchEvent(new MessageEvent('read', { data: JSON.stringify({ id: 'r1', stream: 'k1' }) }))
    source?.dispatchEvent(new MessageEvent('read', { data: JSON.stringify({ id: 7 }) }))
    expect(reads).toEqual([{ id: 'r1', stream: 'k1' }])
    close()
    expect(source?.closed).toBe(true)
  })

  it('posts an answer to the answer route, and leaves a failed post to the tool\'s timeout', async () => {
    const posts: Array<[string, RequestInit | undefined]> = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      posts.push([url, init])
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    const drawn: CanvasDrawn = { id: 'r1', stream: 'k1', project: 'p1', cards: CARDS }
    httpLink.answer(drawn)
    await Promise.resolve()
    expect(posts).toEqual([['/api/dv/canvas/agent/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(drawn) }]])
  })
})
