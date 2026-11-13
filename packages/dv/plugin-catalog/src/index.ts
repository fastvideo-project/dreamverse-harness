/**
 * The DreamVerse plugin catalog: the curated list of plugins a person can install from the 插件市场 / Marketplace page of the left navigator.
 * The list is `catalog.json` beside this package's `src/`, reviewed like code, followed by the catalogs that `sources`
 * names; the plugin answers it at `GET /api/dv/plugins/catalog` while a Connection service is mounted. Installing is the
 * plugin manager's work (`@deepseek-ai/dsh-plugin-manager`), which the browser half `@dv/ui-plugin-catalog` calls.
 *
 * @module @dv/plugin-catalog
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type { CatalogAnswer, CatalogEntry, CatalogProblem, LocalizedText } from './types.ts'

export type { CatalogAnswer, CatalogEntry, CatalogProblem, LocalizedText } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dv-plugin-catalog'

/** The route that answers the catalog. */
export const CATALOG_ROUTE = '/api/dv/plugins/catalog'

/** The catalog this package ships. */
export const SHIPPED_CATALOG = fileURLToPath(new URL('../catalog.json', import.meta.url))

/** Plugin config: catalogs to read after the shipped one. */
export interface Config {
  /**
   * Absolute paths or https URLs of further catalogs (http only on the loopback host), read on every request; an entry
   * whose package an earlier catalog lists replaces it.
   */
  sources: string[]
  /** How long one URL source may take, in milliseconds. */
  sourceTimeoutMs: number
}

export const Config: z<Config> = z.object({
  sources: z.array(z.string().min(1)).default([]),
  sourceTimeoutMs: z.natural().min(1).default(10_000),
})

/** A text field as a catalog file writes it; {@link localized} requires both languages. */
interface TextFields {
  zh?: string
  en?: string
}

interface EntryFields {
  package: string
  version: string
  title: TextFields
  description: TextFields
  setup?: TextFields
  homepage?: string
}

const Text: z<TextFields> = z.object({ zh: z.string(), en: z.string() })

const CatalogFile: z<{ plugins: EntryFields[] }> = z.object({
  plugins: z.array(z.object({
    package: z.string().required(),
    version: z.string().required(),
    title: Text.required(),
    description: Text.required(),
    setup: Text,
    homepage: z.string(),
  })).required(),
})

/**
 * One text field in both languages.
 * @param text - the field as the file writes it.
 * @param where - the entry and field, for the error.
 * @returns the text.
 * @throws {Error} when a language is missing or empty.
 */
function localized(text: TextFields, where: string): LocalizedText {
  if (text.zh === undefined || text.zh === '' || text.en === undefined || text.en === '') {
    throw new Error(`${where} needs both a zh and an en text`)
  }
  return { zh: text.zh, en: text.en }
}

/** An npm package name, scoped or not, as the registry accepts it. */
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** An exact semantic version, with an optional prerelease and build: no range, tag or `v` prefix. */
const EXACT_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** The most redirects one URL source read follows: the redirect limit of the Fetch standard, a protocol constant. */
const MAX_REDIRECTS = 20

