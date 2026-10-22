/**
 * The browser half of a reference noun: a component whose slice holds every version of each item, such as the
 * characters of `@dv/ui-character`. `defineReferenceUi` turns one declaration into the UI plugin that registers the
 * noun's canvas node type with its `dv.canvas.card` and `dv.canvas.editor` entries, its version kind, its references in
 * use, its `@` menu kind and its History row. Every descriptor reads only the noun's own slice and the `proj` records,
 * and every write runs `<key>.update` through the canvas host.
 *
 * @module @dv/ui-reference-kit/reference-kit
 */
import type { CSSProperties, ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NodeEntry, NodeType, RecordsInUse } from '@dv/ui-canvas/contract'
import { pickText, useText } from '@dv/ui-kit/locale.ts'
import type { HistoryRow } from '@dv/ui-history/contract'
import type { MentionKind, UiPlugin, VersionKind } from '@dv/ui-kit/registries.ts'
import type { Asset, WireState } from '@dv/ui-kit/types.ts'
import type {} from '@dv/ui-media/contract'

/** One version of a reference noun item as the wire sends it. */
export interface WireReferenceVersion {
  id: string
  version: number
  name: string
  description: string
  references: readonly string[]
  created_by: string
}

/** The declaration of one reference noun in the browser. */
export interface ReferenceUiSpec<V extends WireReferenceVersion = WireReferenceVersion> {
  /** Package name, such as '@dv/ui-character': the owner of every descriptor. */
  id: string
  /** Component key = reference kind = node type = node ID prefix, such as 'character'. */
  key: string
  /** The noun's slice, such as `state => state.components.character`; undefined while the host half is not loaded. */
  slice: (state: WireState) => Readonly<Record<string, readonly V[]>> | undefined
  /** A slot of the theme's node palette, such as `var(--dv-node-1)`: the type dot and the edges of the noun's nodes. */
  color: string
  /** Card label and picker section, such as ['角色', 'Character']. */
  label: readonly [zh: string, en: string]
  /** The `@` menu section and its order, such as { section: ['角色', 'Characters'], order: 1 }. */
  mention: { section: readonly [zh: string, en: string]; order: number }
}

/** The body height of a noun card: one row with the first reference, the type label and the count of the others. */
const BODY_HEIGHT = 30

/** Every item of a noun by ID; a state without the noun's slice holds none, as the initial slice of the host half. */
const itemsOf = <V extends WireReferenceVersion>(
  spec: ReferenceUiSpec<V>, state: WireState,
): Readonly<Record<string, readonly V[]>> => spec.slice(state) ?? {}

/**
 * Every item of a noun at its newest version, in slice order; an ID without versions is left out.
 * @param spec - the noun.
 * @param state - a project state.
 * @returns the ID, the newest version and every version of each item.
 */
function newestOf<V extends WireReferenceVersion>(
  spec: ReferenceUiSpec<V>, state: WireState,
): Array<{ id: string; latest: V; versions: readonly V[] }> {
  return Object.entries(itemsOf(spec, state)).flatMap(([id, versions]) => {
    const latest = versions.at(-1)
    return latest === undefined ? [] : [{ id, latest, versions }]
  })
}

/** The descriptors of one noun. */
interface ReferenceDescriptors {
  nodeType: NodeType
  versionKind: VersionKind
  referencesInUse: RecordsInUse
  mentionKind: MentionKind
  historyRow: HistoryRow
}

/**
 * Build the descriptors of one reference noun from its declaration: the node type draws one slice node `<key>:<id>`
 * per item at its newest version, the version kind reads every version, the references in use are the producers of
 * the newest references, the mention kind lists `dv:<key>/<id>` items, and the History row names the item of each
 * `<key>.` record.
 * @param spec - the noun.
 * @returns the descriptors.
 */
