/**
 * Doc-sync gate for DreamVerse provider maintenance guides: every generation provider package under `packages/dv/*`
 * has `docs/cookbook/providers/<package>.md` and `.zh.md`, and its `README.md` and `README.zh.md` link them. See the
 * [provider guide](../docs/cookbook/adding-a-dreamverse-provider.md).
 *
 * A provider package is a directory under `packages/dv` whose `src` registers model entries: it calls
 * `dvModels.register(` or the `@dv/models` helper `syncModelEntries(` or `syncModelEntriesAsync(` (the
 * `PROVIDER_REGISTRATION` pattern that `dv-architecture.ts` uses to find the provider layer). The helper declarations in
 * `@dv/models` do not match the pattern. A provider that registers entries through another call is not detected, so
 * register entries through one of these two forms.
 */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PROVIDER_REGISTRATION } from './dv-architecture.ts'

const root = resolve(import.meta.dirname, '..')

/**
 * Providers that predate the maintenance-guide rule and have no guide yet. Each is a self-hosted server provider whose
 * README documents its deployment. A provider leaves this list in the change that adds its guide, and the gate rejects
 * an entry whose guide exists or whose package is no longer a provider.
 */
export const GUIDE_EXCEPTIONS: Readonly<Record<string, string>> = {
  fastvideo: 'Predates the rule; its README documents the server, limits and worker routing.',
  uniserve: 'Predates the rule; its README documents the server contract.',
  'vllm-omni': 'Predates the rule; its README documents the served models.',
  'sglang-diffusion': 'Predates the rule; its README documents the served models.',
  'sglang-omni': 'Predates the rule; its README documents the served models.',
}

/** The path of a provider's guide, relative to the repository root. */
function guidePath(provider: string, language: 'en' | 'zh'): string {
  return `docs/cookbook/providers/${provider}${language === 'zh' ? '.zh' : ''}.md`
}

/**
 * List the provider packages under a repository root.
 * @param repository - the repository root.
 * @returns the directory names under `packages/dv` whose `src` registers model entries, sorted.
 */
export function providerPackages(repository: string): string[] {
  const sources = globSync('packages/dv/*/src/**/*.ts', { cwd: repository, exclude: ['**/node_modules/**'] })
  const providers = new Set(sources
    .filter(file => PROVIDER_REGISTRATION.test(readFileSync(join(repository, file), 'utf8')))
    .map(file => file.split('/')[2] ?? ''))
  return [...providers].sort()
}

/**
 * Report the providers that lack a maintenance guide or a README link to it.
 * @param repository - the repository root.
 * @param exceptions - providers excused from the rule, keyed by package directory name.
 * @returns one diagnostic per missing guide, missing link, or stale exception.
 */
export function providerGuideErrors(repository: string, exceptions: Readonly<Record<string, string>> = GUIDE_EXCEPTIONS): string[] {
  const providers = providerPackages(repository)
  const errors: string[] = []
  for (const provider of providers) {
    const guides = (['en', 'zh'] as const).map(language => ({ language, guide: guidePath(provider, language) }))
    const missing = guides.filter(({ guide }) => !existsSync(join(repository, guide)))
    if (provider in exceptions) {
      if (missing.length === 0) errors.push(`${provider}: remove its entry from GUIDE_EXCEPTIONS; the guide exists.`)
      continue
    }
    for (const { guide } of missing) {
      errors.push(`${provider}: missing ${guide}. Every provider ships a maintenance guide (docs/cookbook/adding-a-dreamverse-provider.md).`)
    }
    for (const { language, guide } of guides) {
      const readme = `packages/dv/${provider}/README${language === 'zh' ? '.zh' : ''}.md`
      const text = existsSync(join(repository, readme)) ? readFileSync(join(repository, readme), 'utf8') : ''
      if (!text.includes(guide)) errors.push(`${readme}: link ${guide} in Further Exploration.`)
    }
  }
  for (const excused of Object.keys(exceptions)) {
    if (!providers.includes(excused)) errors.push(`${excused}: remove its entry from GUIDE_EXCEPTIONS; it is not a provider package.`)
  }
  return errors
}

if (import.meta.main) {
  const failures = providerGuideErrors(root)
  if (failures.length > 0) {
    console.error('verify-provider-maintenance-guides: violations found:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else {
    console.log(`verify-provider-maintenance-guides: ${String(providerPackages(root).length)} provider packages have a guide or a listed exception.`)
  }
}
