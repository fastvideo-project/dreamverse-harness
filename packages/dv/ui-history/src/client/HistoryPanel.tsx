/**
 * The History panel: the edit history of a project, read through `POST /api/dv/history`, like the History panel of an
 * image editor. It lists the steps of the history list, newest first. Each row shows the action with its subject
 * (修改分镜计划 p1 → v2, 渲染镜头 7), who did it (你, 智能体, 自动), how long ago, its status, the thumbnail that the registered
 * history row names, and for an agent action the intent the agent gave for the call. The records that a record started
 * (`started_by`) fold under its row. The step at the current position carries 当前; the steps after it, which redo brings
 * back, are greyed. Every other row's ⋮ menu offers 回到这一步, which moves the current position to that step. Selecting
 * a row plays its output under the row and, for a step at or before the current position, moves the center
 * (`dvCenter.show`) where the registered history row's `focus` says, else to the record's canvas node. The header holds
 * undo and redo; moves write no record, and a new step after a move discards the greyed steps. Media is drawn through
 * the `dv.media` Factory, so the panel names no media type.
 *
 * @module @dv/ui-history/HistoryPanel
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { HostObservable, InjectFace, PropsRenderFactories, PropsRuntime, RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots'
import { errorMessage, type DvClient } from '@dv/ui-kit/api.ts'
import { useCurrentProject } from '@dv/ui-kit/current-project.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { Actor, Asset, HistoryEntry, HistoryQuery, ProjectRecord, RecordStatus, WireHistory, WireState } from '@dv/ui-kit/types.ts'
import { useOperations, useProjectState } from '@dv/ui-kit/useProject.ts'
import { playerBox } from '@dv/ui-kit/player-box.ts'
import {
  DV_HISTORY_FOCUS_EVENT, DV_TRAJECTORY_FOCUS_EVENT, dispatchWorkspaceEvent, type DvWorkspaceEventMap,
} from '@dv/ui-kit/workspace-events.ts'
import type {} from '@dv/ui-media/contract'
import type { CenterTarget } from '@dv/ui-shell/contract'
import type { HistoryRow } from './contract/index.ts'
import { actionLabel, actionRows, centerFocus, matchingRow, relativeTime, type ActionRow, type LabelContext } from './rows.ts'
import css from './HistoryPanel.module.css'

/** What the plugin injects into the tab body. */
export interface HistoryInjected {
  client: DvClient
  hooks: {
    /** The registered history rows (`dvHistory.rows`). */
    rows: HostObservable<readonly HistoryRow[]>
  }
  /** Move the workspace center to a target (`dvCenter.show`); nothing while the shell is absent. */
  showInCenter: (target: CenterTarget) => void
}

/** Props of {@link HistoryPanel}. */
export interface HistoryPanelProps extends PropsRenderFactories {
  projectId: string
  client: DvClient
  rows: readonly HistoryRow[]
  /** Move the workspace center to the target of a selected record. */
  showInCenter: (target: CenterTarget) => void
}

/** Entries per page. */
const PAGE = 50
/** The most entries one request reloads. */
const MAX_PAGE = 200

/** The loaded window of history: entries newest first and their assets. */
interface Loaded {
  entries: HistoryEntry[]
  assets: Map<string, Asset>
  /** The oldest loaded record while the last page was full, so 加载更多 may find more before it; null otherwise. */
  cursor: string | null
}

/** Who did an action: the creator at the screen, the agent, or the project on its own (renders an approval scheduled). */
const ACTORS: Record<Actor, [string, string]> = { user: ['你', 'You'], agent: ['智能体', 'Agent'], system: ['自动', 'Automatic'] }
const STATUSES: Record<RecordStatus, [string, string]> = {
  pending: ['等待中', 'Pending'], running: ['运行中', 'Running'], done: ['完成', 'Done'], failed: ['失败', 'Failed'],
  cancelled: ['已取消', 'Cancelled'],
}

/** The dot color of each status, from the DreamVerse theme tokens. */
const STATUS_COLORS: Record<RecordStatus, string> = {
  pending: 'var(--dv-warn)', running: 'var(--dv-accent)', done: 'var(--dv-ok)', failed: 'var(--dv-danger)', cancelled: 'var(--dv-text-3)',
}

/**
 * A `dv:history-focus` request that no mounted panel has taken yet. The request usually arrives while the tab is
 * closed (the plugin opens the tab in response), so the panel that mounts next takes it.
 */
