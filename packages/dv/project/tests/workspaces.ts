/**
 * Stand-ins for the DSH services that `dvProject` reads projects and chats from, shared by the DreamVerse test suites:
 * a Workspace registry kept in memory, and a live session store whose sessions carry only an ID and a working
 * directory. `chatProject` makes a project in a fresh folder of the DreamVerse folder and opens a chat in it.
 */
import { realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type DvProject from '../src/index.ts'
import type { ProjectId, RecordOrigin } from '../src/index.ts'

/** One Workspace of {@link TestWorkspaces}. */
export class TestWorkspace {
  readonly sessionIds: string[] = []

  constructor(
    readonly id: string, readonly path: string, public title: string, readonly createdAt: string,
    private readonly unattachable: ReadonlySet<string>,
  ) {}

  setTitle(title: string): Promise<void> {
    this.title = title
    return Promise.resolve()
  }

  attachSession(session: string): Promise<void> {
    if (this.unattachable.has(session)) return Promise.reject(new Error(`session persistence holds no session ${session}`))
    if (!this.sessionIds.includes(session)) this.sessionIds.unshift(session)
    return Promise.resolve()
  }
}

/** The Workspace registry methods `dvProject` calls, over canonical paths, newest first. */
export class TestWorkspaces {
  readonly items: TestWorkspace[] = []
  /** Sessions whose attach rejects, as the real registry rejects a session whose header it cannot read. */
  readonly unattachable = new Set<string>()
  /** Creation times strictly increase, so the project list order never depends on the clock. */
  private clock = Date.parse('2026-01-01T00:00:00Z')

  list(): TestWorkspace[] {
    return [...this.items]
  }

  get(id: string): TestWorkspace | undefined {
    return this.items.find(workspace => workspace.id === id)
  }

  resolveByPath(path: string): Promise<TestWorkspace | undefined> {
    const canonical = realpathSync(path)
    return Promise.resolve(this.items.find(workspace => workspace.path === canonical))
  }

  async create(path: string): Promise<TestWorkspace> {
    const known = await this.resolveByPath(path)
    if (known !== undefined) return known
    this.clock += 1000
    const canonical = realpathSync(path)
    const workspace = new TestWorkspace(randomUUID(), canonical, canonical.split('/').at(-1) ?? canonical, new Date(this.clock).toISOString(), this.unattachable)
    this.items.unshift(workspace)
    return workspace
  }

  delete(id: string): Promise<boolean> {
    const index = this.items.findIndex(workspace => workspace.id === id)
    if (index >= 0) this.items.splice(index, 1)
    return Promise.resolve(index >= 0)
  }
}

/** Live chat sessions with the working directory of each. */
export class TestChats {
  private readonly cwds = new Map<string, string>()

  /**
   * Start a chat in a folder; a chat's folder never changes.
   * @param session - the session ID.
   * @param cwd - its working directory.
   */
  open(session: string, cwd: string): void {
    const known = this.cwds.get(session)
    if (known !== undefined && known !== cwd) throw new Error(`Chat ${session} already runs in ${known}.`)
    this.cwds.set(session, cwd)
  }

  get(id: string): { id: string; header: { id: string; cwd: string } } | undefined {
    const cwd = this.cwds.get(id)
    return cwd === undefined ? undefined : { id, header: { id, cwd } }
  }

  list(): Array<{ id: string; header: { id: string; cwd: string } }> {
    return [...this.cwds.keys()].flatMap(id => this.get(id) ?? [])
  }
}

/** The stand-in services of one test context. */
export interface TestChatServices {
  workspaces: TestWorkspaces
  chats: TestChats
}

/**
 * Provide the stand-in `workspaceRegistry` and `sessions` services on a context, before `dvProject` loads.
 * @param ctx - the context.
 * @returns the services.
 */
export function provideChatServices(ctx: Context): TestChatServices {
  const services = { workspaces: new TestWorkspaces(), chats: new TestChats() }
  ctx.provide('workspaceRegistry', services.workspaces as never)
  ctx.provide('sessions', services.chats as never)
  return services
}

/**
 * Make a project in a fresh folder of the DreamVerse folder and start chat `session` in it.
 * @param project - the service.
 * @param services - the stand-in services.
 * @param title - the project title.
 * @param origin - who creates it.
 * @param session - the chat; `s1` by default.
 * @returns the project.
 */
export async function chatProject(
  project: DvProject, services: TestChatServices, title: string, origin: RecordOrigin, session = 's1',
): Promise<ProjectId> {
  const folder = await project.newProjectFolder(title)
  services.chats.open(session, folder)
  return (await project.createProject(folder, title, origin)).id
}
