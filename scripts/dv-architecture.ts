/**
 * Scan DreamVerse packages for the plugin rules R1-R8 and R11 and compare the violations with the ratchet baseline
 * `scripts/dv-architecture.baseline.json`. `RULE_STATEMENTS` states each rule, and every failure line repeats it.
 */

import { globSync, readFileSync } from 'node:fs'
import { join, posix, sep } from 'node:path'
import ts from 'typescript'

/** One scanned file: a repository-relative path with `/` separators, and its text. */
export interface ScanFile { path: string; text: string }

/** One violation. `rule` carries the clause letter when the rule has clauses, such as `R1d`. */
export interface Violation { file: string; line: number; rule: string; text: string }

/** Violation counts keyed by `<file> <rule> <matched text>`. */
export type Baseline = Record<string, number>

/** The one-line statement of each rule, printed with each failure. */
export const RULE_STATEMENTS: Readonly<Record<string, string>> = {
  R1: 'The kernel names no plugin noun and never reads started_by.',
  R2: 'Base packages, reference-kit included, name no media type; workflow-kit names no workflow.',
  R3: 'One owner per component key, reference kind and operation; defineReference operations are checked at runtime; a defineReference key is one lowercase word and not proj, asset, record or version.',
  R4: 'A host package names only operations of its own component key.',
  R5: 'UI core names no plugin noun, media type, task, kind word or record param; a kit names no plugin noun, media type or task.',
  R6: 'No deep import into another package\'s src.',
  R7: 'Dependencies point down the layers; a ./types entry reaches no host-only module.',
  R8: 'A skill never names a consumer; only the package that owns a reference kind names its tools.',
  R11: 'Only @dv/project/grammar writes a citation @[label](dv:<kind>/<id>); UI core, which imports it, writes no citation URI dv:<kind>/<id> by hand.',
  marker: 'The only exception marker is "// dv-arch-allow R<k>: temporary exception", and it suppresses a match on its line.',
}

type Layer = 'kernel' | 'base' | 'provider' | 'domain' | 'workflow-lib' | 'workflow' | 'surface' | 'ui-core' | 'ui-lib' | 'ui' | 'bundle'

/** One parsed TypeScript source file and its package. */
interface Source { path: string; pkg: string; sf: ts.SourceFile }

/** Facts that span packages, collected before any rule runs. */
interface Facts {
  packages: Set<string>
  /** Component key → packages that name it in `registerComponent('<k>')` or `component: '<k>'`. */
  owners: Map<string, Set<string>>
  /** Each component key claim, with its package. */
  claims: Array<Violation & { pkg: string }>
  providers: Set<string>
  /** `PrimitiveTypes` keys declared outside `@dv/models`, and the packages that declare them. */
  primitives: Set<string>
  /** Every `PrimitiveTypes` key, `@dv/models` included (R5g). */
  allPrimitives: Set<string>
  /** Every `TaskMap` key (R5h). */
  tasks: Set<string>
  /** Members of each `Wire<Name>` interface of `ui-kit`, read by the exemption of wire-type guards (R5). */
  wireMembers: Map<string, Set<string>>
  primitivePackages: Set<string>
  /** The browser entries that each host package's `package.json` exports, one of {@link CLIENT_ENTRIES} each (R7 b). */
  clientEntries: Array<{ pkg: string; entry: string }>
  /** Packages whose `src` calls `registerReferenceKind(` or `defineReference(` (R8 f). */
  kindOwners: Set<string>
  /** The owner rows of `listOwners`, in walk order. */
  ownerRows: OwnerRow[]
}

const OWNER_WHATS = ['component', 'kind', 'operation', 'skill', 'node type', 'version kind', 'mention kind', 'history row'] as const
/** The type of a name that `pnpm dv:owners` prints an owner for. */
export type OwnerWhat = (typeof OWNER_WHATS)[number]
/** One owned name and the package that declares it, as `pnpm dv:owners` prints it. */
export interface OwnerRow {
  what: OwnerWhat
  /** The owned name, such as 'character', 'character.create' or the History match 'character.'. */
  name: string
  /** The owning package directory name, such as 'ui-character'; 'bundle' for packages/bundle/dv. */
  pkg: string
  /** '<path>:<line>' of the declaration. */
  where: string
  /** The tool name of an operation ('dv_character_create'); 'slot @dv/<pkg>' for a node type; else ''. */
  extra: string
}
/** The UI registry types of hand-written owner rows, with the property that holds the owned name. */
const UI_ROWS: Readonly<Record<string, [OwnerWhat, string]>> = {
  NodeType: ['node type', 'type'], VersionKind: ['version kind', 'kind'], MentionKind: ['mention kind', 'kind'], HistoryRow: ['history row', 'match'],
}