let pendingFocus: DvWorkspaceEventMap['dv:history-focus'] | null = null
const focusListeners = new Set<(focus: DvWorkspaceEventMap['dv:history-focus']) => void>()
window.addEventListener(DV_HISTORY_FOCUS_EVENT, (event) => {
  const focus = (event as CustomEvent<DvWorkspaceEventMap['dv:history-focus']>).detail
  pendingFocus = focus
  for (const listener of focusListeners) listener(focus)
})

/**
 * Merge a page into the loaded window.
 * @param loaded - the window so far, or null for a fresh one.
 * @param page - the route's answer.
 * @param limit - the page size asked for.
 * @returns the merged window.
 */
function mergePage(loaded: Loaded | null, page: WireHistory, limit: number): Loaded {
  const assets = new Map(loaded?.assets ?? [])
  for (const asset of page.assets) assets.set(asset.id, asset)
  const oldest = page.entries.at(-1)
  return {
    entries: [...loaded?.entries ?? [], ...page.entries],
    assets,
    cursor: oldest !== undefined && page.entries.length >= limit ? oldest.record.id : null,
  }
}

/**
 * The loaded history window for a query: the first page on a query change, more pages on request, a refetch of the
 * loaded window on every `record` or unreadable event, and an in-place record update on every `update` event.
 * @param client - the API client.
 * @param query - the query without paging fields.
 * @returns the window, the last error, and the paging gesture.
 */
function useHistory(client: DvClient, query: HistoryQuery): {
  loaded: Loaded | null
  error: string | null
  loadMore: (before: string) => Promise<void>
} {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<Loaded | null>(null)
  const key = JSON.stringify(query)
  const keyRef = useRef(key)
  keyRef.current = key
  const store = useCallback((next: Loaded | null, forKey: string) => {
    if (keyRef.current !== forKey) return
    current.current = next
    setLoaded(next)
  }, [])
  // The first page of every query.
  useEffect(() => {
    const controller = new AbortController()
    current.current = null
    setLoaded(null)
    client.listHistory({ ...query, limit: PAGE }, controller.signal).then((page) => {
      setError(null)
      store(mergePage(null, page, PAGE), key)
    }, (failure: unknown) => { if (!controller.signal.aborted) setError(errorMessage(failure)) })
    return () => { controller.abort() }
    // `key` stands for `query`.
  }, [client, key, store])
  // Live update of the loaded window.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const refetch = (): void => {
      const limit = Math.min(Math.max(current.current?.entries.length ?? 0, PAGE), MAX_PAGE)
      client.listHistory({ ...query, limit }).then((page) => { store(mergePage(null, page, limit), key) }, () => undefined)
    }
    const unsubscribe = client.subscribe(query.project, (event) => {
      if (event?.kind === 'update') {
        const shown = current.current
        if (shown === null) return
        const entries = shown.entries.map(entry => entry.record.id === event.record.id ? { ...entry, record: event.record } : entry)
        store({ ...shown, entries }, key)
        return
      }
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; refetch() }, 200)
    })
    return () => {
      if (timer !== null) clearTimeout(timer)
      unsubscribe()
    }
  }, [client, key, store])
  const loadMore = useCallback(async (before: string): Promise<void> => {
    const shown = current.current
    const page = await client.listHistory({ ...query, before, limit: PAGE })
    store(mergePage(shown, page, PAGE), key)
  }, [client, key, store])
  return { loaded, error, loadMore }
}

/**
 * The History panel of one project.
 * @param props - the project, the client, the registered rows, the center callback and the Factory renderer.
 * @returns the panel.
 */
