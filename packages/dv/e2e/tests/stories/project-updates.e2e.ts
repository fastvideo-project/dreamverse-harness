// Project updates: the shipped video-harness profile (`dsh web`, the llm-pi-ai openai-completions route, the fake video
// backend) drives a scripted model through steps that change the project, including a canvas import, two renders that run
// in the background and finish between steps of one turn, and an undo between turns. Each render's result reaches the
// agent once, as a record notice. Every agent request of the chat session extends the request before it token for token:
// the same request fields, the same earlier messages, new messages only appended.
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootHarness, playwright, waitFor, type BootedHarness } from '../harness.ts'
import {
  assetIdOf, startScriptedModel, textOf, type ChatRequest, type ScriptedModel, type ScriptedRule,
} from '../scripted-model.ts'

/** A 1×1 opaque PNG, the agent's product image. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** A red 1×1 PNG, the image the user imports on the canvas. */
const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4IScHAAK2AQU0pnWqAAAAAElFTkSuQmCC'

/**
 * Assert that each request extends the one before it: every request field other than the messages is equal, and the
 * earlier messages are unchanged at the start of the later request.
 * @param requests - the agent requests of one chat session, in arrival order.
 */
function expectEachRequestExtendsThePrevious(requests: readonly ChatRequest[]): void {
  for (let index = 1; index < requests.length; index += 1) {
    const { messages: previous, ...previousFields } = requests[index - 1] as ChatRequest
    const { messages: next, ...nextFields } = requests[index] as ChatRequest
    expect(nextFields, `request ${String(index)} fields`).toEqual(previousFields)
    expect(next.length, `request ${String(index)} length`).toBeGreaterThan(previous.length)
    expect(next.slice(0, previous.length), `request ${String(index)} prefix`).toEqual(previous)
  }
}

/** The project state and project update messages of one request, as text. */
function projectMessages(request: ChatRequest): string[] {
  return request.messages.filter(message => message.role === 'user').map(message => textOf(message.content))
    .filter(text => text.startsWith('DreamVerse project'))
}

