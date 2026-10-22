/**
 * Check the size of one DreamVerse change against a base commit. R9: every changed path is own, wiring (W), or
 * matched by an `--allow` glob and its limits. R10: at most 400 counted lines, or the cap of `--max-lines <n>`, and at
 * most 3 logic packages. `--lint`: the default oxlint config reports no finding on an added line.
 *
 * Usage: `pnpm exec tsx scripts/dv-blast-radius.ts --base <sha> [--own <dir or glob>]...
 * [--allow <glob>[:max=<n>][:net-delete]]... [--max-lines <n>] [--lint]`
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { renderChangeScope } from './change-scope.ts'

/** The added and deleted line texts of one changed file, with a repository-relative `/` path and the new-file line
 *  number of each added line. */
export interface FileChange { path: string; added: string[]; addedAt: number[]; deleted: string[] }

/** One `--allow` glob with its optional limits. */
export interface Allow { glob: string; max: number | undefined; netDelete: boolean }

/** Inputs of `checkBudget` besides the changes. */
export interface BudgetOptions {
  own: string[]
  allow: Allow[]
  /** `packages/<group>/<pkg>` directories, and the ratchet baseline file, that exist at the merge base. */
  existing: ReadonlySet<string>
  /** The counted-line cap of R10: 400, or the cap that a caller passes as `--max-lines <n>`. */
  maxLines: number
}

/** Outcome of `checkBudget`. The check passes when `failures` is empty. */
export interface BudgetReport {
  /** Changed paths outside own and wiring (X of R9). */
  outside: string[]
  brPkgs: number
  countedLines: number
  /** Existing packages with more than 2 changed `src` lines, some outside every limited allow glob (R10). */
  logicPackages: string[]
  /** One line per allow glob with a limit: its matched added and deleted lines. */
  limits: string[]
  failures: string[]
}

/** Wiring paths (W): always allowed, never counted. */
const WIRING = new Set([
  'tsconfig.base.json', 'tsconfig.host.json', 'tsconfig.client.json', 'pnpm-lock.yaml',
  ...['cordis.patch.yml', 'package.json', 'tests/composition.spec.ts', 'README.md', 'README.zh.md', 'README.i18n.yaml']
    .map(file => `packages/bundle/dv/${file}`),
])
/** The DreamVerse documentation tree: W. */
const DOCS_WIRING = /^docs\/dreamverse\//u
/** The ratchet baseline of `scripts/dv-architecture.spec.ts`: W with an implied `:net-delete` once it exists at the
 *  merge base. */
const BASELINE = 'scripts/dv-architecture.baseline.json'
/** W files of a package that does not exist at the merge base. */
const NEW_PACKAGE_WIRING = /^packages\/[^/]+\/[^/]+\/(?:README\.md|package\.json|tsconfig\.json)$/u
/** The only counted files of a package that does not exist at the merge base. */
const NEW_PACKAGE_COUNTED = /^packages\/[^/]+\/[^/]+\/(?:src|skills)\//u
/** Paths whose lines never count (R10). */
const UNCOUNTED = /(?:^|\/)tests\/|\.spec\.tsx?$|(?:^|\/)(?:pnpm-lock\.yaml|README\.zh\.md)$|\.i18n\.yaml$/u
const PACKAGE = /^packages\/[^/]+\/[^/]+(?=\/)/u
const SOURCE = /^(packages\/[^/]+\/[^/]+)\/src\//u
const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u
/** One finding of `oxlint -f unix`: path, line, column and text. */
const UNIX_FINDING = /^(.+?):(\d+):\d+: (.*)$/gmu
const TSX_CLI = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url))
const MAX_COUNTED_LINES = 400
const MAX_LOGIC_PACKAGES = 3

/**
 * Parse one `--allow` value.
 * @param value - `<glob>[:max=<n>][:net-delete]`.
 * @returns the glob and its limits.
 */
export function parseAllow(value: string): Allow {
  const match = /^(.+?)(?::max=(\d+))?(:net-delete)?$/u.exec(value)
  if (match === null) throw new Error(`dv-blast-radius: bad --allow value ${JSON.stringify(value)}`)
  return { glob: match[1] as string, max: match[2] === undefined ? undefined : Number(match[2]), netDelete: match[3] !== undefined }
}