export function HistoryPanel(props: HistoryPanelProps): ReactNode {
  const { projectId, client, rows: registered, showInCenter, renderFactorySlot } = props
  const t = useText()
  const current = useProjectState(client, projectId)
  const operations = useOperations(client)
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [focusRecord, setFocusRecord] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const rowRefs = useRef(new Map<string, HTMLElement>())
  // The relative times refresh every half minute.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { clearInterval(timer) }
  }, [])

  // The records of the current state: what the canvas and the timeline show.
  const records = current.value?.components.proj.records
  // The steps of the history list, newest first.
  const query = useMemo((): HistoryQuery => ({ project: projectId }), [projectId])
  const { loaded, error, loadMore } = useHistory(client, query)
  const rows = useMemo(() => actionRows(loaded?.entries ?? []), [loaded])
  // The loaded records and the records of the current state, so a retake finds its `based_on` root outside the window.
  const recordsById = useMemo(
    () => new Map([...records ?? [], ...(loaded?.entries ?? []).map(entry => entry.record)].map(item => [item.id, item])),
    [records, loaded],
  )

  // A `dv:history-focus` request: find the record the tool call wrote, then select it once loaded.
  const takeFocus = useCallback((focus: DvWorkspaceEventMap['dv:history-focus']) => {
    pendingFocus = null
    setNotice(null)
    client.listHistory({ project: projectId, session: focus.session, tool_call: focus.toolCall, limit: 1 }).then((page) => {
      const found = page.entries[0]
      if (found === undefined) { setNotice(t('这次调用没有写记录', 'This call wrote no record')); return }
      setFocusRecord(found.record.id)
    }, (failure: unknown) => { setNotice(String(failure)) })
  }, [client, projectId, t])
  useEffect(() => {
    if (pendingFocus !== null) takeFocus(pendingFocus)
    focusListeners.add(takeFocus)
    return () => { focusListeners.delete(takeFocus) }
  }, [takeFocus])
  useEffect(() => {
    if (focusRecord === null || loaded === null) return
    if (loaded.entries.some(entry => entry.record.id === focusRecord)) {
      // A record folded under an approval shows once its approval's row is expanded.
      const parent = rows.find(row => row.children.some(child => child.record.id === focusRecord))
      if (parent !== undefined) setExpanded(shown => new Set([...shown, parent.entry.record.id]))
      setSelected(focusRecord)
      setFocusRecord(null)
      requestAnimationFrame(() => { rowRefs.current.get(focusRecord)?.scrollIntoView({ block: 'nearest' }) })
    } else if (loaded.cursor !== null) void loadMore(loaded.cursor)
    else setFocusRecord(null)
  }, [focusRecord, loaded, rows, loadMore])

  const choose = (entry: HistoryEntry): void => {
    setSelected(entry.record.id)
    const target = centerFocus(entry, registered, records ?? [])
    if (target !== null) showInCenter(target)
  }
  const toggle = (record: string): void => {
    setExpanded((shown) => {
      const next = new Set(shown)
      if (!next.delete(record)) next.add(record)
      return next
    })
  }
  const report = (failure: unknown): void => { setNotice(errorMessage(failure)) }
  // 回到这一步: move the current position to the step.
  const jump = (record: string): void => {
    setNotice(null)
    client.moveTo(projectId, record).catch(report)
  }
  const rowRef = (record: string) => (element: HTMLElement | null): void => {
    if (element === null) rowRefs.current.delete(record)
    else rowRefs.current.set(record, element)
  }

  const cursor = loaded?.cursor ?? null
  let body: ReactNode
  if (error !== null) body = <p className={`${css.note} ${css.error}`}>{t(`读取失败：${error}`, `Failed to load: ${error}`)}</p>
  else if (loaded === null) body = <p className={css.note}>{t('正在读取…', 'Loading…')}</p>
  else {
    // Every project starts with its `proj.create` record, so a project without other records counts as empty; its
    // creation row stays listed below the notice.
    const changes = loaded.entries.filter(entry => entry.record.operation !== 'proj.create')
    const stateAssets = current.value?.assets ?? []
    const shared: RowContext = {
      now, selected, onChoose: choose, rowRef, onJump: jump, state: current.value, renderFactorySlot,
      labels: { operations: operations.value ?? [], rows: registered, records: recordsById },
      rowOf: record => matchingRow(record, registered),
      assetOf: id => loaded.assets.get(id) ?? stateAssets.find(item => item.id === id),
    }
    body = (
      <>
        {changes.length === 0
          ? (
            <p data-testid="dv-history-empty" className={css.note}>
              {t('还没有记录。在画布、时间线或对话里做的每一步都会出现在这里。', 'No records yet. Every change made in the canvas, the timeline, or the chat appears here.')}
            </p>
          )
          : null}
        {rows.map(row => (
          <Row
            key={row.entry.record.id} {...shared} row={row}
            expanded={expanded.has(row.entry.record.id)} onToggle={() => { toggle(row.entry.record.id) }}
          />
        ))}
      </>
    )
  }
  return (
    <div data-testid="dv-history-panel" className={css.panel}>
      <div className={css.bar}>
        <Actions client={client} projectId={projectId} canRedo={current.value !== null && current.value.head !== current.value.tip} />
      </div>
      {notice === null ? null : <p className={css.notice}>{notice}</p>}
      <div role="listbox" className={css.list}>
        {body}
        {cursor !== null
          ? (
            <button type="button" data-testid="dv-history-more" className={`${css.button} ${css.loadMore}`} onClick={() => { void loadMore(cursor) }}>
              {t('加载更多', 'Load more')}
            </button>
          )
          : null}
      </div>
    </div>
  )
}

