/**
 * Wire types of the generated `authorization` Remote namespace. Client-safe:
 * no Host imports, and no value here carries a credential.
 * @module @deepseek-ai/dsh-api-authorization-controller/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  AuthorizationMethod, AuthorizationNotice, AuthorizationPromptOption, AuthorizationStatus,
} from '@deepseek-ai/dsh-authorization/types'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'

export type { AuthorizationMethod, AuthorizationNotice, AuthorizationPromptOption, AuthorizationStatus }
export type { CredentialKey }

/** Host-minted identity of one open prompt; only the attempt's own stream receives it. */
export type AuthorizationPromptId = Branded<'AuthorizationPromptId'>

/** One offered sign-in as a configuration surface sees it. */
export interface AuthorizationFlowView {
  /** The credential record the flow writes. */
  readonly key: CredentialKey
  /** User-facing name of what is being authorized. */
  readonly label: string
  /** The methods offered, most preferred first. */
  readonly methods: readonly AuthorizationMethod[]
  /** Whether an attempt for this key is running. */
  readonly inFlight: boolean
  /** Whether the credential store holds a record for this key. */
  readonly signedIn: boolean
}

/** A flow's question without its Host-local withdrawal signal. */
export type AuthorizationPromptView =
  | { readonly kind: 'text'; readonly message: string; readonly placeholder?: string }
  | { readonly kind: 'secret'; readonly message: string; readonly placeholder?: string }
  | {
    readonly kind: 'select'
    readonly message: string
    readonly options: readonly AuthorizationPromptOption[]
    /** The option id this deployment prefers, present only when it is one of `options`. */
    readonly preferred?: string
  }

/** Target of one `authorization.begin` stream. */
export interface AuthorizationBeginRequest {
  /** Credential key of an offered flow. */
  readonly key: string
  /** One of the flow's method ids; omitted, the flow's first method runs. */
  readonly method?: string
}

/**
 * One frame of an attempt stream. `settled` is the last frame; a failed
 * attempt ends the stream with a Remote error instead.
 */
export type AuthorizationAttemptFrame =
  | { readonly type: 'notice'; readonly notice: AuthorizationNotice }
  | { readonly type: 'prompt'; readonly id: AuthorizationPromptId; readonly prompt: AuthorizationPromptView }
  | { readonly type: 'prompt-withdrawn'; readonly id: AuthorizationPromptId }
  | { readonly type: 'settled'; readonly status: AuthorizationStatus }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The key names no flow this deployment offers, or its flow is not registered right now. */
    'authorization/not-offered': { readonly key: string }
    /** No open prompt of the key's running attempt has that id. */
    'authorization/no-prompt': { readonly key: string; readonly id: string }
    /** The attempt failed; the message is the flow's diagnostic. */
    'authorization/failed': { readonly key: string; readonly code?: string }
  }
}
