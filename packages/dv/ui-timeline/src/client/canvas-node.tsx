/**
 * The timeline on the canvas: the node type `timeline`, whose nodes the host makes from `timeline.place` records, its card
 * body, and the 时间线 / Timelines section of the canvas's add menu. A node shows the timeline that its record's
 * `timeline` param names in a small timeline editor, whose preview plays above the node while the node is selected. It
 * uses every asset of its clips and sounds and the render of each placeholder clip, so the canvas draws a line from each
 * of their nodes and outlines them while the timeline node is selected.
 *
 * @module @dv/ui-timeline/canvas-node
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { Timeline } from '@dv/timeline/types'
import type { AddMenuSection, CardOwner, NodeType, NodeView, TypeEntry } from '@dv/ui-canvas/contract'
import { errorMessage } from '@dv/ui-kit/api.ts'
import type { DvClient } from '@dv/ui-kit/api.ts'
import { CARD_SURFACE } from '@dv/ui-kit/frame.ts'
import { timelineName } from '@dv/ui-kit/timeline.ts'
import type { ProjectRecord, WireState } from '@dv/ui-kit/types.ts'
import { TIMELINE_ID } from './definition.ts'
import type {} from './locales.ts'
import { TimelineEditor } from './TimelineEditor.tsx'
import { placeTimeline, timelinesOf } from './timelines.ts'

/** The node type key of a placed timeline, the kind that `@dv/timeline` registers `timeline.place` under. */
export const TIMELINE_NODE_KIND = 'timeline'

/** The default frame size of a timeline node, in canvas units, the `size` of `@dv/timeline`'s node maker. */
const CARD_SIZE = { width: 640, height: 390 }

/**
 * The box the card lays its editor out in at scale 1, tall enough for the toolbar, the ruler, the video and 原声 rows,
 * one sound track and the add-track row: at the default size the editor draws 640 / 480 times its panel size with all
 * of them shown, and it grows further as the node grows in both directions.
 */
const LAYOUT_SIZE = { width: 480, height: 290 }

/** The operation that puts a timeline on the canvas. */
const PLACE = 'timeline.place'

/** The timeline dictionary's translate. */
type TimelineTranslate = TranslateNS<'dvTimeline'>

/**
 * @param record - a `timeline.place` record, or undefined.
 * @returns the timeline ID that its `timeline` param names, or null.
 */
function placedId(record: Pick<ProjectRecord, 'params'> | undefined): string | null {
  const id = record?.params['timeline']
  return typeof id === 'string' ? id : null
}

/**
 * @param state - the project state.
 * @param record - a `timeline.place` record.
 * @returns the timeline that the record placed, or null when the project no longer has it.
 */
function placedTimeline(state: WireState, record: Pick<ProjectRecord, 'params'>): Timeline | null {
  const id = placedId(record)
  return timelinesOf(state).find(timeline => timeline.id === id) ?? null
}

/**
 * The canvas node that shows a timeline: a `timeline` node whose first record names it.
 * @param state - the project state.
 * @param timeline - the timeline ID.
 * @returns the node ID, or null when no node shows the timeline.
 */
function timelineNodeOf(state: WireState, timeline: string): string | null {
  const records = new Map(state.components.proj.records.map(record => [record.id, record]))
  const canvas = state.components.canvas
  return canvas.order.find((id) => {
    const node = canvas.nodes[id]
    return node?.kind === TIMELINE_NODE_KIND && node.versions.slice(0, 1).some(first => placedId(records.get(first)) === timeline)
  }) ?? null
}

/**
 * @param timeline - a timeline.
 * @param t - the timeline dictionary's translate.
 * @returns its shown name, such as 时间线 2 for t2 without a name.
 */
function nameOf(timeline: Pick<Timeline, 'id' | 'name'>, t: TimelineTranslate): string {
  return timelineName(timeline, n => t('tabs.defaultTitle', { n }))
}

/**
 * The node type of placed timelines. A node's title is the timeline's name, its meta the timeline's length, and its
 * `uses` the assets of the clips and sounds and the renders of the placeholder clips. A double click shows the timeline
 * in the workspace center's 时间线 view through `show`.
 * @param t - the timeline dictionary's translate.
 * @param show - show a timeline in the 时间线 view.
 * @returns the node type.
 */
export function timelineNodeType(t: TimelineTranslate, show: (timeline: string) => void): NodeType {
  return {
    id: TIMELINE_ID,
    type: TIMELINE_NODE_KIND,
    label: () => t('type.label'),
    color: 'var(--dv-node-3)',
    entry({ record, state }): TypeEntry {
      const sizing = { kind: 'window' as const, defaultSize: CARD_SIZE, minSize: { width: 420, height: 220 } }
      const timeline = placedTimeline(state, record)
      if (timeline === null) return { title: t('node.deleted'), sizing }
      const { total } = placeTimeline(state, timeline)
      return {
        title: nameOf(timeline, t), meta: `${total.toFixed(1)}s`, sizing,
        uses: {
          assets: [
            ...timeline.clips.flatMap(clip => clip.asset === null ? [] : [clip.asset]), ...timeline.sounds.map(sound => sound.asset),
          ],
          records: timeline.clips.flatMap(clip => clip.asset === null && clip.source !== null ? [clip.source.record] : []),
        },
      }
    },
    open(node: NodeView) {
      const id = placedId(node.record)
      if (id !== null) show(id)
    },
  }
}