/** The undo and redo buttons of the header: test ID suffix, label, tooltip, and icon paths. */
const MOVES = [
  { key: 'undo', label: ['撤销', 'Undo'], title: ['撤销（Ctrl+Z / ⌘Z）', 'Undo (Ctrl+Z / ⌘Z)'], paths: ['M9 14 4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'] },
  {
    key: 'redo', label: ['重做', 'Redo'], title: ['重做（Shift+Ctrl+Z / ⇧⌘Z）', 'Redo (Shift+Ctrl+Z / ⇧⌘Z)'],
    paths: ['m15 14 5-5-5-5', 'M20 9H9a5 5 0 0 0 0 10h3'],
  },
] as const

/**
 * Undo and redo at the end of the header: they move the current position one step; redo is enabled while a step after
 * the current position exists.
 * @param props - the client, the project, and whether redo has a step to bring back.
 * @returns the buttons and the last failure.
 */
function Actions(props: { client: DvClient; projectId: string; canRedo: boolean }): ReactNode {
  const { client, projectId } = props
  const t = useText()
  const [failure, setFailure] = useState<string | null>(null)
  const run = (work: () => Promise<unknown>): void => {
    setFailure(null)
    work().catch((error: unknown) => { setFailure(errorMessage(error)) })
  }
  return (
    <div className={css.actions}>
      {MOVES.map((move) => {
        const enabled = move.key === 'undo' || props.canRedo
        return (
          <button
            key={move.key} type="button" data-testid={`dv-history-${move.key}`} disabled={!enabled}
            aria-label={t(move.label[0], move.label[1])} title={t(move.title[0], move.title[1])} className={css.iconButton}
            onClick={() => { run(() => move.key === 'undo' ? client.undo(projectId) : client.redo(projectId)) }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {move.paths.map(path => <path key={path} d={path} />)}
            </svg>
          </button>
        )
      })}
      {failure === null ? null : <span className={css.error}>{failure}</span>}
    </div>
  )
}

/**
 * The ⋮ button at the end of a row and its menu with 回到这一步. Escape or a click outside closes the menu; its clicks and
 * keys never reach the row. The row of the current position has no button.
 * @param props - the 回到这一步 gesture, or null when it does not apply.
 * @returns the button and, while open, the menu; null without a gesture.
 */
function StepActions(props: { onBack: (() => void) | null }): ReactNode {
  const t = useText()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('pointerdown', outside) }
  }, [open])
  const { onBack } = props
  if (onBack === null) return null
  return (
    <span
      ref={root} className={css.stepActions}
      onClick={(event) => { event.stopPropagation() }}
      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') setOpen(false) }}
    >
      <button
        type="button" data-testid="dv-history-step-actions" aria-label={t('更多操作', 'More actions')} title={t('更多操作', 'More actions')}
        aria-haspopup="menu" aria-expanded={open} className={`${css.iconButton} ${css.moreButton}`} onClick={() => { setOpen(value => !value) }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {open
        ? (
          <div role="menu" className={css.menu}>
            <button
              type="button" role="menuitem" data-testid="dv-history-step-back" className={css.menuItem}
              onClick={() => { setOpen(false); onBack() }}
            >
              {t('回到这一步', 'Go back to this step')}
            </button>
          </div>
        )
        : null}
    </span>
  )
}

/** The 在轨迹中查看 link: asks the shell to open 轨迹 on the chat session and show the tool call. */
function TrajectoryLink(props: { session: string; toolCall: string }): ReactNode {
  const t = useText()
  return (
    <button
      type="button" data-testid="dv-history-open-trajectory" className={css.link}
      onClick={(event) => {
        event.stopPropagation()
        dispatchWorkspaceEvent(DV_TRAJECTORY_FOCUS_EVENT, { session: props.session, toolCall: props.toolCall })
      }}
    >
      {t('在轨迹中查看', 'Show in trajectory')}
    </button>
  )
}

