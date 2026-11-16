/** Rebuild metadata from pinned upstream headers; does not change official skill files. */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { parse } from 'yaml'
const assets = fileURLToPath(new URL('../assets/', import.meta.url))
const directories = await readdir(join(assets, 'skills'), { withFileTypes: true })
const catalog = []
for (const entry of directories.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  const raw = await readFile(join(assets, 'skills', entry.name, 'SKILL.md'), 'utf8')
  const header = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw)
  if (header?.[1] === undefined) throw new Error(`Missing frontmatter for ${entry.name}`)
  const data = parse(header[1])
  if (data.name !== entry.name || typeof data.description !== 'string') throw new Error(`Invalid metadata for ${entry.name}`)
  catalog.push({ name: data.name, description: data.description })
}
await writeFile(join(assets, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