export function referenceDescriptors<V extends WireReferenceVersion>(spec: ReferenceUiSpec<V>): ReferenceDescriptors {
  const { key } = spec
  const node = (id: string): string => `${key}:${id}`
  const versionOf = (state: WireState, id: string, version: number): V | undefined =>
    itemsOf(spec, state)[id]?.find(entry => entry.version === version)
  const nodeType: NodeType = {
    id: spec.id,
    type: key,
    label: () => pickText(...spec.label),
    color: spec.color,
    column: 0,
    entries({ state }) {
      const records = new Map(state.components.proj.records.map(record => [record.id, record]))
      return newestOf(spec, state).map(({ id, latest, versions }): NodeEntry => ({
        id: node(id), title: latest.name || id, record: records.get(latest.created_by) ?? null,
        records: versions.slice(0, -1).map(entry => entry.created_by), assets: [...latest.references], bodyHeight: BODY_HEIGHT,
        ref: { kind: key, id },
      }))
    },
  }
  const versionKind: VersionKind = {
    kind: spec.key,
    label: () => pickText(...spec.label),
    node,
    latest: state => newestOf(spec, state).map(({ id, latest }) => ({ id, version: latest.version })),
    name: (state, id, version) => versionOf(state, id, version)?.name ?? null,
    assets: (state, id, version) => [...versionOf(state, id, version)?.references ?? []],
  }
  const referencesInUse: RecordsInUse = {
    id: spec.id,
    uses(state) {
      const createdBy = state.components.proj.created_by
      return newestOf(spec, state).flatMap(({ latest }) => latest.references).flatMap(reference => createdBy[reference] ?? [])
    },
  }
  const mentionKind: MentionKind = {
    id: spec.id,
    kind: spec.key,
    order: spec.mention.order,
    section: () => pickText(...spec.mention.section),
    items: state => newestOf(spec, state).map(({ id, latest }) => {
      const thumb = latest.references[0]
      return {
        uri: `dv:${key}/${encodeURIComponent(id)}`, label: latest.name || id, description: latest.description.slice(0, 40),
        ...thumb === undefined ? {} : { thumb },
      }
    }),
  }
  const historyRow: HistoryRow = {
    match: `${key}.`,
    // The name that the record gives its item, else the item ID of the noun's ID param.
    subject(record) {
      for (const param of ['name', key]) {
        const value = record.params[param]
        const name = typeof value === 'number' ? String(value) : value
        if (typeof name === 'string' && name !== '') return [`「${name}」`, ` “${name}”`]
      }
      return null
    },
  }
  return { nodeType, versionKind, referencesInUse, mentionKind, historyRow }
}

/**
 * Define the UI plugin of one reference noun. The plugin registers its descriptors while their services are present,
 * and its card and editor entries once the canvas declares their slots, each in any load order; every registration
 * leaves with its service or with the plugin.
 * @param spec - the noun.
 * @returns what Cordis loads.
 */
export function defineReferenceUi<V extends WireReferenceVersion>(spec: ReferenceUiSpec<V>): UiPlugin {
  const { nodeType, versionKind, referencesInUse, mentionKind, historyRow } = referenceDescriptors(spec)
  const Card = (props: PropsRuntime<'dv.canvas.card'> & PropsRenderFactories): ReactNode => <ReferenceCard {...props} label={spec.label} />
  const Editor = (props: PropsRuntime<'dv.canvas.editor'> & PropsRenderFactories): ReactNode => <ReferenceEditor {...props} spec={spec} />
  return {
    inject: [],
    apply: (ctx) => {
      // The node type registers first in the one scope of the noun, so a refused type leaves nothing of the noun behind.
      ctx.inject(['dvCanvas', 'slots'], (scope) => {
        scope.effect(() => scope.dvCanvas.nodeTypes.register(nodeType), `${spec.id}: node type`)
        scope.effect(() => scope.dvCanvas.recordsInUse.register(referencesInUse), `${spec.id}: references in use`)
        scope.effect(() => scope.dvCanvas.versionKinds.register(versionKind), `${spec.id}: version kind`)
        scope.effect(() => scope.slots.inject('dv.canvas.card', () => scope.slots.register(
          { name: 'dv.canvas.card', key: spec.key }, Card,
        )), `${spec.id}: card`)
        scope.effect(() => scope.slots.inject('dv.canvas.editor', () => scope.slots.register(
          { name: 'dv.canvas.editor', key: spec.key }, Editor,
        )), `${spec.id}: editor`)
        scope.inject(['dvMentions'], (mentions) => {
          mentions.effect(() => mentions.dvMentions.kinds.register(mentionKind), `${spec.id}: mention kind`)
        })
        scope.inject(['dvHistory'], (history) => {
          history.effect(() => history.dvHistory.rows.register(historyRow), `${spec.id}: history row`)
        })
      })
    },
  }
}

/**
 * The card body of a noun node: its first reference, its type label, and the count of its other references.
 * @param props - the node, its assets, the text scale, the noun's label, and the Factory renderer.
 * @returns the element.
 */
function ReferenceCard(
  { node, assets, textScale, label: nounLabel, renderFactorySlot }: PropsRuntime<'dv.canvas.card'> & PropsRenderFactories & { label: readonly [zh: string, en: string] },
): ReactNode {
  const pick = useText()
  const first = assets[node.assets[0] ?? '']
  const extra = node.assets.length - 1
  const size = (base: number): number => Math.round(base * textScale)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 22, padding: '0 10px 8px', fontSize: size(12), lineHeight: `${String(size(16))}px`, color: 'var(--dv-text-2)' }}>
      <span style={{ flex: 'none', display: 'flex', width: 22, height: 22, borderRadius: 'var(--dv-radius-sm)', overflow: 'hidden', background: 'var(--dv-surface-3)' }}>
        {first === undefined ? null : renderFactorySlot('dv.media', { asset: first, purpose: 'thumb' })}
      </span>
      <span>{pick(...nounLabel)}</span>
      {extra > 0 ? <span style={{ fontFamily: 'var(--dv-font-mono)' }}>{`+${String(extra)}`}</span> : null}
    </div>
  )
}

