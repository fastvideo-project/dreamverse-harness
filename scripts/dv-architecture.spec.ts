import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compareBaseline, listOwners, MARKDOWN_KINDS, parseFixture, readScanFiles, RULE_STATEMENTS, scan,
  type Baseline, type ScanFile, type Violation,
} from './dv-architecture.ts'
import { checkBudget, countLines, findingsOnAddedLines, parseAllow, parseDiff, type FileChange } from './dv-blast-radius.ts'

const root = resolve(import.meta.dirname, '..')

function fixture(name: string): ScanFile[] {
  return parseFixture(readFileSync(resolve(import.meta.dirname, 'fixtures/dv-architecture', name), 'utf8'))
}

function rules(files: ScanFile[]): string[] {
  return scan(files).map(violation => violation.rule)
}

describe('DreamVerse architecture fitness test', () => {
  it('matches the ratchet baseline', () => {
    const baseline = JSON.parse(readFileSync(resolve(root, 'scripts/dv-architecture.baseline.json'), 'utf8')) as Baseline
    expect(compareBaseline(scan(readScanFiles(root)), baseline)).toEqual([])
  })

  it.each<[string, string[]]>([
    ['R1-negative.txt', ['R1b']],
    ['R2-negative.txt', ['R2a']],
    ['R2a-reference-kit-negative.txt', ['R2a']],
    ['R3-negative.txt', ['R3', 'R3']],
    ['R3-component-negative.txt', ['R3', 'R3']],
    ['R3-name-negative.txt', ['R3', 'R4']],
    ['R3-generation-negative.txt', ['R3', 'R4']],
    ['R3c-reference-key-negative.txt', ['R3c', 'R3c']],
    ['R4-negative.txt', ['R4']],
    ['R5-negative.txt', ['R5c', 'R5c']],
    ['R5c-create-element-negative.txt', ['R5c']],
    ['R6-negative.txt', ['R6', 'R7a']],
    ['R7-negative.txt', ['R7a']],
    ['R7a-client-negative.txt', ['R7a']],
    ['R7a-slot-negative.txt', ['R7a']],
    ['R7a-kit-negative.txt', ['R7a', 'R7a']],
    ['R7b-negative.txt', ['R7b']],
    ['R8-negative.txt', ['R8c']],
    ['R8d-negative.txt', ['R8d', 'R8d']],
    ['R8e-negative.txt', ['R8e']],
    ['R8f-negative.txt', ['R8f']],
    ['R8f-define-reference-negative.txt', ['R8f']],
    ['R8g-negative.txt', ['R8g', 'R8g']],
  ])('rejects the fixture %s with %j', (name, expected) => {
    expect(rules(fixture(name)).sort()).toEqual(expected)
  })

  it('accepts a value-type union member and a content block type in the kernel', () => {
    expect(scan(fixture('R1-positive.txt'))).toEqual([])
  })

  it('lets a domain package import the base package reference-kit and its client face', () => {
    expect(scan(fixture('R7-reference-kit-positive.txt'))).toEqual([])
  })

  it('copies the element kinds of DSH MarkdownElement for the Markdown exemption of R5', () => {
    const delegate = readFileSync(resolve(root, 'packages/client/ui-primitives/src/markdown/MarkdownDelegate.tsx'), 'utf8')
    const union = /export type MarkdownElement\s*=([^\n]+)/u.exec(delegate)?.[1] ?? ''
    const kinds = union.split('|').map(name => new RegExp(`interface ${name.trim()}[^}]*kind: '([a-z]+)'`, 'u').exec(delegate)?.[1])
    expect(new Set(kinds)).toEqual(MARKDOWN_KINDS)
  })

  it('fails R5 when the canvas names a take or a media type again', () => {
    const files = readScanFiles(root).map(file => file.path === 'packages/dv/ui-canvas/src/client/graph.ts'
      ? { ...file, text: `${file.text}\nexport const taken = (node: { type: string; mime: string }) => node.type === 'take' || node.mime.startsWith('image/')\n` }
      : file)
    const added = scan(files).filter(violation => violation.file === 'packages/dv/ui-canvas/src/client/graph.ts')
    expect(added.map(violation => `${violation.rule} ${violation.text}`).sort()).toEqual(['R5g image/', 'R5i take'])
  })

  it('lets a kit and a UI plugin type-import a UI-core contract, and a UI plugin value-import a kit', () => {
    expect(scan(fixture('R7a-kit-positive.txt'))).toEqual([])
  })
})

