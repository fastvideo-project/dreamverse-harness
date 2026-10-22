/**
 * The client reference model over the calls of evidence E3: the round-trip law of a stored call, the edits R1, R2,
 * R3′ with the rule for a citation that two inputs satisfy, the undo of an edit through the editor, and version pins.
 */
import { describe, expect, it } from 'vitest'
import { requestInputsOf } from '@dv/ui-kit/references.ts'
import type { ProjectAsset, WireState } from '@dv/ui-kit/types.ts'
import { fixtureState, record } from '../../ui-kit/tests/fixture.client.tsx'
import type { CallInput, PromptCall, PromptDocument, ReferenceAtom } from '../src/client/contract/index.ts'
import {
  callOf, deleteAtom, documentOf, editorContent, isAtom, pinVersion, reconcile, removeInput, resolveAtom, resolveInput,
  runsOfEditor, satisfyingIndexes, type ResolveContext, type VersionReader,
} from '../src/client/reference-model.ts'

/** One image asset. */
const image = (id: string): ProjectAsset => ({
  id, mime: 'image/png', name: `${id}.png`, size_bytes: 1, created_by: null, created_at: '', width: null, height: null, duration_sec: null, made_by: null,
})

/** The character c1 (Mia): version 1 holds a1 and a2, version 2 holds a5. */
const MIA: VersionReader = {
  kind: 'character',
  name: (_state, id, version) => id === 'c1' && (version === 1 || version === 2) ? 'Mia' : null,
  assets: (_state, id, version) => id !== 'c1' ? [] : version === 1 ? ['a1', 'a2'] : version === 2 ? ['a5'] : [],
  latest: () => [{ id: 'c1', version: 2 }],
  node: id => `character:${id}`,
}

/** A state with five images and the take g1, whose output 0 is a4. */
const BASE = fixtureState()
const STATE: WireState = {
  ...BASE, assets: ['a1', 'a2', 'a3', 'a4', 'a5'].map(image),
  components: { ...BASE.components, proj: { ...BASE.components.proj, records: [record({ id: 'g1', outputs: ['a4'] })] } },
}

/** The resolve context of a document's inputs. */
function ctx(inputs: readonly CallInput[] | null): ResolveContext {
  return { state: STATE, versions: [MIA], inputs, filter: null }
}

const reference = (ref: string): CallInput => ({ role: 'reference', ref })
const call = (prompt: string, inputs: CallInput[]): PromptCall => ({
  operation: 'shot.render', params: { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt }, inputs,
})
const atoms = (document: PromptDocument): ReferenceAtom[] => document.runs.filter(isAtom)

/** The calls of E3 (section 3) and the stored forms that the kernel reads but the writer never writes. */
const E3_CALLS = {
  'S4 take with an uncited version': call('Mia walks through the rain', [reference('c1@1')]),
  'S5(i) asset cited': call('@[Lamp](dv:asset/a1) glows', [reference('a1')]),
  'S5(ii) asset of a version cited': call('@[Lamp](dv:asset/a1) glows', [reference('c1@1')]),
  'S5(iii) stored order differs from citation order': call('@[Lamp](dv:asset/a3) lights @[Mia](dv:character/c1)', [reference('c1@1'), reference('a3')]),
  'S5(iv) cited first frame': call('@[Mia](dv:character/c1) from @[首帧](dv:input/first_frame)', [reference('c1@1'), { role: 'first_frame', ref: 'g1#0' }]),
  'S6 start': call('@[Mia](dv:character/c1) holds the lamp from @[Take 3](dv:asset/a4)', [reference('c1@1'), reference('g1#0')]),
  'V2 empty label and a line break': call('@[](dv:asset/a1) and @[Mia\nfront](dv:asset/a2)', [reference('c1@1')]),
} satisfies Record<string, PromptCall>

