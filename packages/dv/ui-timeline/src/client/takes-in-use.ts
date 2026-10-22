/**
 * The records that the project's timelines use, as the canvas reads them through `dvCanvas.recordsInUse`: the record
 * behind each clip, and a trim badge on the asset of each clip with an in or out point.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { RecordsInUse } from '@dv/ui-canvas/contract'
import { TIMELINE_ID } from './definition.ts'
import type {} from './locales.ts'
import { timelinesOf } from './timelines.ts'

/**
 * The `RecordsInUse` of the timeline, registered under the package's id. `uses` lists, for each clip of every timeline, the
 * render the clip waits for (`source.record`), else the producer of its asset; `badges` puts the trim label on the asset
 * of each clip with an in or out point.
 * @param t - namespace-bound translate, read on every `badges` call.
 * @returns the descriptor to register.
 */
export function timelineTakesInUse(t: TranslateNS<'dvTimeline'>): RecordsInUse {
  return {
    id: TIMELINE_ID,
    uses(state) {
      const createdBy = state.components.proj.created_by
      return timelinesOf(state).flatMap(timeline => timeline.clips.flatMap((clip) => {
        const record = clip.source?.record ?? (clip.asset === null ? undefined : createdBy[clip.asset])
        return record === undefined ? [] : [record]
      }))
    },
    badges(state) {
      return timelinesOf(state).flatMap(timeline => timeline.clips.flatMap(clip =>
        clip.asset !== null && (clip.in_sec !== null || clip.out_sec !== null) ? [{ asset: clip.asset, label: t('badge.trim') }] : []))
    },
  }
}
