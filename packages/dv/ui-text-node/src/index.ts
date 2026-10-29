/**
 * Host half of the text node UI plugin: nothing. The browser half in `src/client/` registers the canvas node type of
 * text nodes, their `@` mention kind and their History row.
 *
 * @module @dv/ui-text-node
 */

/** Loader entry; the plugin has no host behavior. */
export function apply(): void {}
