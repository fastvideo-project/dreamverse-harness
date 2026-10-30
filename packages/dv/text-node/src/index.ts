/**
 * The Text node component of DreamVerse as the `dvTextNode` Cordis service: versioned Markdown documents of a project
 * for planning text, such as a script, story beats or an ad spec. A text node is named by its caller-chosen
 * `TextPath` (`beats.md`, `episodes/ep001/script.md`), and each write stores the next version. It owns three operations:
 * - `textnode.write`: the whole body as the next version; version 1 for a new path;
 * - `textnode.edit`: literal replacements on the newest version, each `old_text` occurring exactly once;
 * - `textnode.read`: a read that writes no record, of one version or one heading's section, with line numbers.
 *
 * Each write stores the body as a `text/markdown` asset and supersedes the record of the previous version, so records
 * that took the previous asset become stale. `base_version` refuses a write over a version the caller has not read.
 * A write names the text nodes it was built from as `source` inputs on their current records, so a later version of a
 * source makes it stale; a write without that list keeps the sources of the previous version. `dvProject` turns each
 * operation into its agent tool (`dv_textnode_write`, `dv_textnode_edit`, `dv_textnode_read`). While the DSH skill
 * registry is mounted, the component registers the `text-node` skill.
 *
 * @module @dv/text-node
 */
import { readFileSync } from 'node:fs'
import { Service, type Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import type { OperationResult, OperationSpec, OperationToolCall, ProjectState, RecordId, RunRequest } from '@dv/project'
import { latestVersion, nextText, textReducer } from './reducer.ts'
import { numberedLines, parseTextPath } from './text.ts'
import type { TextVersion } from './types.ts'

export type { TextEdit, TextPath, TextState, TextVersion } from './types.ts'
export { parseTextPath } from './text.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Text node component: versioned Markdown documents of a project. */
    dvTextNode: DvTextNode
  }
}

/** `dvTextNode` plugin configuration: the component has no deployment-varying values. */
export type Config = Record<string, unknown>

/** Loader validation. */
export const Config: z<Config> = z.object({})

/** The skill that tells the agent when to write, edit and read text nodes. */
const TEXT_SKILL = {
  name: 'text-node',
  description: 'How to keep planning text such as a script, story beats or an ad spec in versioned Markdown text nodes of the '
    + 'project: when to write a whole text, when to edit it, and how never to overwrite a version you have not read.',
  whenToUse: 'You write, change or read planning text of a DreamVerse project, or a workflow tells you to keep a document.',
  content: readFileSync(new URL('../skills/text-node/SKILL.md', import.meta.url), 'utf8'),
  source: 'runtime',
}

/** The `path` param of every text operation. */
const PATH_PARAM = {
  path: {
    type: 'string', required: true,
    description: 'The text node, as a relative path such as beats.md or episodes/ep001/script.md (no whitespace, @, # or .., '
      + 'no leading /, no empty or . part).',
  },
} as const

/** The `base_version` param of the writing operations. */
const BASE_PARAM = {
  base_version: {
    type: 'integer', required: true,
    description: 'The version you last read (`version` in dv_proj_state `texts` or in the dv_textnode_read report); 0 for a new text '
      + 'node. The call is refused when the text node has another version.',
  },
} as const

/**
 * Refuse a write while another write of the same text node has not finished, or whose `base_version` is not the text
 * node's newest version (0 for a new path). The runner calls it under the project lock, so of two concurrent writes on one base only the
 * first one passes.
 * @param params - the call's params; `path` is parsed first, so a bad path is refused too.
 * @param state - the project's current state.
 * @returns the newest version, when the text node has one.
 * @throws Error that tells the caller to wait or to read the text node again.
 */
function checkBase(params: Record<string, unknown>, state: ProjectState): TextVersion | undefined {
  const path = parseTextPath(String(params['path']))
  const unfinished = state.components.proj.records.find(record => (record.status === 'pending' || record.status === 'running')
    && (record.operation === 'textnode.write' || record.operation === 'textnode.edit') && record.params['path'] === path)
  if (unfinished !== undefined) {
    throw new Error(`Text node ${path} has a write that has not finished (record ${unfinished.id}). Wait for it with dv_proj_wait, `
      + `then call dv_textnode_read on ${path} and make your change on the new version.`)
  }
  const latest = latestVersion(state, path)
  const current = latest?.version ?? 0
  const base = params['base_version']
  if (base !== current) {
    throw new Error(`Text node ${path} is at version ${String(current)}, not base_version ${String(base)}: it changed since you `
      + `read it. Call dv_textnode_read on ${path} again, then make your change on version ${String(current)}.`)
  }
  return latest
}

