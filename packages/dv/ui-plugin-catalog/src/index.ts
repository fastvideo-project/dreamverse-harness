/**
 * Host half of the DreamVerse Plugins tab: nothing. The browser half in `src/client/` draws the plugin catalog in the
 * entry page's 探索 section; `@dv/plugin-catalog` answers the catalog on the host.
 *
 * @module @dv/ui-plugin-catalog
 */

/** Loader entry; the plugin has no host behavior. */
export function apply(): void {}
