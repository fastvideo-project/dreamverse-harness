/**
 * Shared parts of the chat rows of agent tool calls: the parsed call arguments, whether a settled call wrote a record,
 * the assets of a settled call, and the 在历史中查看 link. The tool rows of `@dv/ui-composer` and the render card of
 * `@dv/ui-shot-render` use them.
 *
 * @module @dv/ui-kit/tool-rows
 */
import { assetUrl } from './api.ts'
import { useText } from './locale.ts'
import { DV_HISTORY_FOCUS_EVENT, dispatchWorkspaceEvent } from './workspace-events.ts'

/** Parsed arguments of a tool call, empty while they stream. */
export function argsOf(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  } catch {
    // Arguments are still streaming: the row shows what it has.
    return {}
  }
}

/**
 * Whether a settled tool call wrote a record, so that its row has a 在历史中查看 link. The result metadata of a tool that
 * writes records, an operation tool or a `dv_proj_*` tool, names the record it wrote; a read operation such as
 * `inspect.image` names `record: ''`, and a read `dv_proj_*` tool or a failed call carries no metadata.
 * @param block - the settled call block.
 * @returns whether the call wrote a record.
 */
export function wroteRecord(block: object): boolean {
  const meta = 'meta' in block ? block.meta : undefined
  return typeof meta === 'object' && meta !== null && 'record' in meta && typeof meta.record === 'string' && meta.record !== ''
}

/** The asset URLs of a settled call, from the result's presentation metadata. */
export function outputsOf(block: object): Array<{ role: string; url: string; mime: string }> {
  const meta = 'meta' in block ? block.meta : undefined
  if (typeof meta !== 'object' || meta === null || !('outputs' in meta) || !Array.isArray(meta.outputs)) return []
  return (meta.outputs as Array<{ role?: unknown; asset_id?: unknown; mime?: unknown }>).flatMap(output =>
    typeof output.asset_id === 'string' ? [{ role: String(output.role), url: assetUrl(output.asset_id), mime: String(output.mime) }] : [])
}

/**
 * 在历史中查看 on a settled tool row: asks the History panel to select the record this tool call wrote.
 * @param props - the chat session, the tool call, and the button class from the caller's own CSS module.
 * @returns the link button.
 */
export function HistoryLink(props: { sessionId: string; callId: string; className: string | undefined }) {
  const t = useText()
  const { sessionId, callId } = props
  return <button type="button" data-testid="dv-composer-open-history" className={props.className}
    onClick={() => { dispatchWorkspaceEvent(DV_HISTORY_FOCUS_EVENT, { session: sessionId, toolCall: callId }) }}>
    {t('在历史中查看', 'Show in history')}
  </button>
}
