/**
 * The card body of a text node version: its opening lines and its version.
 *
 * @module @dv/ui-text-node/TextCard
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { extractMarkdownPlainText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { parsePromptCitations } from '@dv/project/grammar'
import type { NodeSizing } from '@dv/ui-canvas/contract'
import { assetUrl } from '@dv/ui-kit/api.ts'
import { CARD_SURFACE } from '@dv/ui-kit/frame.ts'
import type { NS } from './locales.ts'
import { withLabels } from './texts.ts'

/** The opening lines that a text card of the default size shows at text scale 1. */
const EXCERPT_LINES = 4
const LINE_HEIGHT = 16
/** The frame height of a text card that shows a number of opening lines with their padding. */
const heightFor = (lines: number): number => 10 + lines * LINE_HEIGHT + 10

/**
 * The sizing of a text card, a window node: 208 × 84 by default (four opening lines), and at least 104 units wide and
 * one opening line tall.
 */
export const TEXT_CARD_SIZING: NodeSizing = {
  kind: 'window', defaultSize: { width: 208, height: heightFor(EXCERPT_LINES) }, minSize: { width: 104, height: heightFor(1) },
}

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
 * The version label of a text node, such as `v3 · 1,240 chars`, which the editor shows.
 * @param version - the 1-based version.
 * @param chars - the Unicode code points of the body.
 * @param t - translates a key of the text node dictionary.
 * @returns the label.
 */
export function footerText(version: number, chars: number, t: TranslateNS<typeof NS>): string {
  return t('card.footer', { version: String(version), chars: chars.toLocaleString('en-US') })
}

/**
 * The card body of a text node version on the card surface, filling the frame the canvas sizes: the opening lines of
 * its Markdown as plain text with each citation as its label. The canvas caption above it shows the title.
 * @param props - the node and the text scale.
 * @returns the element.
 */
export function TextCard({ node, textScale }: PropsRuntime<'dv.canvas.card'>): ReactNode {
  const body = useBody(node.assets[0])
  const excerpt = useMemo(() => body === null ? '' : extractMarkdownPlainText(withLabels(body, parsePromptCitations(body))), [body])
  const size = (base: number): number => Math.round(base * textScale)
  return (
    <div style={{ ...CARD_SURFACE, display: 'flex', flexDirection: 'column' }}>
      <p
        data-testid="dv-text-excerpt"
        style={{
          margin: '10px 12px', flex: 1, minHeight: 0, overflow: 'hidden', whiteSpace: 'pre-line', overflowWrap: 'anywhere',
          fontSize: size(12), lineHeight: `${String(size(LINE_HEIGHT))}px`, color: 'var(--dv-text)',
        }}
      >
        {excerpt}
      </p>
    </div>
  )
}
