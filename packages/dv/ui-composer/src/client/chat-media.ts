/**
 * The DreamVerse entry of DSH's `conversation.chat.markdown` chain: in settled chat Markdown, a link to an asset becomes
 * a 16:9 card captioned with the take's shot number, else the asset's name, an image of an asset becomes a capped
 * thumbnail, and a table whose every body row links an asset becomes a three-column grid of cards. Each asset
 * draws through the `dv.media` Factory, so an asset of a media type without a view draws the file card. The entry's
 * `select` finds asset references by their `/dv/assets/<id>` paths alone; the component reads the open project's assets
 * through the `useChatAssets` hook and renders DSH's default element while the project does not hold a referenced
 * asset. The entry stays registered for the whole declaration of the chain, so a change of the project re-renders the
 * cards without remounting them.
 *
 * @module @dv/ui-composer/chat-media
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MarkdownElement, MarkdownTableElement } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { HostObservable, InjectFace, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, type ReactNode } from 'react'
import { DvClient } from '@dv/ui-kit/api.ts'
import type { Asset, ProjectAsset } from '@dv/ui-kit/types.ts'
import type {} from '@dv/ui-media/contract'
import { followChatAssets, NO_CHAT_ASSETS, type ChatAssets } from './chat-assets.ts'
import { ChatMediaView } from './ChatMedia.tsx'

/** One asset link of a table body row. */
export interface RowAsset {
  /** The index of the cell that holds the link. */
  readonly column: number
  readonly asset: string
}

/** One table body row that links at least one asset. */
export interface AssetRow {
  /** The row's asset links in cell order, then link order. */
  readonly assets: readonly RowAsset[]
  /** The plain text of every cell of the row. */
  readonly texts: readonly string[]
}

/** The asset references that the entry's `select` finds in one Markdown element, before the project's assets are known. */
export type AssetReference =
  | { readonly kind: 'link'; readonly asset: string }
  | { readonly kind: 'image'; readonly asset: string; readonly alt: string }
  | { readonly kind: 'table'; readonly rows: readonly AssetRow[] }

/** One card of a grid. */
export interface GridCard {
  readonly asset: ProjectAsset
  /** The row's other cells, joined with ` · `. */
  readonly caption: string
}

/** What the chain entry draws in place of one Markdown element, by the element's kind, and the assets' project. JSON data. */
export type ChatMedia = { readonly project: string } & (
  /** A standalone link: a card captioned with `shot`, the take's shot number, else with the asset's name when it is null. */
  | { readonly kind: 'link'; readonly asset: ProjectAsset; readonly shot: number | null }
  | { readonly kind: 'image'; readonly asset: ProjectAsset; readonly alt: string }
  | { readonly kind: 'table'; readonly cards: readonly GridCard[] }
)

/** What the entry injects: the open project's assets as an observable source, and the preview. */
export interface ChatMediaInjected {
  hooks: { chatAssets: HostObservable<ChatAssets> }
  /** Open the asset preview of `dvMedia` for an asset of a project, growing out of `opener`; nothing while `dvMedia` is absent. */
  preview: (projectId: string, asset: Asset, opener: Element | null) => void
}

/** The path of an asset's file under the host, as `@dv/asset-pool` serves it. */
const ASSET_PATH = /^\/dv\/assets\/([^/]+)$/

/**
 * The asset that a Markdown destination in a chat message points to.
 * @param href - an authored Markdown destination, absolute or root-relative.
 * @returns the asset ID that the destination's path names under `/dv/assets/`, or undefined.
 */
export function assetIdOf(href: string): string | undefined {
  let path: string
  try {
    // The base only completes root-relative destinations; the host part is ignored.
    path = new URL(href, 'http://dv.invalid').pathname
  } catch (_error) {
    // An unparsable destination names no asset.
    return undefined
  }
  const encoded = ASSET_PATH.exec(path)?.[1]
  if (encoded === undefined) return undefined
  try {
    return decodeURIComponent(encoded)
  } catch (_error) {
    // A malformed escape names no asset.
    return undefined
  }
}

/**
 * @param table - a settled Markdown table.
 * @returns the asset links of every body row, or null when the table has no body row or a body row links no asset.
 */
function assetRows(table: MarkdownTableElement): AssetReference | null {
  if (table.rows.length === 0) return null
  const rows: AssetRow[] = []
  for (const row of table.rows) {
    const assets = row.flatMap((cell, column) => cell.links.flatMap((link) => {
      const asset = assetIdOf(link.href)
      return asset === undefined ? [] : [{ column, asset }]
    }))
    if (assets.length === 0) return null
    rows.push({ assets, texts: row.map(cell => cell.text) })
  }
  return { kind: 'table', rows }
}

/**
 * Find the asset references of one settled Markdown element by their paths alone; the chain entry's `select`.
 * @param element - the parsed element.
 * @returns the references, or null to keep DSH's default rendering.
 */