/**
 * Parse the output of `git diff -U0` into added and deleted lines per file. Hunk headers give the line counts and the
 * first new-file line, so a content line that starts with `---` or `+++` stays content.
 * @param text - unified diff with `a/` and `b/` prefixes, no renames and no context lines.
 * @returns one entry per file in the diff; a binary file has no lines.
 */
export function parseDiff(text: string): FileChange[] {
  const changes: FileChange[] = []
  let file: FileChange = { path: '', added: [], addedAt: [], deleted: [] }
  let deletes = 0
  let adds = 0
  let next = 0
  for (const line of text.split('\n')) {
    if (deletes + adds > 0) {
      if (line.startsWith('-')) { file.deleted.push(line.slice(1)); deletes -= 1 }
      if (line.startsWith('+')) { file.added.push(line.slice(1)); file.addedAt.push(next); next += 1; adds -= 1 }
      continue
    }
    const hunk = HUNK.exec(line)
    if (line.startsWith('diff --git ')) changes.push(file = { path: '', added: [], addedAt: [], deleted: [] })
    else if (line.startsWith('--- a/') || line.startsWith('+++ b/')) file.path = line.slice(6).replace(/\t$/u, '')
    else if (hunk !== null) [deletes, next, adds] = [Number(hunk[1] ?? 1), Number(hunk[2]), Number(hunk[3] ?? 1)]
  }
  return changes
}

/**
 * Weigh the changed lines (R10): an added line counts 1 and a deleted line 0.5. A deleted line whose trimmed,
 * non-blank text is added in another file of the same diff is a moved line and counts 0.
 * @param changes - every file that the change touches.
 * @param isCounted - whether a path counts; by default every path that `UNCOUNTED` does not exclude.
 * @returns the counted lines over the files that `isCounted` accepts.
 */
export function countLines(changes: readonly FileChange[], isCounted = (path: string): boolean => !UNCOUNTED.test(path)): number {
  const adders = new Map<string, Set<string>>()
  for (const change of changes) {
    for (const line of change.added) adders.set(line.trim(), (adders.get(line.trim()) ?? new Set()).add(change.path))
  }
  let counted = 0
  for (const change of changes.filter(c => isCounted(c.path))) {
    counted += change.added.length
    for (const line of change.deleted) {
      const moved = line.trim() !== '' && [...adders.get(line.trim()) ?? []].some(path => path !== change.path)
      if (!moved) counted += 0.5
    }
  }
  return counted
}

/**
 * Apply R9 and R10 to the changed files of one change. W is the fixed list, the baseline file once it exists at the
 * merge base, and the `README.md`, `package.json` and `tsconfig.json` of a new package. A new package counts only its
 * `src/**` and `skills/**` lines. A package whose changed `src` files all match a limited allow glob is no logic
 * package.
 * @param changes - every changed path, with its lines (empty for a binary file).
 * @param options - own directories or globs, allow globs, the packages and baseline file that exist at the merge
 * base, and the counted-line cap.
 * @returns X, the counts and the failures.
 */
