/**
 * Two chats on one project through the REAL bundle composition: the project summary that `dv_proj_state` returns gives
 * each chat's agent its own video-model choice as `video_model` and names no other chat's session or choice.
 */
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ProjectId } from '@dv/project'
import { afterEach, describe, expect, it } from 'vitest'
import { bootBundle, fasth3 } from './bundle.ts'

const disposers: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})

describe('conversation video model in the project summary', () => {
  it('shows each chat only its own video model choice', async () => {
    const { ctx, services, dispose } = await bootBundle()
    disposers.push(dispose)
    for (const model of ['pika', 'wan']) ctx.dvModels.register(Object.create(fasth3, { model: { value: model }, provider: { value: 'fastvideo' } }) as typeof fasth3)
    const chatA = 'sess-A-7f3c'
    const chatB = 'sess-B-91d2'
    const folder = await ctx.dvProject.newProjectFolder('two-chats')
    services.chats.open(chatA, folder)
    services.chats.open(chatB, folder)
    let calls = 0
    // One model-visible tool call from a chat; returns the text the model reads.
    const call = async (session: string, name: string, args: Record<string, unknown>) => {
      calls += 1
      const result = await ctx.tools.execute({
        callId: ToolCallId(`${name}-${String(calls)}`), name, arguments: args, signal: new AbortController().signal, agent: { id: session } as never,
      })
      if (result.isError) throw new Error(result.error.message)
      return { value: result.value, text: result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n') }
    }
    const created = await call(chatA, 'dv_proj_create', { title: 'two-chats' })
    expect(ctx.dvProject.sessionProject(chatB as never)).toBe((created.value as { project_id: ProjectId }).project_id)
    const autoForA = await call(chatA, 'dv_proj_state', {})
    expect(JSON.parse(autoForA.text)).toMatchObject({ video_model: null })
    await call(chatB, 'dv_models_select', { provider: 'fastvideo', model: 'pika', reason: 'Chat B wants Pika' })
    await call(chatA, 'dv_models_select', { provider: 'fastvideo', model: 'wan', reason: 'Chat A wants Wan' })

    const seenByA = await call(chatA, 'dv_proj_state', {})
    expect(JSON.parse(seenByA.text)).toMatchObject({ video_model: { provider: 'fastvideo', model: 'wan' } })
    const seenByB = await call(chatB, 'dv_proj_state', {})
    expect(JSON.parse(seenByB.text)).toMatchObject({ video_model: { provider: 'fastvideo', model: 'pika' } })
    // The other chat's records stay listed under `recent`, but no session ID reaches either agent.
    for (const text of [seenByA.text, seenByB.text]) for (const session of [chatA, chatB]) expect(text).not.toContain(session)
    // A choice listed under `recent` says that it belongs to the conversation that made it.
    expect(seenByA.text).toContain('video model pika, for the conversation that chose it only')
  })
})
