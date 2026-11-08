/**
 * Browser half of the text node: the canvas node type `text`, whose nodes the host makes from `textnode.write` records,
 * with its card and editor, the `@` mention kind `textnode`, and the History row of `textnode.` records.
 *
 * @module @dv/ui-text-node/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ReferenceFaceOwner } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { extractMarkdownPlainText } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { HostObservable, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { citationUri, parsePromptCitations } from '@dv/project/grammar'
import type { NodeType, TypeEntry } from '@dv/ui-canvas/contract'
import type { ReferenceFaceInjected } from '@dv/ui-composer/contract'
import { ReferenceFace } from '@dv/ui-composer/reference-face'
import type { HistoryRow } from '@dv/ui-history/contract'
import type { MentionKind } from '@dv/ui-kit/registries.ts'
import { en, NS, zh } from './locales.ts'
import { TEXT_CARD_SIZING, TextCard } from './TextCard.tsx'
import { TextEditor } from './TextEditor.tsx'
import { newestTexts, pathOf, reportedVersion, TEXT_KIND, TEXT_NODE, withLabels } from './texts.ts'

const ID = '@dv/ui-text-node'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    /** The chip face of the `@` source of `@dv/ui-composer` for one citation of the editor's read view. */
    'dv.text.reference': { scope: 'session-maybe'; props: ReferenceFaceOwner; inject: ReferenceFaceInjected }
  }
}

// A read view chip carries its face in its context, so the face reads no open project and no project state.
const NONE: HostObservable<null> = { getSnapshot: () => null, subscribe: () => () => {} }

/**
 * The canvas node type of text nodes: one node per path, whose versions are the `textnode.write` and `textnode.edit`
 * records of the path, so a `source` input draws an edge from the node that it was built from. The caption shows the
 * title of the version on show.
 * @param t - translates a key of the text node dictionary.
 * @returns the node type.
 */
export const textNodeType = (t: TranslateNS<typeof NS>): NodeType => ({
  id: ID,
  type: TEXT_NODE,
  label: () => t('node.label'),
  color: 'var(--dv-node-5)',
  status: { running: () => t('node.saving'), failed: () => t('node.saveFailed') },
  entry({ record }): TypeEntry {
    const title = record.report?.['title']
    return { title: typeof title === 'string' ? title : pathOf(record), sizing: TEXT_CARD_SIZING }
  },
})

/**
 * The `@` mention kind of text nodes: each text node at its newest version, after the reference nouns.
 * @param t - translates a key of the text node dictionary.
 * @returns the mention kind.
 */
export const textMentionKind = (t: TranslateNS<typeof NS>): MentionKind => ({
  id: ID,
  kind: TEXT_KIND,
  order: 4,
  section: () => t('mention.section'),
  items: state => newestTexts(state).map(([path, latest]) => ({
    uri: citationUri(TEXT_KIND, path),
    label: latest.title,
    description: extractMarkdownPlainText(withLabels(latest.body, parsePromptCitations(latest.body)), { mode: 'first-line' }).slice(0, 40),
  })),
})

/** The History row of every `textnode.*` record: the path and the version that the record wrote, such as ` beats.md v2`. */
export const textHistoryRow: HistoryRow = {
  match: `${TEXT_KIND}.`,
  subject(record) {
    const path = pathOf(record)
    if (path === '') return null
    const version = reportedVersion(record)
    const subject = version === null ? ` ${path}` : ` ${path} v${String(version)}`
    return [subject, subject]
  },
}

/** Required browser services: the locale, which every registration translates through. */
export const inject: readonly string[] = ['locale']

/**
 * Client plugin body. Each registration leaves with its service or with the plugin.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-text-node: dictionary')
  const t = ctx.locale.bind(NS)
  ctx.inject(['dvCanvas'], (scope) => {
    scope.effect(() => scope.dvCanvas.nodeTypes.register(textNodeType(t)), 'ui-text-node: node type')
  })
  ctx.inject(['slots'], (scope) => {
    scope.effect(() => scope.slots.inject('dv.canvas.card', () => scope.slots.register({ name: 'dv.canvas.card', key: TEXT_NODE, locale: NS }, TextCard)), 'ui-text-node: card')
  })
  ctx.inject(['slots', 'dvCanvas'], (scope) => {
    const versionKinds = scope.dvCanvas.versionKinds
    const face: ReferenceFaceInjected = { hooks: { currentProject: NONE, versionKinds }, keyedHooks: { projectState: () => NONE } }
    scope.effect(() => scope.slots.registerFactory({ name: 'dv.text.reference', scope: 'session-maybe', inject: () => face }, ReferenceFace), 'ui-text-node: chip face')
    scope.effect(() => scope.slots.inject('dv.canvas.editor', () => scope.slots.register(
      { name: 'dv.canvas.editor', key: TEXT_NODE, locale: NS, inject: () => ({ hooks: { versionKinds } }) }, TextEditor,
    )), 'ui-text-node: editor')
  })
  ctx.inject(['dvMentions'], (scope) => {
    scope.effect(() => scope.dvMentions.kinds.register(textMentionKind(t)), 'ui-text-node: mention kind')
  })
  ctx.inject(['dvHistory'], (scope) => {
    scope.effect(() => scope.dvHistory.rows.register(textHistoryRow), 'ui-text-node: history row')
  })
}
