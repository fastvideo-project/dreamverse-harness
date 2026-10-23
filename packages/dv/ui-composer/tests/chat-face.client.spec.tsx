// @vitest-environment jsdom
/**
 * The chip face in the chat composer bar. The test root declares `conversation.input.reference` as the bar does, with
 * no face context and a glyph chip as the fallback; a `dv-project` chip draws at the open project's newest version
 * until the composer plugin is disposed.
 */
import { waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import { apply as assetPoolApply, inject as assetPoolInject } from '../../ui-asset-pool/src/client/index.ts'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { testRef } from '../../ui-canvas/tests/canvas-runtime.client.tsx'
import { fixtureState, scriptedFetch, withTestRef } from '../../ui-kit/tests/fixture.client.tsx'
import { apply as mediaApply, inject as mediaInject } from '../../ui-media/src/client/index.ts'
import { composerStack } from './composer-stack.client.ts'

const HERO = '@[Hero](dv:test_ref/hero)'

const runtimes: SlotTestRuntime[] = []
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  vi.unstubAllGlobals()
  publishCurrentProject(null)
})

describe('the chip face in the chat composer bar', () => {
  it('draws a chat chip of the open project with its image at the newest version, and leaves the glyph chip when the composer goes', async () => {
    vi.stubGlobal('fetch', scriptedFetch({ state: withTestRef(fixtureState()) }).fetch)
    publishCurrentProject('p1')
    const runtime = await SlotTestRuntime.create()
    runtimes.push(runtime)
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    runtime.ctx.provide('dvCanvas', createDvCanvas())
    runtime.ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
    await runtime.mount({ inject: [...mediaInject], apply: mediaApply })
    await runtime.mount({ inject: [...assetPoolInject], apply: assetPoolApply })
    await runtime.mount({ inject: [...testRef.inject], apply: testRef.apply })
    const composer = await runtime.mount(composerStack)
    await runtime.root.declare(
      { 'conversation.input.reference': { kind: 'keyed', scope: 'session-maybe' } },
      ({ renderSlot }: PropsRenderSlots<'conversation.input.reference'>): ReactNode => renderSlot(
        'conversation.input.reference', { source: 'dv-project', reference: HERO, label: 'Hero', invalid: false, context: null },
        { entryKey: 'dv-project', fallback: <b data-glyph-chip="">Hero</b> },
      ),
    )
    const { container } = runtime.renderRoot()
    await waitFor(() => { expect(container.querySelector('[data-dv-chip="dv:test_ref/hero"] img')?.getAttribute('src')).toContain('ref.png') })
    expect(container.querySelector('[data-dv-chip="dv:test_ref/hero"]')?.textContent).toBe('Hero')
    await composer.dispose()
    await waitFor(() => { expect(container.querySelector('[data-glyph-chip]')?.textContent).toBe('Hero') })
    expect(container.querySelector('[data-dv-chip]')).toBeNull()
  })
})
