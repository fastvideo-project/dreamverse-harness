/** Persistent user skill bundles, validated before an atomic directory install. */
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { unzipSync } from 'fflate'
import { parse } from 'yaml'
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

/** Metadata of a saved, user-invocable skill. */
export interface SavedSkill {
  name: string
  description: string
  modelInvocable: boolean
}

function invalid(message: string): never {
  throw new ApiRequestError(400, message, 'invalid_skill')
}

function metadata(bytes: Uint8Array): SavedSkill {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { return invalid('SKILL.md must be UTF-8 text') }
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(text)
  if (match === null) return invalid('SKILL.md needs YAML frontmatter with name and description')
  let data: unknown
  try { data = parse(match[1] ?? '') }
  catch { return invalid('SKILL.md has invalid YAML frontmatter') }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return invalid('Skill metadata must be a YAML object')
  const fields = data as Record<string, unknown>
  if (typeof fields['name'] !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(fields['name']) || fields['name'].length > 100) {
    return invalid('Skill name must use lowercase letters, numbers and hyphens (up to 100 characters)')
  }
  if (typeof fields['description'] !== 'string' || fields['description'].trim() === '') return invalid('Skill description is required')
  if ((match[2] ?? '').trim() === '') return invalid('Skill instructions cannot be empty')
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

  /** @returns saved skill summaries in name order; an absent library is empty. */
  async list(): Promise<SavedSkill[]> {
    let entries
    try { entries = await readdir(this.directory, { withFileTypes: true }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const skills = await Promise.all(entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(async entry => metadata(await readFile(join(this.directory, entry.name, 'SKILL.md')))))
    return skills.sort((a, b) => a.name.localeCompare(b.name))
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
        await mkdir(join(target, '..'), { recursive: true, mode: 0o700 })
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
}

/** @param store - persistent library.
 * @returns authenticated Connection routes; streaming bounds uploads before buffering their contents.
 */
export function userSkillRoutes(store: UserSkillStore): ConnectionFetchRoute[] {
  return [{
    path: '/api/dv/skills', methods: ['GET'], requestBody: 'buffered',
    fetch: () => answer(() => store.list()),
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
