/**
 * Browser half of the DreamVerse composer additions:
 * - `dvMentions`, the registry of the mention kinds that plugin UI halves add to the `@` source;
 * - `dvComposer`, the registry of parameter bars, and the `dv.prompt` composer Factory with the chip face of every
 *   prompt editor (`prompt.ts`);
 * - an `@` source listing the items of every registered mention kind and the assets of every media type;
 * - a 引用 row in the composer's ＋ menu that opens that `@` list at the end of the draft;
 * - an invisible `conversation.input.left` entry that makes each session's composer a `dv:compose` target;
 * - cards for the project's assets in settled chat Markdown, drawn through `dv.media` (`chat-media.ts`);
 * - 问 agent / Ask the agent on every canvas node and 让智能体使用 / Ask the agent to use it in the asset preview
 *   (`actions.tsx`);
 * - creator-facing names for the `dv_*` tools and for every operation of `/api/dv/operations` in their chat rows
 *   and in the running group title;
 * - 在历史中查看 on every settled row whose tool is not read-only, including failed calls, which dispatches
 *   `dv:history-focus`;
 * - an empty `conversation.input.permission` entry that hides DSH's file-permission chip;
 * - the `dv:compose` prefill from the canvas and asset pool views, which also brings the 对话 tab to the front;
 * - a stylesheet that draws the 对话 tab's composer card, ＋ button, and send button with the DreamVerse theme tokens.
 *
 * @module @dv/ui-composer/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientSessionContext } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { IconLinkOutlineRegular, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { createElement, useEffect, type ComponentType } from 'react'
import { DV_COMPOSE_EVENT, type DvComposeDetail } from '@dv/ui-kit/compose.ts'
import { getCurrentProject } from '@dv/ui-kit/current-project.ts'
import { pickText } from '@dv/ui-kit/locale.ts'
import { createRegistry, type MentionKind } from '@dv/ui-kit/registries.ts'
import type {} from '@dv/ui-canvas/contract'
import type {} from '@dv/ui-media/contract'
import { askAgentAction, UseAssetAction } from './actions.tsx'
import { registerChatMedia } from './chat-media.ts'
import { applyPrompt } from './prompt.ts'
import { deliverCompose, mountComposer } from './compose.ts'
import { MENTION_SOURCE, projectMentionSource } from './mention.ts'
import { DV_TOOL_LABELS } from '@dv/ui-kit/tool-labels.ts'
import { registerOperationRows } from './tool-labels.ts'
import { ToolLabelRow } from './views.tsx'
// The DreamVerse look of the DSH composer card in the 对话 tab; the bundle injects the sheet when the plugin loads.
import './composer.css'

export { projectItems, referenceText, MENTION_SOURCE } from './mention.ts'
export { uriOf } from './compose.ts'

/** The branded session ID the session-scoped DSH UI slots receive. */
type SessionId = ToolCallViewProps['sessionId']

/** Required services: the trigger registry, the sessions, the slots, and the right sidebar that holds 对话. */
export const inject = ['inputTriggers', 'sessions', 'slots', 'sidebarRight']

/**
 * The part of DSH's `ctx.commandUi` service (`@deepseek-ai/dsh-client-ui-commands`) that adds an action row to the
 * composer's ＋ menu; this package does not depend on `ui-commands`, so the face is declared here.
 */
interface CommandMenu {
  register(contribution: {
    readonly name: string
    label(): string
    description(): string
    readonly icon: ComponentType<IconProps>
    available(session: ClientSessionContext): boolean
    readonly ui: { readonly kind: 'action'; run(session: ClientSessionContext): void }
  }): () => void
}

