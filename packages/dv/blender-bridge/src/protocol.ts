/**
 * The messages of the Blender link `/dv/blender/ws` between the harness and the DreamVerse add-on in Blender, and the
 * binary framing of images and file chunks. Text messages are JSON objects with a `type`. A binary message is a 4-byte
 * big-endian header length, that many bytes of JSON header, then the payload bytes.
 *
 * Harness to Blender: `request` (`id`, `op`, `params`), `stream` (`on`), `frame_ack` (`seq`), and `view` (a
 * {@link ViewCommand}), which moves the view of the main 3D viewport and gets no answer.
 * Blender to harness: `hello` and `state` ({@link BlenderState} fields), `response` (`id`, `ok`, `result` or `error`),
 * binary `frame` headers (`seq`, `width`, `height`, `mime`, and from add-on 0.3.0 `timing`; a JPEG or PNG payload) and
 * binary `chunk` headers (`id`, payload bytes of the file that the request with that ID returns; its `response` follows
 * the last chunk).
 *
 * @module @fastvideo/dreamverse-blender-bridge/protocol
 */

/** The operations the add-on answers. */
export type BlenderOp = 'scene' | 'run' | 'look' | 'render'

/** The image formats of viewport frames. */
export type FrameMime = 'image/jpeg' | 'image/png'

/** What the add-on reports about itself and the open file, in `hello` and every later `state`. */
export interface BlenderState {
  /** Blender's version string, such as `5.3.0`. */
  blender_version: string
  /** The add-on's version. */
  addon_version: string
  /** The open `.blend` file's name; empty for an unsaved file. */
  file: string
  /** Whether the add-on's "Allow code from the harness" preference is on. */
  allow_code: boolean
}

/** A text message from the add-on, after {@link parseBlenderText} checked its fields. */
export type BlenderText =
  | { type: 'hello' | 'state'; state: BlenderState }
  | { type: 'response'; id: string; ok: true; result: Record<string, unknown> }
  | { type: 'response'; id: string; ok: false; error: string }

/** How long the add-on took for one frame, in milliseconds: drawing and reading the view, and encoding the image. */
export interface FrameTiming {
  draw_ms: number
  encode_ms: number
}

/** A binary message from the add-on, after {@link parseBlenderBinary} checked its header. */
export type BlenderBinary =
  | { kind: 'frame'; seq: number; width: number; height: number; mime: FrameMime; timing?: FrameTiming; payload: Uint8Array }
  | { kind: 'chunk'; id: string; payload: Uint8Array }

/** The standard views of {@link ViewCommand} `preset`; `camera` looks through the scene camera. */
export const VIEW_PRESETS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'camera'] as const

/** One standard view. */
export type ViewPreset = typeof VIEW_PRESETS[number]

/**
 * A change to the view of the main 3D viewport, sent by a viewer of the viewport and relayed to Blender. `orbit` and
 * `pan` take the drag as fractions of the shown picture's width (`dx`, rightward) and height (`dy`, downward); a drag
 * across the whole width orbits half a turn. `zoom` takes wheel steps, positive away from the scene. `frame` fits
 * every object (`all`) or the selection (`selected`) into the view.
 */
export type ViewCommand =
  | { action: 'orbit' | 'pan'; dx: number; dy: number }
  | { action: 'zoom'; steps: number }
  | { action: 'preset'; preset: ViewPreset }
  | { action: 'frame'; target: 'all' | 'selected' }

/** The largest drag of one `orbit` or `pan`, and the most wheel steps of one `zoom`, that a viewer may send. */
export const VIEW_COMMAND_LIMIT = 10

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stateOf(value: Record<string, unknown>): BlenderState | null {
  const { blender_version: version, addon_version: addon, file, allow_code: allowCode } = value
  if (typeof version !== 'string' || typeof addon !== 'string' || typeof file !== 'string' || typeof allowCode !== 'boolean') return null
  return { blender_version: version, addon_version: addon, file, allow_code: allowCode }
}

/**
 * Read one text message of the add-on; the link is a wire boundary, so every field is checked.
 * @param text - the message text.
 * @returns the message, or null when it is not JSON or misses a field.
 */
