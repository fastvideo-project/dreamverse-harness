/**
 * Write `main-graph.json`: what the canvas and the History panel of `origin/main` at the merge base of `HEAD` show for
 * each conformance case. The script copies `main`'s graph builder, card, locales, reference kit, plan plugin and
 * History rows with `git show` into a scratch directory beside this file, and draws each case with `main`'s
 * descriptors plus the chain anchor and clip uses of `conformance-states.client.ts`.
 * Run: pnpm exec tsx packages/dv/ui-canvas/tests/fixtures/main-graph.gen.client.ts
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ProjectRecord, WireOperation, WireState } from '@dv/ui-kit/types.ts'
import { APPROVAL, CLIPS, conformanceCases, OPS } from './conformance-states.client.ts'
import type { ComparedGraph, ComparedNode } from './conformance-states.client.ts'

const root = resolve(import.meta.dirname, '../../../../..')
const BASE = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim()
const show = (path: string): string => execFileSync('git', ['show', `${BASE}:${path}`], { cwd: root, encoding: 'utf8' })

interface MainNode {
  id: string
  type: 'asset' | 'take' | 'entry'
  nodeType?: { type: string }
  entry?: { slots?: number }
  title: string
  x: number
  y: number
  take: number | null
  durationSec: number | null
  badges: string[]
  flags: ComparedNode['flags']
  thumb: string | null
  video: string | null
}
type Descriptor = object
interface MainLabelContext {
  operations: readonly WireOperation[]
  rows: Descriptor[]
  records: ReadonlyMap<string, ProjectRecord>
}
interface Main {
  graph: {
    buildCanvasGraph(...args: unknown[]): {
      nodes: MainNode[]
      edges: Array<{ from: string; to: string; kind: string }>
      assetNodes: Record<string, string>
    }
    slotFrames(nodes: MainNode[], id: string, slots: number): Array<{ thumb: string | null; video: string | null } | null>
  }
  card: { nodeTitle(node: MainNode, t: (key: string, params?: Record<string, unknown>) => string): string }
  locales: { zh: Record<string, string> }
  kit: {
    defineReferenceUi(spec: object): { nodeType: Descriptor; versionKind: Descriptor; referencesInUse: Descriptor; historyRow: Descriptor }
  }
  plan: { planNodeType: Descriptor; planReferencesInUse: Descriptor; planHistoryRow: Descriptor }
  rows: {
    actionLabel(record: ProjectRecord, context: MainLabelContext): readonly [string, string]
  }
}

const SOURCES = [
  'packages/dv/ui-canvas/src/client/graph.ts', 'packages/dv/ui-canvas/src/client/NodeCard.tsx',
  'packages/dv/ui-canvas/src/client/locales.ts', 'packages/dv/ui-shot-plan/src/client/index.ts',
  'packages/dv/ui-shot-plan/src/client/PlanEditor.tsx', 'packages/dv/ui-history/src/client/rows.ts',
  ...execFileSync('git', ['ls-tree', '--name-only', `${BASE}:packages/dv/ui-kit/src/client/`], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(name => name !== '').map(name => `packages/dv/ui-kit/src/client/${name}`),
]

function mainHeight(node: MainNode, hasFrames: boolean): number {
  switch (node.type) {
    case 'take': return node.flags.failed ? 52 : 147
    case 'asset': return 147
    default: return node.entry?.slots === undefined ? 60 : hasFrames ? 140 : 76
  }
}

const OLD_EDGE: Record<string, string> = { reference: 'input', first_frame: 'input:first_frame', chain: 'chain', take: 'lineage' }

// `main`'s modules read the interface language from `<html lang>`; the cases are drawn in Chinese.
Object.assign(globalThis, { document: { documentElement: { lang: 'zh-CN' } } })
// Inside the package, so that `main`'s React imports resolve to this package's dependencies.
const dir = mkdtempSync(join(import.meta.dirname, '.main-'))
try {
  const kitDir = join(dir, 'packages/dv/ui-kit/src/client')
  for (const path of SOURCES) {
    const target = join(dir, path)
    const kit = relative(dirname(target), kitDir) || '.'
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, show(path).replaceAll('\'@dv/ui-kit/', `'${kit.startsWith('.') ? kit : `./${kit}`}/`))
  }
  const load = (path: string): Promise<unknown> => import(pathToFileURL(join(dir, path)).href)
  const main = {
    graph: await load('packages/dv/ui-canvas/src/client/graph.ts'),
    card: await load('packages/dv/ui-canvas/src/client/NodeCard.tsx'),
    locales: await load('packages/dv/ui-canvas/src/client/locales.ts'),
    kit: await load('packages/dv/ui-kit/src/client/reference-kit.tsx'),
    plan: await load('packages/dv/ui-shot-plan/src/client/index.ts'),
    rows: await load('packages/dv/ui-history/src/client/rows.ts'),
  } as Main
  const testRef = main.kit.defineReferenceUi({
    id: '@dv/ui-test-ref', key: 'test_ref', slice: (state: WireState) => state.components['test_ref'],
    label: ['参考', 'Reference'], mention: { section: ['参考', 'References'], order: 1 },
  })
  const t = (key: string, params: Record<string, unknown> = {}): string =>
    (main.locales.zh[key] ?? key).replace(/\{(\w+)\}/g, (_whole, name: string) => String(params[name]))
  const graphs: Record<string, ComparedGraph> = {}
  for (const { name, state, placed } of conformanceCases()) {
    const graph = main.graph.buildCanvasGraph(
      state, new Set(placed), OPS, 'zh', [APPROVAL], [testRef.referencesInUse, main.plan.planReferencesInUse, CLIPS],
      [testRef.nodeType, main.plan.planNodeType], [testRef.versionKind],
    )
    const nodes = graph.nodes.map((node): ComparedNode => {
      const slots = node.entry?.slots
      const frames = node.type === 'entry' && slots !== undefined
        ? main.graph.slotFrames(graph.nodes, node.id, slots).map(frame => frame === null ? null : frame.thumb ?? frame.video)
        : null
      return {
        id: node.id, type: node.type === 'entry' ? node.nodeType?.type ?? '' : node.type, x: node.x, y: node.y, number: node.take,
        title: main.card.nodeTitle(node, t), meta: node.durationSec === null ? null : `${node.durationSec.toFixed(1)}s`,
        badges: node.badges, flags: node.flags, finished: node.type === 'take' && !node.flags.rendering && (node.video !== null || node.thumb !== null),
        height: mainHeight(node, frames?.some(frame => frame !== null) === true), frames,
      }
    })
    const edges = graph.edges.map(edge => `${edge.from}>${edge.to}:${OLD_EDGE[edge.kind] ?? edge.kind}`).sort()
    const records = new Map(state.components.proj.records.map(record => [record.id, record]))
    const context = { operations: OPS, rows: [testRef.historyRow, main.plan.planHistoryRow], records }
    const labels = Object.fromEntries([...records.values()].map(record => [record.id, main.rows.actionLabel(record, context)[0]]))
    graphs[name] = { nodes, edges, assetNodes: graph.assetNodes, labels }
  }
  writeFileSync(join(import.meta.dirname, 'main-graph.json'), `${JSON.stringify(graphs, null, 1)}\n`)
  console.log(`wrote ${String(Object.keys(graphs).length)} graphs`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
