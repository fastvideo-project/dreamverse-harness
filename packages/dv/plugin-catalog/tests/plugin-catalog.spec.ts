/**
 * The plugin catalog: the shipped catalog file, its validation, extra sources merged after it with their failures reported,
 * and the catalog route registered while a Connection service is mounted and removed when the plugin unloads.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type OutgoingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Catalog from '../src/index.ts'
import type { CatalogAnswer } from '../src/types.ts'

/** A Connection service that keeps the registered Fetch routes. */
class FakeConnection {
  readonly routes = new Map<string, ConnectionFetchRoute>()
  readonly fetch = {
    register: (route: ConnectionFetchRoute): (() => Promise<void>) => {
      this.routes.set(route.path, route)
      return () => { this.routes.delete(route.path); return Promise.resolve() }
    },
  }
}

const entry = (pkg: string, en: string) => ({ package: pkg, version: '1.0.0', title: { zh: en, en }, description: { zh: en, en } })

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** @returns a temporary directory removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dv-plugin-catalog-'))
  cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
  return dir
}

/**
 * Serve one response on the loopback host.
 * @param status - the response status.
 * @param body - the response body.
 * @param headers - the response headers.
 * @returns the URL.
 */
async function serve(status: number, body: string, headers: OutgoingHttpHeaders = {}): Promise<string> {
  const server: Server = createServer((_request, response) => { response.writeHead(status, headers).end(body) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  cleanups.push(() => new Promise<void>((resolve) => { server.close(() => { resolve() }) }))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/catalog.json`
}

describe('the shipped catalog', () => {
  it('is valid and lists voice acting and Blender under @fastvideo at exact versions', () => {
    const plugins = Catalog.parseCatalog(readFileSync(Catalog.SHIPPED_CATALOG, 'utf8'), 'shipped')
    expect(plugins.map(plugin => [plugin.package, plugin.version])).toEqual([
      ['@fastvideo/dreamverse-voice-acting', '0.1.0'], ['@fastvideo/dreamverse-blender', '0.1.0'],
    ])
  })
})

describe('parseCatalog', () => {
  it('keeps the fields and records the source', () => {
    const text = JSON.stringify({ plugins: [{ ...entry('@fastvideo/a', 'A'), setup: { zh: '要', en: 'Needs' }, homepage: 'https://example.com/a' }] })
    expect(Catalog.parseCatalog(text, '/catalogs/x.json')).toEqual([{
      package: '@fastvideo/a', version: '1.0.0', title: { zh: 'A', en: 'A' }, description: { zh: 'A', en: 'A' },
      setup: { zh: '要', en: 'Needs' }, homepage: 'https://example.com/a', source: '/catalogs/x.json',
    }])
  })

  it.each([
    ['not JSON', '{', /JSON/],
    ['a missing title', JSON.stringify({ plugins: [{ package: 'a', version: '1.0.0', description: { zh: 'a', en: 'a' } }] }), /title/],
    ['a title in one language', JSON.stringify({ plugins: [{ ...entry('a', 'x'), title: { en: 'x' } }] }), /needs both a zh and an en text/],
    ['an invalid package name', JSON.stringify({ plugins: [entry('Not A Name', 'x')] }), /not an npm package name/],
    ['a missing version', JSON.stringify({ plugins: [{ package: 'a', title: { zh: 'a', en: 'a' }, description: { zh: 'a', en: 'a' } }] }), /version/],
    ['a version range', JSON.stringify({ plugins: [{ ...entry('a', 'x'), version: '^1.0.0' }] }), /not an exact version/],
    ['a dist-tag as the version', JSON.stringify({ plugins: [{ ...entry('a', 'x'), version: 'latest' }] }), /not an exact version/],
    ['a package listed twice', JSON.stringify({ plugins: [entry('a', 'x'), entry('a', 'y')] }), /listed twice/],
    ['a homepage that is not https', JSON.stringify({ plugins: [{ ...entry('a', 'x'), homepage: 'http://example.com' }] }), /not an https URL/],
  ])('refuses %s', (_case, text, error) => {
    expect(() => Catalog.parseCatalog(text, 'shipped')).toThrow(error)
  })
})

describe('loadCatalog', () => {
  it('merges sources after the shipped entries, a later source replacing an earlier entry, and reports failing sources', async () => {
    const dir = tempDir()
    const file = join(dir, 'extra.json')
    writeFileSync(file, JSON.stringify({ plugins: [entry('@fastvideo/a', 'A again'), entry('@fastvideo/c', 'C')] }))
    const url = await serve(200, JSON.stringify({ plugins: [entry('@fastvideo/d', 'D')] }))
    const broken = await serve(500, 'no')
    const shipped = [{ ...entry('@fastvideo/a', 'A'), source: 'shipped' }, { ...entry('@fastvideo/b', 'B'), source: 'shipped' }]
    const answer = await Catalog.loadCatalog(shipped, {
      sources: [file, url, broken, join(dir, 'missing.json')], sourceTimeoutMs: 5000,
    })
    expect(answer.plugins.map(plugin => [plugin.package, plugin.title.en, plugin.source])).toEqual([
      ['@fastvideo/a', 'A again', file], ['@fastvideo/b', 'B', 'shipped'], ['@fastvideo/c', 'C', file], ['@fastvideo/d', 'D', url],
    ])
    expect(answer.problems.map(problem => problem.source)).toEqual([broken, join(dir, 'missing.json')])
    expect(answer.problems[0]?.message).toBe('the server answered HTTP 500')
  })

  it('follows a redirect to another loopback http URL and merges its entries', async () => {
    const target = await serve(200, JSON.stringify({ plugins: [entry('@fastvideo/e', 'E')] }))
    const source = await serve(302, '', { location: target })
    const answer = await Catalog.loadCatalog([], { sources: [source], sourceTimeoutMs: 5000 })
    expect(answer.plugins.map(plugin => [plugin.package, plugin.source])).toEqual([['@fastvideo/e', source]])
    expect(answer.problems).toEqual([])
  })

  it('reports a URL source whose redirects exceed the hop limit', async () => {
    const source = await serve(302, '', { location: '/catalog.json' })
    const answer = await Catalog.loadCatalog([], { sources: [source], sourceTimeoutMs: 5000 })
    expect(answer.problems).toEqual([{ source, message: 'the server redirected more than 20 times' }])
  })

  it('reports a URL source that redirects to a non-loopback http URL and merges nothing from it', async () => {
    const source = await serve(302, '', { location: 'http://127.0.0.2/catalog.json' })
    const answer = await Catalog.loadCatalog([], { sources: [source], sourceTimeoutMs: 5000 })
    expect(answer.plugins).toEqual([])
    expect(answer.problems).toEqual([{
      source,
      message: 'the server redirected to http://127.0.0.2/catalog.json, which this source may not redirect to',
    }])
  })

  it('reports an https URL source that redirects to a loopback http URL and does not request that URL', async () => {
    const target = await serve(200, JSON.stringify({ plugins: [entry('@fastvideo/f', 'F')] }))
    const source = 'https://catalog.example/catalog.json'
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 302, headers: { location: target } }))
    cleanups.push(() => { fetch.mockRestore() })
    const answer = await Catalog.loadCatalog([], { sources: [source], sourceTimeoutMs: 5000 })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([source])
    expect(answer.plugins).toEqual([])
    expect(answer.problems).toEqual([{ source, message: `the server redirected to ${target}, which this source may not redirect to` }])
  })
})

describe('the plugin', () => {
  it('answers the catalog route while Connection is mounted, and removes it when unloaded', async () => {
    const ctx = new Context()
    cleanups.push(() => ctx.root.fiber.dispose())
    const connection = new FakeConnection()
    ctx.provide('connection', connection)
    const dir = tempDir()
    const extra = join(dir, 'extra.json')
    writeFileSync(extra, JSON.stringify({ plugins: [entry('@fastvideo/extra', 'Extra')] }))
    const plugin = ctx.plugin(Catalog, { sources: [extra], sourceTimeoutMs: 5000 })
    await plugin
    const route = connection.routes.get(Catalog.CATALOG_ROUTE)
    expect(route?.methods).toEqual(['GET'])
    const answer = await (await (route as ConnectionFetchRoute).fetch(new Request(`http://host${Catalog.CATALOG_ROUTE}`))).json() as CatalogAnswer
    expect(answer.plugins.map(plugin => plugin.package)).toEqual(['@fastvideo/dreamverse-voice-acting', '@fastvideo/dreamverse-blender', '@fastvideo/extra'])
    expect(answer.problems).toEqual([])
    await plugin.dispose()
    expect(connection.routes.has(Catalog.CATALOG_ROUTE)).toBe(false)
  })

  it('fails at load for a source that is neither an absolute path, an https URL, nor a loopback http URL', () => {
    const ctx = new Context()
    cleanups.push(() => ctx.root.fiber.dispose())
    expect(() => { Catalog.apply(ctx, { sources: ['relative/catalog.json'], sourceTimeoutMs: 1000 }) })
      .toThrow('dv-plugin-catalog: source "relative/catalog.json" is neither an absolute path nor an https URL')
  })
})
