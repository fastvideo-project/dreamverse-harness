/**
 * The folders of new projects: fresh, empty folders in the DreamVerse folder. Called by the service.
 *
 * @module @dv/project/folders
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectError } from './shared.ts'

/** The DreamVerse folder and the new folders in it; the service documents each operation. */
export class ProjectFolders {
  /**
   * @param parent - the DreamVerse folder, which holds the folders of new projects.
   */
  constructor(private readonly parent: () => string) {}

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
}
