/**
 * Codex settings page: signed-in state with sign-out, or the running attempt's
 * notices (page link and code) and its open question.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthorizationFlowView } from '../types.ts'
import type { en } from './locales.ts'
import { signInKey } from './sign-in.ts'
import type { OpenSignInPrompt, SignInAttempt, SignInState, SignInStore } from './sign-in.ts'
import styles from './CodexSignIn.module.css'

/** Settings namespace `llm-pi-ai` writes its Codex credential under. */
const CODEX_SETTINGS_NS = 'llm-pi-ai'
/** Route id of the Codex subscription flow. */
const CODEX_PROVIDER = 'openai-codex'

/** Data the settings page receives from the client plugin. */
export interface CodexSignInInjected {
  /** The store the actions go to. */
  store: SignInStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSignIn. */
    signIn: SignInStore['store']
  }
  /** Page copy. */
  t: (key: keyof typeof en) => string
}

/** Props of {@link CodexSignInSection}. Injected fields are absent until the slot runtime fills them. */
export type CodexSignInProps = Partial<InjectFace<CodexSignInInjected>>

/**
 * The Codex settings page body.
 * @param props - the store, its snapshot hook, and copy.
 * @returns the page, or null before injection.
 */
export function CodexSignInSection({ store, useSignIn, t }: CodexSignInProps): ReactNode {
  if (store === undefined || useSignIn === undefined || t === undefined) return null
  return (
    <div className={styles['page']}>
      <p className={styles['advancedHint']}>{t('intro')}</p>
      <SignInArea store={store} useSignIn={useSignIn} settingsNs={CODEX_SETTINGS_NS} provider={CODEX_PROVIDER} t={t} />
    </div>
  )
}

/** Props of {@link SignInArea}. */
export interface SignInAreaProps {
  /** The store the actions go to. */
  store: SignInStore
  /** The store's snapshot bound by the UI renderer. */
  useSignIn: SnapshotSelectorHook<SignInState>
  /** The card's settings namespace. */
  settingsNs: string
  /** The card's route id. */
  provider: string
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * The card's sign-in block, or nothing when the Host offers no flow for it.
 * The first mounted block fetches the offered flows.
 * @param props - the store, its snapshot hook, the card's route, and copy.
 * @returns the block, or null.
 */
export function SignInArea({ store, useSignIn, settingsNs, provider, t }: SignInAreaProps): ReactNode {
  const state = useSignIn(snapshot => snapshot)
  useEffect(() => {
    if (store.store.getSnapshot().status === 'idle') void store.load()
  }, [store])
  const key = signInKey(settingsNs, provider)
  const flow = state.flows.find(candidate => candidate.key === key)
  if (flow === undefined) return null
  return <SignInPanel flow={flow} attempt={state.attempts[key]} error={state.error} store={store} t={t} />
}

/** Props of {@link SignInPanel}. */
export interface SignInPanelProps {
  /** The offered flow as last listed. */
  flow: AuthorizationFlowView
  /** This browser's attempt, if any. */
  attempt: SignInAttempt | undefined
  /** The latest refused store call. */
  error: string | null
  /** The store the actions go to. */
  store: SignInStore
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * One flow's sign-in block.
 * @param props - the flow, this browser's attempt, and the store.
 * @returns the block.
 */
export function SignInPanel({ flow, attempt, error, store, t }: SignInPanelProps): ReactNode {
  const { key } = flow
  const cancel = (
    <div className={styles['editorActions']}>
      <button type="button" className={styles['secondaryButton']} onClick={() => { void store.cancel(key) }}>
        {t('signInCancel')}
      </button>
    </div>
  )
  return (
    <section className={styles['signIn']} aria-label={t('signInRegion').replace('{label}', flow.label)}>
      {attempt?.status === 'running'
        ? (
          <>
            {attempt.notices.length === 0 && attempt.prompt === undefined
              ? <p className={styles['advancedHint']}>{t('signInStarting')}</p>
              : null}
            {attempt.notices.map((notice, index) => (
              <div key={index} className={styles['signInNotice']}>
                <p className={styles['advancedHint']}>{notice.message}</p>
                {notice.url === undefined
                  ? null
                  : <a href={notice.url} target="_blank" rel="noopener noreferrer">{notice.url}</a>}
                {notice.code === undefined ? null : <code className={styles['signInCode']}>{notice.code}</code>}
              </div>
            ))}
            {attempt.prompt === undefined ? null : <SignInPrompt open={attempt.prompt} flowKey={key} store={store} t={t} />}
            {cancel}
          </>
        )
        : flow.inFlight
          ? (
            <>
              <p className={styles['advancedHint']}>{t('signInElsewhere')}</p>
              {cancel}
            </>
          )
          : (
            <div className={styles['signInStatus']}>
              <span className={styles['advancedHint']}>
                {`${flow.label} · ${t(flow.signedIn ? 'signInSignedIn' : 'signInSignedOut')}`}
              </span>
              {flow.signedIn
                ? (
                  <button type="button" className={styles['secondaryButton']} onClick={() => { void store.signOut(key) }}>
                    {t('signOut')}
                  </button>
                )
                : (
                  <button type="button" className={styles['primaryButton']} onClick={() => { store.start(key) }}>
                    {t(attempt?.status === 'failed' ? 'signInRetry' : 'signIn')}
                  </button>
                )}
            </div>
          )}
      {attempt?.status === 'failed'
        ? <p role="alert" className={styles['error']}>{`${t('signInFailed')}: ${attempt.message}`}</p>
        : null}
      {error === null ? null : <p role="alert" className={styles['error']}>{error}</p>}
    </section>
  )
}

interface SignInPromptProps {
  open: OpenSignInPrompt
  flowKey: string
  store: SignInStore
  t: (key: keyof typeof en) => string
}

function SignInPrompt({ open, flowKey, store, t }: SignInPromptProps): ReactNode {
  const { prompt } = open
  const [value, setValue] = useState('')
  if (prompt.kind === 'select') {
    const { preferred } = prompt
    const options = [
      ...prompt.options.filter(option => option.id === preferred),
      ...prompt.options.filter(option => option.id !== preferred),
    ]
    return (
      <div className={styles['field']} role="group" aria-label={prompt.message}>
        <span className={styles['fieldLabel']}>{prompt.message}</span>
        <div className={styles['signInOptions']}>
          {options.map(option => (
            <button
              key={option.id}
              type="button"
              className={styles[option.id === preferred ? 'primaryButton' : 'secondaryButton']}
              title={option.description}
              onClick={() => { void store.answer(flowKey, option.id) }}
            >
              {option.id === preferred ? `${option.label} (${t('signInRecommended')})` : option.label}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <form
      className={styles['field']}
      onSubmit={(event) => {
        event.preventDefault()
        void store.answer(flowKey, value)
      }}
    >
      <label className={styles['fieldLabel']}>
        {prompt.message}
        <input
          className={styles['input']}
          type={prompt.kind === 'secret' ? 'password' : 'text'}
          autoComplete="off"
          value={value}
          placeholder={prompt.placeholder}
          onChange={(event) => { setValue(event.target.value) }}
        />
      </label>
      <div className={styles['editorActions']}>
        <button type="submit" className={styles['primaryButton']}>{t('signInSubmit')}</button>
        <button type="button" className={styles['secondaryButton']} onClick={() => { void store.decline(flowKey) }}>
          {t('signInDecline')}
        </button>
      </div>
    </form>
  )
}
