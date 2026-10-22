// @vitest-environment jsdom
/**
 * The asset picker: one section per registered version kind, titled with the kind's label, whose items toggle, and the
 * Escape key that closes it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { RenderFactorySlot } from '@deepseek-ai/dsh-client-ui-slots'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import { fixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { AssetPicker } from '../src/client/AssetPicker.tsx'
import type { CanvasTranslate } from '../src/client/NodeCard.tsx'
import { zh } from '../src/client/locales.ts'

/**
 * A version kind whose items all stand at version 1 with no reference asset.
 * @param kind - the reference kind.
 * @param label - the section title of its items.
 * @param names - item ID → its name.
 * @returns the version kind.
 */
function namedKind(kind: string, label: string, names: Record<string, string>): VersionKind {
  return {
    kind, label: () => label, node: id => `${kind}:${id}`,
    latest: () => Object.keys(names).map(id => ({ id, version: 1 })),
    name: (_state, id) => names[id] ?? null, assets: () => [],
  }
}

afterEach(() => { cleanup() })

describe('AssetPicker', () => {
  it('shows one section per registered version kind, titled with the kind\'s label and holding its items', () => {
    const kinds = [namedKind('character', '角色', { hero: 'Hero' }), namedKind('prop', '道具', { p1: '红伞', p2: '旧皮箱' })]
    const t: CanvasTranslate = makeTranslate(zh)
    // The pool panel and the item covers are slot and Factory bodies, which this unit leaves empty.
    render(
      <AssetPicker
        state={fixtureState()} project="p1" session={null} t={t} kinds={kinds} chosen={[]} onConfirm={() => undefined} onCancel={() => undefined}
        renderSlot={() => null} renderFactorySlot={() => null}
      />,
    )
    const picker = within(document.body).getByTestId('dv-canvas-asset-picker')
    const sections = [...picker.querySelectorAll('section')].map(section => ({
      title: section.querySelector('h3')?.textContent,
      items: within(section).getAllByRole('button').map(button => button.textContent),
    }))
    expect(sections).toEqual([{ title: '角色', items: ['Hero'] }, { title: '道具', items: ['红伞', '旧皮箱'] }])
  })

  it('names an unnamed item by its ID, draws its cover through dv.media, toggles a pick off, and closes on Escape only', () => {
    const kinds: VersionKind[] = [{ ...namedKind('character', '角色', { hero: '' }), assets: () => ['ref.png'] }]
    const t: CanvasTranslate = makeTranslate(zh)
    const onCancel = vi.fn()
    const media: RenderFactorySlot = (name, props) => <span data-factory={name}>{JSON.stringify(props)}</span>
    render(
      <AssetPicker
        state={fixtureState()} project="p1" session={null} t={t} kinds={kinds} chosen={[]} onConfirm={() => undefined} onCancel={onCancel}
        renderSlot={() => null} renderFactorySlot={media}
      />,
    )
    const picker = within(document.body).getByTestId('dv-canvas-asset-picker')
    const hero = within(picker).getByRole('button', { name: /hero/u })
    expect(hero.textContent).toContain('hero')
    const cover = hero.querySelector('[data-factory="dv.media"]')
    expect(JSON.parse(cover?.textContent ?? 'null')).toMatchObject({ asset: { id: 'ref.png' }, purpose: 'thumb' })
    const confirm = (count: number): boolean =>
      within(picker).getByRole('button', { name: `确认（${String(count)}）` }).hasAttribute('disabled')
    fireEvent.click(hero)
    expect([hero.getAttribute('aria-pressed'), confirm(1)]).toEqual(['true', false])
    fireEvent.click(hero)
    expect([hero.getAttribute('aria-pressed'), confirm(0)]).toEqual(['false', true])
    fireEvent.keyDown(window, { key: 'a' })
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
