/**
 * Types of the Text node component: the versions that `textnode.write` and `textnode.edit` records store and the
 * `textnode` state slice. A text node is one Markdown document of a project, such as a script, story beats or an ad
 * spec. Its `TextPath` names it, and its versions are numbered from 1.
 *
 * @module @dv/text-node/types
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AssetId, RecordId } from '@dv/project/types'

/**
 * The address of a text node, chosen by the caller: a relative path such as `beats.md` or `剧集/EP001/剧本.md`. It
 * holds no `@`, `#` or `..` and does not start with `/`. `parseTextPath` of `@dv/text-node` makes one; a citation names
 * it as `dv:textnode/<path>`.
 */
export type TextPath = Branded<'DvTextPath'>

/** One literal replacement of `textnode.edit`: `old_text` occurs exactly once in the text it applies to. */
export interface TextEdit {
  old_text: string
  new_text: string
}

/** One version of a text node: `textnode.write` or `textnode.edit` writes the next one. */
export interface TextVersion {
  path: TextPath
  /** 1-based. */
  version: number
  /** The `title` of the latest write that passed one, else the first heading of version 1, else the path. */
  title: string
  /** The whole Markdown text. */
  body: string
  /** The `text/markdown` asset that holds `body`; a record that takes it as an input becomes stale after the next version. */
  asset: AssetId
  /** The `textnode.write` or `textnode.edit` record that wrote the version. */
  created_by: RecordId
}

/** The `textnode` slice: the versions of every text node in the state, oldest first. */
export interface TextState {
  texts: Record<TextPath, TextVersion[]>
}

declare module '@dv/project/types' {
  interface ComponentStates {
    /** Text nodes and their versions (the Text node component's reducer). */
    textnode: TextState
  }
  interface ReferenceKinds {
    /** A text node by its path; `<path>@<version>` names one version. */
    textnode: TextPath
  }
}
