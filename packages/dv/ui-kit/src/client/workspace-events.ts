/**
 * Browser events and drag data that the DreamVerse workspace panels exchange without importing each other. Panels
 * dispatch the events on `window`; the shell or the panel that owns the target listens. To prefill the chat composer,
 * call `dispatchCompose` from `@dv/ui-kit/compose.ts`, which owns the `dv:compose` event.
 *
 * @module @dv/ui-kit/workspace-events
 */

/** The `DataTransfer` type whose value is an asset ID, set by asset drag sources. */
export const DV_ASSET_DRAG_TYPE = 'application/x-dv-asset'

/**
 * The `DataTransfer` type whose value is the MIME type of the asset that `DV_ASSET_DRAG_TYPE` names, set by the same drag
 * sources, so a drop target can tell audio from video without the project state having the asset yet.
 */
export const DV_ASSET_MIME_DRAG_TYPE = 'application/x-dv-asset-mime'

/** The event that opens the History panel and selects the record a tool call of the agent wrote. */
export const DV_HISTORY_FOCUS_EVENT = 'dv:history-focus'

/** The event that opens 轨迹 on a chat session and shows one of its tool calls. */
export const DV_TRAJECTORY_FOCUS_EVENT = 'dv:trajectory-focus'

/** Event names and their `detail` fields. */
export interface DvWorkspaceEventMap {
  /** Open the History panel and select the record that tool call `toolCall` of chat session `session` wrote. */
  'dv:history-focus': { session: string; toolCall: string }
  /** Open 轨迹 on chat session `session` and show its tool call `toolCall`. */
  'dv:trajectory-focus': { session: string; toolCall: string }
}

/**
 * Dispatch one workspace event on `window`.
 * @param name - the event name.
 * @param detail - the event fields.
 */
export function dispatchWorkspaceEvent<K extends keyof DvWorkspaceEventMap>(name: K, detail: DvWorkspaceEventMap[K]): void {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}
