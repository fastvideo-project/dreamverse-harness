// @vitest-environment jsdom
/**
 * The composer plugin under the real slot runtime: 让智能体使用 in the asset preview of `@dv/ui-media`, the `@` menu
 * icons from the registered media types, the ＋ menu 引用 row, the `dv:compose` prefill of a session composer, the
 * hidden permission picker, and the tool rows, each removed when the plugin is disposed.
 */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { dispatchCompose, DV_COMPOSE_EVENT, type DvComposeDetail } from '@dv/ui-kit/compose.ts'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { MEDIA_TYPES } from '../../ui-asset-pool/src/client/media.tsx'
import { asset, fixtureState, scriptedFetch } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { apply, inject, MENTION_SOURCE } from '../src/client/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  publishCurrentProject(null)
  document.documentElement.lang = ''
})

/**
 * Mount the media plugin with the image, video and audio media types, and the composer, under a root frame that
 * renders the shell's overlay list, in the Chinese interface.
 */
async function mountComposer() {
  document.documentElement.lang = 'zh-CN'
  const runtime = await SlotTestRuntime.create()
  const sources: InputTriggerSource[] = []
  runtime.ctx.provide('inputTriggers', {
    registerSource: (source: InputTriggerSource) => {
      sources.push(source)
      return () => { sources.splice(sources.indexOf(source), 1) }
    },
  } as never)
  runtime.ctx.provide('sidebarRight', { mounted: { getSnapshot: () => undefined }, openTab: () => {} } as never)
  await runtime.root.declare({ 'shell.overlay': { kind: 'list', scope: 'root' } }, props => <>{props.renderSlot('shell.overlay', {})}</>)
  await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
  for (const { type } of MEDIA_TYPES) runtime.ctx.dvMedia.types.register(type)
  const composer = await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  const composed: DvComposeDetail[] = []
  const onCompose = (event: Event): void => { composed.push((event as CustomEvent<DvComposeDetail>).detail) }
  window.addEventListener(DV_COMPOSE_EVENT, onCompose)
  const stop = () => { window.removeEventListener(DV_COMPOSE_EVENT, onCompose) }
  return { runtime, composer, view, sources, composed, stop }
}

describe('让智能体使用', () => {
  it('prefills 使用这个素材： with the previewed asset and closes the preview, until the plugin is disposed', async () => {
    const { runtime, composer, view, composed, stop } = await mountComposer()
    const audio = asset('score.wav', 'audio/wav', null)
    act(() => { runtime.ctx.dvMedia.preview('p1', audio, null) })
    const dialog = within(view.getByRole('dialog', { name: 'score.wav' }))
    expect(dialog.getByRole('button', { name: '让智能体使用' }).className).toBe(dialog.getByRole('button', { name: '关闭' }).className)
    fireEvent.click(dialog.getByRole('button', { name: '让智能体使用' }))
    expect(composed).toEqual([{ text: '使用这个素材：', refs: [{ kind: 'asset', id: 'score.wav', label: 'score.wav', assetId: 'score.wav' }] }])
    await vi.waitFor(() => { expect(view.queryByRole('dialog')).toBeNull() })

    await composer.dispose()
    act(() => { runtime.ctx.dvMedia.preview('p1', audio, null) })
    expect(within(view.getByRole('dialog', { name: 'score.wav' })).queryByRole('button', { name: '让智能体使用' })).toBeNull()
    stop()
    await runtime.dispose()
  })
})

