/** Independently installed MiniMax skill catalog, lazy instructions, references and preview GIFs. */
import { readFileSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BUNDLED_SKILL_RANK, type SkillCandidate } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-client-connection'
import { MINIMAX_SKILLS, PREVIEWS, isMiniMaxSkill } from './catalog.ts'

const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url))
const ROOT = join(ASSETS, 'skills')
const PROVIDER = 'minimax-h3'

/** Cordis identity of the standalone skill-set plugin. */
export const name = 'dv-minimax-skills'
/** The registry is the only required Host capability; the tool registry and Connection are optional. */
export const inject = ['skills']

/** Bounded bundled reference reads. */
export interface Config {
  /** Maximum bytes admitted for one bundled reference document. */
  referenceMaxBytes?: number
}

/** Validated plugin-owned settings. */
export const Config: z<Config> = z.object({
  referenceMaxBytes: z.natural().min(1).default(1024 * 1024),
})

/** Register summaries without reading skill bodies; the standard loader reads bodies only on demand.
 * @param ctx - context carrying the central skill registry.
 * @param config - reference bounds.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = Config(config)
  const metadata = JSON.parse(readFileSync(join(ASSETS, 'catalog.json'), 'utf8')) as Array<{ name: string; description: string }>
  if (metadata.length !== MINIMAX_SKILLS.length
    || MINIMAX_SKILLS.some(skill => metadata.filter(item => item.name === skill).length !== 1)) {
    throw new Error('MiniMax catalog must contain exactly the nine pinned official skills')
  }
  ctx.skills.registerProvider((control) => {
    const filesystem = new FileSystemSkillProvider(ctx, control, {
      providerName: PROVIDER, includeDefaultRoots: false, bundledSkillDir: ROOT, watch: false,
    })
    const candidates: SkillCandidate[] = metadata.map(item => ({
      name: item.name, description: item.description,
      invocation: { userInvocable: true, modelInvocable: true },
      source: 'bundled', provider: PROVIDER, rank: BUNDLED_SKILL_RANK,
      path: join(ROOT, item.name, 'SKILL.md'),
      resourceBase: { kind: 'directory', path: join(ROOT, item.name) },
      locator: { path: join(ROOT, item.name, 'SKILL.md'), directory: join(ROOT, item.name) },
    }))
    return {
      name: PROVIDER,
      list: () => Promise.resolve(candidates),
      async get(candidate, options) {
        const loaded = await filesystem.get(candidate, options)
        if (loaded === undefined) return undefined
        const adapter = await readFile(join(ASSETS, 'compatibility.md'), { encoding: 'utf8', signal: options.signal })
        return { ...loaded, content: `${loaded.content}\n\n${adapter}\n\nFor required reference documents, call dv_skill_read_reference with skill="${loaded.name}" and the relative resource path.` }
      },
    }
  })
  ctx.inject(['tools'], (child) => {
    child.tools.register(defineTool({
      name: 'dv_skill_read_reference',
      description: 'Read a bundled reference document for a MiniMax skill. Supply the exact skill name and its relative references/ or agents/ path.',
      parameters: {
        skill: { type: 'string', required: true, description: 'Exact MiniMax skill name.' },
        path: { type: 'string', required: true, description: 'Relative reference path, for example references/ref-en.txt.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          path: { type: 'string', required: true }, text: { type: 'string', required: true },
        } },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      async execute(args, exec) {
        if (!isMiniMaxSkill(args.skill)) throw new Error('Unknown MiniMax skill')
        const available = await child.skills.get(args.skill, {
          scope: exec.agent, cwd: exec.agent?.session.header.cwd, signal: exec.signal,
        })
        if (available?.provider !== PROVIDER) throw new Error('MiniMax skill is not available in this scope')
        const base = await realpath(join(ROOT, args.skill))
        const path = await realpath(join(base, args.path))
        const local = relative(base, path)
        if (isAbsolute(args.path) || isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)
          || !/^(references|agents)[/\\].*\.(md|txt|ya?ml)$/u.test(local)) throw new Error('Only this skill’s bundled reference documents can be read')
        const limit = resolved.referenceMaxBytes
        if (limit === undefined) throw new Error('Missing referenceMaxBytes')
        if ((await stat(path)).size > limit) throw new Error('MiniMax reference exceeds referenceMaxBytes')
        const bytes = await readFile(path, { signal: exec.signal })
        if (bytes.length > limit) throw new Error('MiniMax reference exceeds referenceMaxBytes')
        return { path: args.path, text: bytes.toString('utf8') }
      },
    }))
  })
  ctx.inject(['connection'], (child) => {
    for (const [skill, filename] of Object.entries(PREVIEWS)) {
      child.effect(() => child.connection.fetch.register({
        path: `/api/minimax/previews/${skill}.gif`, methods: ['GET'], requestBody: 'buffered',
        fetch: async () => new Response(await readFile(join(ASSETS, 'previews', filename)), {
          headers: { 'content-type': 'image/gif', 'cache-control': 'private, max-age=86400' },
        }),
      }), 'MiniMax bundled preview')
    }
  })
}
