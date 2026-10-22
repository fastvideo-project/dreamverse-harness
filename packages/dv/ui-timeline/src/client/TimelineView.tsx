/**
 * The timeline editor for one project, without the project bar: the center area's 时间线 view. It reads the project's
 * current state itself and refetches it after every project change and every write; the view's edits go after the
 * current position of the project's history. The view's selected timeline is the `timeline` field of the open project's
 * center fields, and a pick sets it. A request that the center hands the view selects a timeline and a clip in it, or
 * inserts an asset (插入片段) once the state is read.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@dv/ui-shell/contract'
import { errorMessage } from '@dv/ui-kit/api.ts'
import type { DvClient } from '@dv/ui-kit/api.ts'
import { pickText, useLanguage } from '@dv/ui-kit/locale.ts'
import type { DvLanguage } from '@dv/ui-kit/locale.ts'
import type { OperationRequest, WireState } from '@dv/ui-kit/types.ts'
import { useProjectState } from '@dv/ui-kit/useProject.ts'
import { TimelineEditor } from './TimelineEditor.tsx'
import { en, zh } from './locales.ts'
import type { DvTimelineKey } from './locales.ts'
import { readTimelineRequest } from './selection.ts'
import { timelinesOf } from './timelines.ts'

/** What the plugin injects into the center view: the API client. */
export interface TimelineCenterInjected {
  client: DvClient
}

/** The center view's props: the center's owner data and the injected client; `t` defaults to the DSH language's copy. */
export type TimelineViewProps = PropsRuntime<'dv.center.view'> & InjectFace<TimelineCenterInjected>
  & { t?: Translate<DvTimelineKey> }

/**
 * Translate from one language's dictionary, filling `{name}` placeholders.
 * @param language - the interface language.
 * @returns the translate function.
 */
export function copyFor(language: DvLanguage): Translate<DvTimelineKey> {
  const dictionary = language === 'zh' ? zh : en
  return (key, params) =>
    dictionary[key].replace(/\{(\w+)\}/g, (whole, name: string) => params !== undefined && name in params ? String(params[name]) : whole)
}

/**
 * The write that inserts an asset: a clip at the end of the selected timeline, else of the project's first timeline; in
 * a project without timelines, timeline `t1` holding the clip.
 * @param project - the project.
 * @param session - the chat session the view sits beside; null for none.
 * @param state - the project's current state.
 * @param selected - the selected timeline of the project, or null.
 * @param asset - the asset to insert.
 * @returns the operation request.
 */
function insertRequest(
  project: string, session: string | null, state: WireState, selected: string | null, asset: string,
): OperationRequest {
  const timelines = timelinesOf(state)
  const timeline = timelines.find(item => item.id === selected) ?? timelines[0]
  const at = (timeline?.clips.length ?? 0) + 1
  const call = timeline === undefined
    ? { operation: 'timeline.create', params: { timeline: 't1', assets: [asset] }, intent: pickText('新建时间线', 'Create timeline') }
    : {
      operation: 'timeline.clip_insert', params: { timeline: timeline.id, at, asset },
      intent: pickText(`在位置 ${String(at)} 插入片段`, `Insert clip at position ${String(at)}`),
    }
  return { project, ...call, surface: 'timeline', ...session === null ? {} : { session } }
}

/**
 * The timeline editor of a project's current state.
 * @param props - the center's owner data, the injected client, and optional copy.
 * @returns the element.
 */
export function TimelineView(props: TimelineViewProps): ReactNode {
  const { projectId, session, request, fields, note, client } = props
  const language = useLanguage()
  const t = useMemo(() => props.t ?? copyFor(language), [props.t, language])
  const state = useProjectState(client, projectId)
  const selected = fields['timeline'] ?? null
  const asked = useMemo(() => request === null ? null : readTimelineRequest(request.value), [request])
  const [notice, setNotice] = useState<string | null>(null)
  const reload = state.reload
  const run = useCallback(async (work: () => Promise<unknown>): Promise<boolean> => {
    try {
      await work()
      setNotice(null)
      reload()
      return true
    } catch (failure: unknown) {
      setNotice(errorMessage(failure))
      return false
    }
  }, [reload])
  const select = useCallback((timelineId: string | null) => { note({ timeline: timelineId }) }, [note])
  useEffect(() => {
    if (request === null || asked === null) return
    if ('insert' in asked) {
      if (state.value === null) return
      request.take()
      const write = insertRequest(projectId, session, state.value, selected, asked.insert)
      if (write.operation === 'timeline.create') select('t1')
      void run(() => client.runOperation(write))
    } else {
      if (asked.timeline !== selected) select(asked.timeline)
      if (asked.clip === null) request.take()
    }
  }, [request, asked, state.value, projectId, session, selected, client, run, select])
  const clipFocus = asked !== null && 'timeline' in asked && asked.clip !== null ? { timelineId: asked.timeline, clipId: asked.clip } : null
  const takeClipFocus = useCallback(() => { request?.take() }, [request])
  if (state.value === null) {
    return <p style={{ padding: 12, color: 'var(--dv-text-2)', fontSize: 13, lineHeight: '20px' }} role={state.error === null ? undefined : 'alert'}>{state.error === null ? t('loading') : t('error', { message: state.error })}</p>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {notice !== null ? <p role="alert" style={{ margin: 0, padding: '4px 12px', color: 'var(--dv-danger)', fontSize: 13, lineHeight: '20px' }}>{t('error', { message: notice })}</p> : null}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TimelineEditor
          client={client}
          t={t}
          project={projectId}
          session={session}
          state={state.value}
          run={run}
          selected={selected}
          select={select}
          clipFocus={clipFocus}
          takeClipFocus={takeClipFocus}
        />
      </div>
    </div>
  )
}