export function checkBudget(changes: readonly FileChange[], options: BudgetOptions): BudgetReport {
  const failures: string[] = []
  const isNewPackage = (path: string): boolean => {
    const pkg = PACKAGE.exec(path)?.[0]
    return pkg !== undefined && !options.existing.has(pkg)
  }
  const isWiring = (path: string): boolean => WIRING.has(path) || (path === BASELINE && options.existing.has(BASELINE))
    || DOCS_WIRING.test(path) || (NEW_PACKAGE_WIRING.test(path) && isNewPackage(path))
  const isOwn = (path: string): boolean => options.own.some(dir => path.startsWith(`${dir.replace(/\/+$/u, '')}/`) || posix.matchesGlob(path, dir))
  const outside = changes.map(c => c.path).filter(path => !isWiring(path) && !isOwn(path))
  for (const path of outside.filter(p => !options.allow.some(allow => posix.matchesGlob(p, allow.glob)))) {
    failures.push(`R9: ${path} is outside own, wiring and every --allow glob`)
  }
  const limited = options.allow.filter(allow => allow.max !== undefined || allow.netDelete)
  if (options.existing.has(BASELINE)) limited.push({ glob: BASELINE, max: undefined, netDelete: true })
  const limits = limited.map((allow) => {
    const matched = changes.filter(c => posix.matchesGlob(c.path, allow.glob))
    const added = matched.reduce((sum, c) => sum + c.added.length, 0)
    const deleted = matched.reduce((sum, c) => sum + c.deleted.length, 0)
    if (allow.max !== undefined && added + deleted > allow.max) failures.push(`R9: ${allow.glob} changes ${String(added + deleted)} lines, more than max=${String(allow.max)}`)
    if (allow.netDelete && added > deleted) failures.push(`R9: ${allow.glob} gains lines (+${String(added)} -${String(deleted)}), not a net deletion`)
    return `${allow.glob}: +${String(added)} -${String(deleted)}`
  })
  const sourceLines = new Map<string, { lines: number; unlimited: boolean }>()
  for (const change of changes.filter(c => !UNCOUNTED.test(c.path))) {
    const pkg = SOURCE.exec(change.path)?.[1]
    if (pkg === undefined || !options.existing.has(pkg)) continue
    const lines = change.added.length + change.deleted.length
    const unlimited = lines > 0 && !limited.some(allow => posix.matchesGlob(change.path, allow.glob))
    const total = sourceLines.get(pkg) ?? { lines: 0, unlimited: false }
    sourceLines.set(pkg, { lines: total.lines + lines, unlimited: total.unlimited || unlimited })
  }
  const logicPackages = [...sourceLines].filter(([, total]) => total.lines > 2 && total.unlimited).map(([pkg]) => pkg).sort()
  const isCounted = (path: string): boolean => !UNCOUNTED.test(path) && !isWiring(path)
    && (!isNewPackage(path) || NEW_PACKAGE_COUNTED.test(path))
  const countedLines = countLines(changes, isCounted)
  if (countedLines > options.maxLines) failures.push(`R10: ${String(countedLines)} counted lines, more than ${String(options.maxLines)}`)
  if (logicPackages.length > MAX_LOGIC_PACKAGES) failures.push(`R10: ${String(logicPackages.length)} existing packages with logic changes, more than ${String(MAX_LOGIC_PACKAGES)}`)
  const brPkgs = new Set(outside.map(path => PACKAGE.exec(path)?.[0]).filter(pkg => pkg !== undefined)).size
  return { outside, brPkgs, countedLines, logicPackages, limits, failures }
}

/**
 * Keep the oxlint findings that sit on an added line of the change. Findings on old lines do not block.
 * @param output - stdout of `scripts/run-oxlint.ts -f unix`, with repository-relative paths.
 * @param changes - every file that the change touches.
 * @returns one failure per finding on an added line.
 */
export function findingsOnAddedLines(output: string, changes: readonly FileChange[]): string[] {
  const added = new Map(changes.map(change => [change.path, new Set(change.addedAt)]))
  return [...output.matchAll(UNIX_FINDING)]
    .filter(([, path = '', line]) => added.get(path)?.has(Number(line)) === true)
    .map(([, path = '', line = '', text = '']) => `lint: ${path}:${line}: ${text}`)
}

/**
 * Lint the changed `.ts` and `.tsx` files that exist in the worktree with the default, type-aware oxlint config. The
 * type-aware rules read the host build, so run this after `tsc -b tsconfig.host.json`.
 * @param root - the repository root.
 * @param changes - every file that the change touches.
 * @returns the number of linted files and the failures: findings on added lines, or the oxlint error when oxlint
 * fails and reports no finding.
 */
function lintAddedLines(root: string, changes: readonly FileChange[]): { files: number; failures: string[] } {
  const files = changes.map(change => change.path).filter(path => /\.tsx?$/u.test(path) && existsSync(join(root, path)))
  if (files.length === 0) return { files: 0, failures: [] }
  const result = spawnSync(process.execPath, [TSX_CLI, 'scripts/run-oxlint.ts', '-f', 'unix', ...files], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0 && result.stdout.match(UNIX_FINDING) === null) {
    return { files: files.length, failures: [`lint: oxlint exited ${String(result.status)}: ${`${result.stdout}${result.stderr}`.trim()}`] }
  }
  return { files: files.length, failures: findingsOnAddedLines(result.stdout, changes) }
}

