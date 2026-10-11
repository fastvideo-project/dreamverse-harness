/**
 * Host half of the Skills page plugin: nothing. The browser half in `src/client/` registers the sidebar entry and the
 * page; the host serves the skill list through DSH's `skills` Remote.
 *
 * @module @dv/ui-skills
 */

/** Loader entry; the plugin has no host behavior. */
export function apply(): void {}
