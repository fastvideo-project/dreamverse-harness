/**
 * The History contract: how a UI plugin names, focuses and draws the records of its operations in the History panel,
 * and the record label that the chat reads. `@dv/ui-history` provides `dvHistory`; each kind's plugin registers its
 * rows. Types only.
 *
 * @module @dv/ui-history/contract
 */
import type {} from '@deepseek-ai/cordis'
import type { Registry } from '@dv/ui-kit/registries.ts'
import type { ProjectRecord, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import type { CenterTarget } from '@dv/ui-shell/contract'

/** A pair of interface texts, Chinese then English. */
export type Text = readonly [zh: string, en: string]

/** How History names the records of one operation or component key. Registry `dvHistory.rows`, keyed by `match`. */
export interface HistoryRow {
  /** An operation name, or '<key>.' for every operation of a component key. */
  match: string
  /** The subject after the label, with its own separator, such as [' p1 v1', ' p1 v1']; null names the record's chain slot, if any. */
  subject(record: ProjectRecord): Text | null
  /** Where selecting the record moves the center; absent: the record's canvas node (`{ view: 'canvas', target: { record } }`). */
  focus?(record: ProjectRecord, records: readonly ProjectRecord[]): CenterTarget | null
  /** The asset of the row's thumbnail, drawn through `dv.media` at 'thumb'; absent or null: no thumbnail. */
  thumbnail?: (record: ProjectRecord, state: WireState) => string | null
  /** The label of the records folded under this row, such as ['渲染 3 个镜头', 'Render 3 shots']. */
  fold?(count: number): Text
}

/** Provided by `@dv/ui-history` as `ctx.dvHistory`. */
export interface DvHistory {
  rows: Registry<HistoryRow>
  /** The label History shows for a record: its operation label and its row's subject; the chat media caption reads it. */
  describe(record: ProjectRecord, operations: readonly WireOperation[]): Text
}

declare module '@deepseek-ai/cordis' {
  interface Context { dvHistory: DvHistory }
}
