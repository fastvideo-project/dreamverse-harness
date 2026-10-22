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
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { createRegistry, type MentionKind } from '@dv/ui-kit/registries.ts'
import { MEDIA_TYPES } from '../../ui-asset-pool/src/client/media.tsx'
import { asset, fixtureState, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { apply, inject } from '../src/client/index.ts'
import { MENTION_SOURCE, projectItems, projectMentionSource, referenceText } from '../src/client/mention.ts'

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
    // An image draws its poster, and a take's video the image output of its render; an imported video and an audio file
    // draw the glyphs of their media types' icon names, and a file of a media type without a type draws the file glyph:
    // three different glyphs.
    expect(icons['dv:asset/ref.png']).toMatch(new RegExp(`^<img src="${assetUrl('ref.png')}" alt=""`))
    expect(icons['dv:asset/shot1.mp4']).toMatch(new RegExp(`^<img src="${assetUrl('shot1-last.png')}" alt=""`))
    const glyphs = ['dv:asset/score.wav', 'dv:asset/export.mp4', 'dv:asset/brief.pdf'].map(uri => icons[uri] ?? '')
    expect(glyphs.map(markup => markup.startsWith('<svg'))).toEqual([true, true, true])
    expect(new Set(glyphs).size).toBe(3)
    // A thumb is an asset ID, drawn as that asset's icon.
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
  it('provides dvMentions, whose kinds reach the @ source until their disposal, and removes it with the plugin', async () => {
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
    ctx.provide('slots', { inject: () => () => undefined, register: () => () => undefined } as never)
    ctx.provide('sidebarRight', {} as never)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const names = async (): Promise<string[]> => {
      const candidates = await sources[0]?.candidates({} as never, { query: 'umbrella', signal: new AbortController().signal } as never)
      return (candidates ?? []).map(candidate => candidate.name)
    }
    const dispose = ctx.dvMentions.kinds.register(props)
    expect(ctx.dvMentions.kinds.list()).toEqual([props])
    expect(await names()).toEqual(['Umbrella'])
    expect(() => ctx.dvMentions.kinds.register({ ...marks, id: 'test-props' })).toThrow('registry key "test-props" is already registered')
    dispose()
    expect(ctx.dvMentions.kinds.list()).toEqual([])
    expect(await names()).toEqual([])
    await fiber.dispose()
    expect(ctx.get('dvMentions')).toBeUndefined()
    expect(sources).toEqual([])
  })
})

describe('projectMentionSource candidates and picks', () => {
  /** A kind whose two items share the label Hat. */
  const hats: MentionKind = {
    id: 'test-hats', kind: 'test_hat', order: 1, section: () => 'Hats',
    items: () => [{ uri: 'dv:test_hat/h1', label: 'Hat' }, { uri: 'dv:test_hat/h2', label: 'Hat' }],
  }
  const source = (): InputTriggerSource => {
    const kinds = createRegistry<MentionKind>(kind => [kind.id])
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

describe('projectMentionSource codec', () => {
  it('sends the chip text unchanged and writes nothing; the host puts mentioned assets on the canvas', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', (input: string) => {
      calls.push(input)
      return Promise.resolve(new Response('{}'))
    })
    publishCurrentProject('p1')
    const { codec } = projectMentionSource({ kinds: createRegistry<MentionKind>(kind => [kind.id]) }, () => [])
    if (codec === undefined) throw new Error('the source has no codec')
    const asset = referenceText('hero.png', 'dv:asset/a%2B1')
    const character = referenceText('Hero', 'dv:character/hero')
    expect(await codec.serialize(asset, new AbortController().signal)).toBe(asset)
    expect(await codec.serialize(character, new AbortController().signal)).toBe(character)
    expect(codec.clipboardText(asset)).toBe(asset)
    expect(calls).toEqual([])
  })
})