const BASE = ['models', 'generation', 'asset-pool', 'ffmpeg', 'reference-kit']
const SURFACE = ['api', 'chat-references', 'mcp-presets']
const UI_CORE = ['ui-kit', 'ui-canvas', 'ui-history', 'ui-shell', 'ui-composer', 'ui-media']
/** Kit libraries that one family of UI plugins value-imports: the UI halves of host base kits. */
const UI_LIB = ['ui-reference-kit', 'ui-generation']
const UI_LAYERS: readonly Layer[] = ['ui-core', 'ui-lib', 'ui']
/** Value-import targets, then extra `import type` targets, of each host layer (R7). */
const IMPORTS: Partial<Record<Layer, [Layer[], Layer[]]>> = {
  base: [['kernel', 'base'], []],
  provider: [['kernel', 'base'], []],
  domain: [['kernel', 'base'], []],
  'workflow-lib': [['kernel', 'base'], ['domain']],
  workflow: [['kernel', 'base', 'domain', 'workflow-lib'], []],
  surface: [['kernel', 'base'], ['domain']],
}
/** Skill layer order of R8 (a). */
const SKILL_ORDER: Layer[] = ['kernel', 'base', 'provider', 'domain', 'workflow', 'bundle']
const KERNEL_WORDS = /\b(?:character|location|style|plan|shot|timeline|clip)s?\b/giu
const OPERATION = /^([a-z_]+)\.([a-z_]*)$/u
const TOOL = /(?<!\w)dv_([a-z]+)_\w+/gu
const CORE_TOOL = /^dv_(?:proj|asset|models)_/u
const DIRECTING = /\b([a-z]+)-directing\b/gu
const MARKER = /\/\/ dv-arch-allow (R\d+): (.*)$/u
/**
 * The text parts of a template that writes a citation, `@[${label}](${uri})`, and of one that writes a citation URI,
 * `dv:<kind>/${id}`, with NUL for each substitution (R11).
 */
const CITATION_TEMPLATE = /@\[[^\]]*\]\((?:dv:|\0)/u
const URI_TEMPLATE = /^dv:[^/\0]*\/\0/u
/** The entries of a host package that the browser program reads, each at `src/<entry>.ts` (R7 b). */
const CLIENT_ENTRIES = ['types', 'grammar']
/** Modules that a `./types` or `./grammar` entry must never reach (R7 b). */
const HOST_ONLY = /^(?:node:|@deepseek-ai\/(?:cordis|dsh-tools)(?:\/|$))/u
const KIT_LINES = 300
/** The kind words of R5j, matched in a literal without whitespace, such as `node.take` or `dv:timeline-focus`. */
const UI_KIND_WORDS = /\b(?:character|location|style|plan|shot|timeline|clip|take)s?\b/iu
/** The element kinds of DSH's `MarkdownElement` (`ui-primitives/src/markdown/MarkdownDelegate.tsx`); the spec checks the copy. */
export const MARKDOWN_KINDS: ReadonlySet<string> = new Set(['link', 'image', 'table'])
/**
 * A reference noun key names its skill, ID param and tools; the kernel reserves the other keys (`RESERVED_KINDS` in
 * `project/src/index.ts`, and Project's component key `proj`).
 */
const NOUN_KEY = /^[a-z][a-z0-9]*$/u
const RESERVED_KEYS = ['proj', 'asset', 'record', 'version']

/**
 * Read the files the rules scan: `src` of every DreamVerse package, never a `tests/` folder, the skill Markdown, and
 * each package's `package.json` for its `./types` entry.
 * @param root - repository root.
 * @returns the files sorted by path.
 * @throws when discovery finds no kernel source, so a narrowed glob cannot pass.
 */
export function readScanFiles(root: string): ScanFile[] {
  const patterns = ['packages/dv/*/src/**/*.{ts,tsx}', 'packages/dv/*/skills/**/*.md', 'packages/bundle/dv/skills/**/*.md',
    'packages/dv/*/package.json']
  const paths = globSync(patterns, { cwd: root }).map(path => path.split(sep).join('/')).filter(path => !path.includes('/tests/')).sort()
  if (!paths.some(path => path.startsWith('packages/dv/project/src/'))) throw new Error('dv-architecture: no kernel source found')
  return paths.map(path => ({ path, text: readFileSync(join(root, path), 'utf8') }))
}

/**
 * Split a fixture into files; each line `--- <path>` starts a file.
 * @param text - fixture text.
 * @returns the files of the fixture.
 */
export function parseFixture(text: string): ScanFile[] {
  return text.split(/^--- /mu).slice(1).map(part => ({ path: part.slice(0, part.indexOf('\n')), text: part.slice(part.indexOf('\n') + 1) }))
}

const packageOf = (path: string): string => path.startsWith('packages/bundle/dv/') ? 'bundle' : path.split('/')[2] ?? ''
const textOf = (node: ts.Node | undefined): string | undefined => node === undefined ? undefined
  : ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : ts.isPropertyAccessExpression(node) ? node.name.text : undefined
const lineOf = (sf: ts.SourceFile, node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
const add = (map: Map<string, Set<string>>, key: string, pkg: string): void => {
  map.set(key, (map.get(key) ?? new Set()).add(pkg))
}

/** The property called `name` of an object literal, and its text, when its value is a string literal. */
const stringProperty = (node: ts.Node | undefined, name: string): { at: ts.Node; text: string } | undefined => {
  const found = node !== undefined && ts.isObjectLiteralExpression(node) ? node.properties.find(p => textOf(p.name) === name) : undefined
  const ok = found !== undefined && ts.isPropertyAssignment(found) && ts.isStringLiteralLike(found.initializer)
  return ok ? { at: found, text: found.initializer.text } : undefined
}

/** The operation that a `name:` beside `component:`, or an `operation:` of a `defineGeneration` declaration, names (R3). */
function declaredOperation(node: ts.Node): string | undefined {
  const literal = ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.initializer)
  if (!literal || !ts.isObjectLiteralExpression(node.parent)) return undefined
  const declared = node.parent.properties.some(p => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p))
    && textOf(p.name) === 'component')
  const generation = ts.isCallExpression(node.parent.parent) && textOf(node.parent.parent.expression) === 'defineGeneration'
  const property = textOf(node.name)
  const name = (property === 'name' && declared) || (property === 'operation' && generation) ? OPERATION.exec(node.initializer.text) : null
  return name !== null && name[2] !== '' ? name[0] : undefined
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  ts.forEachChild(node, (child) => {
    walk(child, visit)
  })
}

