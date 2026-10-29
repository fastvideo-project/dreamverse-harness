/**
 * Browser half of the text node: the canvas node type that claims the `textnode.write` and `textnode.edit` records,
 * with its card and editor, the `@` mention kind `textnode`, and the History row of `textnode.` records.
 *
 * @module @dv/ui-text-node/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { extractMarkdownPlainText } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { citationUri, parsePromptCitations } from '@dv/project/grammar'
import type { ClaimedEntry, NodeType } from '@dv/ui-canvas/contract'
import type { HistoryRow } from '@dv/ui-history/contract'
import { pickText } from '@dv/ui-kit/locale.ts'
import type { MentionKind } from '@dv/ui-kit/registries.ts'
import { TEXT_CARD_HEIGHT, TextCard } from './TextCard.tsx'
import { TextEditor } from './TextEditor.tsx'
import { newestTexts, pathOf, reportedVersion, TEXT_KIND, TEXT_OPERATIONS, withLabels } from './texts.ts'

export { textsOf } from './texts.ts'

const ID = '@dv/ui-text-node'

/**
 * The canvas node type of text nodes: one claimed node per `textnode.write` or `textnode.edit` record, so each version
 * is a node, a version is linked to the previous one by its `based_on` lineage edge, and a `source` input draws an
 * edge from the version that it was built from. The caption shows the title and the version.
 */
export const textNodeType: NodeType = {
  id: ID,
  type: TEXT_KIND,
  label: () => pickText('文本', 'Text'),
  color: 'var(--dv-node-5)',
  column: 0,
  claimed: {
    operations: TEXT_OPERATIONS,
    status: { running: () => pickText('保存中…', 'Saving…'), failed: () => pickText('保存失败', 'Save failed') },
    entry({ record }): ClaimedEntry {
      const title = record.report?.['title']
      const version = reportedVersion(record)
      return {
        title: typeof title === 'string' ? title : pathOf(record), bodyHeight: TEXT_CARD_HEIGHT,
        ...version === null ? {} : { meta: `v${String(version)}` },
      }
    },
  },
}

/** The `@` mention kind of text nodes: each text node at its newest version, after the reference nouns. */
export const textMentionKind: MentionKind = {
  id: ID,
  kind: TEXT_KIND,
  order: 4,
  section: () => pickText('文本', 'Texts'),
  items: state => newestTexts(state).map(latest => ({
    uri: citationUri(TEXT_KIND, latest.path),
    label: latest.title,
    description: extractMarkdownPlainText(withLabels(latest.body, parsePromptCitations(latest.body)), { mode: 'first-line' }).slice(0, 40),
  })),
}

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

/** Required browser services: none; each registration waits for its own service. */
export const inject: readonly string[] = []

/**
 * Client plugin body. Each registration leaves with its service or with the plugin.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.inject(['dvCanvas'], (scope) => {
    scope.effect(() => scope.dvCanvas.nodeTypes.register(textNodeType), 'ui-text-node: node type')
  })
  ctx.inject(['slots'], (scope) => {
    scope.effect(() => scope.slots.inject('dv.canvas.card', () => scope.slots.register({ name: 'dv.canvas.card', key: TEXT_KIND }, TextCard)), 'ui-text-node: card')
    scope.effect(() => scope.slots.inject('dv.canvas.editor.claimed', () => scope.slots.register(
      { name: 'dv.canvas.editor.claimed', key: TEXT_KIND }, TextEditor,
    )), 'ui-text-node: editor')
  })
  ctx.inject(['dvMentions'], (scope) => {
    scope.effect(() => scope.dvMentions.kinds.register(textMentionKind), 'ui-text-node: mention kind')
  })
  ctx.inject(['dvHistory'], (scope) => {
    scope.effect(() => scope.dvHistory.rows.register(textHistoryRow), 'ui-text-node: history row')
  })
}
