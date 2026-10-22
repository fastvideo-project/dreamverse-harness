/**
 * Pure readings behind the History panel: the action rows of history entries (a record folds the records it started),
 * the label of an action with its subject, the thumbnail of a record, relative times, and where selecting a record
 * focuses the center. Nothing here touches the DOM or the network, so the unit tests cover it directly.
 *
 * @module @dv/ui-history/rows
 */
import { chainOf } from '@dv/ui-kit/chain.ts'
import { operationLabel } from '@dv/ui-kit/tool-labels.ts'
import type { Asset, HistoryEntry, ProjectRecord, WireOperation } from '@dv/ui-kit/types.ts'
import type { CenterTarget } from '@dv/ui-shell/contract'
import type { HistoryRow } from './contract/index.ts'

/** One row of the panel: an operation entry and the entries of the loaded records it started. */
export interface ActionRow {
  entry: HistoryEntry
  /** The loaded records whose `started_by.record` is this row's record, in log order; empty for most records. */
  children: HistoryEntry[]
}

/**
 * Turn history entries into panel rows: one row per step, newest first. A loaded record whose `started_by.record` is the
 * record of a row folds under that row instead of standing alone, in log order (a plan approval's shot renders in shot
 * order, then its timeline record).
 * @param entries - history entries, newest first.
 * @returns the rows, newest first.
 */
export function actionRows(entries: readonly HistoryEntry[]): ActionRow[] {
  const rows = new Map<string, ActionRow>()
  // Oldest first: the runner appends a starter before it runs the records it starts, so the starter's row exists first.
  for (const entry of [...entries].reverse()) {
    const starter = rows.get(entry.record.started_by?.record ?? '')
    if (starter === undefined) rows.set(entry.record.id, { entry, children: [] })
    else starter.children.push(entry)
  }
  return [...rows.values()].reverse()
}

/** @returns the registered row that matches the record's operation: an exact name first, then `'<key>.'`. */
function matchingRow(record: ProjectRecord, rows: readonly HistoryRow[]): HistoryRow | undefined {
  const operation = record.operation ?? ''
  return rows.find(item => item.match === operation)
    ?? rows.find(item => item.match.endsWith('.') && operation.startsWith(item.match))
}

/** What an action label reads besides its record. */
export interface LabelContext {
  /** The operation declarations of `/api/dv/operations`. */
  operations: readonly WireOperation[]
  /** The registered rows of `dvHistory.rows`. */
  rows: readonly HistoryRow[]
  /** The loaded records by ID, for the chain of a retake. */
  records: ReadonlyMap<string, ProjectRecord>
}

/**
 * The label a row shows for its action: the operation label (`operationLabel` of `@dv/ui-kit`) followed by its subject.
 * The subject comes from the registered row that matches the operation (an exact name first, then `'<key>.'`). Else
 * a record with a chain slot (`chainOf`) names the slot and its lane.
 * @param record - the operation record.
 * @param context - the operations, the registered rows and the loaded records.
 * @returns the Chinese and English label.
 */
export function actionLabel(record: ProjectRecord, context: LabelContext): readonly [string, string] {
  const [zh, en] = operationLabel(record.operation, context.operations)
  const row = matchingRow(record, context.rows)
  if (row !== undefined) {
    const subject = row.subject(record)
    return subject === null ? [zh, en] : [`${zh}${subject[0]}`, `${en}${subject[1]}`]
  }
  const chain = chainOf(record, context.records)
  if (chain === null || chain.slot === null) return [zh, en]
  const slot = chain.lane === undefined ? String(chain.slot) : `${String(chain.slot)} · ${chain.lane}`
  return [`${zh} ${slot}`, `${en} ${slot}`]
}

/**
 * The asset of a row's one thumbnail. An image among the record's outputs, then its inputs, comes first. A video is
 * shown by an image output of the record that made it (a take's still), else by itself. Files that are neither images
 * nor videos (a plan's JSON) and assets of unknown type have no thumbnail. A row without media of its own shows the
 * thumbnail of the first record folded under it.
 * @param record - the record.
 * @param assets - the known assets by ID.
 * @param records - the loaded records by ID, to find the still of a video's maker.
 * @param children - the records folded under the row, in log order.
 * @returns the asset ID, or null.
 */
export function thumbnailOf(
  record: ProjectRecord,
  assets: ReadonlyMap<string, Asset>,
  records: ReadonlyMap<string, ProjectRecord>,
  children: readonly ProjectRecord[] = [],
): string | null {
  const named = [...record.outputs, ...record.inputs.flatMap(input => input.resolved_asset === null ? [] : [input.resolved_asset])]
  const mime = (id: string): string => assets.get(id)?.mime ?? ''
  const image = named.find(id => mime(id).startsWith('image/'))
  if (image !== undefined) return image
  const video = named.find(id => mime(id).startsWith('video/'))
  if (video !== undefined) {
    const maker = records.get(assets.get(video)?.created_by ?? '')
    const still = maker?.outputs.find(id => mime(id).startsWith('image/'))
    return still ?? video
  }
  for (const child of children) {
    const shown = thumbnailOf(child, assets, records)
    if (shown !== null) return shown
  }
  return null
}

/**
 * How long ago a time was, in words: 刚刚 under a minute, minutes under an hour, hours under a day, else the date and
 * `HH:MM`.
 * @param iso - an ISO time.
 * @param now - the current time in milliseconds.
 * @returns the Chinese and English text.
 */
export function relativeTime(iso: string, now: number): readonly [string, string] {
  const time = new Date(iso)
  const minutes = Math.floor((now - time.getTime()) / 60_000)
  if (minutes < 1) return ['刚刚', 'just now']
  if (minutes < 60) return [`${String(minutes)} 分钟前`, `${String(minutes)} min ago`]
  if (minutes < 24 * 60) return [`${String(Math.floor(minutes / 60))} 小时前`, `${String(Math.floor(minutes / 60))} h ago`]
  const clock = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  const date = `${String(time.getMonth() + 1)}/${String(time.getDate())} ${clock}`
  return [date, date]
}

/**
 * Where selecting an entry moves the center. Only steps at or before the current position are what the center views
 * show. The registered row that matches the operation decides when it has a `focus`; else `proj.*` records move
 * nothing, and every other record moves the center to its canvas node.
 * @param entry - the selected entry.
 * @param rows - the registered rows of `dvHistory.rows`.
 * @param records - the records of the current state, oldest first.
 * @returns the center target, or null.
 */
export function centerFocus(
  entry: HistoryEntry,
  rows: readonly HistoryRow[],
  records: readonly ProjectRecord[],
): CenterTarget | null {
  const { record } = entry
  if (entry.place === 'after') return null
  const row = matchingRow(record, rows)
  if (row?.focus !== undefined) return row.focus(record, records)
  if (record.component === 'proj') return null
  return { view: 'canvas', target: { record: record.id } }
}
