/**
 * Settings panel stylesheet contract, asserted against the CSS text on disk:
 * the lane has no CSS module resolution, so computed styles are not observable.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SettingsRoot.module.css', import.meta.url)), 'utf8')

/** The declarations of one top-level rule, by selector. */
function block(selector: string): string {
  const match = new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(css)
  if (match === null) throw new Error(`SettingsRoot.module.css has no \`${selector}\` rule`)
  return match[1] ?? ''
}

describe('Settings panel styles', () => {
  it('fills the viewport without a modal mask layer', () => {
    const panel = block('.panel')
    expect(panel).toContain('position: fixed')
    expect(panel).toContain('inset: 0')
    expect(css).not.toMatch(/^\.(overlay|mask) \{/m)
  })

  it('keeps the frame top clearance as the panel top margin', () => {
    expect(block('.panel')).toContain('padding-block-start: max(8px, var(--dsh-frame-top-clearance, 8px))')
    expect(css).toMatch(/@media \(max-width: 640px\) \{[^@]*\.panel \{[^}]*padding-block-start: var\(--dsh-frame-top-clearance, 0px\)/)
  })
})
