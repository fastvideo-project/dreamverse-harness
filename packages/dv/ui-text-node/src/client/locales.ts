/**
 * The dictionary namespace of the text node UI. The copy lives in `locales/en.json` and `locales/zh.json`.
 *
 * @module @dv/ui-text-node/locales
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import enDictionary from './locales/en.json' with { type: 'json' }
import zhDictionary from './locales/zh.json' with { type: 'json' }

/** The dictionary namespace of every text node UI string. */
export const NS = 'dv-text-node'

/** Every key of the text node dictionary. */
export type TextNodeKey = keyof typeof enDictionary

/** The English dictionary. */
export const en: Record<TextNodeKey, string> = enDictionary

/** The Chinese dictionary, with the same keys. */
export const zh: Record<TextNodeKey, string> = zhDictionary

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The text node card, editor, node type and mention section. */
    'dv-text-node': TextNodeKey
  }
}
