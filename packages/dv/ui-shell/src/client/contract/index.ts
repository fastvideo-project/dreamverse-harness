/**
 * Types of the slots that `@dv/ui-shell` declares for other UI plugins and of `ctx.dvCenter`, the service that shows a
 * view of the open project and hands it a request. The shell names no view. Types only.
 *
 * @module @dv/ui-shell/contract
 */
import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** JSON data. */
export type Json = null | boolean | number | string | readonly Json[] | JsonFields

/** A JSON object. */
export interface JsonFields { readonly [key: string]: Json }

/** A request for the center: a `dv.center.view` entry's ID and a value that the view reads once, such as a record. */
export interface CenterTarget { view: string; target: JsonFields }

/** Provided by `@dv/ui-shell` as `ctx.dvCenter`. */
export interface DvCenter {
  /**
   * Show the view of `target` in the open project's center and hand it the target as its request. A later `show`, a
   * switch to another view, and a switch to another project drop a request that the view has not taken.
   */
  show(target: CenterTarget): void
}

/** A request that the center hands the shown view until the view takes it. */
export interface CenterRequest {
  value: JsonFields
  /** Mark the request as handled, so the view does not get it again, also after a remount. */
  take: () => void
}

/**
 * The open project's center fields, which every view of the project reads and sets, the URL hash keeps as plain
 * fields such as `timeline=t2`, and the summary request reads, such as the timeline whose first clip is the session
 * cover. A field is named by the plugin that sets it; `project`, `view` and `session` name the hash's own fields.
 */
export type CenterFields = Readonly<Record<string, string>>

declare module '@deepseek-ai/cordis' {
  interface Context { dvCenter: DvCenter }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Optional, plugin-owned template cards on the blank Home page; the shell owns no template catalog. */
    'dv.templates': { kind: 'list'; scope: 'root' }
    /**
     * One tab of the entry page's 探索 section, such as MCP tools, workflows, or skills: `label` names the tab, `order`
     * places it, and the component is the tab's body. The shell draws the tab row and renders only the selected tab;
     * the section is hidden while the slot has no entry. Declared by the `@dv/ui-shell` center entry.
     */
    'dv.explore': { kind: 'list'; scope: 'root' }
    /**
     * One view of the open project, such as the canvas; `@dv/ui-shell` shows the selected entry in the workspace center
     * and hands it the request of the latest `dvCenter.show` for it that it has not taken (else null), the project's
     * center fields, and `note`, which sets center fields of the project (null removes one).
     */
    'dv.center.view': {
      kind: 'list'
      scope: 'root'
      owner: {
        projectId: string
        session: string | null
        request: CenterRequest | null
        fields: CenterFields
        note: (fields: Readonly<Record<string, string | null>>) => void
      }
    }
  }
}
