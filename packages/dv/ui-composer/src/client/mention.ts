/**
 * The `@` source that lists the project items of the project the shell has open: the items of the mention kinds that
 * plugin UI halves register in `dvMentions`, and assets of every media type. A pick inserts a reference chip whose text
 * is `@[<label>](dv:<kind>/<id>)`; the host plugin `@dv/chat-references` expands that address into record and asset IDs
 * for the model, and puts the assets of the `dv:asset/<id>` chips of a sent message on the canvas.
 *
 * @module @dv/ui-composer/mention
 */
import { createElement, type ComponentType } from 'react'
import type { InputTriggerCandidate, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  IconMicrophoneOutlineRegular, IconPaperclipOutlineRegular, IconPlayOutlineRegular, type IconProps,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { assetUrl, DvClient } from '@dv/ui-kit/api.ts'
import type { DvMentions, MentionKind } from '@dv/ui-kit/registries.ts'
import { mediaTypeOf } from '@dv/ui-kit/media-type.ts'
import type { Asset, WireState } from '@dv/ui-kit/types.ts'
import { getCurrentProject } from '@dv/ui-kit/current-project.ts'
import { pickText } from '@dv/ui-kit/locale.ts'
import type { MediaType } from '@dv/ui-media/contract'

/** The source name; reference chips carry it so their codec serializes them. */
export const MENTION_SOURCE = 'dv-project'

/**
 * The reference text of one project item.
 * @param label - the chip label.
 * @param uri - the `dv:` address.
 * @returns `@[label](uri)`.
 */
export function referenceText(label: string, uri: string): string {
  return `@[${label.replaceAll(']', '')}](${uri})`
}

/** The glyph of each icon name that a media type gives (`MediaType.icon`), for an asset without a poster. */
const GLYPHS: Readonly<Record<string, ComponentType<IconProps>>> = {
  video: IconPlayOutlineRegular,
  audio: IconMicrophoneOutlineRegular,
}

/** A poster still as a candidate icon. */
function poster(url: string): ComponentType<IconProps> {
  // Sized to stay clear of the label in the 14 px icon column of the @ menu.
  const style = { width: 20, height: 14, objectFit: 'cover' as const, borderRadius: 3, flex: 'none' }
  return function Poster() {
    return createElement('img', { src: url, alt: '', style })
  }
}

/**
 * The `@` menu icon of an asset: an image of its media type's poster, else the glyph of the type's icon name, else a
 * file glyph.
 * @param asset - the asset, or undefined for an asset that the state does not hold.
 * @param types - the registered media types.
 * @param state - the project state that the poster reads.
 * @returns the icon.
 */
function assetIcon(asset: Asset | undefined, types: readonly MediaType[], state: WireState): ComponentType<IconProps> {
  const type = asset === undefined ? undefined : types.find(entry => entry.id === mediaTypeOf(asset.mime))
  const still = asset === undefined ? null : type?.poster?.(asset, state) ?? null
  return still === null ? GLYPHS[type?.icon ?? ''] ?? IconPaperclipOutlineRegular : poster(assetUrl(still))
}

/** One listed item before query filtering. */
interface Item {
  uri: string
  label: string
  section: string
  description?: string
  icon?: ComponentType<IconProps>
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
  // A thumb is an asset ID, drawn as that asset's icon.
  const mentioned = [...kinds].sort((a, b) => a.order - b.order).flatMap((kind) => {
    const section = kind.section()
    return kind.items(state).map(({ thumb, ...item }): Item => ({
      ...item, section, ...thumb === undefined ? {} : { icon: assetIcon(assetsById.get(thumb), types, state) },
    }))
  })
  const assets = state.assets.slice(-40).reverse().map((asset): Item => ({
    uri: `dv:asset/${encodeURIComponent(asset.id)}`, label: asset.name, section: pickText('素材', 'Assets'), icon: assetIcon(asset, types, state),
  }))
  return [...mentioned, ...assets]
}

/**
 * The `@` source over the `/api/dv` routes.
 * @param mentions - the mention kinds that plugin UI halves register.
 * @param mediaTypes - reads the registered media types when the menu lists its candidates.
 * @returns the source.
 */
export function projectMentionSource(mentions: DvMentions, mediaTypes: () => readonly MediaType[]): InputTriggerSource {
  const client = new DvClient()
  return {
    trigger: '@',
    name: MENTION_SOURCE,
    showGroupTitle: false,
    async candidates(_session, { query, signal }): Promise<readonly InputTriggerCandidate[]> {
      // The project the shell has open; the entry page lists nothing.
      const projectId = getCurrentProject()
      if (projectId === null) return []
      const state = await client.getState(projectId, signal)
      const needle = query.toLowerCase()
      // The menu shows a candidate name that differs from its label as a trailing alias, so the name is the label
      // (numbered when labels repeat) and the `dv:` address travels in `value`.
      const seen = new Map<string, number>()
      return projectItems(state, mentions.kinds.list(), mediaTypes())
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
    },
    onPick({ candidate }) {
      const { uri, label } = JSON.parse(candidate.value ?? '{}') as { uri?: string; label?: string }
      if (uri === undefined || label === undefined) return undefined
      const text = referenceText(label, uri)
      return { insert: { source: MENTION_SOURCE, ref: text, label, clipboardText: text } }
    },
    codec: {
      clipboardText: ref => ref,
      serialize: ref => Promise.resolve(ref),
    },
  }
}
