// @vitest-environment jsdom
/**
 * The `@` source: the items of the registered mention kinds, then the assets of every media type with the icons of the
 * registered media types, the `dvMentions` registry that the plugin provides, and the chip serialization when a message
 * is sent (an asset chip places the asset on the canvas).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context } from '@deepseek-ai/cordis'
import type { InputTriggerCandidate, InputTriggerSource, PromptSourceFace } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { createRegistry, type MentionKind } from '@dv/ui-kit/registries.ts'
import { MEDIA_TYPES as MEDIA_ENTRIES } from '../../ui-asset-pool/src/client/media.tsx'

const MEDIA_TYPES = MEDIA_ENTRIES.map(entry => entry.type)
import { asset, fixtureState, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { apply, inject } from '../src/client/index.ts'
import { formatCitation } from '@dv/project/grammar'
import { MENTION_SOURCE, projectItems, projectMentionSource } from '../src/client/mention.ts'

afterEach(() => { vi.unstubAllGlobals(); publishCurrentProject(null); document.documentElement.lang = '' })

/** A test kind at order 2: an item whose thumb is the fixture's video `shot1.mp4`, and an item without a thumb. */
const props: MentionKind = {
  id: 'test-props', kind: 'test_prop', order: 2, section: () => 'Props',
  items: () => [{ uri: 'dv:test_prop/p1', label: 'Umbrella', description: 'red', thumb: 'shot1.mp4' }, { uri: 'dv:test_prop/p2', label: 'Hat' }],
}
/** A test kind at order 1 whose item's thumb is the fixture's image `ref.png`. */
const marks: MentionKind = {
  id: 'test-marks', kind: 'test_mark', order: 1, section: () => 'Marks', items: () => [{ uri: 'dv:test_mark/m1', label: 'X', thumb: 'ref.png' }],
}

/** @returns the markup of an item's icon, or null for an item without one. */
function iconOf(item: { icon?: ComponentType }): string | null {
  return item.icon === undefined ? null : renderToStaticMarkup(createElement(item.icon))
}

describe('projectItems', () => {
  it('lists the items of each mention kind by order under its section, then the assets of every media type', () => {
    document.documentElement.lang = 'zh-CN'
    const state = fixtureState()
    state.assets.push(asset('score.wav', 'audio/wav', null), asset('brief.pdf', 'application/pdf', null))
    const items = projectItems(state, [props, marks], MEDIA_TYPES)
    expect(items.map(item => [item.uri, item.section])).toEqual([
      ['dv:test_mark/m1', 'Marks'], ['dv:test_prop/p1', 'Props'], ['dv:test_prop/p2', 'Props'],
      ...['brief.pdf', 'score.wav', 'export-last.png', 'export.mp4', 'shot2-last.png', 'shot2.mp4', 'shot1-last.png', 'shot1.mp4', 'ref.png']
        .map(id => [`dv:asset/${id}`, '素材']),
    ])
    const [mark, umbrella, hat] = items.slice(0, 3)
    expect([umbrella?.label, umbrella?.description, hat?.description]).toEqual(['Umbrella', 'red', undefined])
    const icons = Object.fromEntries(items.map(item => [item.uri, iconOf(item)]))
    expect(icons['dv:asset/ref.png']).toMatch(new RegExp(`^<img src="${assetUrl('ref.png')}" alt=""`))
    expect(icons['dv:asset/shot1.mp4']).toMatch(new RegExp(`^<img src="${assetUrl('shot1-last.png')}" alt=""`))
    const glyphs = ['dv:asset/score.wav', 'dv:asset/export.mp4', 'dv:asset/brief.pdf'].map(uri => icons[uri] ?? '')
    expect(glyphs.map(markup => markup.startsWith('<svg'))).toEqual([true, true, true])
    expect(new Set(glyphs).size).toBe(3)
    expect(iconOf(umbrella ?? {})).toBe(icons['dv:asset/shot1.mp4'])
    expect(iconOf(mark ?? {})).toContain(`<img src="${assetUrl('ref.png')}"`)
    expect(iconOf(hat ?? {})).toBeNull()
  })

  it('draws a file glyph for every asset while no media type is registered', () => {
    const items = projectItems(fixtureState(), [], [])
    expect(new Set(items.map(iconOf)).size).toBe(1)
    expect(iconOf(items[0] ?? {})).toContain('<svg')
  })

  it('draws the file glyph for a thumb that names an asset the state does not hold', () => {
    const lost: MentionKind = { ...marks, items: () => [{ uri: 'dv:test_mark/m2', label: 'Y', thumb: 'gone.png' }] }
    const state = fixtureState()
    state.assets.push(asset('brief.pdf', 'application/pdf', null))
    const items = projectItems(state, [lost], MEDIA_TYPES)
    const pdf = items.find(item => item.uri === 'dv:asset/brief.pdf')
    expect(iconOf(items[0] ?? {})).toBe(iconOf(pdf ?? {}))
  })

  it('lists no clip and no reference noun item without a registered kind', () => {
    expect(projectItems(fixtureState(), [], MEDIA_TYPES).some(item => item.uri.startsWith('dv:clip/') || item.uri.startsWith('dv:character/'))).toBe(false)
  })
})

