/** The records that the timelines use, as the canvas reads them, and their registration in `dvCanvas.recordsInUse`. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { AssetId, RecordId } from '@dv/project/types'
import type { ClipId, TimelineId } from '@dv/timeline/types'
import { createDvCanvas } from '../../ui-canvas/src/client/dv-canvas.ts'
import { fixtureState } from '../../ui-kit/tests/fixture.client.tsx'
import { TIMELINE_ID } from '../src/client/definition.ts'
import { apply } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'
import { timelineRecordsInUse } from '../src/client/records-in-use.ts'

/** Translate with the Chinese dictionary. */
const t = makeTranslate(zh)

describe('timelineRecordsInUse', () => {
  it('uses the record behind each clip: the render a placeholder clip waits for, else the producer of the clip asset, else none', () => {
    const state = fixtureState()
    state.components.timeline.timelines.push({
      id: 't2' as TimelineId, name: '', sounds: [], sound_track_names: [], clips: [
        { id: 'cl3' as ClipId, asset: null, source: { record: 'g3' as RecordId, output: 0 }, in_sec: null, out_sec: null },
        { id: 'cl4' as ClipId, asset: 'unknown.mp4' as AssetId, source: null, in_sec: null, out_sec: null },
        { id: 'cl5' as ClipId, asset: null, source: null, in_sec: null, out_sec: null },
      ],
    })
    const descriptor = timelineRecordsInUse(t)
    expect(descriptor.id).toBe(TIMELINE_ID)
    expect(descriptor.uses(state)).toEqual(['g1', 'g2', 'g3'])
  })

  it('puts the trim label on the asset of each clip with an in or out point', () => {
    const state = fixtureState()
    state.components.timeline.timelines.push({
      id: 't2' as TimelineId, name: '', sounds: [], sound_track_names: [], clips: [
        { id: 'cl3' as ClipId, asset: 'shot1.mp4' as AssetId, source: null, in_sec: null, out_sec: 2 },
        { id: 'cl4' as ClipId, asset: null, source: { record: 'g3' as RecordId, output: 0 }, in_sec: 1, out_sec: null },
      ],
    })
    expect(timelineRecordsInUse(t).badges?.(state)).toEqual([
      { asset: 'shot2.mp4', label: '已裁剪' }, { asset: 'shot1.mp4', label: '已裁剪' },
    ])
  })
})

describe('ui-timeline records in use', () => {
  it('registers once dvCanvas is present, and the plugin disposal removes it', async () => {
    const ctx = new Context()
    const canvas = createDvCanvas()
    const locale = { bind: vi.fn(() => t), register: vi.fn(() => () => undefined) }
    const slots = { inject: vi.fn(() => () => undefined) }
    const tabs = { register: vi.fn(() => () => undefined) }
    ctx.provide('locale', locale as never)
    ctx.provide('slots', slots as never)
    ctx.provide('sidebarRightTabs', tabs as never)
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(canvas.recordsInUse.getSnapshot()).toEqual([])
    ctx.provide('dvCanvas', canvas)
    await vi.waitFor(() => { expect(canvas.recordsInUse.getSnapshot().map(entry => entry.id)).toEqual([TIMELINE_ID]) })
    expect(canvas.recordsInUse.getSnapshot()[0]?.uses(fixtureState())).toEqual(['g1', 'g2'])
    await fiber.dispose()
    expect(canvas.recordsInUse.getSnapshot()).toEqual([])
  })
})
