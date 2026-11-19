/**
 * Codex page stylesheet: a theme variable the sheet does not declare fails
 * silently in the browser, so the names are checked against the theme files.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/CodexSignIn.module.css', import.meta.url)), 'utf8')
const tokens = readdirSync(fileURLToPath(new URL('../../../client/ui-theme/src/styles/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(fileURLToPath(new URL(`../../../client/ui-theme/src/styles/${name}`, import.meta.url)), 'utf8'))
  .join('\n')

describe('Codex sign-in styles', () => {
  it('names only theme variables the token sheets define', () => {
    const named = [...css.matchAll(/var\((--(?:dsw|dsh|ds)-[a-z0-9-]+)/g)].map(match => match[1])
    const undeclared = [...new Set(named)].filter(name => name !== undefined && !tokens.includes(`  ${name}:`))
    expect(undeclared).toEqual([])
  })

  it('closes every block', () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect((bare.match(/\}/g) ?? []).length).toBe((bare.match(/\{/g) ?? []).length)
  })
})
