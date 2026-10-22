/**
 * The DSH client rules that the composer and the editor seams keep: components read no React context, the composer's
 * components reach no ctx and no API client, and `@dv/ui-composer/contract` holds types only.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as contract from '../src/client/contract/index.ts'
import * as entry from '../src/client/index.ts'

const packages = resolve(import.meta.dirname, '../../..')

/** The `.tsx` files of a directory, with their text. */
function components(dir: string): Array<[string, string]> {
  const root = join(packages, dir)
  return readdirSync(root).filter(name => name.endsWith('.tsx')).map(name => [`${dir}/${name}`, readFileSync(join(root, name), 'utf8')])
}

const EDITOR = components('client/ui-conversation/src/client/input/editor')
const COMPOSER = components('dv/ui-composer/src/client')

describe('DSH client rules', () => {
  it('reads no React context in the chip portals, the prompt editor, the composer or the chip face', () => {
    const files = [...EDITOR, ...components('client/ui-conversation/src/client/skeleton').filter(([path]) => path.endsWith('PromptEditor.tsx')), ...COMPOSER]
    expect(files.map(([path]) => path)).toEqual(expect.arrayContaining([
      'client/ui-conversation/src/client/input/editor/DecoratorPortals.tsx', 'dv/ui-composer/src/client/DvPrompt.tsx',
      'dv/ui-composer/src/client/ReferenceFace.tsx',
    ]))
    expect(files.filter(([, text]) => /\buseContext\b|createContext\(/u.test(text)).map(([path]) => path)).toEqual([])
  })

  it('imports no cordis value and no API client in the composer\'s components', () => {
    const cordisValue = /^import \{[^}]*\} from '@deepseek-ai\/cordis'/mu
    const reaching = COMPOSER.filter(([, text]) => cordisValue.test(text) || /\bDvClient\b/u.test(text) || /\bctx\./u.test(text))
    expect(reaching.map(([path]) => path)).toEqual([])
  })

  it('exports no value from @dv/ui-composer/contract and no new value from the client entry', () => {
    expect(Object.keys(contract)).toEqual([])
    expect(Object.keys(entry).sort()).toEqual(['MENTION_SOURCE', 'apply', 'inject', 'projectItems', 'referenceText', 'uriOf'])
  })
})
