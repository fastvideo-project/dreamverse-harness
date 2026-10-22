/**
 * Host half of the media plugin: nothing. The browser half in `src/client/` provides `dvMedia` and registers the
 * `dv.media` Factory and the asset preview.
 *
 * @module @dv/ui-media
 */

/** Loader entry; the plugin has no host behavior. */
export function apply(): void {}
