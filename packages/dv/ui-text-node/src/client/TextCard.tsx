/**
 * The card body of a text node version: its opening lines and its version.
 *
 * @module @dv/ui-text-node/TextCard
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { extractMarkdownPlainText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parsePromptCitations } from '@dv/project/grammar'
import type {} from '@dv/ui-canvas/contract'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { CARD_SURFACE } from '@dv/ui-kit/frame.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import { reportedVersion, withLabels } from './texts.ts'

/** The lines of the opening text that the card shows at text scale 1. */
const EXCERPT_LINES = 4
const LINE_HEIGHT = 16
const FOOTER_HEIGHT = 28
/** The body height of a text card: the opening lines with their padding, and the footer. */
export const TEXT_CARD_HEIGHT = 10 + EXCERPT_LINES * LINE_HEIGHT + 4 + FOOTER_HEIGHT

// An asset ID names fixed bytes, so one read of a version's Markdown serves every card that shows it.
const bodies = new Map<string, Promise<string>>()

/**
 * Read the Markdown of a text node version from the asset pool, once per asset.
 * @param asset - the version's `text/markdown` asset.
 * @returns the body; a failed read is not kept, so a later card reads again.
 */
export function readBody(asset: string): Promise<string> {
  const held = bodies.get(asset)
  if (held !== undefined) return held
  const read = fetch(assetUrl(asset)).then(response => response.ok ? response.text() : Promise.reject(new Error(`HTTP ${String(response.status)}`)))
  bodies.set(asset, read)
  read.catch(() => { bodies.delete(asset) })
  return read
}

/**
 * The footer of a text card, such as `v3 · 1,240 chars`.
 * @param version - the 1-based version.
 * @param chars - the Unicode code points of the body.
 * @returns the footer text in Chinese and English.
 */
export function footerText(version: number, chars: number): readonly [zh: string, en: string] {
  const count = chars.toLocaleString('en-US')
  return [`第 ${String(version)} 版 · ${count} 字`, `v${String(version)} · ${count} chars`]
}

/**
 * The card body of a text node version on the card surface: the opening lines of its Markdown as plain text with each
 * citation as its label, and a footer with its version and size. The canvas caption above it shows the title.
 * @param props - the node and the text scale.
 * @returns the element.
 */
export function TextCard({ node, textScale }: PropsRuntime<'dv.canvas.card'>): ReactNode {
  const pick = useText()
  const asset = node.assets[0]
  const [body, setBody] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (asset !== undefined) readBody(asset).then((text) => { if (live) setBody(text) }, () => { if (live) setBody(null) })
    return () => { live = false }
  }, [asset])
  const excerpt = useMemo(() => body === null ? '' : extractMarkdownPlainText(withLabels(body, parsePromptCitations(body))), [body])
  const version = node.record === null ? null : reportedVersion(node.record)
  const chars = node.record?.report?.['chars']
  const size = (base: number): number => Math.round(base * textScale)
  return (
    <div style={{ ...CARD_SURFACE, display: 'flex', flexDirection: 'column' }}>
      <p
        data-testid="dv-text-excerpt"
        style={{
          margin: '10px 12px 4px', flex: 1, minHeight: 0, overflow: 'hidden', whiteSpace: 'pre-line', overflowWrap: 'anywhere',
          fontSize: size(12), lineHeight: `${String(size(LINE_HEIGHT))}px`, color: 'var(--dv-text)',
        }}
      >
        {excerpt}
      </p>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', height: FOOTER_HEIGHT, padding: '0 12px', fontFamily: 'var(--dv-font-mono)', fontSize: size(11), lineHeight: 1, color: 'var(--dv-text-2)' }}>
        {version === null || typeof chars !== 'number' ? null : pick(...footerText(version, chars))}
      </div>
    </div>
  )
}
