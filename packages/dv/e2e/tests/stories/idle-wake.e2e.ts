// Idle wake: the shipped video-harness profile drives a scripted agent that starts renders with the backend held and
// ends its turn. When the backend lets the renders finish, the record notices wake the idle agent: one turn opens, and
// its model request ends with the project update that reports each render as `(your call)`. With two renders, the first
// finish waits while the second runs, and one woken turn reports both. The wake itself reaches no request; because each
// request extends the previous one, no logged user message of the session carries a wake either. The step gate of
// `tests/step-gate-plugin.ts` reports each wake's inbox and each idle agent; it holds no step.
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootHarness, playwright, waitFor, type BootedHarness } from '../harness.ts'
import {
  assetIdOf, expectEachRequestExtendsThePrevious, recordIdOf, startScriptedModel, textOf, type ChatRequest,
  type ScriptedModel, type ScriptedRule, type ScriptedStep, type TurnView,
} from '../scripted-model.ts'

/** A 1×1 opaque PNG, the agent's product image. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** The start of every wake text (`wakeMessage` of `@dv/project`). */
const WAKE_TEXT = 'DreamVerse operations you started have finished'
/** The first line of every project update message. */
const UPDATE_HEAD = 'DreamVerse project updates since your last step:'

/** A render call of the agent's product image, as the second and later steps of a turn make it. */
function renderStep(prompt: string): (view: TurnView) => ScriptedStep {
  return view => ({ calls: [{ name: 'dv_shot_render', args: {
    reason: prompt, modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: `Picture 1 ${prompt}`,
    duration_sec: 1, inputs: { reference: assetIdOf(view.toolResults[0], 'asset') },
  } }] })
}

/** The import step that starts each turn of the stories. */
const importStep: ScriptedStep = {
  calls: [{ name: 'dv_asset_import', args: { reason: '产品图', base64: PNG_BASE64, mime: 'image/png', name: 'product.png' } }],
}