/** The file name of the asset of a text node: the last part of its path. */
function fileName(path: string): string {
  return path.split('/').at(-1) ?? path
}

/** The input role of the text nodes that a version was built from. */
const SOURCE = 'source'

/**
 * Point a writing call's `source` inputs at the current records of the text nodes it names in `from`, or, without
 * `from`, at the sources of the previous version, so an edit keeps its links and its stale mark.
 * @param call - the parsed agent call; its request's `inputs` and `based_on` are set here.
 */
function linkSources({ args, request, state }: OperationToolCall): Promise<void> {
  const path = parseTextPath(String(request.params['path']))
  const latest = latestVersion(state, path)
  const from = args['from']
  if (Array.isArray(from)) {
    request.inputs = from.map((raw) => {
      const source = parseTextPath(String(raw))
      const found = latestVersion(state, source)
      if (source === path) throw new Error(`Text node ${path} cannot be built from itself.`)
      if (found === undefined) throw new Error(`No text node ${source}; dv_proj_state lists the text nodes under texts.`)
      return { role: SOURCE, ref: { record: found.created_by, output: 0 } }
    })
  } else if (request.inputs.length === 0 && latest !== undefined) {
    request.inputs = previousSources(state, latest.created_by)
  }
  // Each version is a changed copy of the previous one, so the canvas draws one lineage per text node.
  if (request.based_on === undefined && latest !== undefined) request.based_on = latest.created_by
  return Promise.resolve()
}

/** The `source` inputs of the record that wrote a version, as run request inputs. */
function previousSources(state: ProjectState, record: RecordId): RunRequest['inputs'] {
  const written = state.components.proj.records.find(candidate => candidate.id === record)
  return (written?.inputs ?? []).filter(input => input.role === SOURCE).map(({ role, ref }) => ({ role, ref }))
}

/** The Text node service: the component, the reducer, the three operations and the skill. */
export default class DvTextNode extends Service {
  static inject = ['dvProject']
  static Config = Config

  constructor(ctx: Context, _config: Config) {
    super(ctx, 'dvTextNode')
    ctx.effect(() => ctx.dvProject.registerComponent('textnode'), 'dvTextNode component')
    ctx.effect(() => ctx.dvProject.registerReducer('textnode', textReducer), 'dvTextNode reducer')
    for (const spec of operations()) ctx.effect(() => ctx.dvProject.registerOperation(spec), `dvTextNode ${spec.name}`)
    ctx.inject(['skills'], (child) => {
      child.effect(() => child.skills.register(TEXT_SKILL), `dvTextNode ${TEXT_SKILL.name}`)
    })
  }
}

/**
 * A writing operation, `textnode.write` or `textnode.edit`: it stores the next version as one `text/markdown` output,
 * supersedes the record of the previous version, and takes the text nodes it was built from as `source` inputs.
 * @param spec - its name, component, label, description, params, tool params and precondition.
 * @returns the spec.
 */
function writing(
  spec: Pick<OperationSpec, 'component' | 'label' | 'description' | 'params' | 'toolParams' | 'precondition'>
    & { name: 'textnode.write' | 'textnode.edit' },
): OperationSpec {
  const { name } = spec
  return {
    ...spec, version: '1', outputs: [{ role: 'text', type: 'text' }],
    inputs: { [SOURCE]: { type: 'text', description: 'A text node this version was built from.', many: true } },
    confirm: 'never', deterministic: false, resource: 'none', prepareToolCall: linkSources,
    supersedes: (params, state) => {
      const latest = latestVersion(state, String(params['path']))
      return latest === undefined ? [] : [latest.created_by]
    },
    summarize: (record) => {
      const version = record.report?.['version']
      return `${name === 'textnode.edit' ? 'edited' : 'wrote'} ${String(record.params['path'])} v${typeof version === 'number' ? String(version) : '?'}`
    },
    execute: (context): Promise<OperationResult> => {
      const path = parseTextPath(String(context.params['path']))
      const latest = latestVersion(context.state, path)
      const next = nextText(name, context.params, latest)
      if (!next.ok) throw new Error(next.problems.join(' '))
      const asset = context.importAsset(Buffer.from(next.body), { mime: 'text/markdown', name: fileName(path) })
      const report = { path, version: (latest?.version ?? 0) + 1, title: next.title, chars: Array.from(next.body).length }
      return Promise.resolve({ outputs: [asset], report })
    },
  }
}