/** Collect the cross-package facts from every source file and package manifest. */
function collectFacts(sources: readonly Source[], files: readonly ScanFile[]): Facts {
  const facts: Facts = {
    packages: new Set(files.map(file => packageOf(file.path))), owners: new Map(), claims: [], providers: new Set(),
    primitives: new Set(), allPrimitives: new Set(), tasks: new Set(), wireMembers: new Map(), primitivePackages: new Set(),
    clientEntries: [], kindOwners: new Set(),
    ownerRows: [],
  }
  for (const file of files) {
    for (const entry of CLIENT_ENTRIES) {
      if (file.path.endsWith('/package.json') && new RegExp(`"\\./${entry}"\\s*:`, 'u').test(file.text)) {
        facts.clientEntries.push({ pkg: packageOf(file.path), entry })
      }
    }
    const skill = file.path.endsWith('/SKILL.md') ? file.path.split('/').at(-2) : /([^/]+)\.md$/u.exec(file.path)?.[1]
    if (skill !== undefined) facts.ownerRows.push({ what: 'skill', name: skill, pkg: packageOf(file.path), where: `${file.path}:1`, extra: '' })
  }
  for (const { path, pkg, sf } of sources) {
    if (sf.text.includes('dvModels.register(')) facts.providers.add(pkg)
    walk(sf, (node) => {
      const callee = ts.isCallExpression(node) ? textOf(node.expression) : undefined
      const arg = ts.isCallExpression(node) ? node.arguments[0] : undefined
      const row = (what: OwnerWhat, name: string, at: ts.Node, extra = what === 'node type' ? `slot @dv/${pkg}` : ''): void => {
        facts.ownerRows.push({ what, name, pkg, where: `${path}:${String(lineOf(sf, at))}`, extra })
      }
      const claim = (key: string): void => {
        facts.claims.push({ file: path, line: lineOf(sf, node), rule: 'R3', text: key, pkg })
        add(facts.owners, key, pkg)
        row('component', key, node)
      }
      if (callee === 'registerComponent' && arg !== undefined && ts.isStringLiteralLike(arg)) claim(arg.text)
      if (callee === 'registerReferenceKind' || callee === 'defineReference') facts.kindOwners.add(pkg)
      if (ts.isPropertyAssignment(node) && textOf(node.name) === 'component' && ts.isStringLiteralLike(node.initializer)) {
        claim(node.initializer.text)
      }
      const operation = declaredOperation(node)
      if (operation !== undefined) row('operation', operation, node, `dv_${operation.replace('.', '_')}`)
      // A defineReference noun owns its kind and both operations; a defineReferenceUi call gives four rows: node type,
      // version kind, mention kind and history row.
      const reference = callee === 'defineReference' ? stringProperty(arg, 'component') : undefined
      if (reference !== undefined) {
        row('kind', reference.text, reference.at)
        for (const verb of ['create', 'update']) row('operation', `${reference.text}.${verb}`, reference.at, `dv_${reference.text}_${verb}`)
      }
      const ui = callee === 'defineReferenceUi' ? stringProperty(arg, 'key') : undefined
      if (ui !== undefined) {
        for (const what of ['node type', 'version kind', 'mention kind'] as const) row(what, ui.text, ui.at)
        row('history row', `${ui.text}.`, ui.at)
      }
      const typed = ts.isVariableDeclaration(node) && node.type !== undefined && ts.isTypeReferenceNode(node.type)
      const [what, property = ''] = typed ? UI_ROWS[node.type.typeName.getText(sf)] ?? [] : []
      const owned = what !== undefined && ts.isVariableDeclaration(node) ? stringProperty(node.initializer, property) : undefined
      if (what !== undefined && owned !== undefined) row(what, owned.text, node)
      if (ts.isInterfaceDeclaration(node) && node.name.text === 'PrimitiveTypes') {
        for (const member of node.members) facts.allPrimitives.add(textOf(member.name) ?? '')
      }
      if (ts.isInterfaceDeclaration(node) && node.name.text === 'TaskMap') {
        for (const member of node.members) facts.tasks.add(textOf(member.name) ?? '')
      }
      if (pkg === 'ui-kit' && ts.isInterfaceDeclaration(node) && node.name.text.startsWith('Wire')) {
        facts.wireMembers.set(node.name.text, new Set(node.members.map(member => textOf(member.name) ?? '')))
      }
      if (ts.isInterfaceDeclaration(node) && node.name.text === 'PrimitiveTypes' && pkg !== 'models') {
        facts.primitivePackages.add(pkg)
        for (const member of node.members) facts.primitives.add(textOf(member.name) ?? '')
      }
    })
  }
  return facts
}