describe('ui-composer apply', () => {
  it('provides dvMentions and dvComposer, whose mention kinds reach the @ source until their disposal, and removes both with the plugin', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    publishCurrentProject('p1')
    const ctx = new Context()
    const sources: InputTriggerSource[] = []
    ctx.provide('inputTriggers', {
      registerSource: (source: InputTriggerSource) => {
        sources.push(source)
        return () => { sources.splice(sources.indexOf(source), 1) }
      },
    } as never)
    ctx.provide('sessions', {} as never)
    ctx.provide('slots', { inject: () => () => undefined, register: () => () => undefined, registerFactory: () => () => undefined } as never)
    ctx.provide('sidebarRight', {} as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const names = async (): Promise<string[]> => {
      const candidates = await sources[0]?.candidates({} as never, { query: 'umbrella', signal: new AbortController().signal } as never)
      return (candidates ?? []).map(candidate => candidate.name)
    }
    const dispose = ctx.dvMentions.kinds.register(props)
    expect(ctx.dvMentions.kinds.getSnapshot()).toEqual([props])
    expect(await names()).toEqual(['Umbrella'])
    expect(() => ctx.dvMentions.kinds.register({ ...marks, id: 'test-props' })).toThrow('registry key "test-props" is already registered by test-props')
    dispose()
    expect(ctx.dvMentions.kinds.getSnapshot()).toEqual([])
    expect(await names()).toEqual([])
    expect(ctx.get('dvComposer')?.paramBars.getSnapshot()).toEqual([])
    await fiber.dispose()
    expect([ctx.get('dvMentions'), ctx.get('dvComposer')]).toEqual([undefined, undefined])
    expect(sources).toEqual([])
  })
})

describe('projectMentionSource candidates and picks', () => {
  const hats: MentionKind = {
    id: 'test-hats', kind: 'test_hat', order: 1, section: () => 'Hats',
    items: () => [{ uri: 'dv:test_hat/h1', label: 'Hat' }, { uri: 'dv:test_hat/h2', label: 'Hat' }],
  }
  const source = (): InputTriggerSource => {
    const kinds = createRegistry<MentionKind>(kind => [kind.id], kind => kind.id)
    kinds.register(hats)
    return projectMentionSource({ kinds }, () => [])
  }
  const request = (query: string) => ({ query, signal: new AbortController().signal }) as never

  it('lists nothing while no project is open', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    expect(await source().candidates({} as never, request(''))).toEqual([])
  })

  it('numbers repeated labels and inserts the chip of the picked item with its own label', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    publishCurrentProject('p1')
    const mention = source()
    const candidates = await mention.candidates({} as never, request('hat'))
    expect(candidates.map(candidate => candidate.name)).toEqual(['Hat', 'Hat (2)'])
    const second = candidates[1]
    if (second === undefined) throw new Error('no second candidate')
    const text = '@[Hat](dv:test_hat/h2)'
    expect(mention.onPick({ candidate: second } as never))
      .toEqual({ insert: { source: MENTION_SOURCE, ref: text, label: 'Hat', clipboardText: text } })
    expect(mention.onPick({ candidate: { name: 'Hat' } } as never)).toBeUndefined()
  })
})