export function parseBlenderText(text: string): BlenderText | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    // Not JSON: the caller reports the message as unreadable.
    return null
  }
  if (!isRecord(value)) return null
  if (value['type'] === 'hello' || value['type'] === 'state') {
    const state = stateOf(value)
    return state === null ? null : { type: value['type'], state }
  }
  if (value['type'] !== 'response' || typeof value['id'] !== 'string') return null
  if (value['ok'] === true && isRecord(value['result'])) return { type: 'response', id: value['id'], ok: true, result: value['result'] }
  if (value['ok'] === false && typeof value['error'] === 'string') return { type: 'response', id: value['id'], ok: false, error: value['error'] }
  return null
}

function bounded(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= VIEW_COMMAND_LIMIT
}

/**
 * Read one text message of a viewer; the viewer socket is a wire boundary, so every field is checked.
 * @param text - the message text.
 * @returns the command, or null when it is not JSON, names no known action, or has a field out of range.
 */
export function parseViewCommand(text: string): ViewCommand | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    // Not JSON: the viewer's message is dropped.
    return null
  }
  if (!isRecord(value) || value['type'] !== 'view') return null
  const { action } = value
  if (action === 'orbit' || action === 'pan') {
    const { dx, dy } = value
    return bounded(dx) && bounded(dy) ? { action, dx, dy } : null
  }
  if (action === 'zoom') return bounded(value['steps']) ? { action, steps: value['steps'] } : null
  if (action === 'preset') {
    const preset = VIEW_PRESETS.find(candidate => candidate === value['preset'])
    return preset === undefined ? null : { action, preset }
  }
  if (action === 'frame' && (value['target'] === 'all' || value['target'] === 'selected')) return { action, target: value['target'] }
  return null
}

/**
 * The timing of a frame header; an add-on before 0.3.0 sends none, and a malformed one is dropped with the frame kept.
 * @param value - the header's `timing`.
 * @returns the timing, or null.
 */
function frameTiming(value: unknown): FrameTiming | null {
  if (!isRecord(value)) return null
  const { draw_ms: draw, encode_ms: encode } = value
  const valid = (ms: unknown): ms is number => typeof ms === 'number' && Number.isFinite(ms) && ms >= 0
  return valid(draw) && valid(encode) ? { draw_ms: draw, encode_ms: encode } : null
}

/**
 * Read one binary message of the add-on.
 * @param data - the message bytes.
 * @returns the frame or chunk, or null when the header is malformed.
 */
export function parseBlenderBinary(data: Uint8Array): BlenderBinary | null {
  if (data.byteLength < 4) return null
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0)
  if (4 + length > data.byteLength) return null
  let header: unknown
  try {
    header = JSON.parse(new TextDecoder().decode(data.subarray(4, 4 + length)))
  } catch {
    // A header that is not JSON makes the whole message unreadable.
    return null
  }
  if (!isRecord(header)) return null
  const payload = data.subarray(4 + length)
  if (header['kind'] === 'frame') {
    const { seq, width, height, mime } = header
    if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return null
    if (mime !== 'image/jpeg' && mime !== 'image/png') return null
    const timing = frameTiming(header['timing'])
    const size = { width: width as number, height: height as number }
    return { kind: 'frame', seq: seq as number, ...size, mime, ...timing === null ? {} : { timing }, payload }
  }
  if (header['kind'] === 'chunk' && typeof header['id'] === 'string') return { kind: 'chunk', id: header['id'], payload }
  return null
}

/**
 * Encode one binary message, as the add-on does; the tests' fake Blender uses it.
 * @param header - the JSON header.
 * @param payload - the payload bytes.
 * @returns the message bytes.
 */
export function encodeBinary(header: Record<string, unknown>, payload: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(header))
  const out = new Uint8Array(4 + head.byteLength + payload.byteLength)
  new DataView(out.buffer).setUint32(0, head.byteLength)
  out.set(head, 4)
  out.set(payload, 4 + head.byteLength)
  return out
}