describe('rule clauses', () => {
  const owner = (pkg: string, key: string): ScanFile => ({ path: `packages/dv/${pkg}/src/index.ts`, text: `x = { component: '${key}' }\n` })
  const source = (pkg: string, text: string, file = 'index.ts'): ScanFile => ({ path: `packages/dv/${pkg}/src/${file}`, text })
  const manifest = (pkg: string): ScanFile => ({ path: `packages/dv/${pkg}/package.json`, text: '{ "exports": { "./types": "./src/types.ts" } }\n' })

  it.each<[string, ScanFile[], string[]]>([
    ['R1a kernel import of a plugin', [source('project', "import type {} from '@dv/timeline'\n")], ['R1a', 'R1d', 'R7a']],
    ['R1b key literal', [owner('timeline', 'timeline'), source('project', "keys = ['timeline']\n")], ['R1b', 'R1d']],
    ['R1b exempts the left operand of in', [owner('story-bible', 'bible'), source('project', "if ('bible' in ref) {}\n")], []],
    ['R1b exempts only proj', [owner('asset-pool', 'asset'), source('project', "keys = ['proj', 'asset']\n")], ['R1b']],
    ['R1b and R1d skip the Surface union', [owner('timeline', 'timeline'), source('project', "type Surface = 'chat' | 'timeline'\n")], []],
    ['R1c bible property', [source('project', 'interface OperationInput { bible?: boolean }\n')], ['R1c']],
    ['R1c kind ID type', [source('project', 'type Ref = { character: CharacterId }\n')], ['R1c']],
    ['R1d noun in agent text', [source('project', "text = 'Lists the shots and clips.'\n")], ['R1d', 'R1d']],
    ['R1e started_by outside the record files', [source('project', 'chain = record.started_by\n', 'history.ts')], ['R1e']],
    ['R1e allows started_by in the runner', [source('project', 'chain = request.started_by\n', 'runner.ts')], []],
    ['R2a media literal in generation', [source('generation', "kind = 'video'\n")], ['R2a']],
    ['R2a primitive key declared outside models', [
      source('image-generate', "declare module '@dv/models' { interface PrimitiveTypes { image: Row } }\n"),
      source('models', 'interface Rows { image: Row }\n'),
    ], ['R2a']],
    ['R3 name beside component outside its key owner', [
      owner('timeline', 'timeline'), source('storyboard', "op = { name: 'timeline.create', component: 'board' }\n"),
    ], ['R3', 'R4']],
    ['R3 name without component is no operation', [owner('timeline', 'timeline'), source('storyboard', "file = { name: 'timeline.json' }\n")], ['R4']],
    ['R3 component key claimed in two packages', [owner('timeline', 'timeline'), owner('ui-timeline', 'timeline')], ['R3', 'R3']],
    ['R3 operation in a defineGeneration declaration', [
      owner('shot-render', 'shot'), source('image-generate', "d = defineGeneration({ component: 'image', operation: 'shot.render' })\n"),
    ], ['R3', 'R4']],
    ['R3 operation outside a defineGeneration declaration', [
      owner('shot-render', 'shot'), source('image-generate', "r = { component: 'image', operation: 'shot.render' }\n"),
    ], ['R4']],
    ['R3 leaves reference kinds to the runtime', [
      source('story-bible', "p.registerReferenceKind({ kind: 'prop' })\n"), source('prop', "p.registerReferenceKind({ kind: 'prop' })\n"),
    ], []],
    ['R4 surface may name asset.import', [owner('asset-pool', 'asset'), source('api', "run('asset.import')\n")], []],
    ['R5a operation prefix in UI core', [owner('timeline', 'timeline'), source('ui-canvas', "prefix = 'timeline.'\n")], ['R5a', 'R5j']],
    ['R5b slice read in UI core', [source('ui-history', 'clips = state.components.timeline\n')], ['R5b']],
    ['R5b allows the asset slice', [source('ui-history', 'assets = state.components.asset\n')], []],
    ['R5b allows the canvas slice', [source('ui-canvas', 'nodes = state.components.canvas\n')], []],
    ['R5a and R5c skip the canvas key that UI core reads', [owner('canvas', 'canvas'), source('ui-canvas', "op = 'canvas.node_position'\nkey = 'canvas'\n")], []],
    ['R4 a producer names no canvas operation', [owner('canvas', 'canvas'), source('generation', "run('canvas.node_position')\n")], ['R4']],
    ['R5c skips a DOM tag name', [source('ui-shell', "el = document.createElement('style')\n")], []],
    ['R5c plugin key from the owners', [owner('timeline', 'timeline'), source('ui-shell', "view = 'timeline'\n")], ['R5c']],
    ['R5c skips the asset key that UI core reads', [owner('asset-pool', 'asset'), source('ui-shell', "key = 'asset'\n")], []],
    ['R5g media literal, MIME prefix and element in UI core', [source('ui-history', "a = 'image'\nb = mime.startsWith('video/')\nc = <audio src={x} />\n", 'client/x.tsx')], ['R5g', 'R5g', 'R5g']],
    ['R5g MIME prefix in a template head and a regular expression in UI core', [
      source('ui-history', 'a = `video/${ext}`\nb = /^audio\\//u.test(mime)\nc = /^(?:image|video)\\//u.test(mime)\n'),
    ], ['R5g', 'R5g', 'R5g']],
    ['R5g skips a template and a regular expression without a MIME prefix', [source('ui-shell', 'a = `${type}/png`\nb = /^[a-z]+\\//u\n')], []],
    ['R5g primitive type key', [source('models', 'interface PrimitiveTypes { music: object }\n', 'types.ts'), source('ui-kit', "kind = 'music'\n")], ['R5g']],
    ['R5h task name', [source('models', "interface TaskMap { t2v: 'video' }\n", 'types.ts'), source('ui-canvas', "task = 't2v'\n")], ['R5h']],
    ['R5i take and shot', [source('ui-canvas', "a = node.type === 'take'\nb = 'shot'\n")], ['R5i', 'R5i']],
    ['R5j kind word in a token', [source('ui-kit', "event = 'dv:timeline-focus'\ncolor = 'var(--dv-kind-take)'\n")], ['R5j', 'R5j']],
    ['R5j skips copy with whitespace', [source('ui-shell', "hint = 'Open the timeline view'\n")], []],
    ['R5k record params read in UI core', [source('ui-canvas', 'p = record.params\nq = record?.params\nr = declared.params\n')], ['R5k', 'R5k']],
    ['R5 kit layer: plugin key, media type and task, not take or kind words', [
      owner('timeline', 'timeline'), source('models', "interface TaskMap { t2v: 'video' }\n", 'types.ts'),
      source('ui-generation', "a = 'timeline'\nb = 'video/'\nc = 't2v'\nd = 'take'\ne = 'dv:timeline-focus'\nf = record.params\n", 'client/kit.ts'),
    ], ['R5c', 'R5g', 'R5h']],
    ['R5 skips a UI plugin', [source('ui-shot-render', "a = 'take'\nb = 'video/'\nc = record.params\n", 'client/index.ts')], []],
    ['R5 exempts the wire Surface alias and surface field', [
      source('ui-kit', "type Surface = 'chat' | 'timeline'\ninterface OperationRequest { surface: 'canvas' | 'timeline' }\n", 'client/types.ts'),
    ], []],
    ['R5 exempts a member read in a Wire guard', [
      source('ui-kit', "interface WireProjectCover { video: string | null; image: string | null }\nfunction isCover(x: Record<string, unknown>): x is WireProjectCover { return x['video'] !== undefined && x['image'] !== undefined }\n", 'client/api.ts'),
    ], []],
    ['R5 exempts the Markdown element kinds', [
      source('ui-composer', "type Ref = { kind: 'link' } | { kind: 'image' } | { kind: 'table' }\nfunction f(k: string): Ref { switch (k) { case 'link': case 'image': case 'table': return { kind: 'image' } } return { kind: 'link' } }\n", 'client/chat.ts'),
    ], []],
    ['R5 exempts the Markdown element kinds of a union that an intersection adds shared fields to', [
      source('ui-composer', "type Ref = { at: string } & ({ kind: 'link' } | { kind: 'image' } | { kind: 'table' })\nfunction f(): Ref { return { at: 'p1', kind: 'image' } }\n", 'client/chat.ts'),
    ], []],
    ['R5e plugin tool label', [source('ui-kit', 'const DV_TOOL_LABELS = { dv_proj_undo: x, dv_board_create: y }\n')], ['R5e']],
    ['R5f plugin tool name', [source('ui-composer', "card = 'dv_shot_render'\n")], ['R5f']],
    ['R6 deep import', [source('ui-canvas', "import { A } from '@dv/ui-asset-pool/src/client/A.tsx'\n")], ['R6', 'R7a']],
    ['R7a domain imports a domain value', [source('storyboard', "import { layout } from '@dv/timeline'\n")], ['R7a']],
    ['R7a workflow imports a domain value', [source('workflow-ad', "import { layout } from '@dv/timeline'\n")], []],
    ['R7a UI package imports the client face of its host', [source('ui-timeline', "import type { Clip } from '@dv/timeline/types'\n")], []],
    ['R7a UI package imports the host entry', [source('ui-timeline', "import type { Clip } from '@dv/timeline'\n")], ['R7a']],
    ['R7a UI package imports host values', [source('ui-timeline', "import { clips } from '@dv/timeline/types'\n")], ['R7a']],
    ['R7a UI package imports the face of another host', [source('ui-timeline', "import type { Board } from '@dv/storyboard/types'\n")], ['R7a']],
    ['R7a UI package merges the slots of a slot owner', [
      source('ui-shell', "declare module '@deepseek-ai/dsh-client-ui-slots' { interface SlotMap { 'dv.explore': Slot } }\n"),
      source('ui-skills', "import type {} from '@dv/ui-shell/contract'\n", 'client/index.ts'),
    ], []],
    ['R7a UI package merges a UI core package without slots', [source('ui-skills', "import type {} from '@dv/ui-canvas'\n", 'client/index.ts')], ['R7a']],
    ['R7a provider imports its own client package', [
      source('fastvideo', "import { Client } from '@dv/fastvideo-generation-client'\nctx.dvModels.register(entry)\n"),
    ], []],
    ['R7a provider imports its primitive types', [
      source('sglang', "import type { ImageRequest } from '@dv/image-generate'\nctx.dvModels.register(entry)\n"),
      source('image-generate', "declare module '@dv/models' { interface PrimitiveTypes { image: Row } }\n"),
    ], []],
    ['R7a provider imports other domain types', [
      source('sglang', "import type { Clip } from '@dv/timeline'\nctx.dvModels.register(entry)\n"),
    ], ['R7a']],
    ['R7a UI core imports the kernel grammar', [
      source('ui-canvas', "import { formatCitation } from '@dv/project/grammar'\nimport type { PromptCitation } from '@dv/project/grammar'\n"),
    ], []],
    ['R7a UI core imports the kernel folder layout but not the kernel service', [
      source('ui-canvas', "import { PROJECT_DIR } from '@dv/project/folder'\nimport type DvProject from '@dv/project'\n"),
    ], ['R7a']],
    ['R7a UI core imports another kernel entry', [
      source('ui-canvas', "import { run } from '@dv/project'\nimport type { RecordId } from '@dv/project/types'\n"),
    ], ['R7a', 'R7a']],
    ['R7a a kit or a UI package imports the kernel grammar', [
      source('ui-reference-kit', "import { citationUri } from '@dv/project/grammar'\n", 'client/index.ts'),
      source('ui-storyboard', "import { formatCitation } from '@dv/project/grammar'\n", 'client/index.ts'),
    ], ['R7a', 'R7a']],
    ['R11a a citation written by a template outside the kernel grammar', [
      source('chat-references', 'export const cite = (label: string, uri: string) => `@[${label.replaceAll(\']\', \'\')}](${uri})`\n'),
      source('ui-timeline', 'const text = `@[${label}](dv:clip/${id})`\n', 'client/index.ts'),
      source('project', 'export const cite = (label: string, uri: string) => `@[${label}](${uri})`\n', 'grammar.ts'),
    ], ['R11a', 'R11a']],
    ['R11b a citation URI written by a template in UI core, which imports the grammar', [
      source('ui-composer', 'const uri = `dv:asset/${encodeURIComponent(id)}`\nconst page = `/dv/assets/${id}`\n', 'client/index.ts'),
      source('ui-timeline', 'const uri = `dv:clip/${id}`\n', 'client/index.ts'),
    ], ['R11b']],
    ['R7b grammar entry reaches a host module', [
      { path: 'packages/dv/project/package.json', text: '{ "exports": { "./grammar": "./src/grammar.ts" } }\n' },
      source('project', "import { randomUUID } from 'node:crypto'\n", 'grammar.ts'),
    ], ['R7b']],
    ['R7b face reaches a node import through an import', [
      manifest('project'), source('project', "import type { RecordId } from './ids.ts'\n", 'types.ts'),
      source('project', "import { randomUUID } from 'node:crypto'\n", 'ids.ts'),
    ], ['R7b']],
    ['R7b face reaches cordis through a declare module target', [
      manifest('timeline'), source('timeline', "declare module '@dv/project/types' { interface ComponentStates { timeline: T } }\n", 'types.ts'),
      source('project', "export * from './shared.ts'\n", 'types.ts'), source('project', "import type { Context } from '@deepseek-ai/cordis'\n", 'shared.ts'),
    ], ['R7b']],
    ['R7b host-free face passes', [
      manifest('timeline'), source('timeline', "import type { RecordId } from '@dv/project/types'\n", 'types.ts'),
      source('project', 'export type RecordId = string\n', 'types.ts'), source('project', "import { randomUUID } from 'node:crypto'\n"),
    ], []],
    ['R7b needs a ./types entry', [source('timeline', "import type { Context } from '@deepseek-ai/cordis'\n", 'types.ts')], []],
    ['R8a in provider text', [
      owner('shot-render', 'shot'), source('fastvideo', "ctx.dvModels.register(e)\nd = 'Rules for dv_shot_render'\n"),
    ], ['R8a']],
    ['R8a provider skill names a domain tool', [owner('shot-render', 'shot'), source('fastvideo', 'ctx.dvModels.register(e)\n'), {
      path: 'packages/dv/fastvideo/skills/prompting.md', text: 'Write the prompt of `dv_shot_render`.\n',
    }], ['R8a']],
    ['R8c workflow skill names its own tool', [owner('workflow-ad', 'ad'), {
      path: 'packages/dv/workflow-ad/skills/ad-directing/SKILL.md', text: 'Call `dv_ad_publish`.\n',
    }], []],
    ['R8d catalog skill names only catalog tools', [owner('asset-pool', 'asset'), {
      path: 'packages/dv/models/skills/selection.md', text: 'Call `dv_models_list`, not `dv_asset_import`.\n',
    }], ['R8d']],
    ['R8d skill object description in a base package', [
      source('models', "const skill = { name: 's', description: 'Choose a model with ' + 'dv_models_list.' }\n"),
    ], ['R8d']],
    ['R8d other descriptions of a base package', [source('models', "const tool = { description: 'Lists models for dv_models_get.' }\n")], []],
    ['R8e skill names its own workflow skill', [{
      path: 'packages/dv/workflow-story/skills/story-directing/SKILL.md', text: 'This is story-directing.\n',
    }], []],
    ['R8e bundle skill names a workflow skill', [
      { path: 'packages/dv/workflow-story/skills/story-directing/SKILL.md', text: 'Story flow.\n' },
      { path: 'packages/bundle/dv/skills/video-directing/SKILL.md', text: 'Then follow story-directing.\n' },
    ], ['R8e']],
    ['R8g workflow skill names a tool outside its dependencies in a step that starts with its guard', [owner('audio-generate', 'audio'), {
      path: 'packages/dv/workflow-story/skills/ad-making/SKILL.md', text: '4. If `dv_audio_generate` is in your tool list, add the voice line with `dv_audio_generate`.\n',
    }], []],
  ])('%s', (_name, files, expected) => {
    expect(rules(files).sort()).toEqual(expected)
  })

  it('reads src, skills and package manifests but never a tests folder', () => {
    const paths = readScanFiles(root).map(file => file.path)
    expect(paths.some(path => path.startsWith('packages/dv/ui-kit/src/client/'))).toBe(true)
    expect(paths).toContain('packages/bundle/dv/skills/video-directing/SKILL.md')
    expect(paths).toContain('packages/dv/project/package.json')
    expect(paths.filter(path => path.includes('/tests/'))).toEqual([])
  })
})

