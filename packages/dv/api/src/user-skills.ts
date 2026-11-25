/** Persistent user skill bundles, validated before an atomic directory install. */
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { unzipSync } from 'fflate'
import { parse, stringify } from 'yaml'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { answer, ApiRequestError } from './api.ts'

/** Resource limits applied before archive extraction and installation. */
export interface UserSkillLimits {
  /** Maximum compressed upload size. */
  uploadBytes: number
  /** Maximum total uncompressed bundle size. */
  extractedBytes: number
  /** Maximum number of archive entries. */
  files: number
}

/** The fields of a skill that the Skills page writes and edits: its frontmatter name and description, and its body. */
export interface SkillText {
  name: string
  description: string
  instructions: string
}

/** A saved skill as the editor reads it: its fields and the path of its SKILL.md on the harness machine. */
export interface SavedSkillText extends SkillText {
  path: string
}

/** Metadata of a saved, user-invocable skill. */
export interface SavedSkill {
  name: string
  description: string
  modelInvocable: boolean
}

/** @throws ApiRequestError `400 invalid_skill` with the given message. */
function invalid(message: string): never {
  throw new ApiRequestError(400, message, 'invalid_skill')
}

/** The pattern of a skill name, which is also its folder name and its `/name` command. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** Split SKILL.md into its YAML frontmatter object and its instruction body. */
function split(bytes: Uint8Array): { fields: Record<string, unknown>; body: string } {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { return invalid('SKILL.md must be UTF-8 text') }
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(text)
  if (match === null) return invalid('SKILL.md needs YAML frontmatter with name and description')
  let data: unknown
  try { data = parse(match[1] ?? '') }
  catch { return invalid('SKILL.md has invalid YAML frontmatter') }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return invalid('Skill metadata must be a YAML object')
  return { fields: data as Record<string, unknown>, body: match[2] ?? '' }
}

/** SKILL.md text from frontmatter fields and an instruction body. */
function compose(fields: Record<string, unknown>, instructions: string): Uint8Array {
  return new TextEncoder().encode(`---\n${stringify(fields)}---\n${instructions.trim()}\n`)
}

/** Validate SKILL.md: UTF-8, YAML frontmatter, name, description, invocation flags, and nonempty instructions. */
function metadata(bytes: Uint8Array): SavedSkill {
  const { fields, body } = split(bytes)
  if (typeof fields['name'] !== 'string' || !SKILL_NAME.test(fields['name']) || fields['name'].length > 100) {
    return invalid('Skill name must use lowercase letters, numbers and hyphens (up to 100 characters)')
  }
  if (typeof fields['description'] !== 'string' || fields['description'].trim() === '') return invalid('Skill description is required')
  if (body.trim() === '') return invalid('Skill instructions cannot be empty')
  for (const key of ['user-invocable', 'disable-model-invocation']) {
    if (fields[key] !== undefined && typeof fields[key] !== 'boolean') return invalid(`${key} must be a boolean`)
  }
  if (fields['userInvocable'] !== undefined || fields['disableModelInvocation'] !== undefined) return invalid('Use user-invocable and disable-model-invocation in frontmatter')
  if (fields['user-invocable'] === false) return invalid('Uploaded skills must allow user invocation')
  return { name: fields['name'], description: fields['description'].trim(), modelInvocable: fields['disable-model-invocation'] !== true }
}

/** Disk-backed user library; restarting the application preserves every installed bundle. */
export class UserSkillStore {
  /** @param directory - root also scanned by the DreamVerse preset's filesystem skill provider.
   * @param limits - upload and extraction bounds.
   * @param ensureAvailable - optional registry collision check before publishing files.
   */
  constructor(
    readonly directory: string,
    readonly limits: UserSkillLimits,
    private readonly ensureAvailable?: (name: string) => Promise<void>,
  ) {}

