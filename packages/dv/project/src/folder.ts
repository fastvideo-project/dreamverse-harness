/**
 * The layout of a project folder, as pure code that host and client packages can share: no Node built-ins, no host
 * `Context`.
 *
 * @module @dv/project/folder
 */

/** The hidden directory of a project folder that holds every DreamVerse file; the user's own files stay beside it. */
export const PROJECT_DIR = '.dreamverse'