describe('owner listing', () => {
  it('lists one block per key from defineReference, defineReferenceUi, hand-written UI registrations and skills', () => {
    const character = 'packages/dv/character/src/index.ts:3'
    const ui = 'packages/dv/ui-character/src/client/index.ts:2'
    expect(listOwners(fixture('owners.txt'))).toEqual([
      { what: 'node type', name: 'board', pkg: 'ui-storyboard', where: 'packages/dv/ui-storyboard/src/client/index.ts:1', extra: 'slot @dv/ui-storyboard' },
      { what: 'history row', name: 'board.', pkg: 'ui-storyboard', where: 'packages/dv/ui-storyboard/src/client/index.ts:2', extra: '' },
      { what: 'component', name: 'character', pkg: 'character', where: character, extra: '' },
      { what: 'kind', name: 'character', pkg: 'character', where: character, extra: '' },
      { what: 'operation', name: 'character.create', pkg: 'character', where: character, extra: 'dv_character_create' },
      { what: 'operation', name: 'character.update', pkg: 'character', where: character, extra: 'dv_character_update' },
      { what: 'skill', name: 'character', pkg: 'character', where: 'packages/dv/character/skills/character/SKILL.md:1', extra: '' },
      { what: 'node type', name: 'character', pkg: 'ui-character', where: ui, extra: 'slot @dv/ui-character' },
      { what: 'version kind', name: 'character', pkg: 'ui-character', where: ui, extra: '' },
      { what: 'mention kind', name: 'character', pkg: 'ui-character', where: ui, extra: '' },
      { what: 'history row', name: 'character.', pkg: 'ui-character', where: ui, extra: '' },
      { what: 'mention kind', name: 'clip', pkg: 'ui-timeline', where: 'packages/dv/ui-timeline/src/client/mention.ts:1', extra: '' },
    ])
  })
})