describe('the @ menu', () => {
  it('lists an audio asset with the glyph of its media type and an image with its poster, from the registered media types', async () => {
    const state = fixtureState()
    state.assets.push(asset('score.wav', 'audio/wav', null), asset('brief.pdf', 'application/pdf', null))
    vi.stubGlobal('fetch', scriptedFetch({ state }).fetch)
    publishCurrentProject('p1')
    const { runtime, sources, stop } = await mountComposer()
    const icons = async (): Promise<Record<string, string>> => {
      const candidates = await sources[0]?.candidates({} as never, { query: '', signal: new AbortController().signal } as never) ?? []
      return Object.fromEntries(candidates.map(candidate => [candidate.name, candidate.icon === undefined ? '' : renderToStaticMarkup(createElement(candidate.icon))]))
    }
    const listed = await icons()
    expect(listed['ref.png']).toMatch(new RegExp(`^<img src="${assetUrl('ref.png')}"`))
    expect([listed['score.wav']?.startsWith('<svg'), listed['brief.pdf']?.startsWith('<svg')]).toEqual([true, true])
    expect(listed['score.wav']).not.toBe(listed['brief.pdf'])
    stop()
    await runtime.dispose()
  })

  it('lists an asset of a media type that a plugin adds with the icon component of that type', async () => {
    const state = fixtureState()
    state.assets.push(asset('scene.glb', 'model/gltf-binary', null))
    vi.stubGlobal('fetch', scriptedFetch({ state }).fetch)
    publishCurrentProject('p1')
    const { runtime, sources, stop } = await mountComposer()
    runtime.ctx.dvMedia.types.register({ id: 'model', icon: () => <svg data-icon="cube" /> })
    const candidates = await sources[0]?.candidates({} as never, { query: '', signal: new AbortController().signal } as never) ?? []
    const model = candidates.find(candidate => candidate.name === 'scene.glb')
    expect(model?.icon === undefined ? '' : renderToStaticMarkup(createElement(model.icon))).toBe('<svg data-icon="cube"></svg>')
    stop()
    await runtime.dispose()
  })
})

interface MenuRow {
  readonly name: string
  label(): string
  description(): string
  available(session: { sessionId: string }): boolean
  readonly ui: { run(session: { sessionId: string }): void }
}

type RowProps = { toolName: string; sessionId: string; callId: string; phase: 'start'; block: object }

const pickerPlugin = {
  inject: ['slots'],
  apply(ctx: SlotTestRuntime['ctx']) {
    ctx.effect(() => ctx.slots.inject('conversation.input.permission', () => ctx.slots.register(
      { name: 'conversation.input.permission' }, () => <button type="button">工作区内修改</button>,
    )), 'test: permission picker')
  },
}

/**
 * Mount the composer beside a retained session `s1`, with recording fakes for its composer input, the ＋ menu, the `@`
 * trigger service, and the right panel.
 */
async function mountSessionComposer() {
  document.documentElement.lang = 'zh-CN'
  vi.stubGlobal('fetch', scriptedFetch().fetch)
  const runtime = await SlotTestRuntime.create()
  const calls: string[] = []
  const rows: MenuRow[] = []
  const opened: Array<{ name: string; request: unknown }> = []
  const tabs: string[] = []
  const draft = { text: '', rev: 7 }
  const input = {
    state: { getSnapshot: () => ({ draft: draft.text, draftRev: draft.rev }) },
    setDraft: (text: string) => { draft.text = text; calls.push(`draft ${text}`) },
    insertReference: (chip: { ref: string }) => { calls.push(`chip ${chip.ref}`); return true },
    focus: () => { calls.push('focus') },
  }
  runtime.ctx.provide('inputTriggers', {
    registerSource: () => () => {},
    sessionOf: (scope: object) => ({
      toggleSource: (name: string, request: unknown) => {
        if (scope === runtime.sessions.scope('s1')) opened.push({ name, request })
      },
    }),
  } as never)
  runtime.ctx.provide('sidebarRight', { mounted: { getSnapshot: () => 's1' }, openTab: (id: string) => { tabs.push(id) } } as never)
  runtime.ctx.provide('commandUi', {
    register: (row: MenuRow) => {
      rows.push(row)
      return () => { rows.splice(rows.indexOf(row), 1) }
    },
  } as never)
  const session = await runtime.sessions.add({ id: 's1' })
  const reference = runtime.sessions.retain(session)
  await runtime.root.declare({
    'conversation.input.left': { kind: 'list', scope: 'session' }, 'conversation.input.permission': { kind: 'single', scope: 'session' },
    'tool.call.toolview': { kind: 'keyed', scope: 'session', inject: { hooks: { toolCallArgumentsPartial: () => () => '' } } },
  }, props => (
    <props.SessionProvider session={reference}>
      {props.renderSlot('conversation.input.left', {})}
      {props.renderSlot('conversation.input.permission', { locked: false })}
    </props.SessionProvider>
  ))
  await runtime.mount(pickerPlugin)
  const composer = await runtime.mount({ inject: [...inject], apply })
  const provideInput = () => { runtime.ctx.provide('conversation', { input: { for: () => input } } as never) }
  return { runtime, composer, calls, rows, opened, tabs, draft, provideInput }
}

