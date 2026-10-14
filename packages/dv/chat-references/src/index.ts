/**
 * The DreamVerse chat references as the `dvChatReferences` Cordis service: what a user points at in a chat message
 * reaches the project. At `agent/pre-step`, the files a user attached to the step's messages, of any media type, start
 * to import into the session's project as assets that go on its canvas, and the `dv:` mentions of those messages expand
 * into a context message with the concrete record and asset IDs, read from the current state of the session's project;
 * a `dv:attachment/<n>` mention waits for the import of its message's attachments and names the asset imported from the
 * n-th one. The attachments of a message whose session has no project yet wait, and the first step after the session
 * gets one imports them and names their assets. The `dv:asset` mentions a user sends put those assets on the canvas.
 *
 * @module @dv/chat-references
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed, type FileBlock, type ImageBlock, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import { importedAssets, placeable } from '@dv/asset-pool'
import type { AssetId, ProjectId, SessionId } from '@dv/project'
import mime from 'mime-types'
import {
  deferredAttachmentsBlock, expansionBlock, mentionedAssetIds, mentionsAttachment,
  type DeferredAttachment, type ExpansionSources, type MentionMessage,
} from './expand.ts'

export {
  deferredAttachmentsBlock, describeMention, formatMention, parseMentions,
  type DeferredAttachment, type ExpansionSources, type Mention, type MentionMessage,
} from './expand.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The chat references: `dv:` mention expansion and chat attachment import. */
    dvChatReferences: DvChatReferences
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dv-mentions': { kind: 'dv-mentions' } & ContextFormed
  }
}

/** A chat attachment as the user message carries it: an image block or a block of any other file. */
type ChatAttachmentBlock = ImageBlock | FileBlock

/** The `asset.import` params of one chat attachment: its file on this machine, its media type, and its display name. */
interface AssetImportParams {
  path: string
  mime: string
  name: string
}

/**
 * @param path - the host path the DSH attachment store returned for an attachment.
 * @param name - the attachment's display name.
 * @returns the path. Throws when the store keeps the attachment off this machine.
 */
function requireHostPath(path: string | undefined, name: string): string {
  if (path === undefined) throw new Error(`the DSH attachment store keeps ${name} off this machine`)
  return path
}

/**
 * @param block - one attachment block of a user message.
 * @returns its display name: the file name, or `image.<subtype>` for an image without one.
 */
function attachmentName(block: ChatAttachmentBlock): string {
  if (block.type === 'file') return block.attachment.name
  return block.attachment.name ?? `image.${block.attachment.mediaType.slice('image/'.length)}`
}

/** `dv:` mention expansion and chat attachment import. */
export default class DvChatReferences extends Service {
  static inject = ['dvProject', 'dvAssetPool']

  /**
   * The attachment blocks of the user messages that entered a step while their session had no project, by session, one
   * entry per message in step order. The first step after the session gets a project imports them.
   */
  private deferredAttachments = new Map<SessionId, ChatAttachmentBlock[][]>()