describe('projectMentionSource in a prompt occurrence', () => {
  /**
   * A kind with an item shown by the image ref.png, one shown by an asset that the state lacks, one without a thumb, and
   * one that names a record.
   */
  const looks: MentionKind = {
    id: 'test-looks', kind: 'test_look', order: 1, section: () => 'Looks',
    items: () => [
      { uri: 'dv:test_look/l1', label: 'Lit', thumb: 'ref.png' }, { uri: 'dv:test_look/l2', label: 'Lost', thumb: 'gone.png' },
      { uri: 'dv:test_look/l3', label: 'Bare' }, { uri: 'dv:record/r1', label: 'Made' },
    ],
  }
  const prompt = () => {
    const kinds = createRegistry<MentionKind>(kind => [kind.id], kind => kind.id)
    kinds.register(looks)
    const face = projectMentionSource({ kinds }, () => []).prompt
    if (face === undefined) throw new Error('the source has no prompt face')
    return face
  }
  const ask = (query: string, context: JsonValue | null): Parameters<PromptSourceFace['candidates']>[0] => (
    { query, position: 'inline', drilled: false, signal: new AbortController().signal, context }
  )
  const pickOf = (candidate: InputTriggerCandidate): Parameters<PromptSourceFace['onPick']>[0] => (
    { candidate, position: 'inline', via: 'menu', action: 'pick', span: { start: 0, end: 1, draftRev: 0 } }
  )
  const names = async (context: JsonValue | null): Promise<string[]> => {
    const candidates = await prompt().candidates(ask('', context))
    return candidates.map(candidate => candidate.name)
  }

  it('offers only the items whose asset is of a media type that the occurrence names, and every item without a filter', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    publishCurrentProject('p1')
    const images = await names({ filter: { mediaTypes: ['image'] } })
    expect(images.slice(0, 2)).toEqual(['Lit', 'Bare'])
    expect(images).toContain('ref.png')
    expect(images).not.toContain('shot1.mp4')
    const videos = await names({ filter: { mediaTypes: ['video'] } })
    expect([videos.includes('Lit'), videos.includes('shot1.mp4'), videos.includes('Bare')]).toEqual([false, true, true])
    for (const context of [null, 'image', { filter: { mediaTypes: 'image' } }, { filter: 'image' }]) {
      expect((await names(context)).slice(0, 3)).toEqual(['Lit', 'Lost', 'Bare'])
    }
  })

  it('offers only the assets and the items of the kinds that the occurrence names', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    publishCurrentProject('p1')
    const offered = await names({ filter: null, kinds: ['test_other'] })
    expect([offered.includes('Lit'), offered.includes('ref.png')]).toEqual([false, true])
    const looksOnly = await names({ filter: null, kinds: ['test_look'] })
    expect([looksOnly.includes('Lit'), looksOnly.includes('Made')]).toEqual([true, false])
  })

  it('inserts the picked item\'s chip as the session face does', async () => {
    vi.stubGlobal('fetch', scriptedFetch().fetch)
    publishCurrentProject('p1')
    const [lit] = await prompt().candidates(ask('lit', null))
    if (lit === undefined) throw new Error('no Lit candidate')
    const text = '@[Lit](dv:test_look/l1)'
    expect(prompt().onPick(pickOf(lit))).toEqual({ insert: { source: MENTION_SOURCE, ref: text, label: 'Lit', clipboardText: text } })
  })

  it('writes the citation of a picked item with the kernel writer, which encodes the parentheses of an ID', () => {
    const value = JSON.stringify({ uri: 'dv:test_look/mia(young)', label: 'Mia' })
    const text = '@[Mia](dv:test_look/mia%28young%29)'
    expect(prompt().onPick(pickOf({ name: 'Mia', value }))).toEqual({ insert: { source: MENTION_SOURCE, ref: text, label: 'Mia', clipboardText: text } })
  })

  it('inserts nothing for a picked value without a citation URI or without a label', () => {
    for (const value of [JSON.stringify({ uri: 'https://x', label: 'Hat' }), JSON.stringify({ uri: 'dv:test_look/l1' })]) {
      expect(prompt().onPick(pickOf({ name: 'Hat', value }))).toBeUndefined()
    }
  })
})

describe('projectMentionSource codec', () => {
  it('sends the chip text unchanged and writes nothing; the host puts mentioned assets on the canvas', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', (input: string) => {
      calls.push(input)
      return Promise.resolve(new Response('{}'))
    })
    publishCurrentProject('p1')
    const { codec } = projectMentionSource({ kinds: createRegistry<MentionKind>(kind => [kind.id], kind => kind.id) }, () => [])
    if (codec === undefined) throw new Error('the source has no codec')
    const asset = formatCitation('hero.png', 'asset', 'a+1')
    const character = formatCitation('Hero', 'character', 'hero')
    expect(await codec.serialize(asset, new AbortController().signal)).toBe(asset)
    expect(await codec.serialize(character, new AbortController().signal)).toBe(character)
    expect(codec.clipboardText(asset)).toBe(asset)
    expect(calls).toEqual([])
  })
})
