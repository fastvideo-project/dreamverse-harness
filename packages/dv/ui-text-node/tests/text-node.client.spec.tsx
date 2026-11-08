// @vitest-environment jsdom
/**
 * The text node UI on the real canvas: its card, its edges, its editor's read mode with citation chips, and its save
 * through `textnode.write`, over the scripted `/api/dv` server of the canvas tests. The server keeps the versions of each
 * path and refuses a write whose `base_version` is not the newest version, as `@dv/text-node` refuses it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { TextPath, TextVersion } from '@dv/text-node/types'
import { projectMentionSource } from '@dv/ui-composer/mention'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { createRegistry, type MentionKind } from '@dv/ui-kit/registries.ts'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { asset, record } from '../../ui-kit/tests/fixture.client.tsx'
import { forgetCanvasStorage, mountCanvas, type CanvasServer } from '../../ui-canvas/tests/canvas-runtime.client.tsx'
import { apply, inject } from '../src/client/index.ts'

usePinnedBrowserLanguages('en-US')

beforeEach(() => {
  // jsdom gives a Range no layout; the editor measures the caret's range to scroll it into view after a paste.
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  // jsdom has no layout; the `@` menu scrolls its highlighted row into view.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  publishCurrentProject(null)
  vi.unstubAllGlobals()
  forgetCanvasStorage()
})

const PATH = 'beats.md' as TextPath
const V1 = '# Beats\n\nThe detective wakes up.'
const V2 = '# Beats\n\n@[Hero](dv:test_ref/hero) opens the door.\n\nRain falls on the city.'
const SCRIPT = 'INT. OFFICE - NIGHT'

/** One version written by record `<prefix><version>` into asset `<prefix>-v<version>.md`. */
function version(prefix: string, number: number, body: string): TextVersion {
  return {
    version: number, title: body.split('\n')[0]?.slice(2) ?? '', body,
    asset: `${prefix}-v${String(number)}.md` as TextVersion['asset'], created_by: `${prefix}${String(number)}` as TextVersion['created_by'],
  }
}

/** The record prefix of each path's versions. */
const PREFIX: Record<string, string> = { [PATH]: 'tw', 'script.md': 'sc' }

/**
 * Mount the canvas with the reference noun, the media plugins, the composer stack and the text node plugin, over a
 * server whose `beats.md` holds v1 and v2 and whose `script.md` v1 was built from `beats.md` v2. An accepted
 * `textnode.write` appends the next version of its path and announces the change; a body that contains `FAIL` gives a
 * failed record, and a body that contains `REFUSE` is refused. The asset pool serves each version's Markdown.
 * @returns the mounted canvas and the versions of each path that the server holds.
 */
async function mountTexts() {
  const texts: Record<string, TextVersion[]> = { [PATH]: [version('tw', 1, V1), version('tw', 2, V2)], 'script.md': [version('sc', 1, SCRIPT)] }
  const all = (): TextVersion[] => Object.values(texts).flat()
  let server: CanvasServer | null = null
  const mounted = await mountCanvas({
    kinds: ['reference', 'media', 'assets', 'composer'],
    edit: (state) => {
      for (const [path, versions] of Object.entries(texts)) {
        versions.forEach((each, index) => {
          state.assets.push(asset(each.asset, 'text/markdown', each.created_by))
          state.components.proj.records.push(record({
            id: each.created_by, operation: 'textnode.write', params: { path }, outputs: [each.asset],
            based_on: index === 0 ? null : versions[index - 1]?.created_by ?? null,
            inputs: path === 'script.md' && index === 0 ? [{ role: 'source', ref: { record: 'tw2', output: 0 }, resolved_asset: 'tw-v2.md' }] : [],
            report: { path, version: each.version, title: each.title, chars: Array.from(each.body).length },
          }))
        })
      }
      state.components.textnode = { texts: Object.fromEntries(Object.entries(texts).map(([path, versions]) => [path, [...versions]])) }
    },
    refuse: (path, body) => {
      const request = body as { operation?: string; params?: { path: string; body: string; base_version: number } }
      if (path !== '/api/dv/operation' || request.operation !== 'textnode.write' || request.params === undefined) return null
      if (request.params.body.includes('REFUSE')) return 'Text node script.md is too long.'
      if (request.params.body.includes('FAIL')) return null
      const versions = texts[request.params.path] ?? []
      const newest = versions.length
      if (request.params.base_version !== newest) {
        return `Text node ${request.params.path} is at version ${String(newest)}, not base_version ${String(request.params.base_version)}: it changed since you read it.`
      }
      versions.push(version(PREFIX[request.params.path] ?? 'x', newest + 1, request.params.body))
      queueMicrotask(() => { server?.notify() })
      return null
    },
    beforeCanvas: async (runtime) => {
      const served = globalThis.fetch
      vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
        const found = all().find(each => input === assetUrl(each.asset))
        if (found !== undefined) return Promise.resolve(new Response(found.body))
        if (input.endsWith('/api/dv/operation') && typeof init?.body === 'string' && init.body.includes('FAIL')) {
          const failed = record({ id: 'f1', operation: 'textnode.write', status: 'failed', error: { code: 'operation_failed', message: 'The disk is full.' } })
          return Promise.resolve(new Response(JSON.stringify(failed), { headers: { 'content-type': 'application/json' } }))
        }
        return served(input, init)
      })
      // The `@` source and its mention kinds, which the bundle's `@dv/ui-composer` provides.
      const mentions = { kinds: createRegistry<MentionKind>(kind => [kind.id], kind => kind.id) }
      runtime.ctx.provide('dvMentions', mentions)
      runtime.ctx.effect(() => runtime.ctx.inputTriggers.registerSource(projectMentionSource(mentions, () => [])))
      await runtime.mount({ inject: [...inject], apply })
      // A chip outside a `dv.prompt` call reads the state of the project the shell has open.
      publishCurrentProject('p1')
    },
  })
  server = mounted.server
  return { ...mounted, texts }
}

