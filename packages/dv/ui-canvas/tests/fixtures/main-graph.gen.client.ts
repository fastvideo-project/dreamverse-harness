/**
 * Write `main-graph.json`: the graph that the canvas of `origin/main` at the merge base of `HEAD` draws for each
 * conformance case, with the node types that `main` registered for the reference noun `test_ref` (`defineReferenceUi`)
 * and the plan (`planNodeType`), the chain anchor and clip uses of `conformance-states.ts`, and the card heights of
 * `main`'s `nodeHeight` (`NodeCard.tsx:71-77`). The script reads `main`'s builder with `git show`, so it reruns
 * unchanged. Run: pnpm exec tsx packages/dv/ui-canvas/tests/fixtures/main-graph.gen.client.ts
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { WireState } from '@dv/ui-kit/types.ts'
import { APPROVAL, CLIPS, conformanceCases, OPS } from './conformance-states.client.ts'
import type { ComparedGraph, ComparedNode } from './conformance-states.client.ts'

const root = resolve(import.meta.dirname, '../../../../..')
/** The commit of `origin/main` that the branch starts from, whose canvas the check compares against. */
const BASE = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim()
const show = (path: string): string => execFileSync('git', ['show', `${BASE}:${path}`], { cwd: root, encoding: 'utf8' })

/** One reference noun version and one plan version, as the cases' slices hold them. */
interface Version { version: number; name: string; references: readonly string[]; created_by: string; shots?: unknown[] }
/** The fields of a node of `main`'s `buildCanvasGraph` that the check reads. */
interface MainNode {
  id: string
  type: 'asset' | 'take' | 'entry'
  nodeType?: { type: string }
  entry?: { slots?: number }
  x: number
  y: number
  take: number | null
  badges: string[]
  flags: ComparedNode['flags']
  thumb: string | null
  video: string | null
}
/** The exports of `main`'s graph module that the script calls. */
interface MainGraph {
  buildCanvasGraph(...args: unknown[]): {
    nodes: MainNode[]
    edges: Array<{ from: string; to: string; kind: string }>
    assetNodes: Record<string, string>
  }
  slotFrames(nodes: MainNode[], id: string, slots: number): Array<{ thumb: string | null; video: string | null } | null>
}

/** The newest version of each `test_ref` item, as `main`'s `defineReferenceUi` read it. */
const newest = (state: WireState): Array<{ id: string; latest: Version; versions: Version[] }> =>
  Object.entries((state.components['test_ref'] ?? {}) as Record<string, Version[]>).flatMap(([id, versions]) => {
    const latest = versions.at(-1)
    return latest === undefined ? [] : [{ id, latest, versions }]
  })
const testRefType = {
  id: '@dv/ui-test-ref', type: 'test_ref', label: () => '参考', color: '', column: 0,
  entries(state: WireState) {
    const records = new Map(state.components.proj.records.map(entry => [entry.id, entry]))
    return newest(state).map(({ id, latest, versions }) => ({
      id: `test_ref:${id}`, record: records.get(latest.created_by) ?? null, records: versions.slice(0, -1).map(version => version.created_by),
      title: latest.name || id, media: [...latest.references],
    }))
  },
}
const testRefVersionKind = {
  kind: 'test_ref', label: () => '参考', node: (id: string) => `test_ref:${id}`,
  latest: (state: WireState) => newest(state).map(({ id, latest }) => ({ id, version: latest.version })),
  name: () => null, assets: () => [],
}
const testRefInUse = {
  id: '@dv/ui-test-ref',
  uses: (state: WireState) => newest(state).flatMap(({ latest }) => latest.references)
    .flatMap(ref => state.components.proj.created_by[ref] ?? []),
}
const planType = {
  id: '@dv/ui-shot-plan', type: 'plan', label: () => '分镜计划', color: '', column: 1,
  entries(state: WireState) {
    const records = new Map(state.components.proj.records.map(entry => [entry.id, entry]))
    const plans = ((state.components['plan'] as { plans: Record<string, Version[]> } | undefined)?.plans ?? {})
    return Object.entries(plans).flatMap(([id, versions]) => {
      const latest = versions.at(-1)
      return latest === undefined ? [] : [{
        id: `plan:${id}`, record: records.get(latest.created_by) ?? null, records: versions.slice(0, -1).map(version => version.created_by),
        subtitle: '', title: '', media: [], slots: latest.shots?.length ?? 0,
      }]
    })
  },
}

/** `nodeHeight` of `main`'s `NodeCard.tsx:71-77`. */
function mainHeight(node: MainNode, hasFrames: boolean): number {
  switch (node.type) {
    case 'take': return node.flags.failed ? 52 : 147
    case 'asset': return 147
    default: return node.entry?.slots === undefined ? 60 : hasFrames ? 140 : 76
  }
}

const OLD_EDGE: Record<string, string> = { reference: 'input', first_frame: 'input:first_frame', chain: 'chain', take: 'lineage' }

const dir = mkdtempSync(join(tmpdir(), 'dv-main-graph-'))
try {
  // `main`'s builder and the ui-kit modules it imports, with the ui-kit imports made relative.
  for (const [name, path] of [['graph', 'ui-canvas/src/client/graph.ts'], ['chain', 'ui-kit/src/client/chain.ts'], ['references', 'ui-kit/src/client/references.ts'], ['state', 'ui-kit/src/client/state.ts']] as const) {
    writeFileSync(join(dir, `${name}.ts`), show(`packages/dv/${path}`).replaceAll('@dv/ui-kit/', './'))
  }
  const main = await import(pathToFileURL(join(dir, 'graph.ts')).href) as MainGraph
  const graphs: Record<string, ComparedGraph> = {}
  for (const { name, state, placed } of conformanceCases()) {
    const graph = main.buildCanvasGraph(state, new Set(placed), OPS, 'zh', [APPROVAL], [testRefInUse, CLIPS], [testRefType, planType], [testRefVersionKind])
    const nodes = graph.nodes.map((node): ComparedNode => {
      const slots = node.entry?.slots
      const frames = node.type === 'entry' && slots !== undefined
        ? main.slotFrames(graph.nodes, node.id, slots).map(frame => frame === null ? null : frame.thumb ?? frame.video)
        : null
      return {
        id: node.id, type: node.type === 'entry' ? node.nodeType?.type ?? '' : node.type, x: node.x, y: node.y, number: node.take,
        badges: node.badges, flags: node.flags, finished: node.type === 'take' && !node.flags.rendering && (node.video !== null || node.thumb !== null),
        height: mainHeight(node, frames?.some(frame => frame !== null) === true), frames,
      }
    })
    const edges = graph.edges.map(edge => `${edge.from}>${edge.to}:${OLD_EDGE[edge.kind] ?? edge.kind}`).sort()
    graphs[name] = { nodes, edges, assetNodes: graph.assetNodes }
  }
  writeFileSync(join(import.meta.dirname, 'main-graph.json'), `${JSON.stringify(graphs, null, 1)}\n`)
  console.log(`wrote ${String(Object.keys(graphs).length)} graphs`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