describe('project updates reach the agent as appended messages', () => {
  let harness: BootedHarness
  let model: ScriptedModel
  let browser: Browser
  let projectId = ''
  let scheduled: string[] = []

  // The scripted agent: imports a product image and starts two renders with the backend held, then, between two steps,
  // the user imports an image on the canvas and the first render finishes; the agent reads the project state, and reads it
  // again after the second render finishes.
  const rules: ScriptedRule[] = [
    { match: /只回复\S+/, steps: [view => ({ text: `收到${/只回复(\S+)/.exec(view.userText)?.[1] ?? ''}` })] },
    {
      match: '做两个镜头的广告',
      steps: [
        { calls: [{ name: 'dv_asset_import', args: { reason: '产品图', base64: PNG_BASE64, mime: 'image/png', name: 'product.png' } }] },
        view => ({ calls: [{ name: 'dv_shot_render', args: {
          reason: '镜头1', modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'Picture 1 产品特写',
          duration_sec: 1, inputs: { reference: assetIdOf(view.toolResults[0], 'asset') },
        } }] }),
        view => ({ calls: [{ name: 'dv_shot_render', args: {
          reason: '镜头2', modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'Picture 1 产品使用场景',
          duration_sec: 2, inputs: { reference: assetIdOf(view.toolResults[0], 'asset') },
        } }] }),
        async (view) => {
          scheduled = view.toolResults.slice(1, 3).map(result => /^\w+ (\S+):/.exec(textOf(result))?.[1] ?? '')
          harness.backend.release()
          await harness.api.post('/api/dv/operation', {
            project: projectId, operation: 'asset.import', params: { base64: RED_PNG, mime: 'image/png', name: 'knife.png' },
            inputs: [], surface: 'canvas', intent: 'import knife.png',
          })
          await waitFor(async () => {
            const history = await harness.api.post('/api/dv/history', { project: projectId, records: scheduled }) as {
              entries: Array<{ record: { operation: string; status: string } }>
            }
            return history.entries.some(entry => entry.record.operation === 'shot.render' && entry.record.status === 'done')
          }, 'the first render', 60_000)
          return { calls: [{ name: 'dv_proj_state', args: {} }] }
        },
        async () => {
          harness.backend.releaseAll()
          await waitFor(async () => {
            const history = await harness.api.post('/api/dv/history', { project: projectId, records: scheduled }) as {
              entries: Array<{ record: { status: string } }>
            }
            return history.entries.every(entry => entry.record.status === 'done')
          }, 'the second render', 60_000)
          return { calls: [{ name: 'dv_proj_state', args: {} }] }
        },
      ],
      endText: '两个镜头已渲染。',
    },
  ]

  beforeAll(async () => {
    model = await startScriptedModel(rules)
    harness = await bootHarness({ modelBaseUrl: model.baseURL })
    const executablePath = process.env['DSH_PLAYWRIGHT_EXECUTABLE_PATH']
    browser = await playwright.chromium.launch(executablePath === undefined ? {} : { executablePath })
  }, 150_000)

  afterAll(async () => {
    await browser?.close().catch(() => undefined)
    await harness?.close()
    await model?.close()
  })

  /** Open the harness in a fresh browser context, create a project, and return the page with its chat composer up. */
  async function openProject(): Promise<Page> {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'zh-CN' })).newPage()
    await page.goto(harness.tokenUrl, { waitUntil: 'load' })
    const notice = page.getByRole('button', { name: '继续', exact: true }).first()
    if (await notice.waitFor({ timeout: 8000 }).then(() => true, () => false)) await notice.click()
    await page.getByRole('button', { name: '新建项目' }).first().click()
    await page.locator('[data-dv-workspace]').waitFor({ timeout: 30_000 })
    projectId = await waitFor(() => Promise.resolve(new URLSearchParams(new URL(page.url()).hash.replace(/^#/, '')).get('project')), 'a project in the URL', 10_000)
    return page
  }

  /** Send a chat message and wait until the chat shows the reply. */
  async function chat(page: Page, text: string, reply: string): Promise<void> {
    const composer = page.locator('[data-dv-chat]:visible [contenteditable="true"]:visible').first()
    await composer.waitFor({ timeout: 30_000 })
    await composer.click()
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
    await page.locator('[data-dv-chat]:visible').first().getByText(reply, { exact: false }).first().waitFor({ timeout: 90_000 })
  }

  it('keeps one prefix across tool steps, a canvas import, background render notices, and an undo between turns', async () => {
    const page = await openProject()
    harness.backend.hold()
    await chat(page, '做两个镜头的广告', '两个镜头已渲染')
    const history = await harness.api.post('/api/dv/history', { project: projectId, limit: 2 }) as { entries: Array<{ record: { id: string } }> }
    const beforeTip = history.entries[1]?.record.id ?? ''
    await harness.api.post('/api/dv/undo', { project: projectId })
    await chat(page, '只回复十', '收到十')

    const requests = model.requests
    expect(requests).toHaveLength(7)
    expectEachRequestExtendsThePrevious(requests)
    const first = requests[0] as ChatRequest
    expect(projectMessages(first)).toHaveLength(1)
    expect(projectMessages(first)[0]).toMatch(/^DreamVerse project state\. This conversation belongs to the project "/)
    expect(projectMessages(first)[0]).not.toContain('"report"')
    const system = first.messages.filter(message => message.role === 'system').map(message => textOf(message.content)).join('\n')
    expect(system).toContain('DreamVerse project rules:')
    expect(system).not.toContain('"head"')
    const userTexts = (requests.at(-1) as ChatRequest).messages.filter(message => message.role === 'user').map(message => textOf(message.content))
    const updates = userTexts.filter(text => text.startsWith('DreamVerse project updates since your last step:'))
    const text = updates.join('\n')
    // Each render's result reaches the agent once, as its record notice.
    const notices = userTexts.filter(text => text.startsWith('DreamVerse notice: a call you started finished.')).join('\n')
    for (const record of scheduled) expect(notices.match(new RegExp(`^- done ${record} \\(your call\\): `, 'gm'))).toHaveLength(1)
    // The agent's own import is never repeated.
    expect(text).not.toContain('imported product.png')
    // The step after the canvas import names it once.
    expect(text.match(/^- done \S+ \(user on canvas\): imported knife\.png$/gm)).toHaveLength(1)
    // The notices showed both renders finished, so no update repeats them.
    for (const record of scheduled) expect(text).not.toContain(record)
    // The undo between turns reaches the next turn as a move.
    expect(updates.at(-1)).toMatch(new RegExp(`^- history: the current step is ${beforeTip}; dv_proj_history_list shows which steps are undone or discarded\\.$`, 'm'))
    // No record line is sent twice.
    const lines = [...text.matchAll(/^- (\w+) (\S+) \(/gm)].map(match => `${match[1] ?? ''} ${match[2] ?? ''}`)
    expect(new Set(lines).size, text).toBe(lines.length)
  })
})