describe('exception markers', () => {
  const transition = (line: string): ScanFile[] => [
    { path: 'packages/dv/storyboard/src/index.ts', text: "x = { component: 'board' }\n" },
    { path: 'packages/dv/ui-canvas/src/client/anchor.ts', text: `${line}\n` },
  ]

  it('suppress a violation of the named rule on their line', () => {
    expect(scan(transition("const starter = 'board.publish' // dv-arch-allow R5: temporary exception"))).toEqual([])
  })

  it.each([
    ['another reason', "const starter = 'board.publish' // dv-arch-allow R5: legacy log reader"],
    ['another rule', "const starter = 'board.publish' // dv-arch-allow R4: temporary exception"],
    ['a marker that suppresses nothing', 'const approvals = 0 // dv-arch-allow R5: temporary exception'],
  ])('fail on %s', (_name, line) => {
    expect(rules(transition(line))).toContain('marker')
  })
})

describe('ratchet baseline comparison', () => {
  const violation: Violation = { file: 'packages/dv/project/src/shared.ts', line: 10, rule: 'R1b', text: 'board' }
  const key = 'packages/dv/project/src/shared.ts R1b board'

  it('passes when every count matches', () => {
    expect(compareBaseline([violation], { [key]: 1 })).toEqual([])
  })

  it.each<[string, Violation[], Baseline]>([
    ['a new violation', [violation], {}],
    ['more matches than the count', [violation, { ...violation, line: 11 }], { [key]: 1 }],
    ['fewer matches than the count', [violation], { [key]: 2 }],
  ])('fails on %s', (_name, violations, baseline) => {
    expect(compareBaseline(violations, baseline)).toHaveLength(1)
  })

  it('states the rule with each failure', () => {
    expect(compareBaseline([violation], {})).toEqual([`${key}: found 1, baseline 0; lines 10; R1: ${RULE_STATEMENTS.R1 ?? ''}`])
  })

  it('states every scanned rule', () => {
    expect(Object.keys(RULE_STATEMENTS)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R11', 'marker'])
  })
})

describe('change size check (R9, R10)', () => {
  const change = (path: string, added: string[], deleted: string[] = []): FileChange =>
    ({ path, added, addedAt: added.map((_, index) => index + 1), deleted })
  const budget = (changes: FileChange[], own: string[], allow: string[], existing: string[] = [], maxLines = 400) =>
    checkBudget(changes, { own, allow: allow.map(parseAllow), existing: new Set(existing), maxLines })
  const diffFixture = (name: string): FileChange[] =>
    parseDiff(readFileSync(resolve(import.meta.dirname, 'fixtures/dv-blast-radius', name), 'utf8'))

  it.each([
    ['max-negative.txt', ['packages/dv/shot-render/src/index.ts:max=6'], 'changes 9 lines, more than max=6'],
    ['net-delete-negative.txt', ['packages/dv/storyboard/**:net-delete'], 'gains lines (+3 -1)'],
    ['r10-negative.txt', [], '4 existing packages with logic changes, more than 3'],
  ])('rejects the fixture %s', (name, allow, failure) => {
    const changes = diffFixture(name)
    const existing = changes.map(c => c.path.split('/').slice(0, 3).join('/'))
    expect(budget(changes, ['packages/dv'], allow, existing).failures).toEqual([expect.stringContaining(failure)])
  })

  it('rejects the fixture max-lines-negative.txt under --max-lines 3 and passes it under the default 400', () => {
    const changes = diffFixture('max-lines-negative.txt')
    expect(budget(changes, ['packages/dv'], [], ['packages/dv/timeline'], 3).failures).toEqual(['R10: 3.5 counted lines, more than 3'])
    expect(budget(changes, ['packages/dv'], [], ['packages/dv/timeline']).failures).toEqual([])
  })

  it('reads the new-file line of each added line from the hunk headers', () => {
    expect(diffFixture('max-negative.txt').map(c => c.addedAt)).toEqual([[111, 112, 431, 432, 433]])
  })

  it('weighs an added line 1, a deleted line 0.5, a moved line 0 and a test line 0', () => {
    expect(countLines([
      change('packages/dv/a/src/x.ts', ['const a = 1', ''], ['old()', 'moved()']),
      change('packages/dv/b/src/y.ts', ['  moved()']),
      change('packages/dv/a/tests/x.spec.ts', ['expect(a).toBe(1)']),
    ])).toBe(3.5)
  })

  it('puts paths outside own and wiring in X and fails on a path that no allow glob matches', () => {
    const report = budget([
      change('packages/dv/a/src/x.ts', ['a']), change('pnpm-lock.yaml', ['b']),
      change('packages/dv/b/src/y.ts', ['c']), change('packages/client/c/src/z.ts', ['d']),
    ], ['packages/dv/a'], ['packages/dv/b/**'])
    expect([report.outside, report.brPkgs, report.failures]).toEqual([
      ['packages/dv/b/src/y.ts', 'packages/client/c/src/z.ts'], 2,
      ['R9: packages/client/c/src/z.ts is outside own, wiring and every --allow glob'],
    ])
  })

  it('fails over 400 counted lines and over 3 existing packages with more than 2 changed src lines', () => {
    const report = budget([
      ...['a', 'c', 'd', 'f'].map(pkg => change(`packages/dv/${pkg}/src/index.ts`, ['x', 'y'], ['z'])),
      change('packages/dv/b/src/index.ts', ['x'], ['w']),
      change('packages/dv/new/src/index.ts', Array.from({ length: 400 }, (_, i) => `line ${String(i)}`)),
    ], ['packages/dv'], [], ['a', 'b', 'c', 'd', 'f'].map(pkg => `packages/dv/${pkg}`))
    expect(report.logicPackages).toEqual(['a', 'c', 'd', 'f'].map(pkg => `packages/dv/${pkg}`))
    expect(report.failures).toEqual([
      'R10: 411.5 counted lines, more than 400',
      'R10: 4 existing packages with logic changes, more than 3',
    ])
  })

  it('treats the baseline file as W with :net-delete only once it exists at the merge base', () => {
    const lowered = [change('scripts/dv-architecture.baseline.json', ['  "a": 1,'], ['  "a": 2,', '  "b": 1,'])]
    expect(budget(lowered, [], [], ['scripts/dv-architecture.baseline.json'])).toMatchObject({ outside: [], countedLines: 0, failures: [] })
    const grown = [change('scripts/dv-architecture.baseline.json', ['  "a": 1,', '  "c": 1,'], ['  "a": 2,'])]
    expect(budget(grown, [], [], ['scripts/dv-architecture.baseline.json']).failures).toEqual([
      'R9: scripts/dv-architecture.baseline.json gains lines (+2 -1), not a net deletion',
    ])
    expect(budget(grown, [], [])).toMatchObject({ outside: ['scripts/dv-architecture.baseline.json'], countedLines: 2.5 })
  })

  it('counts only src and skills of a new package and makes its README.md, package.json and tsconfig.json W', () => {
    const files = ['README.md', 'package.json', 'tsconfig.json', 'CONTRACTS.md', 'src/index.ts', 'skills/x/SKILL.md']
    const changes = files.map(file => change(`packages/dv/new/${file}`, ['x']))
    expect(budget(changes, ['packages/dv/new/src', 'packages/dv/new/skills'], ['packages/dv/new/CONTRACTS.md'])).toMatchObject({
      outside: ['packages/dv/new/CONTRACTS.md'], countedLines: 2, failures: [],
    })
    expect(budget(changes, [], ['packages/dv/new/**'], ['packages/dv/new'])).toMatchObject({ outside: changes.map(c => c.path), countedLines: 6 })
  })

  it('makes a package whose changed src files all match a limited glob no logic package', () => {
    const changes = [change('packages/dv/a/src/x.ts', ['x', 'y', 'z']), change('packages/dv/b/src/y.ts', ['x', 'y', 'z'])]
    const existing = ['packages/dv/a', 'packages/dv/b']
    expect(budget(changes, [], ['packages/dv/a/src/x.ts:max=3', 'packages/dv/b/src/**'], existing).logicPackages).toEqual(['packages/dv/b'])
    const allow = ['packages/dv/a/src/x.ts:max=3', 'packages/dv/a/src/z.ts', 'packages/dv/b/**']
    expect(budget([...changes, change('packages/dv/a/src/z.ts', ['w'])], [], allow, existing).logicPackages).toEqual(['packages/dv/a', 'packages/dv/b'])
  })

  it('fails a lint finding on an added line and keeps findings on old lines and unchanged files', () => {
    const output = [
      'scripts/x.ts:2:5: Unnecessary assertion. [Error/typescript(no-unnecessary-type-assertion)]',
      'scripts/x.ts:9:1: Old finding. [Error/eslint(no-unused-vars)]',
      'scripts/y.ts:1:1: Unchanged file. [Error/eslint(no-unused-vars)]',
      '',
      '3 problems',
    ].join('\n')
    expect(findingsOnAddedLines(output, [change('scripts/x.ts', ['a', 'b'])])).toEqual([
      'lint: scripts/x.ts:2: Unnecessary assertion. [Error/typescript(no-unnecessary-type-assertion)]',
    ])
  })
})
