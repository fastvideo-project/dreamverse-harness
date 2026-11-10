/**
 * The failure notice of the shell's navigation actions: a runner that logs a rejected action and keeps its message,
 * and the alert that shows it until it is dismissed or the next action succeeds.
 *
 * @module @dv/ui-shell/notice
 */
import type { ReactNode } from 'react'
import { useState } from 'react'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import css from './shell.module.css'

/** Runs an asynchronous shell action, reporting its failure through the notice. */
export type ActionRunner = (work: () => Promise<void>) => void

/**
 * Create the runner and the notice of one component.
 * @param floating - whether the alert floats below its container, for a container with no room of its own.
 * @returns `run`, which starts the action, logs a rejection with `console.warn` and keeps its message, and clears the
 *   message when the action succeeds; and `notice`, the dismissible alert for the message, or null without one.
 */
export function useActionNotice(floating = false): { run: ActionRunner; notice: ReactNode } {
  const t = useText()
  const [message, setMessage] = useState<string | null>(null)
  const run: ActionRunner = (work) => {
    work().then(() => { setMessage(null) }, (error: unknown) => {
      console.warn('ui-shell: navigation failed', error)
      setMessage(errorMessage(error))
    })
  }
  const notice = message === null
    ? null
    : (
      <p className={floating ? `${css.notice} ${css.noticeFloating}` : css.notice} role="alert" data-testid="dv-shell-notice">
        <span>{t(`操作失败：${message}`, `Couldn't complete that: ${message}`)}</span>
        <button type="button" className={css.noticeDismiss} aria-label={t('关闭', 'Dismiss')} onClick={() => { setMessage(null) }}>×</button>
      </p>
    )
  return { run, notice }
}
