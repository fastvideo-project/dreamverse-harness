/** The plugin's registrations, the `dvCanvas` service, and their removal when the plugin goes. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { DvClient } from '@dv/ui-kit/api.ts'
import type { ChainAnchor } from '@dv/ui-kit/registries.ts'
import { CanvasBody } from '../src/client/CanvasBody.tsx'
import { CanvasCenter } from '../src/client/CanvasCenter.tsx'
import { CANVAS_ID, CANVAS_KIND } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

interface Recorded {
  name: string
  key?: string
  id?: string
  order?: number
  label?: () => string
  locale?: string
  inject: () => { client: unknown; canvas: unknown }
  children?: object
  component: unknown
}

async function boot() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, tabs, registered, dictionaries, fiber }
}

describe('ui-canvas apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, and the body seat under the type\'s id with an API client', async () => {
    const { tabs, registered, dictionaries } = await boot()
    const definition = tabs.get(CANVAS_KIND)
    expect(definition?.id).toBe(CANVAS_ID)
    expect(definition?.priority).toBe('builtin')
    expect(definition?.keepMounted).toBe(true)
    expect(definition?.title('sidebar://dv-canvas')).toBe('type.label')
    expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description?.()])).toEqual([[40, 'guide.title', 'guide.description']])
    expect(dictionaries.get('dvCanvas')).toEqual({ zh, en })
    expect(registered.map(entry => [entry.name, entry.key ?? entry.id, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', CANVAS_ID, 'dvCanvas', CanvasBody],
      ['dv.center.view', 'canvas', undefined, CanvasCenter],
    ])
    expect(registered[0]?.inject().client).toBeInstanceOf(DvClient)
    // The center view comes first in the workspace's view control, under the tab type's label, with the body's client.
    expect([registered[1]?.order, registered[1]?.label?.()]).toEqual([0, 'type.label'])
    expect(registered[1]?.inject()).toBe(registered[0]?.inject())
    // The center view declares the slot of the entry editors, which plugin UI halves fill by `NodeType.id`, and the asset
    // pool's slot of the picker; the body declares none.
    expect(registered[1]?.children).toEqual({
      'dv.canvas.editor': { kind: 'keyed', scope: 'root' },
      'dv.canvas.picker': { kind: 'keyed', scope: 'root' },
    })
    expect(registered[0]?.children).toBeUndefined()
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('provides dvCanvas with empty registries, and its descriptors reach both canvas copies and leave on disposal', async () => {
    const { ctx, registered } = await boot()
    expect(registered[0]?.inject().canvas).toBe(ctx.dvCanvas)
    expect(registered[1]?.inject().canvas).toBe(ctx.dvCanvas)
    expect(ctx.dvCanvas.chainAnchors.list()).toEqual([])
    const anchor: ChainAnchor = { starter: 'story.approve', anchor: () => 'plan:p1' }
    const dispose = ctx.dvCanvas.chainAnchors.register(anchor)
    expect(ctx.dvCanvas.chainAnchors.list()).toEqual([anchor])
    dispose()
    expect(ctx.dvCanvas.chainAnchors.list()).toEqual([])
  })

  it('removes everything when the plugin is disposed', async () => {
    const { ctx, tabs, registered, dictionaries, fiber } = await boot()
    const canvas = ctx.dvCanvas
    await fiber.dispose()
    expect(ctx.get('dvCanvas')).toBeUndefined()
    expect(canvas.chainAnchors.list()).toEqual([])
    expect(tabs.get(CANVAS_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})