describe('the round-trip law', () => {
  it.each(Object.entries(E3_CALLS))('a stored call comes back unchanged through its document and the editor: %s', (_name, stored) => {
    const document = documentOf(stored)
    expect(callOf(document, stored)).toEqual(stored)
    const content = editorContent(document)
    expect(callOf({ ...document, runs: runsOfEditor(content.text, content.chips) }, stored)).toEqual(stored)
  })

  it('keeps a call without a prompt param as it is', () => {
    const bare: PromptCall = { operation: 'asset.import', params: { path: 'x' }, inputs: [] }
    expect(callOf(documentOf(bare), bare)).toEqual(bare)
  })

  it('fails under the derived order, which renumbers the model labels of an unedited resend', () => {
    const stored = E3_CALLS['S5(iii) stored order differs from citation order']
    const document = documentOf(stored)
    // The rejected model derives the inputs: each atom's input by first citation, then the uncited ones.
    const cited = atoms(document).flatMap(atom => satisfyingIndexes(atom.uri, stored.inputs, ctx(stored.inputs)))
    const order = [...new Set([...cited, ...stored.inputs.keys()])]
    expect(order.map(index => stored.inputs[index])).not.toEqual(stored.inputs)
    expect(callOf(document, stored).inputs).toEqual(stored.inputs)
  })
})

