/**
 * The Canvas component in a REAL composition: a test-only `cordis.yml` boots the DSH tool registry, `dvProject`,
 * `dvFfmpeg`, the asset pool and `dvCanvasNodes` through the Loader. A test-only component `demo` names its operation
 * through `registerMaker`, as a producer does. The agent moves and resizes nodes with `dv_canvas_node_position` with no
 * canvas open, and every change is a step that undo reverts.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { brandString } from '@deepseek-ai/dsh-brand'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import DvAssetPool from '@dv/asset-pool'
import DvFfmpeg from '@dv/ffmpeg'
import DvProject, { type OperationSpec, type ProjectId, type ProjectRecord } from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import { chatProject, provideChatServices } from '../../project/tests/workspaces.ts'
import DvCanvasNodes, { type NodeId } from '../src/index.ts'

/** The plugin classes the fixture rows resolve through `globalThis`, because Node imports the rows outside Vite. */
const PLUGINS = { SystemPrompt, ToolRuntime, DvProject, DvFfmpeg, DvAssetPool, DvCanvasNodes }

/** A producer's operation that writes one record and no output. */
const MAKE: OperationSpec = {
  name: 'demo.make', component: 'demo', version: '1', description: 'Make one demo node.', params: {}, inputs: {}, outputs: [],
  deterministic: false, resource: 'none', summarize: () => 'made', execute: () => Promise.resolve({ outputs: [] }),
}