describe('the ＋ menu 引用 row', () => {
  it('shows while a project is open and opens the @ list at the end of the picked session\'s draft, until disposal', async () => {
    const { runtime, composer, rows, opened, draft, provideInput } = await mountSessionComposer()
    const [row] = rows
    if (row === undefined) throw new Error('no ＋ menu row')
    expect([row.name, row.label(), row.description()]).toEqual(['reference', '引用', '项目里的条目或素材'])
    expect(row.available({ sessionId: 's1' })).toBe(false)
    publishCurrentProject('p1')
    expect(row.available({ sessionId: 's1' })).toBe(true)

    const tick = () => new Promise(resolve => setTimeout(resolve, 0))
    row.ui.run({ sessionId: 's1' })
    row.ui.run({ sessionId: 'gone' })
    await tick()
    expect(opened).toEqual([])
    provideInput()
    row.ui.run({ sessionId: 's1' })
    await tick()
    draft.text = 'hello'
    row.ui.run({ sessionId: 's1' })
    await tick()
    const at = (position: string, end: number) => ({
      name: MENTION_SOURCE, request: { trigger: '@', query: '', quoted: false, position, span: { start: end, end, draftRev: 7 } },
    })
    expect(opened).toEqual([at('leading', 0), at('inline', 5)])

    await composer.dispose()
    expect(rows).toEqual([])
    await runtime.dispose()
  })
})

describe('the session composer', () => {
  it('takes a waiting dv:compose prefill, brings 对话 to the front, ignores invalid events, and hides the permission picker', async () => {
    const { runtime, composer, calls, tabs, provideInput } = await mountSessionComposer()
    provideInput()
    dispatchCompose({ text: '使用这个素材：', refs: [{ kind: 'asset', id: 'score.wav', label: 'score.wav', assetId: 'score.wav' }] })
    expect(tabs).toEqual(['dv-chat'])
    expect(calls).toEqual([])
    const view = runtime.renderRoot()
    expect(calls).toEqual(['draft 使用这个素材： ', 'chip @[score.wav](dv:asset/score.wav)', 'focus'])
    expect(view.queryByRole('button', { name: '工作区内修改' })).toBeNull()

    for (const detail of [null, { text: 'x', refs: 'x' }]) window.dispatchEvent(new CustomEvent(DV_COMPOSE_EVENT, { detail }))
    expect(tabs).toEqual(['dv-chat'])
    expect(calls).toHaveLength(3)

    await composer.dispose()
    expect(view.getByRole('button', { name: '工作区内修改' })).toBeTruthy()
    await runtime.dispose()
  })
})

describe('the tool rows', () => {
  it('names a labelled tool in its chat row at priority 0.5, so the plugin\'s own row at priority 0 wins', async () => {
    const { runtime } = await mountSessionComposer()
    const entry = runtime.slots.entries('tool.call.toolview').find(each => each.options.key === 'dv_proj_create')
    if (entry === undefined) throw new Error('no dv_proj_create row')
    expect(entry.options.priority).toBe(0.5)
    const Row = entry.component as ComponentType<RowProps>
    const props: RowProps = { toolName: 'dv_proj_create', sessionId: 's1', callId: 'call-1', phase: 'start', block: {} }
    const { container } = render(createElement(Row, props))
    expect(container.textContent).toBe('新建项目进行中…')
    await runtime.dispose()
  })
})