/**
 * Provide `dvMentions` and register the composer additions.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // At apply's top level, never inside an effect: other plugins register into the registry from their own fibers.
  const mentions = { kinds: createRegistry<MentionKind>(kind => [kind.id], kind => kind.id) }
  ctx.reflect.provide('dvMentions', mentions)
  const mediaTypes = () => ctx.get('dvMedia')?.types.getSnapshot() ?? []
  ctx.effect(() => ctx.inputTriggers.registerSource(projectMentionSource(mentions, mediaTypes)), 'dv-composer: @ source')
  applyPrompt(ctx)
  registerChatMedia(ctx)
  ctx.inject(['dvCanvas'], (scope) => {
    scope.effect(() => scope.dvCanvas.actions.register(askAgentAction), 'dv-composer: ask the agent')
  })
  ctx.effect(() => ctx.slots.inject('dv.media.preview.action', () => ctx.slots.register(
    { name: 'dv.media.preview.action', id: '@dv/ui-composer:use-asset' }, UseAssetAction,
  )), 'dv-composer: use the asset')

  /** The input facade of one session, while its scope and conversation service exist. */
  const inputOf = (sessionId: SessionId): SessionInput | undefined => {
    const scope = ctx.sessions.scope(sessionId)
    return scope?.get('conversation')?.input.for(scope)
  }

  /**
   * Open the `@` project-item list of one session's composer at the end of its draft; a pick inserts its chip there.
   * @param sessionId - the session whose ＋ menu row was picked.
   */
  function openMentionMenu(sessionId: SessionId): void {
    const scope = ctx.sessions.scope(sessionId)
    const input = inputOf(sessionId)
    if (scope === undefined || input === undefined) return
    const { draft, draftRev } = input.state.getSnapshot()
    ctx.inputTriggers.sessionOf(scope).toggleSource(MENTION_SOURCE, {
      trigger: '@', query: '', quoted: false, position: draft.trim() === '' ? 'leading' : 'inline',
      span: { start: draft.length, end: draft.length, draftRev },
    })
  }
  ctx.inject(['commandUi'], (scope) => {
    const commands = scope.get('commandUi') as CommandMenu
    scope.effect(() => commands.register({
      name: 'reference',
      label: () => pickText('引用', 'Reference'),
      description: () => pickText('项目里的条目或素材', 'An item or asset of the project'),
      icon: IconLinkOutlineRegular,
      available: () => getCurrentProject() !== null,
      // The ＋ menu closes itself after running the action, so the `@` list opens on the next task.
      ui: { kind: 'action', run: (session) => { setTimeout(() => { openMentionMenu(session.sessionId) }, 0) } },
    }), 'dv-composer: ＋ menu reference row')
  })

  // Each mounted session composer takes `dv:compose` prefills while it is mounted; the entry renders nothing.
  function ComposeTarget(props: { sessionId: SessionId }) {
    const { sessionId } = props
    useEffect(() => mountComposer(() => inputOf(sessionId)), [sessionId])
    return null
  }
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'dv-composer-compose', order: 50 }, ComposeTarget,
  ))
  // DreamVerse sessions always edit inside their project's Workspace, so DSH's file-permission chip (工作区内修改) is
  // hidden: an empty entry at a lower priority shadows the permission picker.
  ctx.slots.inject('conversation.input.permission', () => ctx.slots.register({ name: 'conversation.input.permission', priority: -1 }, () => null))

  // Every labelled tool shows its creator-facing name in its chat row and in the running group title. The row sits at
  // priority 0.5: a plugin's own row at the default priority 0 wins over it, and it wins over the operation rows at 1.
  for (const [name, label] of Object.entries(DV_TOOL_LABELS)) {
    const LabelRow = (props: ToolCallViewProps) => createElement(ToolLabelRow, {
      label, toolName: props.toolName, sessionId: props.sessionId, callId: props.callId, phase: props.phase, block: props.block,
    })
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: name, priority: 0.5 }, LabelRow))
  }
  // Every operation of /api/dv/operations gets its row and its name in the running group title.
  registerOperationRows(ctx)

  ctx.effect(() => {
    const onCompose = (event: Event): void => {
      const detail = (event as CustomEvent<DvComposeDetail | null>).detail
      if (typeof detail !== 'object' || detail === null || !Array.isArray(detail.refs)) return
      // Bring 对话 to the front so the user sees the prefilled draft; a closed chat tab reopens and takes the event.
      if (ctx.sidebarRight.mounted.getSnapshot() !== undefined) ctx.sidebarRight.openTab('dv-chat')
      deliverCompose(detail)
    }
    window.addEventListener(DV_COMPOSE_EVENT, onCompose)
    return () => { window.removeEventListener(DV_COMPOSE_EVENT, onCompose) }
  }, 'dv-composer: dv:compose listener')
}
