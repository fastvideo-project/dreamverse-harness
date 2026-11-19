/** Pod discovery exposes only connection metadata and never forwards control keys to workers. */
import { describe, expect, it } from 'vitest'
import { listRunPodPods, runPodViews } from '../src/runpod.ts'

describe('existing RunPod discovery', () => {
  it('filters invalid ports and identities and strips all environment and secret fields', () => {
    const views = runPodViews([{ id: 'pod123', name: 'My GPU', desiredStatus: 'RUNNING',
      ports: ['18000/http', '22/tcp', '0/http', '99999/http'], env: { SECRET: 'must-not-leak' },
      apiKey: 'must-not-leak', publicIp: '1.2.3.4' }, { id: 'bad.id', ports: ['18000/http'] }])
    expect(views).toEqual([{ id: 'pod123', name: 'My GPU', status: 'RUNNING',
      endpoints: [{ port: 18000, baseUrl: 'https://pod123-18000.proxy.runpod.net' }] }])
    expect(JSON.stringify(views)).not.toContain('must-not-leak')
  })

  it('uses only an authenticated GET to the RunPod control origin and refuses redirects', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = []
    await listRunPodPods('fixture-account-key', AbortSignal.timeout(1000), async (input, init) => {
      calls.push({ url: input instanceof Request ? input.url : input.toString(), init })
      return Response.json([])
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://rest.runpod.io/v1/pods?computeType=GPU&desiredStatus=RUNNING')
    expect(calls[0]?.init).toMatchObject({ headers: { authorization: 'Bearer fixture-account-key' }, redirect: 'error' })
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET')
  })

  it('does not expose a credential-bearing error response', async () => {
    await expect(listRunPodPods('fixture-key', AbortSignal.timeout(1000), async () => new Response('secret=fixture-key', { status: 403 })))
      .rejects.toThrow('RunPod could not list Pods (HTTP 403). Check the saved account key.')
    expect(() => runPodViews({ env: 'secret' })).toThrow('invalid Pod list')
  })
})