/** The layer of a package, inferred from its name and, for providers, from `dvModels.register(` in its `src`. */
function layerOf(pkg: string, facts: Facts): Layer {
  if (pkg === 'project') return 'kernel'
  if (pkg === 'bundle') return 'bundle'
  if (BASE.includes(pkg)) return 'base'
  if (facts.providers.has(pkg) || pkg === 'fastvideo-generation-client') return 'provider'
  if (pkg === 'workflow-kit') return 'workflow-lib'
  if (pkg.startsWith('workflow-')) return 'workflow'
  if (SURFACE.includes(pkg)) return 'surface'
  if (UI_LIB.includes(pkg)) return 'ui-lib'
  if (UI_CORE.includes(pkg)) return 'ui-core'
  return pkg.startsWith('ui-') ? 'ui' : 'domain'
}

/**
 * R7 (a): whether package `from` may import `specifier`. Every UI layer value-imports `@dv/ui-kit` and type-imports the
 * `./contract` entry of a UI-core package; UI core alone also value-imports the kernel's pure grammar entry
 * `@dv/project/grammar`; a UI plugin also value-imports a kit (`ui-lib`) and type-imports its host package's `./types`;
 * UI core imports no kit.
 * @param typeOnly - the import is `import type` or `export type`.
 */
function importAllowed(from: string, specifier: string, typeOnly: boolean, facts: Facts): boolean {
  const to = specifier.split('/')[1] ?? ''
  const [source, target] = [layerOf(from, facts), layerOf(to, facts)]
  if (from === to) return true
  if (UI_LAYERS.includes(source)) {
    if (to === 'ui-kit') return true
    if (typeOnly && target === 'ui-core' && specifier === `@dv/${to}/contract`) return true
    if (source === 'ui-core' && specifier === '@dv/project/grammar') return true
    if (source !== 'ui') return false
    return target === 'ui-lib' || (typeOnly && specifier === `@dv/${from.slice('ui-'.length)}/types`)
  }
  if (source === 'provider' && target === 'provider') return to === `${from}-generation-client`
  if (source === 'provider' && target === 'domain') return typeOnly && facts.primitivePackages.has(to)
  const [values, types] = IMPORTS[source] ?? [[], []]
  return values.includes(target) || (typeOnly && types.includes(target))
}

/** Whether a package other than `pkg` owns the component key; false for an unknown key. */
function ownedElsewhere(key: string, pkg: string, facts: Facts): boolean {
  const owners = facts.owners.get(key)
  return owners !== undefined && !owners.has(pkg)
}

/** Whether a string literal sits in the `description` of an object held by a property or variable `skill` or `promptSkill`. */
function inSkillDescription(node: ts.Node): boolean {
  let part: ts.Node = node
  while (ts.isBinaryExpression(part.parent) || ts.isParenthesizedExpression(part.parent)) part = part.parent
  const holder = ts.isPropertyAssignment(part.parent) && textOf(part.parent.name) === 'description' ? part.parent.parent.parent : undefined
  return holder !== undefined && (ts.isPropertyAssignment(holder) || ts.isVariableDeclaration(holder))
    && ['skill', 'promptSkill'].includes(textOf(holder.name) ?? '')
}

/**
 * R8 over one skill text.
 * @param md - the text is a skill file; otherwise a string literal in `src`.
 * @param described - the literal is the description of a `skill` or `promptSkill` object.
 */
function scanSkillText(
  pkg: string, md: boolean, described: boolean, text: string, facts: Facts, report: (rule: string, offset: number, text: string) => void,
): void {
  const layer = layerOf(pkg, facts)
  const skillText = md || layer === 'provider'
  const catalog = layer === 'provider' || (md && pkg === 'models')
  for (const match of text.matchAll(TOOL)) {
    const key = match[1] ?? ''
    const owner = [...facts.owners.get(key) ?? []][0] ?? (facts.packages.has(key) ? key : undefined)
    const ownerLayer = owner === undefined ? undefined : layerOf(owner, facts)
    const higher = skillText && ownerLayer !== undefined && SKILL_ORDER.indexOf(ownerLayer) > SKILL_ORDER.indexOf(layer)
    if (higher) report('R8a', match.index, match[0])
    if (skillText && ownerLayer === 'workflow' && !(md && pkg === owner)) report('R8c', match.index, match[0])
    if (skillText && owner !== undefined && facts.kindOwners.has(owner) && pkg !== owner) report('R8f', match.index, match[0])
    if (!higher && (described || (catalog && !match[0].startsWith('dv_models_')))) report('R8d', match.index, match[0])
  }
  if (!skillText) return
  for (const match of text.matchAll(DIRECTING)) {
    const flow = `workflow-${match[1] ?? ''}`
    if (facts.packages.has(flow) && pkg !== flow) report('R8e', match.index, match[0])
  }
  if (layer !== 'base' && layer !== 'provider') return
  for (const match of text.matchAll(/\b(?:plan|continue_previous)\b/giu)) report('R8b', match.index, match[0].toLowerCase())
}