  /** @returns saved skill summaries in name order; an absent library is empty, and a folder without a valid
   * SKILL.md is skipped, as the filesystem skill provider skips it. */
  async list(): Promise<SavedSkill[]> {
    let entries
    try { entries = await readdir(this.directory, { withFileTypes: true }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const skills = await Promise.all(entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(async (entry) => {
        try { return metadata(await readFile(join(this.directory, entry.name, 'SKILL.md'))) }
        catch (error) {
          if (error instanceof ApiRequestError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
          throw error
        }
      }))
    return skills.filter(skill => skill !== undefined).sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Install one Markdown file or ZIP bundle without replacing an existing skill.
   * @param filename - original upload name, used only to select its format.
   * @param bytes - uploaded contents.
   * @returns saved metadata after all files are committed.
   * @throws ApiRequestError for malformed, oversized or duplicate bundles.
   */
  async install(filename: string, bytes: Uint8Array): Promise<SavedSkill> {
    if (bytes.length > this.limits.uploadBytes) return invalid('Skill upload is too large')
    let files: Record<string, Uint8Array>
    if (filename.toLowerCase().endsWith('.md')) files = { 'SKILL.md': bytes }
    else if (filename.toLowerCase().endsWith('.zip')) {
      let total = 0
      let extracted = 0
      const seen = new Set<string>()
      try {
        files = unzipSync(bytes, { filter: (file) => {
          if (++total > this.limits.files) return invalid('Skill archive contains too many entries')
          if (file.name.startsWith('__MACOSX/') || file.name.split('/').some(part => part.startsWith('._'))) return false
          if (file.name.startsWith('/') || file.name.includes('\\') || file.name.includes(':') || file.name.includes('\0')
            || file.name.split('/').some(part => part === '..' || part === '.')) return invalid('Skill archive contains an unsafe path')
          if (seen.has(file.name)) return invalid('Skill archive contains duplicate paths')
          seen.add(file.name)
          extracted += file.originalSize
          if (extracted > this.limits.extractedBytes) return invalid('Extracted skill bundle is too large')
          return !file.name.endsWith('/')
        } })
      } catch (error) {
        if (error instanceof ApiRequestError) throw error
        return invalid('Could not read the skill ZIP archive')
      }
    } else return invalid('Upload a Markdown file or ZIP skill bundle')
    const totalBytes = Object.values(files).reduce((sum, value) => sum + value.length, 0)
    if (totalBytes > this.limits.extractedBytes) return invalid('Extracted skill bundle is too large')
    const instructions = Object.keys(files).filter(path => path === 'SKILL.md' || path.endsWith('/SKILL.md'))
    if (instructions.length !== 1) return invalid('Upload one skill bundle containing exactly one SKILL.md')
    const instruction = instructions[0]
    if (instruction === undefined) return invalid('SKILL.md is missing')
    const prefix = instruction.slice(0, -'SKILL.md'.length)
    if (Object.keys(files).some(path => !path.startsWith(prefix))) return invalid('All files must be inside the skill folder')
    const skill = metadata(files[instruction] ?? new Uint8Array())
    await this.ensureAvailable?.(skill.name)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const staging = await mkdtemp(join(dirname(this.directory), '.skill-upload-'))
    try {
      for (const [path, content] of Object.entries(files)) {
        const local = path.slice(prefix.length)
        if (local === '' || local.split('/').some(part => part === '')) return invalid('Skill archive contains an invalid path')
        const target = join(staging, local)
        await mkdir(dirname(target), { recursive: true, mode: 0o700 })
        await writeFile(target, content, { flag: 'wx', mode: 0o600 })
      }
      try { await rename(staging, join(this.directory, skill.name)) }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EEXIST' || code === 'ENOTEMPTY') throw new ApiRequestError(409, 'A saved skill already uses this name', 'skill_exists')
        throw error
      }
    } finally { await rm(staging, { recursive: true, force: true }) }
    return skill
  }

  /**
   * Save a new skill written on the Skills page as its SKILL.md, through the same checks as an upload.
   * @param text - the name, description and instructions.
   * @returns saved metadata.
   * @throws ApiRequestError for invalid fields or a name that is already used.
   */
  async create(text: SkillText): Promise<SavedSkill> {
    return this.install('SKILL.md', compose({ name: text.name, description: text.description }, text.instructions))
  }

  /**
   * Read the editable fields of one saved skill.
   * @param name - the skill name.
   * @returns its name, description, instructions, and the path of its SKILL.md.
   * @throws ApiRequestError `404 skill_not_found` when the library has no such skill.
   */
  async read(name: string): Promise<SavedSkillText> {
    const { fields, body } = split(await this.skillFile(name))
    return {
      name, description: typeof fields['description'] === 'string' ? fields['description'].trim() : '', instructions: body.trim(),
      path: join(this.directory, name, 'SKILL.md'),
    }
  }

  /**
   * Delete one saved skill: its folder with SKILL.md and every bundle file.
   * @param name - the skill name.
   * @throws ApiRequestError `404 skill_not_found` when the library has no such skill.
   */
  async remove(name: string): Promise<void> {
    await this.skillFile(name)
    await rm(join(this.directory, name), { recursive: true, force: true })
  }

  /**
   * Replace the description and instructions of one saved skill. The name stays, because it is the folder name and the
   * `/name` command; the other frontmatter keys and the bundle's other files are kept. SKILL.md is replaced in one rename.
   * @param text - the skill name, and its new description and instructions.
   * @returns saved metadata.
   * @throws ApiRequestError `404 skill_not_found` for an unknown skill, `400 invalid_skill` for invalid fields.
   */
  async update(text: SkillText): Promise<SavedSkill> {
    const { fields } = split(await this.skillFile(text.name))
    const bytes = compose({ ...fields, name: text.name, description: text.description }, text.instructions)
    if (bytes.length > this.limits.uploadBytes) return invalid('Skill instructions are too large')
    const skill = metadata(bytes)
    const target = join(this.directory, text.name, 'SKILL.md')
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
      await rename(temporary, target)
    } finally { await rm(temporary, { force: true }) }
    return skill
  }

  /** The SKILL.md bytes of one saved skill; refuses names that are not skill names, so no path leaves the library. */
  private async skillFile(name: string): Promise<Uint8Array> {
    if (!SKILL_NAME.test(name)) throw new ApiRequestError(404, 'No saved skill uses this name', 'skill_not_found')
    try { return await readFile(join(this.directory, name, 'SKILL.md')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiRequestError(404, 'No saved skill uses this name', 'skill_not_found')
      throw error
    }
  }
}

/** The `{name, description, instructions}` body of a create, update or delete request, as strings; missing fields are empty. */
function skillText(body: unknown): SkillText {
  if (typeof body !== 'object' || body === null) return invalid('Send the skill name, description and instructions')
  const fields = body as Record<string, unknown>
  const text = (key: string): string => (typeof fields[key] === 'string' ? fields[key] : '')
  return { name: text('name'), description: text('description'), instructions: text('instructions') }
}

/** @param store - persistent library.
 * @returns authenticated Connection routes; streaming bounds uploads before buffering their contents.
 */
export function userSkillRoutes(store: UserSkillStore): ConnectionFetchRoute[] {
  return [{
    path: '/api/dv/skills', methods: ['GET'], requestBody: 'buffered',
    fetch: () => answer(() => store.list()),
  }, {
    path: '/api/dv/skills/read', methods: ['GET'], requestBody: 'buffered',
    fetch: request => answer(() => store.read(new URL(request.url).searchParams.get('name') ?? '')),
  }, {
    path: '/api/dv/skills/create', methods: ['POST'], requestBody: 'buffered',
    fetch: request => answer(async () => store.create(skillText(await request.json()))),
  }, {
    path: '/api/dv/skills/update', methods: ['POST'], requestBody: 'buffered',
    fetch: request => answer(async () => store.update(skillText(await request.json()))),
  }, {
    path: '/api/dv/skills/delete', methods: ['POST'], requestBody: 'buffered',
    fetch: request => answer(async () => {
      const { name } = skillText(await request.json())
      await store.remove(name)
      return { name }
    }),
  }, {
    path: '/api/dv/skills/upload', methods: ['POST'], requestBody: 'streaming',
    fetch: request => answer(async () => {
      const filename = new URL(request.url).searchParams.get('filename') ?? ''
      const reader = request.body?.getReader()
      if (reader === undefined) return invalid('Choose a skill file to upload')
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          size += next.value.length
          if (size > store.limits.uploadBytes) {
            await reader.cancel()
            return invalid('Skill upload is too large')
          }
          chunks.push(next.value)
        }
      } finally { reader.releaseLock() }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      return store.install(filename, bytes)
    }),
  }]
}
