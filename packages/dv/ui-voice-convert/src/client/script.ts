/**
 * The lines of a script for recording, and the file names of their recordings. A script is plain text in either of two
 * forms, mixed freely: `NAME: words` on one line, or screenplay blocks, where a line in capitals names the speaker and the
 * lines below it, up to a blank line or the next speaker, are that speaker's words. A line that is wholly in parentheses
 * or brackets is a stage direction, a scene heading (`INT.`, `EXT.`, `INT./EXT.`, `EST.`) names a place, and inside a
 * speaker's block a line with lowercase letters and a word of three or more capitals, such as `Fletcher SLAPS him.`, is
 * action; none of them is a line to record. Any other text line is a line without a speaker, unless the script names a
 * speaker anywhere: then it is action too, as in a screenplay.
 *
 * @module @fastvideo/dreamverse-ui-voice-convert/script
 */

/** One line to record. */
export interface ScriptLine {
  /** The line's position among the script's lines, from 1. */
  index: number
  /** The speaker, as the script writes it; null for a line without one. */
  character: string | null
  text: string
}

const NAMED = /^([\p{L}][\p{L}\p{N} .'’-]{0,29}):\s*(\S.*)$/u
const DIRECTION = /^(\(.*\)|\[.*\])$/su
const SCENE_HEADING = /^(INT|EXT|INT\.?\/EXT|I\/E|EST)[. ]/u
const SHOUTED_WORD = /(^|[^\p{L}])\p{Lu}{3,}([^\p{L}]|$)/u

/** Whether a line inside a speaker's block is action: lowercase words with a word in capitals, such as `He SLAPS him.` */
function isAction(line: string): boolean {
  return /\p{Ll}/u.test(line) && SHOUTED_WORD.test(line)
}

/** Whether a line is a screenplay speaker cue: letters in capitals, at most 30 characters, optionally `(V.O.)` and the like. */
function isCue(line: string): boolean {
  const name = line.replace(/\s*\([^)]*\)\s*$/u, '')
  return name.length <= 30 && /\p{Lu}/u.test(name) && !/\p{Ll}/u.test(name) && /^[\p{Lu}\p{N} .'’-]+$/u.test(name)
}

/**
 * Read the lines of a script.
 * @param text - the script.
 * @returns the lines to record, in script order.
 */
export function parseScript(text: string): ScriptLine[] {
  const lines: ScriptLine[] = []
  let cue: { character: string; words: string[] } | null = null
  const add = (character: string | null, words: string): void => {
    lines.push({ index: lines.length + 1, character, text: words })
  }
  const flush = (): void => {
    if (cue !== null && cue.words.length > 0) add(cue.character, cue.words.join(' '))
    cue = null
  }
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '') {
      flush()
      continue
    }
    if (DIRECTION.test(line) || SCENE_HEADING.test(line)) continue
    if (cue !== null && !isCue(line)) {
      if (!isAction(line)) cue.words.push(line)
      continue
    }
    flush()
    const named = NAMED.exec(line)
    if (named !== null) add((named[1] as string).trim(), (named[2] as string).trim())
    else if (isCue(line)) cue = { character: line.replace(/\s*\([^)]*\)\s*$/u, ''), words: [] }
    else add(null, line)
  }
  flush()
  if (!lines.some(line => line.character !== null)) return lines
  return lines.filter(line => line.character !== null).map((line, index) => ({ ...line, index: index + 1 }))
}

/**
 * The stem that names a script's recordings: its file name without the extension, lowercase, with every run of other
 * characters than letters and digits replaced by one `-`.
 * @param name - the script's file name, such as `Rehearsal Scene.txt`.
 * @returns the stem, such as `rehearsal-scene`; `script` when nothing is left.
 */
export function scriptStem(name: string): string {
  const stem = name.replace(/\.[^.]*$/u, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/gu, '')
  return stem === '' ? 'script' : stem
}

/**
 * The file name of a line's recording.
 * @param stem - the script's stem.
 * @param index - the line's index.
 * @returns such as `rehearsal-scene-line-03.wav`.
 */
export function lineFileName(stem: string, index: number): string {
  return `${stem}-line-${String(index).padStart(2, '0')}.wav`
}

/**
 * The line that a recording's file name records.
 * @param stem - the script's stem.
 * @param name - a file name.
 * @returns the line's index; null for a file name of another script or of no script.
 */
export function lineOfFile(stem: string, name: string): number | null {
  const match = /^(.*)-line-(\d+)\.wav$/u.exec(name)
  return match !== null && match[1] === stem ? Number(match[2]) : null
}
