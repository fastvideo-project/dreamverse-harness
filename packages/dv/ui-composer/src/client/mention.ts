/**
 * The `@` source that lists the project items of the project the shell has open: the items of the mention kinds that
 * plugin UI halves register in `dvMentions`, and assets of every media type. A pick inserts a reference chip whose text
 * is the citation `@[<label>](dv:<kind>/<id>)` that `formatCitation` of `@dv/project/grammar` writes; the host plugin
 * `@dv/chat-references` expands that address into record and asset IDs for the model, and puts the assets of the
 * `dv:asset/<id>` chips of a sent message on the canvas.
 *
 * @module @dv/ui-composer/mention
 */
import { createElement, type ComponentType } from 'react'
import type { InputTriggerCandidate, InputTriggerSource, PickOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { IconPaperclipOutlineRegular, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { citationTarget, citationUri, citedAsset, citedElement, formatCitation } from '@dv/project/grammar'
import { assetUrl, DvClient } from '@dv/ui-kit/api.ts'
import type { DvMentions, MentionKind } from '@dv/ui-kit/registries.ts'
import { mediaTypeOf } from '@dv/ui-kit/media-type.ts'
import type { Asset, WireState } from '@dv/ui-kit/types.ts'
import { getCurrentProject } from '@dv/ui-kit/current-project.ts'
import { pickText } from '@dv/ui-kit/locale.ts'
import type { MediaType } from '@dv/ui-media/contract'

/** The source name; reference chips carry it so their codec serializes them. */
export const MENTION_SOURCE = 'dv-project'

function poster(url: string): ComponentType<IconProps> {
  // Sized to stay clear of the label in the 14 px icon column of the @ menu.
  const style = { width: 20, height: 14, objectFit: 'cover' as const, borderRadius: 3, flex: 'none' }
  return function Poster() {
    return createElement('img', { src: url, alt: '', style })
  }
}

function assetIcon(asset: Asset | undefined, types: readonly MediaType[], state: WireState): ComponentType<IconProps> {
  const type = asset === undefined ? undefined : types.find(entry => entry.id === mediaTypeOf(asset.mime))
  const still = asset === undefined ? null : type?.poster?.(asset, state) ?? null
  return still === null ? type?.icon ?? IconPaperclipOutlineRegular : poster(assetUrl(still))
}

/** One listed item before query filtering. */
interface Item {
  uri: string
  label: string
  section: string
  description?: string
  icon?: ComponentType<IconProps>
  /** The asset that shows the item: the asset itself, or the thumb of a mention kind's item. */
  shows?: string
}

/**
 * The project items of a project state: the items of each mention kind in `order` (registration order on a tie) under
 * the kind's section, and the 40 newest assets of every media type. Labels and group names follow the interface language
 * at call time, so the label a pick inserts is in that language.
 * @param state - the project's current state.
 * @param kinds - the registered mention kinds.
 * @param types - the registered media types, which draw the icons.
 * @returns the items in display order.
 */
export function projectItems(state: WireState, kinds: readonly MentionKind[], types: readonly MediaType[]): Item[] {
  const assetsById = new Map(state.assets.map(asset => [asset.id, asset]))
  const mentioned = [...kinds].sort((a, b) => a.order - b.order).flatMap((kind) => {
    const section = kind.section()
    return kind.items(state).map(({ thumb, ...item }): Item => ({
      ...item, section, ...thumb === undefined ? {} : { icon: assetIcon(assetsById.get(thumb), types, state), shows: thumb },
    }))
  })
  const assets = state.assets.slice(-40).reverse().map((asset): Item => ({
    uri: citationUri('asset', asset.id), label: asset.name, section: pickText('素材', 'Assets'), icon: assetIcon(asset, types, state),
    shows: asset.id,
  }))
  return [...mentioned, ...assets]
}

/** A JSON object, else null. */
function objectOf(value: JsonValue | undefined): { readonly [key: string]: JsonValue } | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}

/** The strings of a JSON list, else null. */
function stringsOf(value: JsonValue | undefined): readonly string[] | null {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : null
}

/** What a prompt occurrence's source context names, each null when the context names none. */
interface PromptFilter {
  /** The media types that the call's model takes. */
  readonly media: readonly string[] | null
  /** The kinds whose items a version kind reads, which an input of the call can satisfy. */
  readonly kinds: readonly string[] | null
}

/** The filter that a prompt occurrence's source context names. */
function promptFilterOf(context: JsonValue | null): PromptFilter {
  const fields = objectOf(context)
  return { media: stringsOf(objectOf(fields?.['filter'])?.['mediaTypes']), kinds: stringsOf(fields?.['kinds']) }
}

/**
 * The `@` source over the `/api/dv` routes. A prompt occurrence outside a Session reaches it through its `prompt`
 * face with the media types that its call's model takes and the kinds that a version kind reads; an item whose asset
 * is of another media type, and an item of another kind, such as a timeline clip, is not offered there, because no input
 * of the call can satisfy it.
 * @param mentions - the mention kinds that plugin UI halves register.
 * @param mediaTypes - reads the registered media types when the menu lists its candidates.
 * @returns the source.
 */
export function projectMentionSource(mentions: DvMentions, mediaTypes: () => readonly MediaType[]): InputTriggerSource {
  const client = new DvClient()
  /**
   * The candidates of a query: a media filter keeps the items whose asset is of a media type the call's model takes, and
   * a kinds filter keeps the assets and the items of those kinds.
   */
  async function candidates(query: string, signal: AbortSignal, { media, kinds }: PromptFilter): Promise<readonly InputTriggerCandidate[]> {
    // The project the shell has open; the entry page lists nothing.
    const projectId = getCurrentProject()
    if (projectId === null) return []
    const state = await client.getState(projectId, signal)
    const needle = query.toLowerCase()
    const mimes = new Map(state.assets.map(asset => [asset.id, asset.mime]))
    const taken = (asset: string): boolean => media === null || media.includes(mediaTypeOf(mimes.get(asset) ?? ''))
    // The menu shows a candidate name that differs from its label as a trailing alias, so the name is the label
    // (numbered when labels repeat) and the `dv:` address travels in `value`.
    const seen = new Map<string, number>()
    return projectItems(state, mentions.kinds.getSnapshot(), mediaTypes())
      .filter(item => item.shows === undefined || taken(item.shows))
      .filter(item => kinds === null || citedAsset(item.uri) !== null || kinds.includes(citedElement(item.uri)?.kind ?? ''))
      .filter(item => needle === '' || item.label.toLowerCase().includes(needle) || (item.description ?? '').toLowerCase().includes(needle))
      .map((item): InputTriggerCandidate => {
        const count = (seen.get(item.label) ?? 0) + 1
        seen.set(item.label, count)
        return {
          name: count === 1 ? item.label : `${item.label} (${String(count)})`, section: item.section, value: JSON.stringify({ uri: item.uri, label: item.label }),
          ...item.description === undefined ? {} : { description: item.description },
          ...item.icon === undefined ? {} : { icon: item.icon },
        }
      })
  }
  /** The chip of a picked candidate. */
  function insert(candidate: InputTriggerCandidate): PickOutcome {
    const { uri, label } = JSON.parse(candidate.value ?? '{}') as { uri?: string; label?: string }
    // An item URI may hold the parentheses of an ID raw; the kernel writer encodes them, so the chip text reads back as the item.
    const target = uri === undefined ? null : citationTarget(uri)
    if (target === null || label === undefined) return undefined
    const text = formatCitation(label, target.kind, target.id)
    return { insert: { source: MENTION_SOURCE, ref: text, label, clipboardText: text } }
  }
  return {
    trigger: '@',
    name: MENTION_SOURCE,
    showGroupTitle: false,
    candidates: (_session, { query, signal }) => candidates(query, signal, { media: null, kinds: null }),
    onPick: ({ candidate }) => insert(candidate),
    prompt: {
      candidates: ({ query, signal, context }) => candidates(query, signal, promptFilterOf(context)),
      onPick: ({ candidate }) => insert(candidate),
    },
    codec: {
      clipboardText: ref => ref,
      serialize: ref => Promise.resolve(ref),
    },
  }
}
