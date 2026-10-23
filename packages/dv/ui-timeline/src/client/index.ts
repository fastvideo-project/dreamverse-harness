/**
 * Browser half: registers `dv-timeline` as a right-Sidebar tab type with its dictionaries and body, and, while each
 * service is present, its contributions to `dvCenter` (the 时间线 view `TimelineView` and the 插入片段 preview action),
 * `dvCanvas` (the records that timelines use), `dvHistory` (the row of timeline records), and `dvMentions` (the clip
 * mention kind). The tab body keeps its own timeline selection of each project; the center view keeps its selection in
 * the open project's center fields.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@dv/ui-canvas/contract'
import type {} from '@dv/ui-history/contract'
import { DvClient } from '@dv/ui-kit/api.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { DV_CURRENT_PROJECT_EVENT, getCurrentProject } from '@dv/ui-kit/current-project.ts'
import type {} from '@dv/ui-shell/contract'
import { TIMELINE_ID, timelineDefinition } from './definition.ts'
import { timelineHistoryRow } from './history-row.ts'
import { InsertClipAction } from './InsertClipAction.tsx'
import type { InsertClipInjected } from './InsertClipAction.tsx'
import { en, NS, zh } from './locales.ts'
import { clipMentionKind } from './mention.ts'
import { createTimelineSelection } from './selection.ts'
import { timelineRecordsInUse } from './records-in-use.ts'
import { TimelineBody } from './TimelineBody.tsx'
import type { TimelineInjected } from './TimelineBody.tsx'
import { TimelineView } from './TimelineView.tsx'
import type { TimelineCenterInjected } from './TimelineView.tsx'

export type { DvTimelineKey } from './locales.ts'
export type { TimelineBodyProps, TimelineInjected } from './TimelineBody.tsx'
export type { TimelineCenterInjected, TimelineViewProps } from './TimelineView.tsx'

/** Required browser services: the tab registry, the DSH UI registry, and the dictionaries. */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * Client plugin body. Each service-dependent registration leaves with its service or with the plugin.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(timelineDefinition(t)), 'ui-timeline: tab type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-timeline: dictionaries')
  const client = new DvClient()
  const selection = createTimelineSelection()
  const injected: TimelineInjected = { client, hooks: { selection }, select: selection.select }
  const openProject: HostObservable<string | null> = {
    getSnapshot: getCurrentProject,
    subscribe(listener) {
      window.addEventListener(DV_CURRENT_PROJECT_EVENT, listener)
      return () => { window.removeEventListener(DV_CURRENT_PROJECT_EVENT, listener) }
    },
  }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TIMELINE_ID, locale: NS, inject: () => injected },
    TimelineBody,
  )), 'ui-timeline: tab body')
  ctx.inject(['dvCenter', 'slots'], (scope) => {
    const center: TimelineCenterInjected = { client }
    scope.effect(() => scope.slots.inject('dv.center.view', () => scope.slots.register(
      { name: 'dv.center.view', id: 'timeline', order: 1, label: () => t('type.label'), inject: () => center }, TimelineView,
    )), 'ui-timeline: center view')
    const action: InsertClipInjected = {
      hooks: { openProject },
      insert: (assetId) => { scope.dvCenter.show({ view: 'timeline', target: { insert: assetId } }) },
    }
    scope.effect(() => scope.slots.inject('dv.media.preview.action', () => scope.slots.register(
      { name: 'dv.media.preview.action', id: 'dv.timeline.insert', locale: NS, inject: () => action }, InsertClipAction,
    )), 'ui-timeline: 插入片段 preview action')
  })
  ctx.inject(['dvCanvas'], (scope) => {
    scope.effect(() => scope.dvCanvas.recordsInUse.register(timelineRecordsInUse(t)), 'ui-timeline: records in use')
  })
  ctx.inject(['dvHistory'], (scope) => {
    scope.effect(() => scope.dvHistory.rows.register(timelineHistoryRow), 'ui-timeline: history row')
  })
  ctx.inject(['dvMentions'], (scope) => {
    scope.effect(() => scope.dvMentions.kinds.register(clipMentionKind), 'ui-timeline: mention kind clip')
  })
}
