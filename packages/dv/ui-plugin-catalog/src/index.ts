/**
 * Host half of the DreamVerse Marketplace page: nothing. The browser half in `src/client/` draws the plugin catalog on
 * the page that its left-navigator entry opens; `@dv/plugin-catalog` answers the catalog on the host.
 *
 * @module @dv/ui-plugin-catalog
 */

/** Loader entry; the plugin has no host behavior. */
export function apply(): void {}
