// @vitest-environment jsdom
/** The chat rows and the group-title names of the operation tools, read from `GET /api/dv/operations`. */
import { act, cleanup, render } from '@testing-library/react'
import { createElement, type ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { publishCurrentProject } from '@dv/ui-kit/current-project.ts'
import type { WireOperation } from '@dv/ui-kit/types.ts'
import { addToolNames, registerOperationRows } from '../src/client/tool-labels.ts'

/** A workflow operation that declares its label and has no `DV_TOOL_LABELS` entry. */
const ASSEMBLE: WireOperation = {
  name: 'cut.assemble', version: '1', description: 'Assemble a cut.', label: { zh: '拼接成片', en: 'Assemble cut' },
  inputs: {}, params: {}, outputs: [], deterministic: false, resource: 'none', confirm: 'always',
}
/** An operation without a label or a `DV_TOOL_LABELS` entry. */
const PREVIEW: WireOperation = {
  name: 'cut.preview', version: '1', description: 'Preview a cut.', inputs: {}, params: {}, outputs: [], deterministic: true,
  resource: 'none', confirm: 'never',
}

/** The props of a tool row that the test passes. */
type RowProps = { toolName: string; sessionId: string; callId: string; phase: 'start'; block: object }

beforeEach(() => { document.documentElement.lang = 'zh-CN' })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  publishCurrentProject(null)
})

describe('registerOperationRows', () => {
  it('shows the label of a cut.assemble row, registers its rows again when the list changes, and removes them on unload', async () => {
    const lists = { current: [ASSEMBLE] }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json(lists.current))))
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({
      'tool.call.toolview': { kind: 'keyed', scope: 'session', inject: { hooks: { toolCallArgumentsPartial: () => () => '' } } },
    })
    const entries = () => runtime.slots.entries('tool.call.toolview')
    const plugin = await runtime.mount({ inject: ['slots'], apply: registerOperationRows })
    await vi.waitFor(() => { expect(entries()).toHaveLength(1) })
    expect(entries()[0]!.options).toMatchObject({ key: 'dv_cut_assemble', priority: 1 })
    const Row = entries()[0]!.component as ComponentType<RowProps>
    const { container } = render(createElement(Row, { toolName: 'dv_cut_assemble', sessionId: 's1', callId: 'call-1', phase: 'start', block: {} }))
    expect(container.textContent).toContain('拼接成片')
    expect(container.textContent).not.toContain('dv_cut_assemble')

    // Opening a project reads the list again: a changed list replaces every row, an unchanged one keeps them.
    lists.current = [ASSEMBLE, PREVIEW]
    act(() => { publishCurrentProject('p1') })
    await vi.waitFor(() => { expect(entries().map(entry => entry.options.key)).toEqual(['dv_cut_assemble', 'dv_cut_preview']) })
    const shown = entries()
    act(() => { publishCurrentProject('p2') })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(entries()[0]).toBe(shown[0])
    expect(entries()[1]).toBe(shown[1])

    await plugin.dispose()
    expect(entries()).toHaveLength(0)
    await runtime.dispose()
  })
})

describe('addToolNames', () => {
  it('writes the group-title name of every labelled tool and of every operation', () => {
    const zh: Record<string, string> = {}
    const en: Record<string, string> = {}
    addToolNames({ dicts: new Map([['chat', new Map([['zh', zh], ['en', en]])]]) }, [ASSEMBLE, PREVIEW])
    expect([zh['tool.name.dv_cut_assemble'], en['tool.name.dv_cut_assemble']]).toEqual(['拼接成片', 'Assemble cut'])
    expect(zh['tool.name.dv_cut_preview']).toBe('cut.preview')
    expect(zh['tool.name.dv_asset_import']).toBe('导入素材')
  })
})
