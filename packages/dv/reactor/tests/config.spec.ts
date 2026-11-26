/** Check the Reactor loader schema and the load-time refusal of an alias without a usable duration. */
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as Reactor from '../src/index.ts'

/** Apply the plugin to a context that records nothing, so only the load-time checks run. */
function load(settings: Record<string, unknown>): void {
  const ctx = { inject: () => undefined, effect: () => undefined, on: () => undefined } as unknown as Context
  Reactor.apply(ctx, Reactor.Config(settings))
}

describe('Reactor configuration', () => {
  it('defaults the session lifetime to 360 seconds and the catalog deadline to 30 seconds', () => {
    expect(Reactor.Config({})).toMatchObject({ pythonPath: 'python3', timeoutSeconds: 360, catalogTimeoutSeconds: 30 })
  })

  it('defaults the Clip Generation poll interval to 5 seconds and bounds it', () => {
    expect(Reactor.Config({}).pollIntervalMs).toBe(5000)
    expect(Reactor.Config({ pollIntervalMs: 1 }).pollIntervalMs).toBe(1)
    for (const value of [0, 60_001, 1.5]) expect(() => Reactor.Config({ pollIntervalMs: value })).toThrow()
  })

  it('defaults the API origin to the Reactor service', () => {
    expect(Reactor.Config({}).apiBaseUrl).toBe('https://api.reactor.inc')
  })

  it.each(['not a url', 'http://api.reactor.inc', 'https://api.reactor.inc/v1', 'https://api.reactor.inc/?a=1',
    'https://api.reactor.inc/#x', 'https://user@api.reactor.inc', 'https://user:pw@api.reactor.inc'])(
    'refuses to load with the API base URL %s', (apiBaseUrl) => {
      expect(() => { load({ apiBaseUrl }) }).toThrow('Configure apiBaseUrl as an HTTPS origin')
    })

  it.each([0, 301, 1.5])('rejects a catalog deadline of %s seconds', (seconds) => {
    expect(() => Reactor.Config({ catalogTimeoutSeconds: seconds })).toThrow()
  })

  it.each([1, 300])('accepts a catalog deadline of %s seconds', (seconds) => {
    expect(Reactor.Config({ catalogTimeoutSeconds: seconds }).catalogTimeoutSeconds).toBe(seconds)
  })

  it('refuses to load when an alias has no duration shorter than the session lifetime', () => {
    expect(() => { load({ timeoutSeconds: 8, models: { quick: { profile: 'fast-h3' } } }) })
      .toThrow('Reactor model quick has no duration shorter than timeoutSeconds (8).')
    expect(() => { load({ timeoutSeconds: 8, models: { quick: { profile: 'fast-h3', durationsSec: [8, 9] } } }) })
      .toThrow('quick')
  })

  it.each([
    [{ pythonPath: '  ' }, 'Configure a Python interpreter for Reactor.'],
    [{ credentialRef: 'not a name' }, 'Configure an environment variable name for the Reactor credential.'],
    [{ models: { 'Bad Alias': { profile: 'fast-h3' } } }, 'Reactor model aliases use lowercase letters, numbers and hyphens.'],
    [{ models: { quick: { profile: 'fast-h3', modelId: 'no-owner' } } }, 'Reactor model IDs use owner/name.'],
  ])('refuses to load the settings %j', (settings, message) => {
    expect(() => { load(settings) }).toThrow(message)
  })
})
