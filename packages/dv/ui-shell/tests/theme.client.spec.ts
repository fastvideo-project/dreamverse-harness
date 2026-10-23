// @vitest-environment jsdom
/** The DreamVerse theme stylesheet: the node palette and the waveform colors in the light and the dark theme. */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { applyTheme } from '../src/client/theme.ts'

function variablesOf(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  return Object.fromEntries([...css.slice(start, css.indexOf('}', start)).matchAll(/(--dv-[\w-]+):\s*([^;]+);/g)]
    .map(([, name = '', value = '']) => [name, value]))
}

describe('the DreamVerse theme', () => {
  it('defines the node palette and the waveform colors in both themes, names no kind, and leaves with the shell', async () => {
    const fiber = new Context().plugin({ apply: applyTheme })
    await fiber.await()
    const style = (): Element | null => document.head.querySelector('style[data-plugin="@dv/ui-shell/theme"]')
    const css = style()?.textContent ?? ''
    const palette = Array.from({ length: 8 }, (_unused, index) => `--dv-node-${String(index + 1)}`)
    const tokens = [...palette, '--dv-waveform', '--dv-waveform-soft']
    const light = variablesOf(css, 'html body')
    const dark = variablesOf(css, 'html body[data-ds-dark-theme]')
    expect([tokens.filter(name => light[name] === undefined), tokens.filter(name => dark[name] === undefined)]).toEqual([[], []])
    expect(new Set(palette.map(name => light[name])).size).toBe(8)
    expect(new Set(palette.map(name => dark[name])).size).toBe(8)
    expect(css).not.toContain('--dv-kind-')
    const kept = ['--dv-node-1', '--dv-node-2', '--dv-node-3', '--dv-waveform', '--dv-waveform-soft']
    expect(kept.map(name => light[name])).toEqual(['#DB2777', '#EA580C', '#0D9488', 'rgba(77,124,15,0.7)', 'rgba(101,163,13,0.10)'])
    expect(kept.map(name => dark[name])).toEqual(['#F472B6', '#FB923C', '#2DD4BF', 'rgba(163,230,53,0.75)', 'rgba(163,230,53,0.10)'])
    await fiber.dispose()
    expect(style()).toBeNull()
  })
})
