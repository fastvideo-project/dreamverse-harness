/** Provider connections check a candidate key before storing it, supersede earlier requests, and drop a removed key. */
import { describe, expect, it, vi } from 'vitest'
import type { CloudAccount, CloudCatalogResult, CloudModelSettings } from '@dv/ui-kit/cloud-model-settings.ts'
import { CloudConnections } from '../src/client/cloud-connections.ts'

const connected: CloudAccount = { status: 'connected', balanceUsd: 1, label: null, limitRemainingUsd: null }

function provider(over: Partial<CloudModelSettings> = {}): CloudModelSettings {
  return {
    id: 'p', name: 'P', domain: 'p.example', keyUrl: 'https://p.example', logo: () => null, media: ['video'],
    settings: { getSnapshot: () => ({ writable: true, enabled: [] }), subscribe: () => () => {} },
    account: vi.fn(async () => connected), verify: vi.fn(async () => connected), removeKey: vi.fn(async () => {}),
    load: vi.fn(async () => ({ models: [{ id: 'm', name: 'M', media: 'video' as const }], warning: 'careful' })),
    setEnabled: async () => {}, ...over,
  }
}

describe('CloudConnections', () => {
  it('reads each account once and loads the catalog of a connected provider', async () => {
    const p = provider()
    const connections = new CloudConnections()
    const changes = vi.fn()
    const off = connections.subscribe(changes)
    connections.ensure([p])
    connections.ensure([p])
    await vi.waitFor(() => { expect(connections.getSnapshot().catalogs.get('p')?.status).toBe('ready') })
    expect(p.account).toHaveBeenCalledTimes(1)
    expect(connections.getSnapshot().catalogs.get('p')).toMatchObject({ warning: 'careful' })
    off()
    connections.dispose()
  })

  it('skips the catalog of a provider that is not connected and falls back to unavailable', async () => {
    const p = provider({ account: vi.fn(async () => { throw new Error('offline') }) })
    const connections = new CloudConnections()
    await connections.refresh(p)
    expect(connections.getSnapshot().accounts.get('p')).toEqual({ status: 'unavailable' })
    expect(p.load).not.toHaveBeenCalled()
  })

  it('stores nothing when the candidate key is rejected, unavailable, or reported missing', async () => {
    const connections = new CloudConnections()
    for (const [status, expected] of [['rejected', 'rejected'], ['unavailable', 'unavailable'], ['missing', 'rejected']] as const) {
      const p = provider({ verify: vi.fn(async () => ({ status })) })
      expect(await connections.save(p, 'k')).toEqual({ status: expected })
      expect(p.load).not.toHaveBeenCalled()
    }
    const failing = provider({ verify: vi.fn(async () => { throw new Error('offline') }) })
    expect(await connections.save(failing, 'k')).toEqual({ status: 'unavailable' })
  })

  it('stores a verified key, loads the catalog, and reports a setup step the account still needs', async () => {
    const connections = new CloudConnections()
    const ok = provider()
    expect(await connections.save(ok, 'k')).toEqual({ status: 'saved' })
    expect(ok.load).toHaveBeenCalledWith('k', expect.any(AbortSignal))
    const setup = provider({
      verify: vi.fn(async () => ({ status: 'needs-setup' as const, message: 'Add billing' })),
      account: vi.fn(async () => ({ status: 'needs-setup' as const, message: 'Add billing' })),
    })
    expect(await connections.save(setup, 'k')).toEqual({ status: 'needs-setup', message: 'Add billing' })
    expect(connections.getSnapshot().accounts.get('p')).toEqual({ status: 'needs-setup', message: 'Add billing' })
  })

  it('checks the saved key when no key is given, and names credential and network failures', async () => {
    const connections = new CloudConnections()
    const p = provider({ load: vi.fn(async () => ({ credentialError: 'rejected' as const })) })
    expect(await connections.save(p, '')).toEqual({ status: 'rejected' })
    expect(p.verify).not.toHaveBeenCalled()
    expect(connections.getSnapshot().catalogs.get('p')).toEqual({ status: 'failed' })
    const broken = provider({ load: vi.fn(async () => { throw new Error('502') }) })
    expect(await connections.save(broken, '')).toEqual({ status: 'failed' })
  })

  it('drops the result of a request that a newer one superseded', async () => {
    const connections = new CloudConnections()
    let release: (account: CloudAccount) => void = () => {}
    const slow = provider({ account: vi.fn(() => new Promise<CloudAccount>((resolve) => { release = resolve })) })
    const first = connections.refresh(slow)
    connections.dispose()
    release(connected)
    await first
    expect(slow.load).not.toHaveBeenCalled()
    const verifying = provider({ verify: vi.fn(() => new Promise<CloudAccount>((resolve) => { release = resolve })) })
    const saving = connections.save(verifying, 'k')
    void connections.refresh(provider())
    release(connected)
    expect(await saving).toEqual({ status: 'failed' })
  })

  it('reports a superseded catalog load and account read as failed without publishing them', async () => {
    const connections = new CloudConnections()
    let releaseLoad: () => void = () => {}
    const p = provider({
      load: vi.fn(() => new Promise<CloudCatalogResult>((resolve) => { releaseLoad = () => { resolve({ models: [] }) } })),
    })
    const saving = connections.save(p, '')
    await vi.waitFor(() => { expect(p.load).toHaveBeenCalled() })
    connections.dispose()
    releaseLoad()
    expect(await saving).toEqual({ status: 'failed' })
    let releaseAccount: () => void = () => {}
    const q = provider({ account: vi.fn(() => new Promise<CloudAccount>((resolve) => { releaseAccount = () => { resolve(connected) } })) })
    const second = new CloudConnections()
    const checking = second.save(q, '')
    await vi.waitFor(() => { expect(q.account).toHaveBeenCalled() })
    second.dispose()
    releaseAccount()
    expect(await checking).toEqual({ status: 'saved' })
    const throwing = provider({ load: vi.fn(async () => { throw new Error('x') }) })
    const third = new CloudConnections()
    const pending = third.save(throwing, '')
    third.dispose()
    expect(await pending).toEqual({ status: 'failed' })
  })

  it('deletes the key and forgets the account and the catalog', async () => {
    const connections = new CloudConnections()
    const p = provider()
    await connections.refresh(p)
    await connections.remove(p)
    expect(p.removeKey).toHaveBeenCalledOnce()
    expect(connections.getSnapshot().accounts.get('p')).toEqual({ status: 'missing' })
    expect(connections.getSnapshot().catalogs.has('p')).toBe(false)
    const refusing = provider({ removeKey: vi.fn(async () => { throw new Error('denied') }) })
    await expect(connections.remove(refusing)).rejects.toThrow('denied')
  })
})
