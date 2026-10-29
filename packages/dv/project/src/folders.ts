/**
 * Projects over the DSH Workspace registry: a project is a registered Workspace whose folder holds
 * `.dreamverse/records.jsonl`, and its ID, title, creation time and path are the Workspace's. This module is the only
 * DreamVerse code that writes the registry, and it never deletes a file. Called by the service.
 *
 * @module @dv/project/folders
 */
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { WorkspaceId, type Workspace, type WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { PROJECT_DIR } from './folder.ts'
import { ProjectError } from './shared.ts'
import type { ProjectId, ProjectInfo } from './types.ts'

/**
 * @param path - a path.
 * @returns its `realpath`, or undefined when it does not resolve.
 */
export function canonicalPath(path: string): string | undefined {
  try {
    return realpathSync.native(path)
  } catch {
    // `realpath` throws ENOENT for a missing path, and a missing folder belongs to no Workspace.
    return undefined
  }
}

const isProject = (workspace: Workspace): boolean => existsSync(join(workspace.path, PROJECT_DIR, 'records.jsonl'))

const infoOf = (workspace: Workspace): ProjectInfo =>
  ({ id: brandString<ProjectId>(workspace.id), title: workspace.title, created_at: workspace.createdAt, path: workspace.path })

/** The projects of the Workspace registry, and the folders of new projects; the service documents each operation. */
export class ProjectFolders {
  /** Serializes create, rename and remove, so two calls never register one folder twice or pick one free title. */
  private chain: Promise<unknown> = Promise.resolve()

  /**
   * @param registry - the DSH Workspace registry.
   * @param parent - the DreamVerse folder, which holds the folders of new projects.
   */
  constructor(
    private readonly registry: Pick<WorkspaceRegistry, 'list' | 'get' | 'create' | 'delete' | 'resolveByPath'>,
    private readonly parent: () => string,
  ) {}

  list(): ProjectInfo[] {
    return this.registry.list().filter(isProject).map(infoOf)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  }

  get(project: ProjectId): ProjectInfo {
    return infoOf(this.workspace(project))
  }

  async newFolder(name: string): Promise<string> {
    const base = name.replaceAll(/[/\\]/gu, '-').trim()
    if (base === '' || base === '.' || base === '..') throw new ProjectError('invalid_params', 'A project folder needs a name.')
    await mkdir(this.parent(), { recursive: true })
    for (let suffix = 1; ; suffix += 1) {
      const folder = join(this.parent(), suffix === 1 ? base : `${base} ${String(suffix)}`)
      try {
        await mkdir(folder)
        return folder
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
  }

  create(folder: string, title: string, writeFirst: (project: ProjectId, dir: string) => Promise<void>): Promise<ProjectInfo> {
    return this.serial(async () => {
      const path = await realpath(folder)
      const known = await this.registry.resolveByPath(path)
      const workspace = known ?? await this.registry.create(path)
      const started = !isProject(workspace)
      if (started || known === undefined) await workspace.setTitle(title)
      if (started) await writeFirst(brandString<ProjectId>(workspace.id), join(path, PROJECT_DIR))
      return infoOf(workspace)
    })
  }

  rename(project: ProjectId, title: string): Promise<ProjectInfo> {
    return this.serial(async () => {
      const workspace = this.workspace(project)
      const wanted = title.trim()
      if (wanted.length === 0) throw new ProjectError('invalid_params', 'A project title must not be empty.')
      const taken = new Set(this.list().filter(info => info.id !== project).map(info => info.title))
      let unique = wanted
      for (let suffix = 2; taken.has(unique); suffix += 1) unique = `${wanted} ${String(suffix)}`
      await workspace.setTitle(unique)
      return infoOf(workspace)
    })
  }

  remove(project: ProjectId): Promise<void> {
    return this.serial(async () => { await this.registry.delete(WorkspaceId(project)) })
  }

  private workspace(project: ProjectId): Workspace {
    const workspace = this.registry.get(WorkspaceId(project))
    if (workspace === undefined || !isProject(workspace)) throw new ProjectError('unknown_project', `There is no project ${project}.`)
    return workspace
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(work)
    // The caller gets a rejection through `result`; the chain goes on after it.
    this.chain = result.catch(() => undefined)
    return result
  }
}
