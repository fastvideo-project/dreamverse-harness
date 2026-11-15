/**
 * Host half of the Blender UI plugin: nothing. The browser half in `src/client/` registers the Blender tab and the
 * Blender takes; the routes it reads belong to `@fastvideo/dreamverse-blender-bridge`.
 *
 * @module @fastvideo/dreamverse-ui-blender
 */

/** Loader entry; the plugin has no host behavior. */
export function apply(): void {}
