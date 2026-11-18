/** The canvas registries and their keys. */
import { describe, expect, it } from 'vitest'
import type { VersionKind } from '@dv/ui-kit/registries.ts'
import type { AddMenuSection, NodeAction, NodeType, NodeView } from '../src/client/contract/index.ts'
import { createDvCanvas } from '../src/client/dv-canvas.ts'


const typed = (id: string, type: 'test_clip' | 'test_cut'): NodeType => ({
  id, type, label: () => type, color: '#888',
  entry: () => ({ title: '', sizing: { kind: 'window', defaultSize: { width: 208, height: 117 }, minSize: { width: 104, height: 117 } } }),
})

describe('createDvCanvas', () => {
  it('creates five empty registries', () => {
    const canvas = createDvCanvas()
    const registries = [canvas.nodeTypes, canvas.recordsInUse, canvas.versionKinds, canvas.actions, canvas.addMenu]
    expect(registries.map(registry => registry.getSnapshot())).toEqual([[], [], [], [], []])
  })

  it('keys a node type by its type, and a refusal names the package that holds the key', () => {
    const canvas = createDvCanvas()
    canvas.nodeTypes.register(typed('@dv/ui-clip', 'test_clip'))
    expect(() => canvas.nodeTypes.register(typed('@dv/ui-other', 'test_clip')))
      .toThrow('registry key "test_clip" is already registered by @dv/ui-clip')
    expect(() => canvas.nodeTypes.register(typed('@dv/ui-other', 'test_cut'))).not.toThrow()
  })

  it('refuses a second records in use of a package, version kind of a kind, action of an id, and add menu section of a package', () => {
    const canvas = createDvCanvas()
    canvas.recordsInUse.register({ id: '@dv/ui-timeline', uses: () => [] })
    expect(() => canvas.recordsInUse.register({ id: '@dv/ui-timeline', uses: () => ['r1'] })).toThrow('registry key "@dv/ui-timeline" is already registered by @dv/ui-timeline')
    const props: VersionKind = { kind: 'prop', label: () => '道具', node: (_state, id) => `prop:${id}`, latest: () => [], name: () => null, assets: () => [] }
    canvas.versionKinds.register(props)
    expect(() => canvas.versionKinds.register({ ...props })).toThrow('registry key "prop" is already registered by the version kind prop')
    const upscale: NodeAction = { id: '@dv/ui-image-upscale:upscale', label: () => '放大', order: 1, shows: (_node): _node is NodeView => true, run: () => undefined }
    canvas.actions.register(upscale)
    expect(() => canvas.actions.register({ ...upscale })).toThrow('registry key "@dv/ui-image-upscale:upscale" is already registered by @dv/ui-image-upscale')
    const timelines: AddMenuSection = { id: '@dv/ui-timeline', order: 1, label: () => '时间线', items: () => [] }
    canvas.addMenu.register(timelines)
    expect(() => canvas.addMenu.register({ ...timelines })).toThrow('registry key "@dv/ui-timeline" is already registered by @dv/ui-timeline')
  })
})