/**
 * The 时间线 / Timelines section of the canvas's add menu: every timeline of the project by its shown name. A timeline
 * that a node already shows names that node; any other one goes on the canvas with one `timeline.place` record.
 * @param t - the timeline dictionary's translate.
 * @returns the section.
 */
export function timelineAddSection(t: TimelineTranslate): AddMenuSection {
  return {
    id: TIMELINE_ID,
    order: 1,
    label: () => t('canvas.addSection'),
    items: state => timelinesOf(state).map((timeline) => {
      const label = nameOf(timeline, t)
      return {
        key: timeline.id, label, node: timelineNodeOf(state, timeline.id),
        request: { operation: PLACE, params: { timeline: timeline.id }, intent: `place ${label} on the canvas` },
      }
    }),
  }
}

/**
 * The card body of a timeline node: the timeline editor, small, for the timeline that the node shows. While the node is
 * selected, the editor's preview plays above the node. A timeline that the project no longer has shows the deleted
 * words.
 * @param props - the node, the project state, the chat session, the area above the node, the text scale, the API
 *   client, the timeline dictionary's translate, and the call that shows the timeline in the 时间线 view.
 * @returns the element.
 */
function TimelineCard(props: PropsRuntime<'dv.canvas.card'> & CardServices): ReactNode {
  const { node, state, textScale, t } = props
  const timeline = placedTimeline(state, node.record)
  if (timeline === null) {
    const centered: CSSProperties = {
      ...CARD_SURFACE, fontSize: Math.round(12 * textScale), lineHeight: `${String(Math.round(16 * textScale))}px`, display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 12, textAlign: 'center', color: 'var(--dv-text-2)',
    }
    return <div style={centered} data-timeline-card="deleted">{t('node.deleted')}</div>
  }
  return <CardEditor key={timeline.id} {...props} timeline={timeline} />
}

/** What the plugin lends the card: the API client, the translate, and the call that shows a timeline in the 时间线 view. */
export interface CardServices {
  client: DvClient
  t: TimelineTranslate
  show: (timeline: string) => void
}

/**
 * The editor of one placed timeline inside its card. A press on one of the editor's controls selects the node and stays
 * with the editor; a press anywhere else, the preview included, moves the node. The preview grows with the node in both
 * directions: it is as wide as the node, or wider and centered when the node is taller than the default proportions
 * give, at width = height × 640 / 390. The editor and the preview draw their text and controls larger as the node grows:
 * by the smaller of width / 480 and height / 290, at least 1, so the default 640 × 390 node draws them at 4 / 3. A
 * refused write shows its error above the editor until the next write succeeds.
 * @param props - the project state, the chat session, the area above the node, the timeline, and the card services.
 * @returns the element.
 */
function CardEditor(
  { state, session, above, timeline, client, t, show }: Pick<CardOwner, 'state' | 'session' | 'above'> & CardServices & { timeline: Timeline },
): ReactNode {
  const [notice, setNotice] = useState<string | null>(null)
  const run = useCallback(async (work: () => Promise<unknown>): Promise<boolean> => {
    try {
      await work()
      setNotice(null)
      return true
    } catch (failure: unknown) {
      setNotice(errorMessage(failure))
      return false
    }
  }, [])
  // The frame's size in canvas units: offsets ignore the canvas zoom. None before layout.
  const box = useRef<HTMLDivElement | null>(null)
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const element = box.current as HTMLDivElement
    const measure = (): void => {
      if (element.offsetWidth > 0) setFrame({ width: element.offsetWidth, height: element.offsetHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])
  const previewWidth = frame === null ? undefined : Math.max(frame.width, frame.height * CARD_SIZE.width / CARD_SIZE.height)
  // The editor and its preview draw larger as the node grows in both directions, never smaller than the panel's size.
  const scale = frame === null ? 1 : Math.max(1, Math.min(frame.width / LAYOUT_SIZE.width, frame.height / LAYOUT_SIZE.height))
  return (
    <div ref={box} data-timeline-card={timeline.id} style={{ ...CARD_SURFACE, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {notice === null ? null : <p role="alert" style={{ margin: 0, padding: '4px 12px', fontSize: 12, lineHeight: '16px', color: 'var(--dv-danger)' }}>{notice}</p>}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TimelineEditor
          client={client} t={t} project={state.project.id} session={session} state={state} run={run}
          selected={timeline.id}
          card={{ viewer: above, open: () => { show(timeline.id) }, scale, ...previewWidth === undefined ? {} : { previewWidth } }}
        />
      </div>
    </div>
  )
}

/**
 * The `dv.canvas.card` entry of timeline nodes: {@link TimelineCard} with the plugin's services, which slot entries do
 * not receive.
 * @param services - the API client, the timeline dictionary's translate, and the call that shows a timeline.
 * @returns the card component.
 */
export function timelineCard(services: CardServices): (props: PropsRuntime<'dv.canvas.card'>) => ReactNode {
  return function TimelineNodeCard(props) {
    return <TimelineCard {...props} {...services} />
  }
}