// The `dv-canvas-btn` class of the canvas stylesheet paints the fill and the hover of these buttons.
const button: CSSProperties = {
  height: 32, border: '1px solid var(--dv-line-strong)', borderRadius: 'var(--dv-radius-md)', padding: '0 12px', fontFamily: 'inherit', fontSize: 13,
  lineHeight: '20px', fontWeight: 500, color: 'var(--dv-text)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const label: CSSProperties = { display: 'block', fontSize: 12, lineHeight: '16px', fontWeight: 500, color: 'var(--dv-text-2)', margin: '12px 0 4px' }
const referenceImage: CSSProperties = { display: 'flex', height: 220, borderRadius: 'var(--dv-radius-md)', overflow: 'hidden', background: 'var(--dv-surface-3)' }

/**
 * The box of one reference: 220 px tall at the asset's aspect ratio, or square for an asset of unknown dimensions or
 * one that the state does not hold.
 * @param asset - the reference's asset, or undefined.
 * @returns the box style.
 */
function referenceBox(asset: Asset | undefined): CSSProperties {
  const known = asset !== undefined && asset.width !== null && asset.height !== null && asset.height > 0
  return { ...referenceImage, aspectRatio: known ? `${String(asset.width)} / ${String(asset.height)}` : '1' }
}

/** Props of the editor body of one noun node. */
type ReferenceEditorProps = PropsRuntime<'dv.canvas.editor'> & PropsRenderFactories & { spec: ReferenceUiSpec }

/**
 * The references grid, the description and ＋ 添加素材 of one item; each change writes `<key>.update` through
 * `host.run`. Each reference opens the asset preview and can be removed while more than one is left; 添加素材 appends
 * the assets picked in the canvas's picker. Nothing renders when no item of the noun has the node's ID.
 * @param props - the node, the state it came from, the canvas host, the noun, and the Factory renderer.
 * @returns the element.
 */
function ReferenceEditor(props: ReferenceEditorProps): ReactNode {
  const { node, state, host, spec, renderFactorySlot } = props
  const pick = useText()
  const { key } = spec
  const prefix = `${key}:`
  const id = node.id.startsWith(prefix) ? node.id.slice(prefix.length) : null
  const latest = id === null ? undefined : itemsOf(spec, state)[id]?.at(-1)
  if (id === null || latest === undefined) return null
  const operation = `${key}.update`
  const name = latest.name || id
  const references = latest.references
  const assets = new Map(state.assets.map(asset => [asset.id, asset]))
  // `<key>.update` writes the next version with exactly these references.
  const update = (next: readonly string[], intent: string): void => {
    host.run({ operation, params: { [key]: id }, inputs: next.map(ref => ({ role: 'reference', ref })), intent })
  }
  const addReferences = (picked: readonly string[]): void => {
    const added = picked.filter(ref => !references.includes(ref))
    if (added.length > 0) update([...references, ...added], pick(`在画布上给 ${name} 添加参考`, `Add references to ${name} from the canvas`))
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {references.map((reference) => {
          const asset = assets.get(reference)
          const assetName = asset?.name ?? reference
          return (
            <div key={reference} style={{ position: 'relative' }}>
              <button
                type="button" data-reference={reference} aria-label={pick(`查看 ${assetName}`, `View ${assetName}`)}
                style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'block' }}
                onClick={(event) => { if (asset !== undefined) host.preview(reference, event.currentTarget) }}
              >
                <span style={referenceBox(asset)}>{asset === undefined ? null : renderFactorySlot('dv.media', { asset, purpose: 'card' })}</span>
              </button>
              {/* An update without references keeps the current ones, so the last reference cannot be removed. */}
              <button
                type="button" className="dv-canvas-btn" aria-label={pick(`移除 ${assetName}`, `Remove ${assetName}`)} disabled={references.length < 2}
                style={{ ...button, position: 'absolute', top: 6, right: 6, width: 28, height: 28, padding: 0, background: 'var(--dv-surface-1)', opacity: references.length < 2 ? 0.5 : 1 }}
                onClick={() => { update(references.filter(other => other !== reference), pick(`在画布上移除 ${name} 的一个参考`, `Remove a reference of ${name} from the canvas`)) }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      {latest.description === '' ? null : <><span style={label}>{pick('描述', 'Description')}</span><p style={{ margin: 0 }}>{latest.description}</p></>}
      <div style={{ marginTop: 12 }}>
        <button type="button" className="dv-canvas-btn" style={button} onClick={() => { host.pickAssets(references, { versions: false }, addReferences) }}>{pick('＋ 添加素材', '+ Add asset')}</button>
      </div>
    </div>
  )
}
