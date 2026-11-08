/**
 * The pairing token a Blender presents to link: random, kept in the DSH credential store under
 * `dv-blender/pairing-token` while one is mounted, so it survives a restart of the harness, and only in memory
 * otherwise.
 *
 * @module @fastvideo/dreamverse-blender-bridge/token
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'

const KEY = credentialKey('dv-blender', 'pairing-token')
const PAYLOAD_VERSION = 1

function generated(): string {
  return randomBytes(24).toString('base64url')
}

function tokenOf(record: CredentialRecord | undefined): string | null {
  if (record?.kind !== 'grant') return null
  const payload = record.payload
  if (typeof payload !== 'object' || payload === null) return null
  const { version, token } = payload as Record<string, unknown>
  return version === PAYLOAD_VERSION && typeof token === 'string' && token.length > 0 ? token : null
}

/** The pairing token; see the module comment. */
export class PairingToken {
  private cached: string | null = null

  /**
   * @param credentials - reads the credential store each time, because the store may mount after the bridge.
   */
  constructor(private readonly credentials: () => CredentialProvider | undefined) {}

  /**
   * The token, created on first use.
   * @returns the token.
   */
  async current(): Promise<string> {
    if (this.cached !== null) return this.cached
    const store = this.credentials()
    if (store === undefined) {
      this.cached = generated()
      return this.cached
    }
    const record = await store.modifyRecord(KEY, current => Promise.resolve(
      tokenOf(current) === null ? { kind: 'grant', payload: { version: PAYLOAD_VERSION, token: generated() } } : undefined,
    ))
    this.cached = tokenOf(record) ?? generated()
    return this.cached
  }

  /**
   * Replace the token; a Blender must then link with the new one.
   * @returns the new token.
   */
  async regenerate(): Promise<string> {
    const token = generated()
    const store = this.credentials()
    if (store !== undefined) await store.modifyRecord(KEY, () => Promise.resolve({ kind: 'grant', payload: { version: PAYLOAD_VERSION, token } }))
    this.cached = token
    return token
  }

  /**
   * Compare a presented token with the current one in constant time.
   * @param presented - the token from the request.
   * @returns whether it matches.
   */
  async matches(presented: string): Promise<boolean> {
    const expected = Buffer.from(await this.current())
    const given = Buffer.from(presented)
    return given.byteLength === expected.byteLength && timingSafeEqual(given, expected)
  }
}