describe('the edits', () => {
  it('R1: a new chip that no input satisfies appends its input; an element enters at its newest version', () => {
    const before = documentOf(call('the lamp glows', [reference('a3')]))
    const runs = [...before.runs, { label: 'Mia', uri: 'dv:character/c1' }]
    expect(reconcile(before, runs, [], ctx(before.inputs)).document.inputs).toEqual([reference('a3'), reference('c1@2')])
    const asset = reconcile(before, [...before.runs, { label: 'Take', uri: 'dv:asset/a4' }], [], ctx(before.inputs))
    expect(asset.document.inputs).toEqual([reference('a3'), reference('a4')])
  })

  it('R2: removing the version turns its chip into its label, so every citation stays satisfied (S6)', () => {
    const document = documentOf(E3_CALLS['S6 start'])
    const { document: next } = removeInput(document, 0, ctx(document.inputs))
    expect(next.inputs).toEqual([reference('g1#0')])
    expect(callOf(next, E3_CALLS['S6 start']).params['prompt']).toBe('Mia holds the lamp from @[Take 3](dv:asset/a4)')
    expect(atoms(next).every(atom => satisfyingIndexes(atom.uri, next.inputs, ctx(next.inputs)).length > 0)).toBe(true)
    // Today's take editor drops the input and keeps the citation, which no input satisfies.
    const dropped = { ...document, inputs: [reference('g1#0')] }
    expect(atoms(dropped).map(atom => resolveAtom(atom, ctx(dropped.inputs)).satisfied)).toEqual([false, true])
  })

  it('R3′: deleting the last chip of an input removes the input; an input cited elsewhere or never cited stays', () => {
    const document = documentOf(E3_CALLS['S6 start'])
    const remaining = atoms(document).slice(1)
    expect(deleteAtom(document.inputs, 'dv:character/c1', remaining, ctx(document.inputs)).inputs).toEqual([reference('g1#0')])
    // Two Mia chips: deleting one keeps c1@1.
    const twice = documentOf(call('@[Mia](dv:character/c1) and @[Mia](dv:character/c1)', [reference('c1@1')]))
    expect(deleteAtom(twice.inputs, 'dv:character/c1', atoms(twice).slice(1), ctx(twice.inputs)).inputs).toEqual([reference('c1@1')])
    // The uncited version of S4 stays when a chip of another input goes.
    const s4 = { runs: [{ text: 'Mia walks ' }], inputs: [reference('c1@1'), reference('a3')] }
    expect(deleteAtom(s4.inputs, 'dv:asset/a3', [], ctx(s4.inputs)).inputs).toEqual([reference('c1@1')])
  })

  it('R3′: deleting a chip that an asset and a version both satisfy keeps both inputs (E3 S5(ii))', () => {
    const document = documentOf(call('@[Lamp](dv:asset/a1) glows', [reference('a1'), reference('c1@1')]))
    expect(satisfyingIndexes('dv:asset/a1', document.inputs, ctx(document.inputs))).toEqual([0, 1])
    const { inputs, removed } = deleteAtom(document.inputs, 'dv:asset/a1', [], ctx(document.inputs))
    expect([inputs, removed]).toEqual([[reference('a1'), reference('c1@1')], null])
  })

  it('an editor undo that brings a deleted chip back restores the input at its old place', () => {
    const stored = E3_CALLS['S6 start']
    const document = documentOf(stored)
    const deleted = reconcile(document, document.runs.slice(1), [], ctx(document.inputs))
    expect(deleted.document.inputs).toEqual([reference('g1#0')])
    const undone = reconcile(deleted.document, document.runs, deleted.removed, ctx(deleted.document.inputs))
    expect(undone.document.inputs).toEqual(stored.inputs)
    expect(undone.removed).toEqual([])
    // An undo of R2 brings the chip back the same way.
    const tile = removeInput(document, 0, ctx(document.inputs))
    expect(reconcile(tile.document, document.runs, tile.removed, ctx(tile.document.inputs)).document.inputs).toEqual(stored.inputs)
  })

  it('R5′: pinning a version rewrites its input, and every chip of the element names the new version', () => {
    const document = documentOf(E3_CALLS['S6 start'])
    const pinned = pinVersion(document, 0, 2)
    expect(pinned.inputs).toEqual([reference('c1@2'), reference('g1#0')])
    expect(resolveAtom({ label: 'Mia', uri: 'dv:character/c1' }, ctx(pinned.inputs)).version).toEqual({ sent: 2, newest: 2 })
    expect(resolveAtom({ label: 'Mia', uri: 'dv:character/c1' }, ctx(document.inputs)).version).toEqual({ sent: 1, newest: 2 })
    // In chat a chip names the newest version and no sent version.
    expect(resolveAtom({ label: 'Mia', uri: 'dv:character/c1' }, ctx(null))).toMatchObject({ version: null, preview: { id: 'a5' } })
  })

  it('folds the version fan-out of a stored record into one request input', () => {
    const version = { character: 'c1', version: 1 }
    const record = { inputs: [
      { role: 'reference', ref: version, resolved_asset: 'a1' }, { role: 'reference', ref: version, resolved_asset: 'a2' },
      { role: 'first_frame', ref: { record: 'g1', output: 0 }, resolved_asset: 'a4' },
    ] }
    expect(requestInputsOf(record)).toEqual([reference('c1@1'), { role: 'first_frame', ref: 'g1#0' }])
  })
})

