// @vitest-environment jsdom
/** The plugin's registrations, and their removal when the plugin goes. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { DvClient } from '@dv/ui-kit/api.ts'
import { createRegistry, type DvMentions, type MentionKind } from '@dv/ui-kit/registries.ts'
import { TIMELINE_ID, TIMELINE_KIND } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'
import { InsertClipAction } from '../src/client/InsertClipAction.tsx'
import { clipMentionKind } from '../src/client/mention.ts'
import { TimelineBody } from '../src/client/TimelineBody.tsx'
import { TimelineView } from '../src/client/TimelineView.tsx'
import { apply as hostApply } from '../src/index.ts'

interface Recorded {
  name: string
  key?: string
  id?: string
  order?: number
  label?: () => string
  locale?: string
  inject: () => { client: unknown; hooks: unknown }
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

describe('ui-timeline apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, and the body seat under the type\'s id with an API client, and nothing in the center without dvCenter', async () => {
    const { tabs, registered, dictionaries } = await boot()
    const definition = tabs.get(TIMELINE_KIND)
    expect(definition?.id).toBe(TIMELINE_ID)
    expect(definition?.priority).toBe('builtin')
    expect(definition?.title('sidebar://dv-timeline')).toBe('type.label')
    expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description?.()])).toEqual([[41, 'guide.title', 'guide.description']])
    expect(dictionaries.get('dvTimeline')).toEqual({ zh, en })
    expect(registered.map(entry => [entry.name, entry.key ?? entry.id, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', TIMELINE_ID, 'dvTimeline', TimelineBody],
    ])
    expect(registered[0]?.inject().client).toBeInstanceOf(DvClient)
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    // 插入片段 of the asset preview and of the track read one key.
    expect(Object.keys(zh)).not.toContain('preview.insert')
  })

  it('registers the center view and 插入片段 once dvCenter is present, with the tab body\'s API client, and both leave with dvCenter', async () => {
    const { ctx, registered } = await boot()
    const dispose = ctx.provide('dvCenter', { show: () => {} })
    await vi.waitFor(() => { expect(registered).toHaveLength(3) })
    expect(registered.map(entry => [entry.name, entry.key ?? entry.id, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', TIMELINE_ID, 'dvTimeline', TimelineBody],
      ['dv.center.view', 'timeline', undefined, TimelineView],
      ['dv.media.preview.action', 'dv.timeline.insert', 'dvTimeline', InsertClipAction],
    ])
    // The center view comes after the canvas in the workspace's view control, under the tab type's label.
    expect([registered[1]?.order, registered[1]?.label?.()]).toEqual([1, 'type.label'])
    expect(registered[1]?.inject().client).toBe(registered[0]?.inject().client)
    dispose()
    await vi.waitFor(() => { expect(registered.map(entry => entry.name)).toEqual(['sidebar.right.pane.tab']) })
  })

  it('registers the clip mention kind once dvMentions is present, and the plugin disposal removes it', async () => {
    const { ctx, fiber } = await boot()
    const mentions: DvMentions = { kinds: createRegistry<MentionKind>(kind => [kind.id], kind => kind.id) }
    ctx.provide('dvMentions', mentions)
    await vi.waitFor(() => { expect(mentions.kinds.getSnapshot()).toEqual([clipMentionKind]) })
    await fiber.dispose()
    expect(mentions.kinds.getSnapshot()).toEqual([])
  })

  it('removes everything when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(TIMELINE_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})