/** @returns the text node writes that the server received, with their params, inputs and `based_on`. */
function textWrites(server: CanvasServer): unknown[] {
  return server.writes.flatMap((write) => {
    const body = write.body as { operation?: string; params?: unknown; inputs?: unknown; based_on?: unknown }
    return write.path === '/api/dv/operation' && body.operation === 'textnode.write' ? [{ params: body.params, inputs: body.inputs, based_on: body.based_on }] : []
  })
}

/** The editor box of the `conversation.prompt` occurrence in an element. */
const box = (element: HTMLElement): HTMLElement => {
  const found = element.querySelector<HTMLElement>('[data-composer-input]')
  if (found === null) throw new Error('no editor box')
  return found
}

describe('text node', () => {
  it('draws one card per version with its title, version, and opening lines with each citation as its label', async () => {
    const { node } = await mountTexts()
    const card = await waitFor(() => node('tw2'))
    expect(card.textContent).toContain('Beats')
    await waitFor(() => { expect(within(card).getByTestId('dv-text-excerpt').textContent).toContain('Hero opens the door.') })
    expect(within(card).getByTestId('dv-text-excerpt').textContent).not.toContain('@')
    expect(card.textContent).toContain(`v2 · ${String(Array.from(V2).length)} chars`)
    expect(node('tw1').textContent).toContain('v1 · ')
    // The default frame is 208 × 106: four opening lines with their padding, and the footer.
    expect([node('tw2').style.width, card.querySelector<HTMLElement>('[data-node-frame]')?.style.height]).toEqual(['208px', '106px'])
  })

  it('draws an edge from a source version to the text built from it, and a lineage edge between versions', async () => {
    const { view } = await mountTexts()
    await waitFor(() => { expect(view.container.querySelector('path[data-edge="tw2>sc1"]')).not.toBeNull() })
    expect(view.container.querySelector('path[data-edge="tw1>tw2"]')).not.toBeNull()
  })

  it('reads the Markdown in the editor and draws a citation as a chip with the cited item\'s picture', async () => {
    const { open } = await mountTexts()
    const editor = await open('tw2')
    const markdown = within(editor).getByTestId('dv-text-markdown')
    const chip = await waitFor(() => {
      const found = markdown.querySelector('[data-dv-chip="dv:test_ref/hero"]')
      if (found === null) throw new Error('no chip')
      return found
    })
    expect(chip.textContent).toBe('Hero')
    await waitFor(() => { expect(chip.querySelector('img')?.getAttribute('src')).toBe(assetUrl('ref.png')) })
    expect(markdown.textContent).toContain('Rain falls on the city.')
  })

  it('renders the Markdown in read mode, with a heading as a heading and no citation source', async () => {
    const { open } = await mountTexts()
    const editor = await open('tw2')
    const markdown = within(editor).getByTestId('dv-text-markdown')
    await waitFor(() => { expect(markdown.querySelector('[data-dv-chip="dv:test_ref/hero"]')).not.toBeNull() })
    expect(markdown.querySelector('h1')?.textContent).toBe('Beats')
    expect([...markdown.querySelectorAll('p')].map(paragraph => paragraph.textContent)).toEqual(['Hero opens the door.', 'Rain falls on the city.'])
    expect(markdown.textContent).not.toContain('#')
    expect(markdown.textContent).not.toContain('dv:')
  })

  it('opens the @ menu below the editor, inside the scrolling editor body', async () => {
    const { open } = await mountTexts()
    const editor = await open('tw2')
    await waitFor(() => { expect(within(editor).getByRole<HTMLButtonElement>('button', { name: 'Edit' }).disabled).toBe(false) })
    fireEvent.click(within(editor).getByRole('button', { name: 'Edit' }))
    await waitFor(() => { expect(box(editor).getAttribute('contenteditable')).toBe('true') })
    act(() => { box(editor).focus() })
    // jsdom fires no beforeinput, so the text arrives through the editor's paste path, which `@` detection follows.
    fireEvent.paste(box(editor), { clipboardData: { items: [], getData: (type: string) => type === 'text/plain' ? ' @' : '' } })
    const menu = await waitFor(() => {
      const found = editor.querySelector<HTMLElement>('[data-trigger-menu]')
      if (found === null) throw new Error('no menu')
      return found
    })
    expect([getComputedStyle(menu).top, getComputedStyle(menu).bottom]).toEqual(['calc(100% + 4px)', 'auto'])
  })

  it('offers no edit on an older version and opens the newest one instead', async () => {
    const { open } = await mountTexts()
    const editor = await open('tw1')
    expect(within(editor).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(editor).getByRole('button', { name: 'Open version 2' })).toBeTruthy()
  })

  /**
   * Open the editor of a node, enter edit mode, and append text to the draft.
   * @returns the editor.
   */
  async function draft(open: (id: string) => Promise<HTMLElement>, id: string, text: string): Promise<HTMLElement> {
    const editor = await open(id)
    await waitFor(() => { expect(within(editor).getByRole<HTMLButtonElement>('button', { name: 'Edit' }).disabled).toBe(false) })
    fireEvent.click(within(editor).getByRole('button', { name: 'Edit' }))
    await waitFor(() => { expect(box(editor).getAttribute('contenteditable')).toBe('true') })
    act(() => { box(editor).focus() })
    fireEvent.paste(box(editor), { clipboardData: { items: [], getData: (type: string) => type === 'text/plain' ? text : '' } })
    await waitFor(() => { expect(box(editor).textContent).toContain(text.trim()) })
    return editor
  }

  type Write = { params: { path: string; body: string; base_version: number }; inputs: unknown; based_on: unknown }

  it('saves the draft as the next version with the version it started from, its sources at their newest versions and its lineage', async () => {
    const { open, server, texts, node } = await mountTexts()
    texts[PATH]?.push(version('tw', 3, '# Beats\n\nThe agent rewrote this.'))
    server.notify()
    await waitFor(() => node('tw3'))
    const editor = await draft(open, 'sc1', ' EXT.')
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(textWrites(server)).toHaveLength(1) })
    const [write] = textWrites(server) as Write[]
    expect(write?.params).toMatchObject({ path: 'script.md', base_version: 1 })
    expect(write?.params.body).toContain(' EXT.')
    expect(write?.inputs).toEqual([{ role: 'source', ref: 'tw3#0' }])
    expect(write?.based_on).toBe('sc1')
    await waitFor(() => { expect(editor.isConnected).toBe(false) })
    await waitFor(() => { expect(node('sc2').textContent).toContain('v2 · ') })
  })

  it('names the newest version and the draft\'s version when a newer version arrives, and saves the draft on top of it', async () => {
    const { open, server, texts, node } = await mountTexts()
    const editor = await draft(open, 'tw2', ' Mine.')
    texts[PATH]?.push(version('tw', 3, '# Beats\n\nThe agent rewrote this.'))
    server.notify()
    await waitFor(() => { expect(within(editor).getByRole('alert').textContent).toBe('Someone saved version 3 first. Your draft is based on version 2.') })
    expect(box(editor).textContent).toContain('Mine.')
    fireEvent.click(within(editor).getByRole('button', { name: 'Save on top of v3' }))
    await waitFor(() => { expect(editor.isConnected).toBe(false) })
    expect(textWrites(server).map(write => (write as Write).params.base_version)).toEqual([3])
    await waitFor(() => { expect(node('tw4').textContent).toContain('v4 · ') })
  })

  it.each([
    ['refused', ' REFUSE', 'Text node script.md is too long.'],
    ['failed', ' FAIL', 'The disk is full.'],
  ])('shows the error of a %s save and keeps the draft open', async (_case, text, message) => {
    const { open } = await mountTexts()
    const editor = await draft(open, 'sc1', text)
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(within(editor).getByRole('alert').textContent).toBe(message) })
    expect(editor.isConnected).toBe(true)
    expect(box(editor).getAttribute('contenteditable')).toBe('true')
    expect(box(editor).textContent).toContain(text.trim())
  })
})
