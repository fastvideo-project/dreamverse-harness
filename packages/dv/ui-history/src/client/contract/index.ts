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
  /**
   * Present on the row of the records that History draws as media, such as takes: such a row has the thumbnail column,
   * and its record counts in the fold text of its starter.
   */
  media?: {
    /** The asset of the row's thumbnail, drawn through `dv.media` at 'thumb'; null: an empty square. */
    thumbnail(record: ProjectRecord, state: WireState): string | null
  }
  /** The label of the records folded under this row, such as ['渲染 3 个镜头', 'Render 3 shots']. */
  fold?(count: number): Text
}

/** What History's label of a record reads besides the record. */
export interface DescribeContext {
  /** The operation declarations of `/api/dv/operations`. */
  operations: readonly WireOperation[]
  /** The records of the project's current state by ID, for the chain of a retake. */
  records: Readonly<Record<string, ProjectRecord>>
}

/** Provided by `@dv/ui-history` as `ctx.dvHistory`. */
export interface DvHistory {
  rows: Registry<HistoryRow>
  /**
   * The label History shows for a record whose row has `media`, such as a take: its operation label and its subject;
   * null for any other record, such as an import. The chat media caption reads it, else the asset's name.
   */
  describe(record: ProjectRecord, context: DescribeContext): Text | null
}

declare module '@deepseek-ai/cordis' {
  interface Context { dvHistory: DvHistory }
}
