/**
 * The History row of timeline records, as the History panel reads it through `dvHistory.rows`: no subject, and a focus
 * that shows the timeline view of the workspace center on the record's timeline and clip.
 */
import type { HistoryRow } from '@dv/ui-history/contract'
import type { ProjectRecord } from '@dv/ui-kit/types.ts'

/** @returns the text value of a param, or null. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * @param record - a finished record.
 * @param key - `clips` or `sounds`.
 * @returns the clip or sound IDs the record assigned (`report.clips` or `report.sounds`).
 */
function reportedIds(record: ProjectRecord, key: 'clips' | 'sounds'): string[] {
  const ids = record.report?.[key]
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

/**
 * The timeline each clip and sound belongs to: the timeline of the record that assigned the clip or sound
 * (`timeline.create`, `update`, `clip_insert`, `sound_add` name it by `params.timeline`, a create without one makes
 * `t1`; `clip_split` adds to the timeline of the split clip).
 * @param records - the records of the current state, oldest first.
 * @returns clip or sound ID → timeline ID.
 */
export function clipTimelines(records: readonly ProjectRecord[]): Map<string, string> {
  const owner = new Map<string, string>()
  for (const record of records) {
    const clips = [...reportedIds(record, 'clips'), ...reportedIds(record, 'sounds')]
    if (clips.length === 0) continue
    const timeline = record.operation === 'timeline.clip_split'
      ? owner.get(text(record.params['clip']) ?? '') ?? null
      : text(record.params['timeline']) ?? (record.operation === 'timeline.create' ? 't1' : null)
    if (timeline === null) continue
    for (const clip of clips) owner.set(clip, timeline)
  }
  return owner
}

/**
 * The timeline a record works on: its `timeline` param, else the timeline of its `clip` or `sound` param, else `t1`
 * for a `timeline.create` without a param.
 * @param record - the record.
 * @param owner - clip or sound ID → timeline ID, from {@link clipTimelines}.
 * @returns the timeline ID, or null when the record names none.
 */
function timelineOf(record: ProjectRecord, owner: ReadonlyMap<string, string>): string | null {
  const named = text(record.params['timeline'])
  if (named !== null) return named
  const clip = text(record.params['clip']) ?? text(record.params['sound'])
  if (clip !== null) return owner.get(clip) ?? null
  return record.operation === 'timeline.create' ? 't1' : null
}

/**
 * The History row of every `timeline.*` operation; it adds no subject to the operation label. Its focus shows the
 * `timeline` center view on the record's timeline and the record's `clip` param, else on the first clip that the
 * record assigned; a record whose
 * timeline cannot be found focuses nothing.
 */
export const timelineHistoryRow: HistoryRow = {
  match: 'timeline.',
  subject: () => null,
  focus(record, records) {
    const timelineId = timelineOf(record, clipTimelines(records))
    if (timelineId === null) return null
    const clipId = text(record.params['clip']) ?? reportedIds(record, 'clips')[0] ?? null
    return { view: 'timeline', target: { timeline: timelineId, clip: clipId } }
  },
}
