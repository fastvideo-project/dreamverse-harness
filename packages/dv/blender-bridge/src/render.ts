/**
 * The two render operations of the Blender component, which put what the scene camera of the connected Blender sees
 * into the project: `blender.render` renders one frame as a PNG image, and `blender.animation_render` renders a frame
 * range as an MP4 video through Blender's FFmpeg output. Blender renders with the scene's own engine and settings and
 * sends the file back over the link; the operation imports it as the record's one output, so it reaches the canvas, the
 * asset pool and the timeline like a generated take.
 *
 * @module @fastvideo/dreamverse-blender-bridge/render
 */
import { importOne } from '@dv/generation'
import type { OperationContext, OperationResult, OperationSpec, ProjectRecord } from '@dv/project'
import type { BlenderLink } from './link.ts'

/** Time limit of a render. */
export interface RenderLimits {
  renderTimeoutMs: number
}

function wholeNumber(params: Record<string, unknown>, name: string): number | undefined {
  const value = params[name]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${name} must be a whole frame number.`)
  return value
}

function fact(record: ProjectRecord, name: string): string {
  const value = record.report?.[name]
  return typeof value === 'number' ? String(value) : '?'
}

function sizeOf(record: ProjectRecord): string {
  const { width, height } = record.report ?? {}
  return typeof width === 'number' && typeof height === 'number' ? `${String(width)}x${String(height)}` : '?'
}

/**
 * Render over the link and import the file.
 * @param link - the Blender link.
 * @param limits - the time limit.
 * @param run - the running call.
 * @param params - what the add-on renders.
 * @param mime - the media type the add-on must return.
 * @returns the output and the report.
 */
async function renderInto(link: BlenderLink, limits: RenderLimits, run: OperationContext, params: Record<string, unknown>,
  mime: 'image/png' | 'video/mp4'): Promise<OperationResult> {
  const reply = await link.request('render', params, { timeoutMs: limits.renderTimeoutMs, signal: run.signal })
  const { width, height, duration_sec: durationSec } = reply.result
  if (reply.file === null || reply.result['mime'] !== mime || typeof width !== 'number' || typeof height !== 'number') {
    throw new Error('Blender answered the render without the file it rendered.')
  }
  const asset = importOne(run, { bytes: reply.file, mime, width, height, ...typeof durationSec === 'number' ? { durationSec } : {} })
  const { mime: _mime, ...report } = reply.result
  return { outputs: [asset], report }
}

/**
 * The still render operation.
 * @param link - the Blender link.
 * @param limits - the time limit.
 * @returns the operation spec.
 */
export function stillOperation(link: BlenderLink, limits: RenderLimits): OperationSpec {
  return {
    name: 'blender.render',
    component: 'blender',
    version: '1',
    label: { zh: 'Blender 渲染', en: 'Blender render' },
    description: 'Render one frame of the connected Blender\'s scene with its scene camera, render engine and resolution, as a '
      + 'PNG image in the project, for use as a still or as the reference image of a shot. Check the framing with '
      + 'dv_blender_look view camera first. Blender is busy until the render finishes.',
    params: {
      frame: { type: 'integer', description: 'The frame to render; default: the scene\'s current frame.' },
    },
    inputs: {},
    outputs: [{ role: 'image', type: 'image' }],
    deterministic: false,
    resource: 'none',
    summarize: record => `Blender frame ${fact(record, 'frame')} (${sizeOf(record)})`,
    execute: async (run) => {
      const frame = wholeNumber(run.params, 'frame')
      return await renderInto(link, limits, run, { kind: 'still', ...frame === undefined ? {} : { frame } }, 'image/png')
    },
  }
}

/**
 * The animation render operation.
 * @param link - the Blender link.
 * @param limits - the time limit.
 * @returns the operation spec.
 */
export function animationOperation(link: BlenderLink, limits: RenderLimits): OperationSpec {
  return {
    name: 'blender.animation_render',
    component: 'blender',
    version: '1',
    label: { zh: 'Blender 动画渲染', en: 'Blender animation render' },
    description: 'Render a frame range of the connected Blender\'s scene with its scene camera, render engine, resolution and '
      + 'frame rate, as an MP4 video in the project that the timeline can use as a shot. Rendering many frames takes long; '
      + 'keep ranges short and the resolution modest unless the user asks for more. Blender is busy until it finishes.',
    params: {
      frame_start: { type: 'integer', description: 'The first frame; default: the scene\'s start frame.' },
      frame_end: { type: 'integer', description: 'The last frame, included; default: the scene\'s end frame.' },
    },
    inputs: {},
    outputs: [{ role: 'video', type: 'video' }],
    deterministic: false,
    resource: 'none',
    summarize: (record) => {
      const duration = record.report?.['duration_sec']
      return `Blender frames ${fact(record, 'frame_start')}–${fact(record, 'frame_end')} `
        + `(${sizeOf(record)}, ${typeof duration === 'number' ? duration.toFixed(1) : '?'}s)`
    },
    execute: async (run) => {
      const start = wholeNumber(run.params, 'frame_start')
      const end = wholeNumber(run.params, 'frame_end')
      if (start !== undefined && end !== undefined && end < start) throw new Error('frame_end must not come before frame_start.')
      return await renderInto(link, limits, run, {
        kind: 'animation', ...start === undefined ? {} : { frame_start: start }, ...end === undefined ? {} : { frame_end: end },
      }, 'video/mp4')
    },
  }
}