describe('a render that finishes while the agent is idle wakes it', () => {
  let harness: BootedHarness
  let model: ScriptedModel
  let browser: Browser
  let gate: Server
  let projectId = ''
  const records: Record<string, string[]> = { one: [], two: [] }
  /** The inbox (`next-step` or `next-turn`) of each wake that entered one, in report order. */
  const inserted: string[] = []
  /** The session ids of the reported `idle` statuses, in report order. */
  const idles: string[] = []

  const rules: ScriptedRule[] = [
    {
      match: '渲染一个镜头',
      steps: [
        importStep,
        renderStep('产品特写'),
        (view) => {
          records['one'] = [recordIdOf(view.toolResults[1])]
          return { text: '已开始渲染一个镜头。' }
        },
        { text: '一个镜头渲染好了。' },
      ],
    },
    {
      match: '渲染两个镜头',
      steps: [
        importStep,
        renderStep('产品特写'),
        renderStep('使用场景'),
        (view) => {
          records['two'] = [recordIdOf(view.toolResults[1]), recordIdOf(view.toolResults[2])]
          return { text: '已开始渲染两个镜头。' }
        },
        { text: '两个镜头渲染好了。' },
      ],
    },
  ]

  beforeAll(async () => {
    gate = createServer((request, response) => {
      void (async () => {
        let body = ''
        for await (const chunk of request) body += String(chunk)
        if (request.url === '/wake-inserted') inserted.push(body)
        if (request.url === '/idle') idles.push(body)
        response.end()
      })()
    })
    gate.listen(0, '127.0.0.1')
    await once(gate, 'listening')
    const { port } = gate.address() as AddressInfo
    model = await startScriptedModel(rules)
    harness = await bootHarness({ modelBaseUrl: model.baseURL, stepGate: { url: `http://127.0.0.1:${String(port)}`, holdText: 'never sent' } })
    const executablePath = process.env['DSH_PLAYWRIGHT_EXECUTABLE_PATH']
    browser = await playwright.chromium.launch(executablePath === undefined ? {} : { executablePath })
  }, 150_000)

  afterAll(async () => {
    await browser?.close().catch(() => undefined)
    await harness?.close()
    await model?.close()
    if (gate === undefined) return
    gate.closeAllConnections()
    await new Promise<void>((resolve) => { gate.close(() => { resolve() }) })
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

  /** Wait until every named record of the project is done. */
  async function done(ids: readonly string[]): Promise<void> {
    await waitFor(async () => {
      const history = await harness.api.post('/api/dv/history', { project: projectId, records: ids }) as {
        entries: Array<{ record: { status: string } }>
      }
      return history.entries.length === ids.length && history.entries.every(entry => entry.record.status === 'done')
    }, 'the renders', 60_000)
  }

  /** The session whose agent call started a record. */
  async function sessionOf(id: string): Promise<string> {
    const history = await harness.api.post('/api/dv/history', { project: projectId, records: [id] }) as {
      entries: Array<{ record: { session: string | null } }>
    }
    return history.entries[0]?.record.session ?? ''
  }

  /** Wait until the agent of a session has reported `count` idle statuses. */
  async function idled(session: string, count: number): Promise<void> {
    await waitFor(() => Promise.resolve(idles.filter(id => id === session).length >= count), 'the idle agent', 90_000)
  }

  /** The last user message of a request, as text. */
  function lastUserText(request: ChatRequest | undefined): string {
    return textOf(request?.messages.findLast(message => message.role === 'user')?.content)
  }

  it('opens one turn whose request ends with the project update of the render', async () => {
    const page = await openProject()
    harness.backend.hold()
    await chat(page, '渲染一个镜头', '已开始渲染一个镜头')
    // The first turn has ended before the render finishes, so the wake reaches an idle agent.
    const session = await sessionOf(records['one']?.[0] ?? '')
    await idled(session, 1)
    const before = model.requests.length
    const insertedFrom = inserted.length
    harness.backend.releaseAll()
    await done(records['one'] ?? [])
    await page.locator('[data-dv-chat]:visible').first().getByText('一个镜头渲染好了', { exact: false }).first().waitFor({ timeout: 90_000 })
    // The woken turn, the session's second, has ended, and its wake was the only one, queued for the next turn.
    await idled(session, 2)
    expect(inserted.slice(insertedFrom)).toEqual(['next-turn'])

    const requests = model.requests.slice(before - 3)
    expect(requests).toHaveLength(4)
    expectEachRequestExtendsThePrevious(requests)
    for (const request of requests) expect(JSON.stringify(request.messages)).not.toContain(WAKE_TEXT)
    const update = lastUserText(requests[3])
    expect(update.startsWith(UPDATE_HEAD)).toBe(true)
    expect(update).toMatch(new RegExp(`^- done ${records['one']?.[0] ?? ''} \\(your call\\): `, 'm'))
  })

  it('opens one turn for two renders when the second finishes after the first', async () => {
    const page = await openProject()
    harness.backend.hold()
    await chat(page, '渲染两个镜头', '已开始渲染两个镜头')
    const [first = '', second = ''] = records['two'] ?? []
    // The first turn has ended before either render finishes, so each wake reaches an idle agent.
    const session = await sessionOf(first)
    await idled(session, 1)
    const before = model.requests.length
    const insertedFrom = inserted.length
    harness.backend.release()
    await done([first])
    // The first finish waits for the second render, which still runs: its wake waits for the next step, opening no turn.
    await waitFor(() => Promise.resolve(inserted.length > insertedFrom), 'the first wake', 30_000)
    expect(inserted.slice(insertedFrom)).toEqual(['next-step'])
    expect(model.requests).toHaveLength(before)
    harness.backend.releaseAll()
    await done([second])
    await page.locator('[data-dv-chat]:visible').first().getByText('两个镜头渲染好了', { exact: false }).first().waitFor({ timeout: 90_000 })
    await idled(session, 2)
    expect(inserted.slice(insertedFrom)).toEqual(['next-step', 'next-turn'])

    const requests = model.requests.slice(before - 4)
    expect(requests).toHaveLength(5)
    expectEachRequestExtendsThePrevious(requests)
    for (const request of requests) expect(JSON.stringify(request.messages)).not.toContain(WAKE_TEXT)
    const update = lastUserText(requests[4])
    expect(update.startsWith(UPDATE_HEAD)).toBe(true)
    expect(update).toMatch(new RegExp(`^- done ${first} \\(your call\\): `, 'm'))
    expect(update).toMatch(new RegExp(`^- done ${second} \\(your call\\): `, 'm'))
  })
})
