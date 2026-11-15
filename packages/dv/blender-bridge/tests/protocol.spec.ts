/**
 * The add-on's messages as the harness reads them off the link: every malformed text message and binary header reads
 * as null, which the link reports as unreadable.
 */
import { describe, expect, it } from 'vitest'
import { encodeBinary, parseBlenderBinary, parseBlenderText } from '../src/index.ts'

const STATE = { blender_version: '5.3.0', addon_version: '0.1.0', file: '', allow_code: false }

/**
 * A binary message whose 4-byte header length is `length` and whose header bytes are `header`.
 * @param length - the declared header length.
 * @param header - the header text.
 * @returns the message bytes.
 */
function framed(length: number, header: string): Uint8Array {
  const head = new TextEncoder().encode(header)
  const out = new Uint8Array(4 + head.byteLength)
  new DataView(out.buffer).setUint32(0, length)
  out.set(head, 4)
  return out
}

describe('parseBlenderText', () => {
  it('reads a state, a result and an error', () => {
    expect(parseBlenderText(JSON.stringify({ type: 'state', ...STATE }))).toEqual({ type: 'state', state: STATE })
    expect(parseBlenderText('{"type":"response","id":"r1","ok":true,"result":{"a":1}}')).toEqual({ type: 'response', id: 'r1', ok: true, result: { a: 1 } })
    expect(parseBlenderText('{"type":"response","id":"r1","ok":false,"error":"no"}')).toEqual({ type: 'response', id: 'r1', ok: false, error: 'no' })
  })

  it.each([
    ['text that is not JSON', 'nope'],
    ['an array', '[]'],
    ['a hello without allow_code', JSON.stringify({ type: 'hello', ...STATE, allow_code: 'yes' })],
    ['an unknown type', '{"type":"bye"}'],
    ['a response without an id', '{"type":"response","ok":true,"result":{}}'],
    ['a result that is not an object', '{"type":"response","id":"r1","ok":true,"result":[1]}'],
    ['an error that is not text', '{"type":"response","id":"r1","ok":false,"error":1}'],
  ])('reads %s as null', (_case, text) => {
    expect(parseBlenderText(text)).toBeNull()
  })
})

describe('parseBlenderBinary', () => {
  it('reads a PNG frame and a chunk', () => {
    expect(parseBlenderBinary(encodeBinary({ kind: 'frame', seq: 1, width: 2, height: 3, mime: 'image/png' }, new Uint8Array([7]))))
      .toEqual({ kind: 'frame', seq: 1, width: 2, height: 3, mime: 'image/png', payload: new Uint8Array([7]) })
    expect(parseBlenderBinary(encodeBinary({ kind: 'chunk', id: 'r1' }, new Uint8Array([8])))).toEqual({ kind: 'chunk', id: 'r1', payload: new Uint8Array([8]) })
  })

  it.each([
    ['fewer than 4 bytes', new Uint8Array([0, 0, 0])],
    ['a header longer than the message', framed(10, '{}')],
    ['a header that is not JSON', framed(3, 'abc')],
    ['a header that is not an object', framed(2, '[]')],
    ['a frame with a fractional seq', encodeBinary({ kind: 'frame', seq: 1.5, width: 2, height: 3, mime: 'image/png' }, new Uint8Array())],
    ['a frame of another image type', encodeBinary({ kind: 'frame', seq: 1, width: 2, height: 3, mime: 'image/gif' }, new Uint8Array())],
    ['a chunk without an id', encodeBinary({ kind: 'chunk' }, new Uint8Array())],
  ])('reads %s as null', (_case, data) => {
    expect(parseBlenderBinary(data)).toBeNull()
  })
})