export function selectAssetReference(element: MarkdownElement): AssetReference | null {
  switch (element.kind) {
    case 'link': {
      const asset = assetIdOf(element.href)
      return asset === undefined ? null : { kind: 'link', asset }
    }
    case 'image': {
      const asset = assetIdOf(element.src)
      return asset === undefined ? null : { kind: 'image', asset, alt: element.alt }
    }
    case 'table':
      return assetRows(element)
  }
}

/**
 * @param row - the asset links and cell texts of one body row.
 * @param held - the open project's assets.
 * @returns the card of the row's first asset that the project holds, or undefined when it holds none.
 */
function gridCard(row: AssetRow, held: ChatAssets): GridCard | undefined {
  const link = row.assets.find(({ asset }) => held.assets[asset] !== undefined)
  const asset = link === undefined ? undefined : held.assets[link.asset]
  if (link === undefined || asset === undefined) return undefined
  const caption = row.texts.filter((text, column) => column !== link.column && text !== '')
  return { asset, caption: caption.join(' · ') }
}

/**
 * Resolve an element's asset references against the open project's assets.
 * @param reference - the references that {@link selectAssetReference} found.
 * @param held - the open project's assets.
 * @returns what the entry draws, or null while the project does not hold a referenced asset.
 */
export function resolveChatMedia(reference: AssetReference, held: ChatAssets): ChatMedia | null {
  const { project } = held
  if (project === null) return null
  switch (reference.kind) {
    case 'link': {
      const asset = held.assets[reference.asset]
      return asset === undefined ? null : { project, kind: 'link', asset, shot: held.shots[asset.id] ?? null }
    }
    case 'image': {
      const asset = held.assets[reference.asset]
      return asset === undefined ? null : { project, kind: 'image', asset, alt: reference.alt }
    }
    case 'table': {
      const cards: GridCard[] = []
      for (const row of reference.rows) {
        const card = gridCard(row, held)
        if (card === undefined) return null
        cards.push(card)
      }
      return { project, kind: 'table', cards }
    }
  }
}

/** The props that the chain entry's component reads. */
export type ChatMediaEntryProps = PropsRuntime<'conversation.chat.markdown'> & PropsRenderFactories
  & InjectFace<ChatMediaInjected> & { matched: AssetReference }

/**
 * The chain entry's component: the cards of the matched references, or DSH's default element while the project does
 * not hold a referenced asset. A change of the project re-renders a card in place, so its state survives.
 * @param props - the matched references, the default element, the asset hook, the preview, and the Factory renderer.
 * @returns the card, the thumbnail, the grid, or the default element.
 */
export function ChatMediaEntry(props: ChatMediaEntryProps): ReactNode {
  const { matched, fallback, useChatAssets, preview, renderFactorySlot } = props
  const media = useChatAssets(held => resolveChatMedia(matched, held), sameChatMedia)
  return media === null ? fallback : createElement(ChatMediaView, { media, preview, renderFactorySlot })
}

/**
 * @param a - a resolved form.
 * @param b - another resolved form.
 * @returns whether both draw the same cards.
 */
function sameChatMedia(a: ChatMedia | null, b: ChatMedia | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Register the chain entry while the Chat view declares `conversation.chat.markdown`. The entry stays registered for
 * the whole declaration, and the open project's assets reach its component through the `useChatAssets` hook. The
 * project is followed only while a chat element subscribes; when the last one unsubscribes, following stops and the
 * last snapshot stays for the next subscriber. The preview is read from the optional `dvMedia` service at call time.
 * @param ctx - client root context with the `slots` service.
 */
export function registerChatMedia(ctx: Context): void {
  const client = new DvClient()
  ctx.slots.inject('conversation.chat.markdown', () => {
    let held = NO_CHAT_ASSETS
    const listeners = new Set<() => void>()
    let stopFollowing: (() => void) | null = null
    const chatAssets: HostObservable<ChatAssets> = {
      getSnapshot: () => held,
      subscribe: (listener) => {
        listeners.add(listener)
        stopFollowing ??= followChatAssets(client, (next) => {
          held = next
          for (const each of [...listeners]) each()
        })
        return () => {
          listeners.delete(listener)
          if (listeners.size > 0) return
          stopFollowing?.()
          stopFollowing = null
        }
      },
    }
    const injected: ChatMediaInjected = {
      hooks: { chatAssets },
      preview: (projectId, asset, opener) => { ctx.get('dvMedia')?.preview(projectId, asset, opener) },
    }
    const unregister = ctx.slots.register({
      name: 'conversation.chat.markdown',
      select: ({ element }) => selectAssetReference(element),
      inject: () => injected,
    }, ChatMediaEntry)
    return () => {
      unregister()
      stopFollowing?.()
    }
  })
}
