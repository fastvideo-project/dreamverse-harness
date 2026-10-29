/**
 * The creator-facing name of an operation: its label on the wire, else its tool label, else its name. The name of a
 * generation task: its catalog label, else its name.
 */
import { describe, expect, it } from 'vitest'
import { operationLabel, taskLabel, toolNameOf } from '../src/client/tool-labels.ts'
import type { WireOperation } from '../src/client/types.ts'
import { OPERATIONS, TASK_LABELS } from './fixture.client.tsx'

/** A workflow operation that declares its label and has no `DV_TOOL_LABELS` entry. */
const ASSEMBLE: WireOperation = {
  name: 'cut.assemble', version: '1', description: 'Assemble a cut.', label: { zh: '拼接成片', en: 'Assemble cut' },
  inputs: {}, params: {}, outputs: [], deterministic: false, resource: 'none', confirm: 'always',
}

describe('operationLabel', () => {
  it('names an operation by the label that its declaration on the wire carries', () => {
    expect(operationLabel('cut.assemble', [...OPERATIONS, ASSEMBLE])).toEqual(['拼接成片', 'Assemble cut'])
    const relabelled = { ...OPERATIONS[0]!, label: { zh: '生成镜头', en: 'Generate shot' } }
    expect(operationLabel('shot.render', [relabelled])).toEqual(['生成镜头', 'Generate shot'])
  })

  it('falls back to the tool label, then to the operation name, and names nothing for a record without an operation', () => {
    expect(operationLabel('asset.import', OPERATIONS)).toEqual(['导入素材', 'Import asset'])
    expect(operationLabel('cut.assemble', OPERATIONS)).toEqual(['cut.assemble', 'cut.assemble'])
    expect(operationLabel(null, OPERATIONS)).toEqual(['', ''])
  })

  it('derives the tool name of an operation as the kernel does', () => {
    expect(toolNameOf('timeline.clip_move')).toBe('dv_timeline_clip_move')
  })
})

describe('taskLabel', () => {
  it('names a task by its catalog label, else by the task name', () => {
    expect(taskLabel('ref2v', TASK_LABELS)).toEqual(['参考图生成', 'From references'])
    expect(taskLabel('t2i', TASK_LABELS)).toEqual(['t2i', 't2i'])
  })
})
