/** The canvas registries and their keys. */
import { describe, expect, it } from 'vitest'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import type { NodeAction, NodeType, NodeView } from '../src/client/contract/index.ts'
import { createDvCanvas } from '../src/client/dv-canvas.ts'


const claiming = (id: string, type: 'test_clip' | 'test_cut', operations: string[]): NodeType => ({
  id, type, label: () => type, color: '#888', column: 2,
  claimed: { operations, status: { running: () => '', failed: () => '' }, entry: () => ({ title: '', sizing: { kind: 'window', defaultSize: { width: 208, height: 117 }, minSize: { width: 104, height: 117 } } }) },
})

describe('createDvCanvas', () => {
  it('creates four empty registries', () => {
    const canvas = createDvCanvas()
    const registries = [canvas.nodeTypes, canvas.recordsInUse, canvas.versionKinds, canvas.actions]
    expect(registries.map(registry => registry.getSnapshot())).toEqual([[], [], [], []])
  })

  it('keys a node type by its type and each claimed operation, and a refusal names the package that holds the key', () => {
    const canvas = createDvCanvas()
    canvas.nodeTypes.register(claiming('@dv/ui-clip', 'test_clip', ['clip.render', 'clip.trim']))
    expect(() => canvas.nodeTypes.register({ id: '@dv/ui-other', type: 'test_clip', label: () => '', color: '', column: 0, entries: () => [] }))
      .toThrow('registry key "test_clip" is already registered by @dv/ui-clip')
    expect(() => canvas.nodeTypes.register(claiming('@dv/ui-other', 'test_cut', ['clip.trim'])))
      .toThrow('registry key "op:clip.trim" is already registered by @dv/ui-clip')
    expect(() => canvas.nodeTypes.register(claiming('@dv/ui-other', 'test_cut', ['clip.export']))).not.toThrow()
  })

  it('refuses a second records in use of a package, version kind of a kind, and action of an id', () => {
    const canvas = createDvCanvas()
    canvas.recordsInUse.register({ id: '@dv/ui-timeline', uses: () => [] })
    expect(() => canvas.recordsInUse.register({ id: '@dv/ui-timeline', uses: () => ['r1'] })).toThrow('registry key "@dv/ui-timeline" is already registered by @dv/ui-timeline')
    const props: VersionKind = { kind: 'prop', label: () => '道具', node: id => `prop:${id}`, latest: () => [], name: () => null, assets: () => [] }
    canvas.versionKinds.register(props)
    expect(() => canvas.versionKinds.register({ ...props })).toThrow('registry key "prop" is already registered by the version kind prop')
    const upscale: NodeAction = { id: '@dv/ui-image-upscale:upscale', label: () => '放大', order: 1, shows: (_node): _node is NodeView => true, run: () => undefined }
    canvas.actions.register(upscale)
    expect(() => canvas.actions.register({ ...upscale })).toThrow('registry key "@dv/ui-image-upscale:upscale" is already registered by @dv/ui-image-upscale')
  })
})
