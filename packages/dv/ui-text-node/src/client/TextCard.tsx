/**
 * The card body of a text node version: its opening lines and its version.
 *
 * @module @dv/ui-text-node/TextCard
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { extractMarkdownPlainText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { parsePromptCitations } from '@dv/project/grammar'
import type {} from '@dv/ui-canvas/contract'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { CARD_SURFACE } from '@dv/ui-kit/frame.ts'
import type { NS } from './locales.ts'
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
function readBody(asset: string): Promise<string> {
  const held = bodies.get(asset)
  if (held !== undefined) return held
  const read = fetch(assetUrl(asset)).then(response => response.ok ? response.text() : Promise.reject(new Error(`HTTP ${String(response.status)}`)))
  bodies.set(asset, read)
  read.catch(() => { bodies.delete(asset) })
  return read
}

/**
 * The Markdown of a text node version, read from its asset. The card and the editor both read the body this way, so
 * they show the same bytes.
 * @param asset - the version's `text/markdown` asset, or undefined while the version is unknown.
 * @returns the body, or null until the read finishes and after a failed read.
 */
export function useBody(asset: string | undefined): string | null {
  const [body, setBody] = useState<{ asset: string; text: string } | null>(null)
  useEffect(() => {
    let live = true
    if (asset !== undefined) readBody(asset).then((text) => { if (live) setBody({ asset, text }) }, () => { if (live) setBody(null) })
    return () => { live = false }
  }, [asset])
  return body !== null && body.asset === asset ? body.text : null
}

/**
 * The footer of a text card, such as `v3 · 1,240 chars`.
 * @param version - the 1-based version.
 * @param chars - the Unicode code points of the body.
 * @param t - translates a key of the text node dictionary.
 * @returns the footer text.
 */
export function footerText(version: number, chars: number, t: TranslateNS<typeof NS>): string {
  return t('card.footer', { version: String(version), chars: chars.toLocaleString('en-US') })
}

/**
 * The card body of a text node version on the card surface: the opening lines of its Markdown as plain text with each
 * citation as its label, and a footer with its version and size. The canvas caption above it shows the title.
 * @param props - the node, the text scale, and the translate function.
 * @returns the element.
 */
export function TextCard({ node, textScale, t }: PropsRuntime<'dv.canvas.card'> & PropsLocale<typeof NS>): ReactNode {
  const body = useBody(node.assets[0])
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
        {version === null || typeof chars !== 'number' ? null : footerText(version, chars, t)}
      </div>
    </div>
  )
}
