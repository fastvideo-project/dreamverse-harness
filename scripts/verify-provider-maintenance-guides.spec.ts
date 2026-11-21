/** The provider maintenance guide gate against synthetic repositories and the real one. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GUIDE_EXCEPTIONS, providerGuideErrors, providerPackages } from './verify-provider-maintenance-guides.ts'

const roots: string[] = []

/** Write files into a fresh repository root, keyed by repository-relative path. */
function repository(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'provider-guides-'))
  roots.push(dir)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

const REGISTERS = 'ctx.effect(() => ctx.dvModels.register(entry), "models")\n'
const SYNCS = "syncModelEntries(ctx, { label: 'models' })\n"
const guideLinks = (name: string, suffix = ''): string => `[Maintain](../../../docs/cookbook/providers/${name}${suffix}.md)\n`

/** A complete provider `acme`: registration, both guides and both README links. */
const complete = (): Record<string, string> => ({
  'packages/dv/acme/src/index.ts': REGISTERS,
  'docs/cookbook/providers/acme.md': '# Acme\n',
  'docs/cookbook/providers/acme.zh.md': '# Acme\n',
  'packages/dv/acme/README.md': guideLinks('acme'),
  'packages/dv/acme/README.zh.md': guideLinks('acme', '.zh'),
})

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('provider maintenance guide gate', () => {
  it('detects providers by their registration calls and ignores the helper declarations and other packages', () => {
    const dir = repository({
      'packages/dv/direct/src/index.ts': REGISTERS,
      'packages/dv/helper/src/nested/index.ts': SYNCS,
      'packages/dv/async/src/index.ts': 'syncModelEntriesAsync(ctx, {})\n',
      'packages/dv/models/src/sync.ts': 'export function syncModelEntries(ctx) {}\nexport function syncModelEntriesAsync(ctx) {}\n',
      'packages/dv/other/src/index.ts': 'export const name = "other"\n',
    })
    expect(providerPackages(dir)).toEqual(['async', 'direct', 'helper'])
  })

  it('accepts a provider with both guides linked from both READMEs', () => {
    expect(providerGuideErrors(repository(complete()), {})).toEqual([])
  })

  it('rejects a provider without guides', () => {
    const files = complete()
    delete files['docs/cookbook/providers/acme.md']
    delete files['docs/cookbook/providers/acme.zh.md']
    expect(providerGuideErrors(repository(files), {})).toEqual([
      expect.stringContaining('acme: missing docs/cookbook/providers/acme.md.'),
      expect.stringContaining('acme: missing docs/cookbook/providers/acme.zh.md.'),
    ])
  })

  it('rejects a README that does not link its guide, and a README that is absent', () => {
    const files = complete()
    files['packages/dv/acme/README.md'] = 'No link.\n'
    delete files['packages/dv/acme/README.zh.md']
    expect(providerGuideErrors(repository(files), {})).toEqual([
      'packages/dv/acme/README.md: link docs/cookbook/providers/acme.md in Further Exploration.',
      'packages/dv/acme/README.zh.md: link docs/cookbook/providers/acme.zh.md in Further Exploration.',
    ])
  })

  it('excuses a listed provider without a guide', () => {
    const files = Object.fromEntries(Object.entries(complete()).filter(([path]) => path.startsWith('packages/dv/acme/src')))
    expect(providerGuideErrors(repository(files), { acme: 'Predates the rule.' })).toEqual([])
  })

  it('rejects a listed provider that has a guide and a listed package that is not a provider', () => {
    expect(providerGuideErrors(repository(complete()), { acme: 'Predates the rule.', ghost: 'Never existed.' })).toEqual([
      'acme: remove its entry from GUIDE_EXCEPTIONS; the guide exists.',
      'ghost: remove its entry from GUIDE_EXCEPTIONS; it is not a provider package.',
    ])
  })

  it('lists only providers with a stated reason', () => {
    expect(Object.keys(GUIDE_EXCEPTIONS).sort()).toEqual(['fastvideo', 'sglang-diffusion', 'sglang-omni', 'uniserve', 'vllm-omni'])
    expect(Object.values(GUIDE_EXCEPTIONS).every(reason => reason.length > 0)).toBe(true)
  })

  it('accepts the repository once every provider has a guide or an exception', () => {
    expect(providerGuideErrors(join(import.meta.dirname, '..'))).toEqual([])
  })
})