  constructor(ctx: Context) {
    super(ctx, 'dvChatReferences')
    ctx.on('session/event', (session: Session, event: SessionEvent) => { this.onSessionEvent(session, event) })
    ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const session = brandString<SessionId>(agent.id)
      const deferred = await this.importDeferredAttachments(session)
      const messages = await Promise.all(decision.messages.filter(message => message.source.kind === 'user')
        .map(message => this.mentionMessage(session, message)))
      const context = this.expansionMessage(agent.id, messages, deferred)
      return context === null ? decision : { ...decision, messages: [...decision.messages, context] }
    }, { prepend: true })
  }

  /**
   * The context message for the `dv:` mentions in one step's user messages and for the files imported at this step
   * because the session got a project, or null when there is neither.
   * @param sessionId - the chat session.
   * @param messages - the step's new messages that the user typed, with the assets imported from their attachments.
   * @param deferred - the files attached while the session had no project, imported at this step.
   * @returns the message.
   */
  expansionMessage(
    sessionId: string, messages: readonly MentionMessage[], deferred: readonly DeferredAttachment[] = [],
  ): UserMessage | null {
    const text = messages.map(message => message.text).join('\n')
    const session = brandString<SessionId>(sessionId)
    const blocks = [deferredAttachmentsBlock(deferred), expansionBlock(messages, this.projectFor(session, text), this.expansionSources())]
      .filter(part => part !== null)
    if (blocks.length === 0) return null
    const block = blocks.join('\n\n')
    return createUserMessage({
      content: [{ type: 'text', text: block }],
      source: { kind: 'dv-mentions', form: 'snapshot', sections: [{ name: 'dv-mentions', text: block }] },
    })
  }

  /** The session's bound project, else the newest project whose records produced a mentioned asset, else the newest project. */
  private projectFor(session: SessionId, text: string): ProjectId | null {
    const project = this.ctx.dvProject
    const bound = project.sessionProject(session)
    if (bound !== null) return bound
    const assets = mentionedAssetIds(text)
    const projects = project.listProjects().sort((a, b) => b.created_at.localeCompare(a.created_at))
    const match = projects.find((info) => {
      const createdBy = project.getState(info.id).components.proj.created_by
      return assets.some(asset => createdBy[asset] !== undefined)
    })
    return match?.id ?? projects[0]?.id ?? null
  }

  /** The Project reads expansion needs: mentions resolve against the project's current state. */
  private expansionSources(): ExpansionSources {
    const project = this.ctx.dvProject
    return {
      getState: projectId => project.getState(projectId),
      getRecord: (projectId, record) => {
        try {
          return project.getRecord(projectId, record)
        } catch {
          // An unknown record ID is reported in the expansion text, not as a failed step.
          return undefined
        }
      },
    }
  }

  /**
   * Start the import of the attachments of one user message that enters a step, and read the message for expansion.
   * The step waits for the import only when the message holds a `dv:attachment/<n>` mention.
   * @param session - the chat session.
   * @param message - a message of the step that the user typed.
   * @returns the message's text and, when it mentions an attachment, the asset imported from each attachment block.
   */
  private async mentionMessage(session: SessionId, message: UserMessage): Promise<MentionMessage> {
    const text = message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    const blocks = message.content.flatMap(block => block.type === 'image' || block.type === 'file' ? [block] : [])
    if (this.ctx.dvProject.sessionProject(session) === null) {
      // The session's project does not exist yet (the entry page): the first step after it is bound imports the files.
      if (blocks.length > 0) this.deferredAttachments.set(session, [...this.deferredAttachments.get(session) ?? [], blocks])
      return { text, attachments: blocks.map(() => null), importPending: blocks.length > 0 }
    }
    const imports = blocks.length === 0 ? [] : this.importChatAttachments(session, blocks)
    return { text, attachments: mentionsAttachment(text) ? await Promise.all(imports) : [], importPending: false }
  }

  /**
   * Import the files attached while the session had no project, once it has one, and name the asset of each.
   * @param session - the chat session.
   * @returns the files in message order and then in attachment order; empty while the session has no project or
   * nothing waits.
   */
  private async importDeferredAttachments(session: SessionId): Promise<DeferredAttachment[]> {
    const waiting = this.deferredAttachments.get(session)
    if (waiting === undefined || this.ctx.dvProject.sessionProject(session) === null) return []
    this.deferredAttachments.delete(session)
    const blocks = waiting.flat()
    const assets = await Promise.all(this.importChatAttachments(session, blocks))
    let index = 0
    return waiting.flatMap((message, m) => message.map((block, b): DeferredAttachment => ({
      name: attachmentName(block), position: b + 1, message: m + 1, asset: assets[index++] ?? null,
    })))
  }

  /** Place the assets that the messages a user typed in a live session mention. */
  private onSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
    const agents = this.ctx.get('agents')
    if (agents !== undefined) {
      const agent = agents.get(session.id)
      if (agent === undefined || agent.session !== session) return
    }
    this.placeMentionedAssets(brandString<SessionId>(session.id), event.data)
  }

  /**
   * Put the assets a user message mentions (`dv:asset/<id>`) on the canvas of the session's project with one
   * `asset.place` by the user, in the chat. Only assets that `asset.place` accepts (an import of the project anywhere in its
   * history, or an asset a record of the current state created) and that are not on the canvas yet count; a message without
   * such a mention, or a session without a project, places nothing.
   * @param session - the chat session.
   * @param message - the appended user message, which the user typed.
   */
  private placeMentionedAssets(session: SessionId, message: SessionEventMap['user/message']): void {
    const project = this.ctx.dvProject
    const projectId = project.sessionProject(session)
    if (projectId === null) return
    const mentioned = mentionedAssetIds(message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'))
    if (mentioned.length === 0) return
    const state = project.getState(projectId)
    const placed = new Set(state.components.asset.placed)
    const imported = importedAssets(project.listRecords(projectId))
    const assets = mentioned.filter(asset => placeable(state, imported, asset) && !placed.has(asset))
    if (assets.length === 0) return
    project.run({
      project: projectId, operation: 'asset.place', params: {}, inputs: assets.map(asset => ({ role: 'asset', ref: { asset } })),
      actor: 'user', surface: 'chat', session, turn: null, tool_call: null, intent: 'place mentioned assets',
    }).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      this.ctx.logger('dvChatReferences').warn('could not place the mentioned assets of session %s: %s', session, reason)
    })
  }

  /**
   * Import chat attachments of any media type as assets of the session's project and put them on its canvas: one
   * `asset.import` with `place` per attachment by the user, in the chat, after the project's current position, in block
   * order. The import stops at the first attachment that fails and logs the failure. The session's next tool call waits
   * until the import finished (`dvProject.holdToolCalls`). A session without a project, or a process without an
   * attachment service, imports nothing.
   * @param session - the chat session.
   * @param blocks - the attachment blocks of the user message, in content order.
   * @returns per block, in block order, a promise of the asset imported from it, or of null when the block was not
   * imported; the promises never reject.
   */
  private importChatAttachments(session: SessionId, blocks: readonly ChatAttachmentBlock[]): Array<Promise<AssetId | null>> {
    const project = this.ctx.dvProject
    const projectId = project.sessionProject(session)
    const attachments = this.ctx.get('attachments')
    if (projectId === null || attachments === undefined) return blocks.map(() => Promise.resolve(null))
    // Each import starts after the previous one finished, and a failure rejects the imports of the blocks after it.
    let previous: Promise<AssetId | undefined> = Promise.resolve(undefined)
    const imports = blocks.map((block) => {
      previous = previous.then(async () => {
        const params = this.getAssetImportParamsFromDshAttachmentStore(attachments, block)
        const result = await project.run({
          project: projectId, operation: 'asset.import', inputs: [], params: { ...params, place: true },
          actor: 'user', surface: 'chat', session, turn: null, tool_call: null, intent: `import ${params.name}`,
        })
        return result.outputs[0]
      })
      return previous
    })
    const importing = Promise.all(imports)
    project.holdToolCalls(session, importing)
    importing.catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      this.ctx.logger('dvChatReferences').warn('could not import chat attachments of session %s as assets: %s', session, reason)
    })
    return imports.map(imported => imported.then(asset => asset ?? null, () => null))
  }

  /**
   * Get the `asset.import` params of one chat attachment from the DSH attachment store. An image is the store's
   * normalized file and keeps the media type of its block; any other file is the store's verbatim file, and its file name
   * extension names its media type, or `application/octet-stream` when the extension names none.
   * @param attachments - the DSH attachment store.
   * @param block - one attachment block of the user message.
   * @returns the host path of the stored file, its media type, and its display name. Throws when the store keeps the
   * file off this machine.
   */
  private getAssetImportParamsFromDshAttachmentStore(attachments: AttachmentStore, block: ChatAttachmentBlock): AssetImportParams {
    const name = attachmentName(block)
    if (block.type === 'image') {
      return { path: requireHostPath(attachments.imageHostPath(block.attachment), name), mime: block.attachment.mediaType, name }
    }
    return { path: requireHostPath(attachments.fileHostPath(block.attachment), name), mime: mime.lookup(name) || 'application/octet-stream', name }
  }
}
