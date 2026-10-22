/**
 * Host half of the shot render UI plugin: nothing. The browser half in `src/client/` declares the `shot.render` takes
 * through `defineGenerationUi` of `@dv/ui-generation`.
 *
 * @module @dv/ui-shot-render
 */

/** Loader entry; the plugin has no host behavior. */
export function apply(): void {}