describe('the readers of a document', () => {
  it('reads a chip whose text is no citation as plain text', () => {
    expect(runsOfEditor('a cat here', [{ ref: 'cat', label: 'cat', offset: 2, length: 3 }])).toEqual([{ text: 'a ' }, { text: 'cat' }, { text: ' here' }])
  })

  it('satisfies an input citation by an input of its role only, and a record citation by no input', () => {
    const inputs = [reference('a3'), { role: 'first_frame', ref: 'g1#0' }]
    expect([
      satisfyingIndexes('dv:input/first_frame', inputs, ctx(inputs)), satisfyingIndexes('dv:input/reference', inputs, ctx(inputs)),
      satisfyingIndexes('dv:asset/a4', inputs, ctx(inputs)), satisfyingIndexes('dv:record/g1', inputs, ctx(inputs)),
    ]).toEqual([[1], [], [], []])
  })

  it('adds no input for a new chip that no input can satisfy: a record, or an element without an item', () => {
    const before = documentOf(call('the lamp glows', [reference('a3')]))
    for (const uri of ['dv:record/g1', 'dv:character/c9', 'dv:prop/p1']) {
      expect(reconcile(before, [...before.runs, { label: 'X', uri }], [], ctx(before.inputs)).document.inputs).toEqual([reference('a3')])
    }
  })

  it('keeps the input and remembers nothing when one of two chips of one version goes', () => {
    const twice = documentOf(call('@[Mia](dv:character/c1) and @[Mia](dv:character/c1)', [reference('c1@1')]))
    const next = reconcile(twice, twice.runs.slice(1), [], ctx(twice.inputs))
    expect([next.document.inputs, next.removed]).toEqual([[reference('c1@1')], []])
  })

  it('changes nothing for a removal or a pin of an input that the document does not hold, or that names no version', () => {
    const document = documentOf(E3_CALLS['S6 start'])
    expect([removeInput(document, 5, ctx(document.inputs)).document, pinVersion(document, 5, 2), pinVersion(document, 1, 2)])
      .toEqual([document, document, document])
  })

  it('draws a version by the assets that the state holds, and a version that no newest item names as its own newest', () => {
    const state = { ...STATE, assets: STATE.assets.filter(asset => asset.id !== 'a2') }
    const view = resolveInput(reference('c1@1'), { ...ctx([reference('c1@1')]), state })
    expect([view.label, view.assets.map(asset => asset.id), view.version]).toEqual(['Mia', ['a1'], { sent: 1, newest: 2 }])
    const lost: VersionReader = { ...MIA, latest: () => [] }
    expect(resolveInput(reference('c1@1'), { ...ctx([reference('c1@1')]), versions: [lost] }).version).toEqual({ sent: 1, newest: 1 })
  })

  it('draws an unknown output, an unknown asset and an element of an unloaded kind with nothing to open', () => {
    expect(resolveInput(reference('g9#0'), ctx([reference('g9#0')]))).toMatchObject({ label: 'g9#0', preview: null, open: null, satisfied: false })
    expect(resolveAtom({ label: 'Gone', uri: 'dv:asset/gone' }, ctx([]))).toMatchObject({ preview: null, open: null, satisfied: false })
    expect(resolveAtom({ label: 'Prop', uri: 'dv:prop/p1' }, ctx(null))).toMatchObject({ preview: null, open: null, satisfied: true, version: null })
  })

  it('draws an input citation by its input\'s assets, and by none in chat', () => {
    const inputs = [{ role: 'first_frame', ref: 'g1#0' }]
    expect(resolveAtom({ label: '首帧', uri: 'dv:input/first_frame' }, ctx(inputs))).toMatchObject({ preview: { id: 'a4' }, open: { asset: 'a4' } })
    expect(resolveAtom({ label: '首帧', uri: 'dv:input/first_frame' }, ctx(null))).toMatchObject({ assets: [], preview: null })
  })

  it('reads a version through the reader of its kind only, and draws a version that no reader holds as an unknown asset', () => {
    // The style s1 has a version 1 with no reference image.
    const style: VersionReader = { kind: 'style', name: (_state, id) => id === 's1' ? 'Noir' : null, assets: () => [], latest: () => [], node: id => `style:${id}` }
    const readers = { ...ctx([reference('c1@1'), reference('s1@1')]), versions: [style, MIA] }
    expect(satisfyingIndexes('dv:character/c1', readers.inputs ?? [], readers)).toEqual([0])
    expect(resolveInput(reference('s1@1'), readers)).toMatchObject({ label: 'Noir', preview: null, open: { node: 'style:s1' } })
    expect(resolveInput(reference('c9@1'), readers)).toMatchObject({ uri: '', label: 'c9@1', assets: [], satisfied: false, version: null })
  })

  it('marks a reference whose media type the selected model does not take', () => {
    const filter = { mediaTypes: ['audio'], maxReferences: null }
    expect([resolveInput(reference('a3'), { ...ctx([reference('a3')]), filter }).fits, resolveInput(reference('a3'), ctx([reference('a3')])).fits])
      .toEqual([false, true])
  })
})
