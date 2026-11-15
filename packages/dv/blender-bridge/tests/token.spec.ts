/**
 * {@link PairingToken} over an in-memory credential store: a stored record that is not a valid pairing token, which
 * another build or a hand edit may leave, is replaced by a fresh token.
 */
import { Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it } from 'vitest'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { PairingToken } from '../src/token.ts'

const KEY = credentialKey('dv-blender', 'pairing-token')

describe('PairingToken', () => {
  it('keeps a valid stored token', async () => {
    const store = new MemoryCredentials(new Context())
    await store.modifyRecord(KEY, () => Promise.resolve({ kind: 'grant', payload: { version: 1, token: 'kept' } }))
    const token = new PairingToken(() => store)
    expect(await token.current()).toBe('kept')
    expect(await token.matches('kept')).toBe(true)
    expect(await token.matches('kepT')).toBe(false)
  })

  it.each<[string, CredentialRecord]>([
    ['an API key', { kind: 'api-key', key: 'x' }],
    ['a grant without a payload object', { kind: 'grant', payload: null } as never],
    ['a grant of another payload version', { kind: 'grant', payload: { version: 2, token: 'old' } }],
    ['a grant with an empty token', { kind: 'grant', payload: { version: 1, token: '' } }],
  ])('replaces %s with a fresh stored token', async (_case, stored) => {
    const store = new MemoryCredentials(new Context())
    await store.modifyRecord(KEY, () => Promise.resolve(stored))
    const token = await new PairingToken(() => store).current()
    expect(token).toMatch(/^[\w-]{32}$/u)
    expect(await store.readRecord(KEY)).toEqual({ kind: 'grant', payload: { version: 1, token } })
  })
})