/** What every row reads besides its own entry. */
interface RowContext {
  now: number
  selected: string | null
  onChoose: (entry: HistoryEntry) => void
  rowRef: (record: string) => (element: HTMLElement | null) => void
  /** 回到这一步 on a row. */
  onJump: (record: string) => void
  state: WireState | null
  renderFactorySlot: RenderFactorySlot
  /** What the row labels read: the operation declarations, the registered rows and the records. */
  labels: LabelContext
  rowOf: (record: ProjectRecord) => HistoryRow | undefined
  assetOf: (id: string) => Asset | undefined
}

function isMediaRow(row: HistoryRow | undefined): row is HistoryRow & Required<Pick<HistoryRow, 'media'>> {
  return row?.media !== undefined
}

/**
 * One action row: the thumbnail, the action label and the time on the first line; who, the status, 当前 on the step at
 * the current position and the agent's intent on the second; a step after the current position is greyed. A row whose
 * record started other loaded records adds the toggle that shows them, nested below it.
 * @param props - the row, the shared row context, and the approval's expanded state and toggle.
 * @returns the row and, while expanded, its nested rows.
 */
function Row(props: RowContext & { row: ActionRow; expanded: boolean; onToggle: () => void }): ReactNode {
  const { row, expanded } = props
  const t = useText()
  const children = row.children
  const renders = children.filter(child => isMediaRow(props.rowOf(child.record)))
  const doneRenders = renders.filter(child => child.record.status === 'done').length
  const starter = props.rowOf(row.entry.record)
  const foldText = renders.length === 0 || starter?.fold === undefined
    ? t(...actionLabel(children[0]?.record ?? row.entry.record, props.labels))
    : t(...starter.fold(renders.length))
  return (
    <div className={css.group}>
      <EntryRow {...props} entry={row.entry} nested={false} />
      {children.length === 0
        ? null
        : (
          <button
            type="button" data-testid="dv-history-fold" aria-expanded={expanded} onClick={props.onToggle}
            className={`${css.link} ${css.fold}`}
          >
            {expanded ? '▾' : '▸'} {foldText}
            {doneRenders < renders.length ? ` (${String(doneRenders)}/${String(renders.length)})` : ''}
          </button>
        )}
      {expanded ? children.map(child => <EntryRow key={child.record.id} {...props} entry={child} nested />) : null}
    </div>
  )
}

/**
 * One record's line pair, with its output preview, full words and trajectory link while selected.
 * @param props - the entry, the shared row context, and whether it is nested under an approval.
 * @returns the row.
 */
function EntryRow(props: RowContext & { entry: HistoryEntry; nested: boolean }): ReactNode {
  const { entry, nested } = props
  const { record } = entry
  const t = useText()
  const selected = props.selected === record.id
  const status = t(...STATUSES[record.status])
  const row = props.rowOf(record)
  const render = isMediaRow(row)
  const thumbnail = render && props.state !== null ? row.media.thumbnail(record, props.state) : null
  const thumbAsset = thumbnail === null ? undefined : props.assetOf(thumbnail)
  // The intent the agent gave for its call; a call without one records the operation name, which the label already shows.
  // A human action's intent repeats its label, so it stays in the tooltip.
  const words = record.actor === 'agent' && record.intent !== record.operation ? record.intent : ''
  const size = nested ? 28 : 40
  // A step after the current position is clearly greyed: faded text and a black-and-white thumbnail.
  const after = entry.place === 'after'
  const dim = after ? 0.3 : 1
  return (
    <div
      ref={props.rowRef(record.id)} role="option" tabIndex={0} aria-selected={selected} title={record.intent}
      data-testid="dv-history-row" data-record={record.id} data-status={record.status} data-actor={record.actor}
      data-surface={record.surface} data-place={entry.place} data-nested={nested ? '' : undefined}
      onClick={() => { props.onChoose(entry) }}
      onKeyDown={(event) => { if (event.key === 'Enter') props.onChoose(entry) }}
      className={css.row}
    >
      <div
        className={css.rowGrid}
        style={{ gridTemplateColumns: render ? `${String(size)}px minmax(0, 1fr) auto` : 'minmax(0, 1fr) auto' }}
      >
        {/* A step after the current one is greyed; the ⋮ menu is not, so it is not trapped under the next row. */}
        {!render
          ? null
          : <div style={{ opacity: dim, filter: after ? 'grayscale(1)' : undefined }}><Thumb asset={thumbAsset} size={size} renderFactorySlot={props.renderFactorySlot} /></div>}
        <div style={{ minWidth: 0, opacity: dim }}>
          <div className={css.titleLine}>
            <span className={css.label}>
              {t(...actionLabel(record, props.labels))}
            </span>
            <span
              data-testid="dv-history-time" title={new Date(record.created_at).toLocaleString()} className={css.time}
            >
              {t(...relativeTime(record.created_at, props.now))}
            </span>
          </div>
          <div className={css.meta}>
            <span>{t(...ACTORS[record.actor])}</span>
            <span title={record.error?.message ?? status} className={css.status}>
              <span className={css.dot} style={{ background: STATUS_COLORS[record.status] }} />
              {record.status === 'done' ? null : <span className={record.status === 'failed' ? css.error : undefined}>{status}</span>}
            </span>
            {entry.place === 'current'
              ? (
                <span data-testid="dv-history-current" className={css.currentBadge}>
                  {t('当前', 'Current')}
                </span>
              )
              : null}
            {words === '' ? null : <span title={words} className={css.words}>“{words}”</span>}
          </div>
        </div>
        <StepActions onBack={entry.place === 'current' ? null : () => { props.onJump(record.id) }} />
      </div>
      {selected
        ? <Details record={record} media={props.assetOf(record.outputs[0] ?? '')} words={words} renderFactorySlot={props.renderFactorySlot} />
        : null}
    </div>
  )
}

