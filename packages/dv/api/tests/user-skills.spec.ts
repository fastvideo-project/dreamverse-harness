/** Uploaded bundles persist intact and become discoverable by the existing filesystem provider. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as Filesystem from '@deepseek-ai/dsh-skill-filesystem'
import { UserSkillStore, userSkillRoutes } from '../src/user-skills.ts'

const TEXT = '---\nname: my-trailer\ndescription: Plan my trailer\n---\nAsk for the story and make three shots.\n'
const LIMITS = { uploadBytes: 8192, extractedBytes: 16384, files: 10 }
let root: string
let store: UserSkillStore
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dv-user-skills-'))
  store = new UserSkillStore(join(root, 'skills'), LIMITS)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

async function upload(filename: string, bytes = strToU8(TEXT)) {
  const route = userSkillRoutes(store).find(route => route.path === '/api/dv/skills/upload')!
  return route.fetch(new Request(`http://localhost/api/dv/skills/upload?filename=${encodeURIComponent(filename)}`, {
    method: 'POST', body: Buffer.from(bytes),
  }))
}

async function call(path: string, body?: unknown) {
  const route = userSkillRoutes(store).find(route => route.path === `/api/dv/skills/${path.split('?')[0] ?? ''}`)!
  return route.fetch(new Request(`http://localhost/api/dv/skills/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
}

describe('skills written and edited on the Skills page', () => {
  it('creates a skill from its fields, reads it back, and updates its description and instructions', async () => {
    const created = await call('create', { name: 'opening-shot', description: 'Plan an opening shot', instructions: 'Ask for the mood.\n\nThen one wide shot.' })
    expect(created.status).toBe(200)
    expect(await created.json()).toEqual({ name: 'opening-shot', description: 'Plan an opening shot', modelInvocable: true })
    const read = await call('read?name=opening-shot')
    expect(await read.json()).toEqual({ name: 'opening-shot', description: 'Plan an opening shot', instructions: 'Ask for the mood.\n\nThen one wide shot.',
      path: join(store.directory, 'opening-shot', 'SKILL.md') })
    const updated = await call('update', { name: 'opening-shot', description: 'Plan a calm opening: shot', instructions: 'Ask for the mood first.' })
    expect(await updated.json()).toEqual({ name: 'opening-shot', description: 'Plan a calm opening: shot', modelInvocable: true })
    expect(await (await call('read?name=opening-shot')).json()).toMatchObject({ description: 'Plan a calm opening: shot', instructions: 'Ask for the mood first.' })
    expect((await store.list()).map(skill => skill.name)).toEqual(['opening-shot'])
    expect((await readdir(join(store.directory, 'opening-shot')))).toEqual(['SKILL.md'])
  })

  it('keeps the other frontmatter keys and bundle files of an uploaded skill when it is edited', async () => {
    const archive = zipSync({ 'my-trailer/SKILL.md': strToU8(TEXT.replace('---\nAsk', 'disable-model-invocation: true\n---\nAsk')), 'my-trailer/references/beats.md': strToU8('Three beats') })
    expect((await upload('my-trailer.zip', archive)).status).toBe(200)
    expect((await call('update', { name: 'my-trailer', description: 'Plan my trailer again', instructions: 'Use the beats.' })).status).toBe(200)
    expect(await readFile(join(store.directory, 'my-trailer/references/beats.md'), 'utf8')).toBe('Three beats')
    expect(await store.list()).toEqual([{ name: 'my-trailer', description: 'Plan my trailer again', modelInvocable: false }])
  })

  it('deletes a saved skill with its bundle files, and refuses a skill that is not saved or a path outside the library', async () => {
    const archive = zipSync({ 'my-trailer/SKILL.md': strToU8(TEXT), 'my-trailer/references/beats.md': strToU8('Three beats') })
    expect((await upload('my-trailer.zip', archive)).status).toBe(200)
    await writeFile(join(root, 'keep.txt'), 'outside')
    const deleted = await call('delete', { name: 'my-trailer' })
    expect([deleted.status, await deleted.json()]).toEqual([200, { name: 'my-trailer' }])
    expect(await store.list()).toEqual([])
    expect(await readdir(store.directory)).toEqual([])
    expect((await call('delete', { name: 'my-trailer' })).status).toBe(404)
    expect((await call('delete', { name: '..' })).status).toBe(404)
    expect(await readFile(join(root, 'keep.txt'), 'utf8')).toBe('outside')
  })

  it('refuses a duplicate or invalid new skill, and an update or read of a skill that is not saved', async () => {
    expect((await upload('SKILL.md')).status).toBe(200)
    expect((await call('create', { name: 'my-trailer', description: 'Again', instructions: 'Again.' })).status).toBe(409)
    expect((await call('create', { name: 'Bad Name', description: 'Bad', instructions: 'Bad.' })).status).toBe(400)
    expect((await call('create', { name: 'no-body', description: 'No body', instructions: '   ' })).status).toBe(400)
    expect((await call('update', { name: 'my-trailer', description: '', instructions: 'Still here.' })).status).toBe(400)
    expect((await call('update', { name: 'absent', description: 'Absent', instructions: 'Absent.' })).status).toBe(404)
    expect((await call('read?name=..%2Foutside')).status).toBe(404)
    expect(await readFile(join(store.directory, 'my-trailer/SKILL.md'), 'utf8')).toBe(TEXT)
  })
})

describe('persistent user skills', () => {
  it('uploads without a session and survives a fresh store and filesystem provider', async () => {
    expect(await store.list()).toEqual([])
    const response = await upload('SKILL.md')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ name: 'my-trailer', description: 'Plan my trailer', modelInvocable: true })
    const reopened = new UserSkillStore(store.directory, LIMITS)
    expect((await reopened.list()).map(skill => skill.name)).toEqual(['my-trailer'])
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(Filesystem, { includeDefaultRoots: false, customSkillDirs: [store.directory], watch: false })
      const skill = await ctx.skills.get('my-trailer')
      expect(skill?.content).toBe('Ask for the story and make three shots.')
      expect(skill?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps ZIP references and scripts with the instructions and refuses duplicate names', async () => {
    const archive = zipSync({ 'my-trailer/SKILL.md': strToU8(TEXT), 'my-trailer/references/beats.md': strToU8('Three beats'), '__MACOSX/._ignored': strToU8('metadata') })
    expect((await upload('my-trailer.zip', archive)).status).toBe(200)
    expect(await readFile(join(store.directory, 'my-trailer/references/beats.md'), 'utf8')).toBe('Three beats')
    expect((await upload('SKILL.md')).status).toBe(409)
    expect(await readFile(join(store.directory, 'my-trailer/SKILL.md'), 'utf8')).toBe(TEXT)
    expect(await readdir(root)).toEqual(['skills'])
  })

  it.each([
    ['bad.md', strToU8('No metadata')],
    ['bad.md', strToU8(TEXT.replace('my-trailer', '../outside'))],
    ['bad.md', strToU8(TEXT.replace('description: Plan my trailer', 'description:'))],
    ['bad.md', strToU8(TEXT.replace('---\nAsk', 'user-invocable: false\n---\nAsk'))],
    ['bad.zip', zipSync({ '../outside/SKILL.md': strToU8(TEXT) })],
    ['bad.zip', zipSync({ '/outside/SKILL.md': strToU8(TEXT) })],
    ['bad.zip', zipSync({ 'a/SKILL.md': strToU8(TEXT), 'b/SKILL.md': strToU8(TEXT) })],
    ['bad.zip', zipSync({ 'a/SKILL.md': strToU8(TEXT), 'outside.md': strToU8('outside') })],
    ['bad.zip', strToU8('Not ZIP')],
    ['bad.exe', strToU8(TEXT)],
  ])('refuses invalid bundle %s without installing files', async (name, bytes) => {
    const response = await upload(name, bytes)
    expect(response.status).toBe(400)
    expect(await store.list()).toEqual([])
    expect(await readdir(root)).toEqual([])
  })

  it('bounds the upload and declared extraction sizes before creating files', async () => {
    expect((await upload('large.md', new Uint8Array(LIMITS.uploadBytes + 1))).status).toBe(400)
    const archive = zipSync({ 'SKILL.md': strToU8(TEXT), 'huge.txt': new Uint8Array(LIMITS.extractedBytes + 1) })
    expect((await upload('large.zip', archive)).status).toBe(400)
    expect(await readdir(root)).toEqual([])
  })

  it('lists saved skills when the library also holds a folder without a valid SKILL.md', async () => {
    expect((await upload('SKILL.md')).status).toBe(200)
    await mkdir(join(store.directory, 'notes'))
    await mkdir(join(store.directory, 'draft'))
    await writeFile(join(store.directory, 'draft', 'SKILL.md'), 'No metadata')
    const route = userSkillRoutes(store).find(route => route.path === '/api/dv/skills')!
    const response = await route.fetch(new Request('http://localhost/api/dv/skills'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ name: 'my-trailer', description: 'Plan my trailer', modelInvocable: true }])
  })

  it('allows only one winner for simultaneous uploads with the same name', async () => {
    const responses = await Promise.all([upload('a.md'), upload('b.md')])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    expect((await store.list()).map(skill => skill.name)).toEqual(['my-trailer'])
    expect(await readdir(root)).toEqual(['skills'])
  })
})

it('lists an empty library and uploads through the real HTTP bridge without attaching a body to GET', async () => {
  const { createServer } = await import('node:http')
  const { bridge } = await import('../../../client/connection/src/http-bridge.ts')
  const routes = userSkillRoutes(store)
  const server = createServer((request, response) => {
    void bridge(request, response, {
      requestBodyMode: ({ url }) => routes.find(route => route.path === url.pathname)?.requestBody ?? 'buffered',
      fetch: async (request) => {
        const route = routes.find(route => route.path === new URL(request.url).pathname)
        if (route === undefined) return new Response('not found', { status: 404 })
        return route.fetch(request)
      },
    }).catch((error: unknown) => {
      response.writeHead(400)
      response.end(error instanceof Error ? error.message : String(error))
    })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  try {
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Missing test port')
    const base = `http://127.0.0.1:${address.port}/api/dv/skills`
    const empty = await fetch(base)
    expect(empty.status).toBe(200)
    expect(await empty.json()).toEqual([])
    const uploaded = await fetch(`${base}/upload?filename=SKILL.md`, { method: 'POST', body: TEXT })
    expect(uploaded.status).toBe(200)
    const saved = await fetch(base)
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual([{ name: 'my-trailer', description: 'Plan my trailer', modelInvocable: true }])
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
      server.closeAllConnections()
    })
  }
})
