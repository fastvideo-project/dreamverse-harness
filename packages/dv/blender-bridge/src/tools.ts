/**
 * The agent's Blender tools: `dv_blender_scene` reads the scene, `dv_blender_run` runs Python in Blender, and
 * `dv_blender_look` returns a picture of the viewport or of the scene camera as an image the model sees. Each call goes
 * over the link to the one connected Blender and fails with {@link NOT_LINKED} while none is connected.
 *
 * @module @fastvideo/dreamverse-blender-bridge/tools
 */
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolExecution } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { BlenderLink } from './link.ts'

/** Tool names. */
export const SCENE_TOOL = 'dv_blender_scene'
export const RUN_TOOL = 'dv_blender_run'
export const LOOK_TOOL = 'dv_blender_look'

const JSON_OUTPUT = {
  schema: { type: 'json' },
  render: (_args: unknown, value: JsonValue) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

const CODE_OFF = 'The user has switched off "Allow code from the harness" in the DreamVerse add-on, so Blender runs no code '
  + 'from the harness. Ask the user to switch it on in the add-on\'s panel if they want you to change the scene.'

/** What `dv_blender_look` returns: the view, and the stored picture's attachment fields. */
export interface LookValue {
  view: 'viewport' | 'camera'
  image: {
    attachmentId: string
    mediaType: 'image/png'
    bytes: number
    width: number
    height: number
  }
}

const LOOK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    view: { type: 'string', enum: ['viewport', 'camera'], required: true },
    image: {
      type: 'object', additionalProperties: false, required: true,
      properties: {
        attachmentId: { type: 'string', required: true },
        mediaType: { type: 'string', enum: ['image/png'], required: true },
        bytes: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
  },
} as const

/**
 * The model-facing content of a look: one line naming the view and size, then the picture.
 * @param value - the tool value.
 * @returns the content blocks.
 */
export function lookContent(value: LookValue): ContentBlock[] {
  const attachment: ImageAttachmentRef = { ...value.image, attachmentId: AttachmentId(value.image.attachmentId) }
  const what = value.view === 'camera' ? 'the scene camera\'s view' : 'the Blender viewport as the user sees it'
  return [
    { type: 'text', text: `A picture of ${what}, ${String(value.image.width)}x${String(value.image.height)} px.` },
    { type: 'image', attachment },
  ]
}

/** Time limits of the tools. */
export interface ToolLimits {
  requestTimeoutMs: number
}

/**
 * Refuse a look when the calling model route does not declare image input, before Blender draws anything.
 * @param ctx - a context that may hold `llm`.
 * @param exec - the tool call.
 * @throws Error naming the model when it takes no images.
 */
async function assertSeesImages(ctx: Context, exec: ToolExecution): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) return
  const info = await llm.resolveModelInfo(provider, model, exec.signal)
  if (info.inputModalities?.includes('image') !== true) {
    throw new Error(`The model "${model}" does not take images, so it cannot look at Blender. Read the scene with ${SCENE_TOOL} instead.`)
  }
}

/**
 * Register the scene and run tools, and the look tool while an attachment store is mounted.
 * @param ctx - the bridge's context.
 * @param link - the Blender link.
 * @param limits - the time limits.
 */
export function registerTools(ctx: Context, link: BlenderLink, limits: ToolLimits): void {
  const ask = (op: 'scene' | 'run', params: Record<string, unknown>, exec: ToolExecution): Promise<JsonValue> =>
    link.request(op, params, { timeoutMs: limits.requestTimeoutMs, signal: exec.signal }).then(reply => reply.result as JsonValue)
  ctx.inject(['tools'], (tooled) => {
    tooled.effect(() => tooled.tools.register(defineTool({
      name: SCENE_TOOL,
      description: 'Read the scene of the Blender that the user connected to the harness: the open file, the frame range and '
        + 'frames per second, the render engine and resolution, the active camera, the selection, and every object with its '
        + 'type, parent, location, rotation (degrees), scale, dimensions, visibility and materials. Read it before you change '
        + 'the scene, and again when the user may have changed it.',
      parameters: {},
      output: JSON_OUTPUT,
      execute: (_args, exec) => ask('scene', {}, exec),
    })), `dv-blender: ${SCENE_TOOL}`)
    tooled.effect(() => tooled.tools.register(defineTool({
      name: RUN_TOOL,
      description: 'Run Python in the connected Blender, with bpy, mathutils and math imported. The user sees each change in '
        + 'their Blender at once. Make one small change per call. Assign a JSON value to `result` to return it; print() output '
        + 'returns as stdout. A Python error returns its traceback, and the changes made before the error stay. The user can '
        + 'undo a call in Blender with Ctrl+Z.',
      parameters: {
        code: { type: 'string', required: true, description: 'The Python code.' },
      },
      output: JSON_OUTPUT,
      execute: (args, exec) => {
        if (link.state?.allow_code === false) throw new Error(CODE_OFF)
        return ask('run', { code: args.code }, exec)
      },
    })), `dv-blender: ${RUN_TOOL}`)
  })
  ctx.inject(['tools', 'attachments'], (seeing) => {
    seeing.effect(() => seeing.tools.register(defineTool({
      name: LOOK_TOOL,
      description: 'Look at the connected Blender: a PNG of the 3D viewport as the user sees it (`viewport`, the default), or '
        + 'of what the scene camera frames (`camera`), at most 1280 px wide. Look after a visible change to check it.',
      parameters: {
        view: { type: 'string', enum: ['viewport', 'camera'], description: 'What to look at; default: viewport.' },
      },
      output: { schema: LOOK_SCHEMA, render: (_args, value) => lookContent(value) },
      execute: async (args, exec): Promise<LookValue> => {
        await assertSeesImages(ctx, exec)
        const view = args.view === 'camera' ? 'camera' : 'viewport'
        const reply = await link.request('look', { view }, { timeoutMs: limits.requestTimeoutMs, signal: exec.signal })
        if (reply.file === null) throw new Error('Blender answered the look without a picture.')
        const ref = await seeing.attachments.saveImage({ data: reply.file, mediaType: 'image/png', name: `blender-${view}.png` })
        return {
          view,
          image: { attachmentId: ref.attachmentId, mediaType: 'image/png', bytes: ref.bytes, width: ref.width, height: ref.height },
        }
      },
    })), `dv-blender: ${LOOK_TOOL}`)
  })
}