/** The three text operations. */
function operations(): OperationSpec[] {
  return [
    writing({
      name: 'textnode.write',
      component: 'textnode',
      label: { zh: '写入文本', en: 'Write text' },
      description: 'Write the whole Markdown text of a text node as its next version; a new path starts at version 1. A text node '
        + 'holds planning text such as a script, story beats or an ad spec. base_version is the version you read, so you never '
        + 'overwrite a version you have not read; 0 for a new path. For a small change to a long text, call dv_textnode_edit instead.',
      params: {
        ...PATH_PARAM,
        body: { type: 'string', required: true, description: 'The complete Markdown text of the new version.' },
        title: { type: 'string', description: 'The title; defaults to the previous title, else the first heading, else the path.' },
        ...BASE_PARAM,
      },
      toolParams: {
        from: {
          type: 'array', items: { type: 'string' },
          description: 'The paths of the text nodes this version was built from, such as the beats a script follows; a later '
            + 'version of one of them marks this version stale. Omit it to keep the sources of the previous version; [] for none.',
        },
      },
      precondition: (request, state) => {
        checkBase(request.params, state)
        return Promise.resolve()
      },
    }),
    writing({
      name: 'textnode.edit',
      component: 'textnode',
      label: { zh: '修改文本', en: 'Edit text' },
      description: 'Change a text node by literal replacements and write the result as its next version. The edits apply in '
        + 'order; each old_text must occur exactly once in the text, so copy it from dv_textnode_read without the line numbers and '
        + 'add neighboring lines when it repeats. When any edit does not apply, nothing is written. base_version is the version '
        + 'you read.',
      params: {
        ...PATH_PARAM,
        edits: {
          type: 'array', required: true,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              old_text: { type: 'string', required: true, description: 'Text that occurs exactly once.' },
              new_text: { type: 'string', required: true, description: 'Its replacement; empty to delete it.' },
            },
          },
        },
        ...BASE_PARAM,
      },
      precondition: (request, state) => {
        const next = nextText('textnode.edit', request.params, checkBase(request.params, state))
        if (!next.ok) throw new Error(`dv_textnode_edit wrote nothing. ${next.problems.join(' ')}`)
        return Promise.resolve()
      },
    }),
    {
      name: 'textnode.read',
      component: 'textnode',
      version: '1',
      label: { zh: '读取文本', en: 'Read text' },
      description: 'Read a text node with line numbers: the whole text, or one section (a heading and its lines up to the next '
        + 'heading of the same or a higher level). The newest version unless you pass version. dv_proj_state lists the text '
        + 'nodes under texts.',
      params: {
        ...PATH_PARAM,
        section: { type: 'string', description: 'The text of a heading, without the # marks.' },
        version: { type: 'integer', description: 'A version number; defaults to the newest version.' },
      },
      inputs: {},
      outputs: [],
      confirm: 'never',
      deterministic: false,
      resource: 'none',
      readOnly: true,
      summarize: record => `read ${String(record.params['path'])}`,
      execute: (context): Promise<OperationResult> => {
        const path = parseTextPath(String(context.params['path']))
        const versions = context.state.components.textnode.texts[path]
        if (versions === undefined) throw new Error(`No text node ${path}; dv_proj_state lists the text nodes under texts.`)
        const wanted = context.params['version']
        const found = typeof wanted === 'number' ? versions[wanted - 1] : versions.at(-1)
        if (found === undefined) throw new Error(`Text node ${path} has no version ${String(wanted)}; it has ${String(versions.length)}.`)
        const section = typeof context.params['section'] === 'string' ? context.params['section'] : undefined
        const report = {
          path, version: found.version, title: found.title, chars: Array.from(found.body).length,
          ...section === undefined ? {} : { section }, text: numberedLines(found.body, section),
        }
        return Promise.resolve({ outputs: [], report })
      },
    },
  ]
}