function git(root: string, args: string[]): string {
  const result = spawnSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.trim()}`)
  return result.stdout
}

/**
 * Collect the changed files of the worktree against a base, as `scripts/change-scope.ts` scopes them (committed,
 * staged, unstaged and untracked), with their lines from the merge base to the working tree.
 * @param cwd - a directory inside the worktree.
 * @param base - the parent commit of the change.
 * @returns the repository root, the changes, the merge base, and the touched packages and baseline file that exist at
 * the merge base.
 */
function collectChanges(cwd: string, base: string): { root: string; changes: FileChange[]; mergeBase: string; existing: Set<string> } {
  const scope = JSON.parse(renderChangeScope(['--base', base], cwd)) as {
    repositoryRoot: string
    resolved: { mergeBaseSha: string }
    paths: Record<string, string[]>
  }
  const root = scope.repositoryRoot
  const mergeBase = scope.resolved.mergeBaseSha
  const diff = git(root, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', '-U0', mergeBase, '--'])
  const byPath = new Map(parseDiff(diff).map(change => [change.path, change]))
  for (const path of scope.paths.untracked ?? []) {
    const text = readFileSync(join(root, path), 'utf8')
    const added = text.includes('\0') ? [] : text.replace(/\n$/u, '').split('\n')
    byPath.set(path, { path, added, addedAt: added.map((_, index) => index + 1), deleted: [] })
  }
  const changes = [...new Set(Object.values(scope.paths).flat())].sort()
    .map(path => byPath.get(path) ?? { path, added: [], addedAt: [], deleted: [] })
  const touched = new Set(changes.map(change => PACKAGE.exec(change.path)?.[0] ?? (change.path === BASELINE ? BASELINE : undefined))
    .filter(pkg => pkg !== undefined))
  const existing = new Set([...touched].filter(pkg => spawnSync('git', ['-C', root, 'cat-file', '-e', `${mergeBase}:${pkg}`]).status === 0))
  return { root, changes, mergeBase, existing }
}

/**
 * Run the change size check from command-line arguments.
 * @param args - arguments after the script path.
 * @param cwd - a directory inside the worktree.
 * @returns the report text and whether the change passes the check.
 */
export function runBlastRadius(args: string[], cwd: string): { text: string; ok: boolean } {
  const { values } = parseArgs({
    args, strict: true, allowPositionals: false,
    options: {
      base: { type: 'string' }, own: { type: 'string', multiple: true, default: [] }, allow: { type: 'string', multiple: true, default: [] },
      'max-lines': { type: 'string' }, lint: { type: 'boolean', default: false },
    },
  })
  if (values.base === undefined) throw new Error('dv-blast-radius: missing required --base <sha>')
  const cap = values['max-lines']
  if (cap !== undefined && !/^[1-9]\d*$/u.test(cap)) throw new Error(`dv-blast-radius: bad --max-lines value ${JSON.stringify(cap)}`)
  const maxLines = cap === undefined ? MAX_COUNTED_LINES : Number(cap)
  const allow = values.allow.map(parseAllow)
  const { root, changes, mergeBase, existing } = collectChanges(cwd, values.base)
  const report = checkBudget(changes, { own: values.own, allow, existing, maxLines })
  const lint = values.lint ? lintAddedLines(root, changes) : undefined
  report.failures.push(...lint?.failures ?? [])
  const lines = [
    `base ${values.base} (merge base ${mergeBase}): ${String(changes.length)} changed paths`,
    `own: ${values.own.join(' ') || 'none'}; allowed: ${allow.map(a => a.glob).join(' ') || 'none'}`,
    ...report.outside.map(path => `X ${path}`),
    `BR_files = ${String(report.outside.length)}`,
    `BR_pkgs = ${String(report.brPkgs)}`,
    ...report.limits.map(limit => `limit ${limit}`),
    `counted lines = ${String(report.countedLines)} (max ${String(maxLines)})`,
    `packages with logic changes = ${String(report.logicPackages.length)} (max ${String(MAX_LOGIC_PACKAGES)}) ${report.logicPackages.join(' ')}`.trimEnd(),
    ...lint === undefined ? [] : [`lint: ${String(lint.files)} files, ${String(lint.failures.length)} failures`],
    ...report.failures.map(failure => `FAIL ${failure}`),
    report.failures.length === 0 ? 'PASS' : 'FAIL',
  ]
  return { text: `${lines.join('\n')}\n`, ok: report.failures.length === 0 }
}

const entryPath = process.argv[1]
if (entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  try {
    const { text, ok } = runBlastRadius(process.argv.slice(2), process.cwd())
    process.stdout.write(text)
    if (!ok) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`dv-blast-radius: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