/** Whether a source is a URL the plugin fetches: https anywhere, http only on the loopback host. */
function isUrlSource(source: string): boolean {
  if (source.startsWith('https://')) return true
  if (!source.startsWith('http://')) return false
  const { hostname } = new URL(source)
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

/**
 * Read one catalog file's text into its entries.
 * @param text - the file's text.
 * @param source - `shipped`, or the configured path or URL, recorded on each entry.
 * @returns the entries in file order.
 * @throws {Error} when the text is not JSON, misses a field, names an invalid package, gives a version that is not exact,
 * lists a package twice, or gives a homepage that is not https.
 */
export function parseCatalog(text: string, source: string): CatalogEntry[] {
  const file = CatalogFile(JSON.parse(text) as { plugins: EntryFields[] })
  const seen = new Set<string>()
  return file.plugins.map((entry) => {
    if (!PACKAGE_NAME.test(entry.package)) throw new Error(`"${entry.package}" is not an npm package name`)
    if (!EXACT_VERSION.test(entry.version)) {
      throw new Error(`the version "${entry.version}" of "${entry.package}" is not an exact version such as 1.2.0`)
    }
    if (seen.has(entry.package)) throw new Error(`"${entry.package}" is listed twice`)
    seen.add(entry.package)
    if (entry.homepage !== undefined && !entry.homepage.startsWith('https://')) {
      throw new Error(`the homepage of "${entry.package}" is not an https URL`)
    }
    const setup = entry.setup === undefined || (entry.setup.zh === undefined && entry.setup.en === undefined)
      ? undefined : localized(entry.setup, `the setup of "${entry.package}"`)
    return {
      package: entry.package,
      version: entry.version,
      title: localized(entry.title, `the title of "${entry.package}"`),
      description: localized(entry.description, `the description of "${entry.package}"`),
      ...setup === undefined ? {} : { setup },
      ...entry.homepage === undefined ? {} : { homepage: entry.homepage },
      source,
    }
  })
}

/**
 * Read a configured source's text.
 * @param source - an absolute path or a URL that {@link isUrlSource} accepts.
 * @param timeoutMs - the bound on a URL request.
 * @returns the text.
 * @throws {Error} when the file cannot be read, the request fails or times out, a redirect leads to a URL that
 * {@link isUrlSource} refuses, more than {@link MAX_REDIRECTS} redirects follow one another, or the server answers an
 * error status.
 */
async function readSource(source: string, timeoutMs: number): Promise<string> {
  if (!isUrlSource(source)) return readFile(source, 'utf8')
  const signal = AbortSignal.timeout(timeoutMs)
  let url = source
  for (let hops = 0; ; hops++) {
    const response = await fetch(url, { redirect: 'manual', signal })
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
    if (location === null) {
      if (!response.ok) throw new Error(`the server answered HTTP ${String(response.status)}`)
      return response.text()
    }
    if (hops === MAX_REDIRECTS) throw new Error(`the server redirected more than ${String(MAX_REDIRECTS)} times`)
    const next = new URL(location, url).href
    if (!isUrlSource(next)) {
      throw new Error(`the server redirected to ${next}, which is neither an https URL nor an http URL on the loopback host`)
    }
    url = next
  }
}

/**
 * Merge the shipped entries with the configured sources' entries.
 * @param shipped - the shipped catalog's entries.
 * @param config - the sources and their time bound.
 * @returns the merged list and a problem for each source that could not be used.
 */
export async function loadCatalog(shipped: readonly CatalogEntry[], config: Config): Promise<CatalogAnswer> {
  const merged = new Map(shipped.map(entry => [entry.package, entry]))
  const problems: CatalogProblem[] = []
  for (const source of config.sources) {
    try {
      for (const entry of parseCatalog(await readSource(source, config.sourceTimeoutMs), source)) merged.set(entry.package, entry)
    } catch (error) {
      problems.push({ source, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return { plugins: [...merged.values()], problems }
}

/**
 * Read the shipped catalog and register the catalog route while a Connection service is mounted.
 * @param ctx - plugin context.
 * @param config - further catalog sources.
 * @throws {Error} at load when a source is neither an absolute path nor an accepted URL, or the shipped catalog is
 * malformed.
 */
export function apply(ctx: Context, config: Config): void {
  for (const source of config.sources) {
    if (!isAbsolute(source) && !isUrlSource(source)) {
      throw new Error(`dv-plugin-catalog: source "${source}" is neither an absolute path nor an https URL`)
    }
  }
  let shipped: CatalogEntry[]
  try {
    shipped = parseCatalog(readFileSync(SHIPPED_CATALOG, 'utf8'), 'shipped')
  } catch (error) {
    throw new Error(`dv-plugin-catalog: ${SHIPPED_CATALOG} is malformed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const logger = ctx.logger('dvPluginCatalog')
  const route: ConnectionFetchRoute = {
    path: CATALOG_ROUTE, methods: ['GET'], requestBody: 'buffered',
    fetch: async () => {
      const answer = await loadCatalog(shipped, config)
      for (const problem of answer.problems) logger.warn('catalog source %s: %s', problem.source, problem.message)
      return Response.json(answer)
    },
  }
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const dispose = scope.connection.fetch.register(route)
      return () => { void dispose() }
    }, `dv-plugin-catalog ${CATALOG_ROUTE}`)
  })
}
