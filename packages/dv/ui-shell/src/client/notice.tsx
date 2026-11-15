/**
 * The failure toast of the shell's navigation actions: a runner that logs a rejected action and keeps its message in a
 * module store, and the `shell.overlay` entry that shows the message as a Toast. The entry outlives the navigator, the
 * session switcher, and the recent projects, so a failure stays visible when the surface that reported it unmounts.
 *
 * @module @dv/ui-shell/notice
 */
import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { useText } from '@dv/ui-kit/locale.ts'

/** Hold of the toast, which quotes the server's reason, as DSH's refused Session creation toast does. */
const FAILURE_HOLD_MS = 6000

/** The failure on display, with a per-report sequence that restarts the toast for a repeated message. */
let failure: { seq: number; message: string } | null = null
let reports = 0
/** The shell application that actions report to; a clear starts the next one, so earlier actions report nothing. */
let generation = 0
const listeners = new Set<() => void>()

/**
 * Replace the failure on display and notify the toast.
 * @param next - the failure, or null to clear it.
 */
function publish(next: typeof failure): void {
  failure = next
  for (const listener of listeners) listener()
}

/**
 * Clear the failure on display, so that a shell applied again starts with no toast, and drop the outcome of every
 * action still pending.
 */
export function clearActionFailure(): void {
  generation += 1
  publish(null)
}

/**
 * Start an asynchronous shell action. A rejection is logged with `console.warn` and shown in the toast; a success
 * clears a failure still on display that was reported before the action started. An action that settles after
 * `clearActionFailure` changes no toast.
 * @param work - the action.
 */
export function runAction(work: () => Promise<void>): void {
  const started = generation
  const seen = reports
  work().then(() => { if (failure !== null && failure.seq <= seen) publish(null) }, (error: unknown) => {
    console.warn('ui-shell: navigation failed', error)
    if (started !== generation) return
    reports += 1
    publish({ seq: reports, message: errorMessage(error) })
  })
}

/**
 * The `shell.overlay` entry: the failure on display as a warning Toast, which removes it once the Toast fades.
 * @returns the Toast, or null without a failure.
 */
export function ActionFailureToast(): ReactNode {
  const t = useText()
  const shown = useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, () => failure)
  if (shown === null) return null
  return (
    <Toast
      key={`toast-${String(shown.seq)}`}
      text={t(`操作失败：${shown.message}`, `Couldn't complete that: ${shown.message}`)}
      icon={<IconWarningOutlineRegular />}
      holdMs={FAILURE_HOLD_MS}
      onDone={() => { publish(null) }}
    />
  )
}
