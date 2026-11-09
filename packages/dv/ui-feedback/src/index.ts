/**
 * Host half of the DreamVerse Feedback button: nothing. The browser half in `src/client/` draws the button and its
 * dialog; `@dv/feedback` serves the route that the dialog sends to.
 *
 * @module @dv/ui-feedback
 */

/** Loader entry; the plugin has no host behavior. */
export function apply(): void {}