function unionOf(type: ts.TypeNode): ts.UnionTypeNode | undefined {
  if (ts.isParenthesizedTypeNode(type)) return unionOf(type.type)
  if (ts.isIntersectionTypeNode(type)) return type.types.map(unionOf).find(union => union !== undefined)
  return ts.isUnionTypeNode(type) ? type : undefined
}

/**
 * The type aliases of a file whose union members' `kind` literals are exactly the Markdown element kinds, so the file
 * mirrors DSH's `MarkdownElement` (exemption M of R5).
 */
function markdownMirrors(sf: ts.SourceFile): Set<string> {
  const mirrors = new Set<string>()
  walk(sf, (node) => {
    if (!ts.isTypeAliasDeclaration(node)) return
    const union = unionOf(node.type)
    if (union === undefined) return
    const kinds = new Set(union.types.flatMap(member => ts.isTypeLiteralNode(member)
      ? member.members.flatMap(field => textOf(field.name) === 'kind' && ts.isPropertySignature(field) && field.type !== undefined
        && ts.isLiteralTypeNode(field.type) ? [textOf(field.type.literal) ?? ''] : [])
      : []))
    if (sameSet(kinds, MARKDOWN_KINDS)) mirrors.add(node.name.text)
  })
  return mirrors
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every(item => b.has(item))

/**
 * Whether a string literal is a wire fact or a Markdown element kind, which R5c-R5j do not count: a literal in the
 * `Surface` or `ViewSurface` alias or the literal type of a `surface` field (W); a key read inside a guard
 * `x is Wire<Name>` that names a member of that `ui-kit` interface (W); a literal in a Markdown mirror alias, a `case`
 * of a switch over exactly the Markdown kinds, or the `kind` of an object returned as a Markdown mirror (M).
 */
function exemptUiLiteral(node: ts.StringLiteralLike, sf: ts.SourceFile, facts: Facts, mirrors: ReadonlySet<string>): boolean {
  const inAlias = (names: ReadonlySet<string> | readonly string[]): boolean =>
    ts.findAncestor(node, n => ts.isTypeAliasDeclaration(n) && [...names].includes(n.name.text)) !== undefined
  if (inAlias(['Surface', 'ViewSurface']) || inAlias(mirrors)) return true
  const field = ts.findAncestor(node, ts.isPropertySignature)
  if (field !== undefined && textOf(field.name) === 'surface' && ts.isLiteralTypeNode(node.parent)) return true
  if (ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node) {
    const guard = ts.findAncestor(node, ts.isFunctionLike)?.type
    const named = guard !== undefined && ts.isTypePredicateNode(guard) ? guard.type?.getText(sf) : undefined
    if (named !== undefined && facts.wireMembers.get(named)?.has(node.text) === true) return true
  }
  if (ts.isCaseClause(node.parent) && node.parent.expression === node) {
    const cases = new Set(node.parent.parent.clauses.flatMap(clause => ts.isCaseClause(clause) ? [textOf(clause.expression) ?? ''] : []))
    if (sameSet(cases, MARKDOWN_KINDS)) return true
  }
  if (ts.isPropertyAssignment(node.parent) && textOf(node.parent.name) === 'kind' && ts.isObjectLiteralExpression(node.parent.parent)) {
    const returned = ts.findAncestor(node.parent.parent, ts.isFunctionLike)?.type
    const references: string[] = []
    if (returned !== undefined) walk(returned, (type) => { if (ts.isTypeReferenceNode(type)) references.push(type.typeName.getText(sf)) })
    if (references.some(name => mirrors.has(name))) return true
  }
  return false
}

/**
 * R5c and R5g-R5j over one node of a UI-core or kit file: a plugin component key (c), a media type literal, a MIME
 * prefix in a string, template head or regular expression, or a media element (g) and a task name (h) in both layers;
 * the literals `take` and `shot` (i) and a kind word in token-shaped text (j) in UI core only.
 */
function scanUiLiteral(
  node: ts.Node, sf: ts.SourceFile, layer: Layer, facts: Facts, mirrors: ReadonlySet<string>, pluginKeys: ReadonlySet<string>,
  report: (rule: string, text: string) => void,
): void {
  if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ['video', 'audio'].includes(node.tagName.getText(sf))) {
    report('R5g', `<${node.tagName.getText(sf)}>`)
  }
  if (ts.isTemplateHead(node) && /^(?:image|video|audio)\//u.test(node.text)) report('R5g', node.text)
  if (ts.isRegularExpressionLiteral(node) && /(?:image|video|audio)\)?\\\//u.test(node.text)) report('R5g', node.text)
  if (!ts.isStringLiteralLike(node) || ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) return
  if (ts.isCallExpression(node.parent) && node.parent.expression.getText(sf) === 'document.createElement') return
  if (ts.isModuleDeclaration(node.parent) || exemptUiLiteral(node, sf, facts, mirrors)) return
  const text = node.text
  const media = new Set(['image', 'video', 'audio', ...facts.allPrimitives])
  if (pluginKeys.has(text)) report('R5c', text)
  if (media.has(text) || /^(?:image|video|audio)\//u.test(text)) report('R5g', text)
  if (facts.tasks.has(text)) report('R5h', text)
  if (layer !== 'ui-core') return
  if (text === 'take' || text === 'shot') report('R5i', text)
  else if (!pluginKeys.has(text) && !/\s/u.test(text) && UI_KIND_WORDS.test(text)) report('R5j', text)
}

/** R1, R2 and R4-R8 over one TypeScript source file, and R3 for operation names. */
function scanSource({ path, pkg, sf }: Source, facts: Facts, out: Violation[]): void {
  const layer = layerOf(pkg, facts)
  const pluginKeys = new Set([...facts.owners].filter(([key, owners]) => key !== 'proj' && [...owners].some(o => o !== 'project'))
    .map(([key]) => key))
  const uiPluginKeys = new Set([...pluginKeys].filter(key => key !== 'asset'))
  const mirrors = layer === 'ui-core' || layer === 'ui-lib' ? markdownMirrors(sf) : new Set<string>()
  const workflowKey = (key: string): boolean => [...facts.owners.get(key) ?? []].some(owner => layerOf(owner, facts) === 'workflow')
  const inAlias = (node: ts.Node, name: string): boolean =>
    ts.findAncestor(node, n => ts.isTypeAliasDeclaration(n) && n.name.text === name) !== undefined
  const grammar = path === 'packages/dv/project/src/grammar.ts'
  walk(sf, (node) => {
    const body = ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) ? node.text : undefined
    const report = (rule: string, text: string, offset = 0): number =>
      out.push({ file: path, line: lineOf(sf, node) + (body ?? '').slice(0, offset).split('\n').length - 1, rule, text })
    const declaration = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node : undefined
    const specifier = textOf(declaration?.moduleSpecifier)
    if (declaration !== undefined && specifier?.startsWith('@dv/') === true) {
      const clause = ts.isImportDeclaration(declaration) ? declaration.importClause : undefined
      const typeOnly = ts.isExportDeclaration(declaration) ? declaration.isTypeOnly : clause?.phaseModifier === ts.SyntaxKind.TypeKeyword
      if (pkg === 'project') report('R1a', specifier)
      if (/^@dv\/[^/]+\/src\//u.test(specifier)) report('R6', specifier)
      if (!importAllowed(pkg, specifier, typeOnly, facts)) report('R7a', specifier)
    }
    const literal = ts.isStringLiteralLike(node) ? node.text : undefined
    // R11: the text parts of a template, with one NUL in place of each substitution.
    const template = ts.isTemplateExpression(node) && !grammar
      ? [node.head.text, ...node.templateSpans.map(span => `\0${span.literal.text}`)].join('') : undefined
    if (template !== undefined && CITATION_TEMPLATE.test(template)) report('R11a', node.getText(sf))
    if (template !== undefined && layer === 'ui-core' && URI_TEMPLATE.test(template)) report('R11b', node.getText(sf))
    const access = ts.isPropertyAccessExpression(node) ? [textOf(node.expression), node.name.text]
      : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
        ? [textOf(node.expression), node.argumentExpression.text] : []
    const [object, member = ''] = access
    const read = `${object ?? ''}.${member}`
    const parent = ts.isIdentifier(node) && node.text === 'bible' ? node.parent : undefined
    const bibleProperty = parent !== undefined && (ts.isPropertySignature(parent) || ts.isPropertyAssignment(parent)
      || (ts.isPropertyAccessExpression(parent) && textOf(parent.expression) !== 'components')) && parent.name === node
    if (pkg === 'project') {
      const holder = literal === undefined ? undefined : ts.isLiteralTypeNode(node.parent) ? node.parent.parent : node.parent
      const typeValue = holder !== undefined && (ts.isPropertyAssignment(holder) || ts.isPropertySignature(holder))
        && textOf(holder.name) === 'type'
      const inOperand = holder !== undefined && ts.isBinaryExpression(holder) && holder.operatorToken.kind === ts.SyntaxKind.InKeyword
        && holder.left === node
      const surface = inAlias(node, 'Surface')
      const exemptLiteral = typeValue || inOperand || surface || inAlias(node, 'OperationValueType')
      if (literal !== undefined && pluginKeys.has(literal) && !exemptLiteral) report('R1b', literal)
      if (object === 'components' && pluginKeys.has(member) && ts.isPropertyAccessExpression(node)) report('R1b', read)
      const kindId = ts.isIdentifier(node) && ['CharacterId', 'LocationId', 'StyleId'].includes(node.text)
      if (kindId || bibleProperty) report('R1c', textOf(node) ?? '')
      for (const match of surface ? [] : body?.matchAll(KERNEL_WORDS) ?? []) report('R1d', match[0].toLowerCase(), match.index)
      const exempt = ['types.ts', 'runner.ts', 'record-store.ts'].includes(path.split('/').pop() ?? '')
      if ((ts.isIdentifier(node) || literal !== undefined) && textOf(node) === 'started_by' && !exempt) report('R1e', 'started_by')
    }
    if (pkg === 'models' || pkg === 'generation' || pkg === 'reference-kit') {
      const banned = new Set(['image', 'audio', ...facts.primitives, ...(pkg === 'generation' ? ['video', 'shot', 'plan'] : [])])
      const typeKey = ts.isIdentifier(node) && ts.isPropertySignature(node.parent) && node.parent.name === node
      if ((literal !== undefined || typeKey) && banned.has(textOf(node) ?? '')) report('R2a', textOf(node) ?? '')
    }
    const key = OPERATION.exec(literal ?? '')
    const operationKey = key !== null && key[2] !== '' ? key[1] ?? '' : undefined
    if (pkg === 'workflow-kit' && literal !== undefined && workflowKey(operationKey ?? literal)) report('R2b', literal)
    // R3: `name:` beside `component:`, or `operation:` in a defineGeneration declaration, names a key of this package.
    // R3c: a defineReference key is one lowercase word and not a reserved key.
    const noun = ts.isCallExpression(node) && textOf(node.expression) === 'defineReference' ? stringProperty(node.arguments[0], 'component') : undefined
    if (noun !== undefined && (!NOUN_KEY.test(noun.text) || RESERVED_KEYS.includes(noun.text))) report('R3c', noun.text)
    const operation = declaredOperation(node)
    if (operation !== undefined && facts.owners.get(operation.split('.')[0] ?? '')?.has(pkg) !== true) report('R3', operation)
    const surfaceAsset = ['api', 'chat-references'].includes(pkg) && ['asset.import', 'asset.place'].includes(literal ?? '')
    const host = layer !== 'ui' && layer !== 'ui-core'
    if (host && operationKey !== undefined && ownedElsewhere(operationKey, pkg, facts) && !surfaceAsset) report('R4', literal ?? '')
    if (layer === 'ui-core' || layer === 'ui-lib') scanUiLiteral(node, sf, layer, facts, mirrors, uiPluginKeys, report)
    if (layer === 'ui-core') {
      if (key !== null && !['proj', 'asset'].includes(key[1] ?? '') && facts.owners.has(key[1] ?? '')) report('R5a', key[0])
      if (object === 'components' && !['proj', 'asset'].includes(member) && ts.isPropertyAccessExpression(node)) report('R5b', read)
      if (pkg === 'ui-kit' && bibleProperty) report('R5c', 'bible')
      const params = (ts.isPropertyAccessExpression(node) && node.name.text === 'params') || (ts.isElementAccessExpression(node) && textOf(node.argumentExpression) === 'params')
      if (params && ts.isIdentifier(node.expression) && node.expression.text === 'record') report('R5k', node.getText(sf))
      if (object === 'params' && ['plan', 'plan_version', 'shot'].includes(member)) report('R5d', read)
      const table = ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)
        && ts.isVariableDeclaration(node.parent.parent) && textOf(node.parent.parent.name) === 'DV_TOOL_LABELS'
      if (table && !CORE_TOOL.test(textOf(node.name) ?? '')) report('R5e', textOf(node.name) ?? '')
      if (/^dv_[a-z]+_\w+$/u.test(literal ?? '') && !CORE_TOOL.test(literal ?? '')) report('R5f', literal ?? '')
    }
    const described = body !== undefined && inSkillDescription(node)
    if (body !== undefined && (layer === 'provider' || described)) {
      scanSkillText(pkg, false, described, body, facts, (rule, offset, text) => report(rule, text, offset))
    }
  })
}

/**
 * R7 (b): each module that a browser entry (`./types` at `src/types.ts`, `./grammar` at `src/grammar.ts`) of a host
 * package reaches through its imports and its `declare module` targets, when that module imports `node:*`, cordis or
 * dsh-tools.
 */
function scanTypesEntries(sources: readonly Source[], facts: Facts): Violation[] {
  const byPath = new Map(sources.map(source => [source.path, source]))
  const resolve = (from: string, specifier: string): string | undefined => {
    if (specifier.startsWith('.')) {
      const path = posix.join(posix.dirname(from), specifier)
      return [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`].find(candidate => byPath.has(candidate))
    }
    const [scope, pkg, ...rest] = specifier.split('/')
    if (scope !== '@dv' || pkg === undefined) return undefined
    const sub = rest.join('/')
    return `packages/dv/${pkg}/${sub === '' ? 'src/index.ts' : CLIENT_ENTRIES.includes(sub) ? `src/${sub}.ts` : sub}`
  }
  const violations: Violation[] = []
  for (const { pkg, entry } of facts.clientEntries.filter(face => !['ui', 'ui-core'].includes(layerOf(face.pkg, facts)))) {
    const queue = [`packages/dv/${pkg}/src/${entry}.ts`]
    const seen = new Set<string>()
    for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
      const source = byPath.get(path)
      if (seen.has(path) || source === undefined) continue
      seen.add(path)
      walk(source.sf, (node) => {
        const target = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? textOf(node.moduleSpecifier)
          : ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name) ? node.name.text : undefined
        if (target === undefined) return
        if (HOST_ONLY.test(target)) {
          violations.push({ file: path, line: lineOf(source.sf, node), rule: 'R7b', text: `@dv/${pkg}/${entry} reaches ${target}` })
        }
        const next = resolve(path, target)
        if (next !== undefined) queue.push(next)
      })
    }
  }
  return violations
}

/**
 * Apply the exception markers to the violations of one file.
 * @returns the violations that no valid marker suppresses, plus one `marker` violation per invalid or unused marker.
 */
function applyMarkers(path: string, text: string, found: Violation[]): Violation[] {
  const suppressed = new Set<Violation>()
  const invalid: Violation[] = []
  text.split('\n').forEach((line, index) => {
    if (!line.includes('dv-arch-allow')) return
    const marker = MARKER.exec(line)
    const hits = found.filter(v => v.line === index + 1 && v.rule.replace(/[a-z]$/u, '') === marker?.[1])
    if (marker === null || marker[2] !== 'temporary exception' || hits.length === 0) {
      invalid.push({ file: path, line: index + 1, rule: 'marker', text: line.trim() })
    } else for (const hit of hits) suppressed.add(hit)
  })
  return [...found.filter(v => !suppressed.has(v)), ...invalid]
}

/** Parse each TypeScript file of a scan, with its package. */
const parseSources = (files: readonly ScanFile[]): Source[] => files.filter(file => /\.tsx?$/u.test(file.path)).map(file => ({
  path: file.path, pkg: packageOf(file.path), sf: ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true),
}))

/**
 * List the owner of every component key, reference kind, operation, skill and UI registration that the static patterns
 * of `collectFacts` find: one row per (what, name, package) at its first declaration in path order, sorted by key
 * (the name up to its first `.`), then by the order of `OwnerWhat`, then by name, so one noun prints as one block.
 * @param files - the repository files from `readScanFiles`, or the files of a fixture.
 * @returns the sorted owner rows.
 */
export function listOwners(files: readonly ScanFile[]): OwnerRow[] {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  const rows = new Map<string, OwnerRow>()
  for (const row of collectFacts(parseSources(sorted), sorted).ownerRows) {
    if (!rows.has(`${row.what} ${row.name} ${row.pkg}`)) rows.set(`${row.what} ${row.name} ${row.pkg}`, row)
  }
  // Three stable sorts, the last by the most significant field.
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
    .sort((a, b) => OWNER_WHATS.indexOf(a.what) - OWNER_WHATS.indexOf(b.what))
    .sort((a, b) => (a.name.split('.')[0] ?? '').localeCompare(b.name.split('.')[0] ?? ''))
}

/**
 * Run R1-R8 and R11 over a set of files.
 * @param files - the repository files from `readScanFiles`, or the files of a fixture.
 * @returns every violation that no valid exception marker suppresses.
 */
export function scan(files: readonly ScanFile[]): Violation[] {
  const sources = parseSources(files)
  const facts = collectFacts(sources, files)
  const violations: Violation[] = []
  for (const source of sources) {
    const found: Violation[] = []
    scanSource(source, facts, found)
    violations.push(...applyMarkers(source.path, source.sf.text, found))
  }
  for (const claim of facts.claims) {
    const claimants = new Set(facts.claims.filter(other => other.text === claim.text).map(other => other.pkg))
    if (claimants.size > 1) violations.push({ file: claim.file, line: claim.line, rule: claim.rule, text: claim.text })
  }
  const kitLines = sources.filter(source => source.pkg === 'workflow-kit')
    .reduce((sum, source) => sum + source.sf.text.split('\n').filter(line => line.trim() !== '').length, 0)
  if (kitLines > KIT_LINES) {
    violations.push({ file: 'packages/dv/workflow-kit/src', line: 0, rule: 'R2b', text: `${String(kitLines)} non-blank lines, over ${String(KIT_LINES)}` })
  }
  violations.push(...scanTypesEntries(sources, facts))
  for (const file of files.filter(f => f.path.endsWith('.md'))) {
    scanSkillText(packageOf(file.path), true, false, file.text, facts, (rule, offset, text) =>
      violations.push({ file: file.path, line: file.text.slice(0, offset).split('\n').length, rule, text }))
  }
  return violations
}

/**
 * Count violations by file, rule and matched text.
 * @param violations - output of `scan`.
 * @returns the counts with sorted keys, in the baseline format.
 */
export function countViolations(violations: readonly Violation[]): Baseline {
  const counts: Baseline = {}
  for (const v of violations) counts[`${v.file} ${v.rule} ${v.text}`] = (counts[`${v.file} ${v.rule} ${v.text}`] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

/**
 * Compare violations with the ratchet baseline. A new entry, more matches than an entry's count, and fewer matches
 * than its count each fail, so a change that removes a violation lowers its entry in the same commit.
 * @param violations - output of `scan`.
 * @param baseline - the recorded counts.
 * @returns one line per differing entry, with the lines of its current matches and the statement of its rule; empty
 * when the counts are equal.
 */
export function compareBaseline(violations: readonly Violation[], baseline: Baseline): string[] {
  const found = countViolations(violations)
  return [...new Set([...Object.keys(found), ...Object.keys(baseline)])].sort()
    .filter(key => (found[key] ?? 0) !== (baseline[key] ?? 0))
    .map((key) => {
      const rule = (key.split(' ')[1] ?? '').replace(/^(R\d+)[a-z]$/u, '$1')
      const lines = violations.filter(v => `${v.file} ${v.rule} ${v.text}` === key).map(v => v.line).join(',')
      return `${key}: found ${String(found[key] ?? 0)}, baseline ${String(baseline[key] ?? 0)}; lines ${lines}; ${rule}: ${RULE_STATEMENTS[rule] ?? ''}`
    })
}