interface Fixture {
  ctx: Context
  project: ProjectId
  /** Run one tool as the agent of chat session `s1`, which runs in the folder of `project`. */
  call(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** Run `demo.make` as the human on the canvas. */
  make(basedOn?: ProjectRecord): Promise<ProjectRecord>
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/**
 * Boot the composition from a test-only `cordis.yml` and register the `demo` component and its maker.
 * @returns the fixture, with a project whose folder chat session `s1` runs in.
 */
async function start(): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'dv-canvas-'))
  const globals = globalThis as typeof globalThis & { __dvCanvasComposition?: typeof PLUGINS }
  globals.__dvCanvasComposition = PLUGINS
  const rows: string[] = []
  const row = (id: string, key: keyof typeof PLUGINS, config: string[]): void => {
    writeFileSync(join(dir, `${id}.mjs`), `export default globalThis.__dvCanvasComposition.${key}\n`)
    rows.push(`- id: ${id}`, `  name: ${pathToFileURL(join(dir, `${id}.mjs`)).href}`, ...config.length === 0 ? [] : ['  config:', ...config.map(line => `    ${line}`)])
  }
  row('system-prompt', 'SystemPrompt', [])
  row('tools', 'ToolRuntime', [])
  row('dv-project', 'DvProject', [`projectsFolder: ${join(dir, 'projects')}`])
  // The agent tools describe outputs through the asset pool, so the pool and its ffmpeg runner are mounted too.
  row('dv-ffmpeg', 'DvFfmpeg', ['ffmpegPath: ffmpeg', 'ffprobePath: ffprobe'])
  row('dv-asset-pool', 'DvAssetPool', [])
  row('dv-canvas', 'DvCanvasNodes', [])
  writeFileSync(join(dir, 'cordis.yml'), `${rows.join('\n')}\n`)

  const ctx = new Context()
  const services = provideChatServices(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => {
    await ctx.fiber.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  ctx.effect(() => ctx.dvProject.registerComponent('demo'))
  ctx.effect(() => ctx.dvProject.registerOperation(MAKE))
  ctx.effect(() => ctx.dvCanvasNodes.registerMaker({ operations: ['demo.make'], kind: 'demo', column: 1 }))
  const origin = { actor: 'user' as const, surface: 'canvas' as const, session: null, turn: null, tool_call: null, intent: 'make' }
  const project = await chatProject(ctx.dvProject, services, 'canvas', origin)
  let calls = 0
  return {
    ctx, project,
    call(name, args) {
      calls += 1
      return ctx.tools.execute({ callId: ToolCallId(`call-${String(calls)}`), name, arguments: { reason: 'arrange', ...args }, signal: new AbortController().signal, agent: { id: 's1' } as never })
    },
    async make(basedOn) {
      const result = await ctx.dvProject.run({ ...origin, project, operation: 'demo.make', params: {}, inputs: [], based_on: basedOn?.id ?? null })
      if (result.record === null) throw new Error('demo.make wrote no record')
      return result.record
    },
  }
}

const failure = (result: ToolExecutionResult): string => result.isError ? result.error.message : ''

describe('dvCanvasNodes', () => {
  it('makes one node per producer record, keeps a rerun in the same node, and drops the nodes when the maker leaves', async () => {
    const fixture = await start()
    const first = await fixture.make()
    const rerun = await fixture.make(first)
    const canvas = (): ReturnType<Context['dvProject']['getState']>['components']['canvas'] => fixture.ctx.dvProject.getState(fixture.project).components.canvas
    expect(canvas().order).toEqual([first.id])
    expect(canvas().nodes[brandString<NodeId>(first.id)]).toEqual({
      kind: 'demo', name: null, versions: [first.id, rerun.id], position: { x: 240, y: 0, width: null, height: null },
    })
    expect(() => fixture.ctx.dvCanvasNodes.registerMaker({ operations: ['demo.make'], kind: 'other', column: 0 }))
      .toThrow('The canvas already has a node registration for demo.make.')
    const placement = { place: 'demo.place', kind: 'demo', column: 0 }
    const dispose = fixture.ctx.dvCanvasNodes.registerPlacement(placement)
    dispose()
    fixture.ctx.dvCanvasNodes.registerPlacement({ ...placement })
    // A second call of a spent disposer leaves the newer registration in place.
    dispose()
    expect(() => fixture.ctx.dvCanvasNodes.registerPlacement(placement)).toThrow('The canvas already has a node registration for demo.place.')
  })

  it('moves and resizes a node with dv_canvas_node_position and no canvas open; undo restores each step, and dv_proj_state lists the node', async () => {
    const fixture = await start()
    const made = await fixture.make()
    const moved = await fixture.call('dv_canvas_node_position', { node: made.id, x: 600, y: 40 })
    expect(failure(moved)).toBe('')
    const resized = await fixture.call('dv_canvas_node_position', { node: made.id, width: 320, height: 200 })
    expect(failure(resized)).toBe('')
    const node = brandString<NodeId>(made.id)
    const position = (): unknown => fixture.ctx.dvProject.getState(fixture.project).components.canvas.nodes[node]?.position
    expect(position()).toEqual({ x: 600, y: 40, width: 320, height: 200 })
    const summary = await fixture.call('dv_proj_state', {})
    expect(summary.isError ? null : (summary.value as { canvas?: unknown }).canvas)
      .toEqual([{ node: made.id, kind: 'demo', name: null, shown: made.id, x: 600, y: 40, width: 320, height: 200 }])
    await fixture.ctx.dvProject.undo(fixture.project)
    expect(position()).toEqual({ x: 600, y: 40, width: null, height: null })
    await fixture.ctx.dvProject.undo(fixture.project)
    expect(position()).toEqual({ x: 240, y: 0, width: null, height: null })
  })

  it('refuses an unknown node, a call without a field, and a size of 0 before any record', async () => {
    const fixture = await start()
    expect(failure(await fixture.call('dv_canvas_node_position', { node: 'n0', x: 1 }))).toContain('The canvas has no node n0. Its nodes are: none.')
    const made = await fixture.make()
    const records = (): number => fixture.ctx.dvProject.listRecords(fixture.project).length
    const before = records()
    expect(failure(await fixture.call('dv_canvas_node_position', { node: 'n9', x: 1 }))).toContain(`The canvas has no node n9. Its nodes are: ${made.id}.`)
    expect(failure(await fixture.call('dv_canvas_node_position', { node: made.id }))).toContain('Give at least one of x, y, width and height.')
    expect(failure(await fixture.call('dv_canvas_node_position', { node: made.id, width: 0 }))).toContain('width must be more than 0.')
    expect(records()).toBe(before)
  })

  it('removes nodes with dv_canvas_node_remove and no canvas open, reports them, and undo brings each back as it was', async () => {
    const fixture = await start()
    const first = await fixture.make()
    const rerun = await fixture.make(first)
    const other = await fixture.make()
    expect(failure(await fixture.call('dv_canvas_node_position', { node: first.id, x: 600, y: 40 }))).toBe('')
    const canvas = (): ReturnType<Context['dvProject']['getState']>['components']['canvas'] => fixture.ctx.dvProject.getState(fixture.project).components.canvas
    const before = canvas()
    const removed = await fixture.call('dv_canvas_node_remove', { nodes: [first.id, other.id] })
    expect(failure(removed)).toBe('')
    expect(removed.isError ? null : removed.value).toMatchObject({ summary: `removed node ${first.id}, ${other.id} from the canvas` })
    expect(canvas()).toEqual({ nodes: {}, order: [], assets: {} })
    const record = fixture.ctx.dvProject.listRecords(fixture.project).at(-1)
    expect(record).toMatchObject({ operation: 'canvas.node_remove', actor: 'agent', status: 'done', params: { nodes: [first.id, other.id] } })
    const kept = (id: string): unknown => before.nodes[brandString<NodeId>(id)]
    expect(record?.report).toEqual({ removed: { [first.id]: kept(first.id), [other.id]: kept(other.id) } })
    expect(before.nodes[brandString<NodeId>(first.id)]).toMatchObject({ versions: [first.id, rerun.id], position: { x: 600, y: 40 } })
    await fixture.ctx.dvProject.undo(fixture.project)
    expect(canvas()).toEqual(before)
  })

  it('refuses a call that names no node or a node the canvas does not hold, before any record', async () => {
    const fixture = await start()
    const made = await fixture.make()
    const records = (): number => fixture.ctx.dvProject.listRecords(fixture.project).length
    const before = records()
    expect(failure(await fixture.call('dv_canvas_node_remove', { nodes: [made.id, 'n9'] })))
      .toContain(`The canvas has no node n9; its nodes are: ${made.id}. Nothing was removed.`)
    expect(failure(await fixture.call('dv_canvas_node_remove', { nodes: [] }))).toContain('Name at least one node. Nothing was removed.')
    expect(records()).toBe(before)
    expect(fixture.ctx.dvProject.getState(fixture.project).components.canvas.order).toEqual([made.id])
  })

  it('removes canvas.node_position, canvas.node_remove, their tools and the slice when the plugin is disposed', async () => {
    const fixture = await start()
    expect(fixture.ctx.dvProject.listOperations().map(spec => spec.name)).toContain('canvas.node_position')
    expect(fixture.ctx.tools.get('dv_canvas_node_position')).toBeDefined()
    expect(fixture.ctx.tools.get('dv_canvas_node_remove')).toBeDefined()
    const entry = [...fixture.ctx.loader.entries()].find(candidate => candidate.options.name.endsWith('/dv-canvas.mjs'))
    await entry?.fiber?.dispose()
    expect(fixture.ctx.dvProject.listOperations().map(spec => spec.name)).not.toContain('canvas.node_position')
    expect(fixture.ctx.tools.get('dv_canvas_node_position')).toBeUndefined()
    expect(fixture.ctx.tools.get('dv_canvas_node_remove')).toBeUndefined()
    expect(fixture.ctx.dvProject.getState(fixture.project).components).not.toHaveProperty('canvas')
  })
})