/**
 * A row's one thumbnail: its asset drawn through `dv.media` at 'thumb', or an empty square that keeps the rows aligned
 * when the row has no asset or its media fails to load.
 * @param props - the thumbnail's asset, or undefined, its edge in pixels, and the Factory renderer.
 * @returns the thumbnail.
 */
function Thumb(props: { asset: Asset | undefined; size: number; renderFactorySlot: RenderFactorySlot }): ReactNode {
  const [failed, setFailed] = useState<string | null>(null)
  const box: CSSProperties = { width: props.size, height: props.size, overflow: 'hidden' }
  const { asset } = props
  if (asset === undefined || failed === asset.id) return <span className={css.thumb} style={box} />
  return (
    <span
      data-testid="dv-history-thumb" data-asset={asset.id} className={css.thumb} style={box}
      onErrorCapture={() => { setFailed(asset.id) }}
    >
      {props.renderFactorySlot('dv.media', { asset, purpose: 'thumb' })}
    </span>
  )
}

/**
 * What a selected row adds below it: the inline player of the record's first output, the agent's intent in full, and
 * the link into the trajectory for an agent action.
 * @param props - the record, the asset of its first output, the agent's intent, and the Factory renderer.
 * @returns the details, or null when there is nothing to add.
 */
function Details(
  props: { record: ProjectRecord; media: Asset | undefined; words: string; renderFactorySlot: RenderFactorySlot },
): ReactNode {
  const { record, media } = props
  const call = record.session !== null && record.tool_call !== null ? { session: record.session, toolCall: record.tool_call } : null
  if (media === undefined && call === null && props.words === '') return null
  return (
    <div onClick={(event) => { event.stopPropagation() }} className={css.details}>
      {media === undefined
        ? null
        : (
          <div data-testid="dv-history-preview" className={css.preview} style={playerBox(media, 220)}>
            {props.renderFactorySlot('dv.media', { asset: media, purpose: 'loop' })}
          </div>
        )}
      {props.words === '' ? null : <div className={css.detailWords}>“{props.words}”</div>}
      {call === null ? null : <div><TrajectoryLink session={call.session} toolCall={call.toolCall} /></div>}
    </div>
  )
}

/** The tab body's composed props. */
export type HistoryTabBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderFactories & InjectFace<HistoryInjected>

/**
 * The tab body: the History panel of the project that the DreamVerse shell has open, beside the chat session whose
 * right panel holds the tab.
 * @param props - the tab's props, the injected client, rows and center callback, and the Factory renderer.
 * @returns the panel, or a notice while no project is open.
 */
export function HistoryTabBody(props: HistoryTabBodyProps): ReactNode {
  const project = useCurrentProject()
  const rows = props.useRows(value => value)
  const t = useText()
  if (project === null) return <p data-testid="dv-history-empty" className={css.note} style={{ padding: 12 }}>{t('先打开一个项目', 'Open a project first')}</p>
  // Keyed by project so a switch starts from an empty panel instead of showing the previous project's records.
  return (
    <HistoryPanel
      key={project} projectId={project} client={props.client} rows={rows} showInCenter={props.showInCenter}
      renderFactorySlot={props.renderFactorySlot}
    />
  )
}
