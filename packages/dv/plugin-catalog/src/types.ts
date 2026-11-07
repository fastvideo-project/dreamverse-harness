/**
 * Types of the DreamVerse plugin catalog: its entries and the answer of `GET /api/dv/plugins/catalog`.
 *
 * @module @dv/plugin-catalog/types
 */

/** A text in both languages of the interface. */
export interface LocalizedText {
  zh: string
  en: string
}

/** One plugin a catalog lists. */
export interface CatalogEntry {
  /** The npm package that installs the plugin, a bundle that declares `dsh.bundle`, such as `@fastvideo/dreamverse-voice-acting`. */
  package: string
  /** The exact version that 安装 / Install requests, the one the catalog's review approved, such as `0.1.0`. */
  version: string
  title: LocalizedText
  description: LocalizedText
  /** What the plugin needs besides the install, such as a server to run; absent when it needs nothing. */
  setup?: LocalizedText
  /** An https page about the plugin. */
  homepage?: string
  /** The catalog that listed the entry: `shipped`, or the path or URL of a configured source. */
  source: string
}

/** A configured catalog source that could not be read or is malformed. */
export interface CatalogProblem {
  source: string
  message: string
}

/** The answer of `GET /api/dv/plugins/catalog`. */
export interface CatalogAnswer {
  /** The listed plugins: the shipped catalog's order, then the entries that later sources add. */
  plugins: CatalogEntry[]
  problems: CatalogProblem[]
}
