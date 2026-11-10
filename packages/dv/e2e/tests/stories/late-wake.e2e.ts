// Late wake: the shipped video-harness profile, plus `tests/step-gate-plugin.ts`, drives a scripted agent whose render
// finishes while the first step of the next turn is held between claiming the user's message and the project update.
// The project update of that step reports the finish, and the wake that the record notices injected during the hold
// reaches the step after the model ended the turn. That step has nothing to report, so the agent loop ends the turn
// without a model request.
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootHarness, playwright, waitFor, type BootedHarness } from '../harness.ts'
import {
  assetIdOf, expectEachRequestExtendsThePrevious, recordIdOf, startScriptedModel, textOf, type ScriptedModel,
  type ScriptedRule,
} from '../scripted-model.ts'

/** A 1×1 opaque PNG, the agent's product image. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** The user message whose first step the step gate holds. */
const HOLD_TEXT = '渲染好了吗'
/** The start of every wake text (`wakeMessage` of `@dv/project`). */
const WAKE_TEXT = 'DreamVerse operations you started have finished'

describe('a late wake with nothing left to report sends no model request', () => {
  let harness: BootedHarness
  let model: ScriptedModel
  let browser: Browser
  let gate: Server
  let projectId = ''
  let record = ''
  let wakes = 0
  /** The session ids of the reported `idle` statuses, in report order. */
  const idles: string[] = []

  const rules: ScriptedRule[] = [
    {
      match: '渲染一个镜头',
      steps: [
        { calls: [{ name: 'dv_asset_import', args: { reason: '产品图', base64: PNG_BASE64, mime: 'image/png', name: 'product.png' } }] },
        view => ({ calls: [{ name: 'dv_shot_render', args: {
          reason: '镜头1', modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'Picture 1 产品特写',
          duration_sec: 1, inputs: { reference: assetIdOf(view.toolResults[0], 'asset') },
        } }] }),
        (view) => {
          record = recordIdOf(view.toolResults[1])
          return { text: '已开始渲染。' }
        },
      ],
    },
    { match: HOLD_TEXT, steps: [{ text: '看到结果了。' }] },
  ]

  beforeAll(async () => {
    // The step gate's test server: `/hold` answers once the render has finished, `/wake` counts claimed wakes, `/idle`
    // records the session of each idle agent.
    gate = createServer((request, response) => {
      void (async () => {
        let body = ''
        for await (const chunk of request) body += String(chunk)
        if (request.url === '/idle') {
          idles.push(body)
        } else if (request.url === '/hold') {
          harness.backend.releaseAll()
          await waitFor(async () => {
            const history = await harness.api.post('/api/dv/history', { project: projectId, records: [record] }) as {
              entries: Array<{ record: { status: string } }>
            }
            return history.entries[0]?.record.status === 'done'
          }, 'the render', 60_000)
        } else if (request.url === '/wake') {
          wakes += 1
        }
        response.end()
      })()
    })
    gate.listen(0, '127.0.0.1')
    await once(gate, 'listening')
    const { port } = gate.address() as AddressInfo
    model = await startScriptedModel(rules)
    harness = await bootHarness({ modelBaseUrl: model.baseURL, stepGate: { url: `http://127.0.0.1:${String(port)}`, holdText: HOLD_TEXT } })
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

  /** Type a chat message into the composer and send it. */
  async function send(page: Page, text: string): Promise<void> {
    const composer = page.locator('[data-dv-chat]:visible [contenteditable="true"]:visible').first()
    await composer.waitFor({ timeout: 30_000 })
    await composer.click()
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
  }

  it('reports the finish once in the project update and ends the turn at the late wake', async () => {
    const page = await openProject()
    harness.backend.hold()
    await send(page, '渲染一个镜头')
    await page.locator('[data-dv-chat]:visible').first().getByText('已开始渲染', { exact: false }).first().waitFor({ timeout: 90_000 })
    expect(model.requests).toHaveLength(3)
    await send(page, HOLD_TEXT)
    // The wake is claimed by the step after the reply of the held step, and the turn ends at that step.
    await waitFor(() => Promise.resolve(wakes === 1), 'the claimed wake', 30_000)
    const history = await harness.api.post('/api/dv/history', { project: projectId, records: [record] }) as {
      entries: Array<{ record: { session: string | null } }>
    }
    const session = history.entries[0]?.record.session ?? ''
    await waitFor(() => Promise.resolve(idles.filter(id => id === session).length === 2), 'the end of the second turn', 30_000)

    const requests = model.requests
    expect(requests).toHaveLength(4)
    expectEachRequestExtendsThePrevious(requests)
    for (const request of requests) expect(JSON.stringify(request.messages)).not.toContain(WAKE_TEXT)
    const userTexts = requests[3]?.messages.filter(message => message.role === 'user').map(message => textOf(message.content)) ?? []
    const finishLine = new RegExp(`^- done ${record} \\(your call\\): `, 'gm')
    expect(userTexts.join('\n').match(finishLine)).toHaveLength(1)
    expect(userTexts.at(-1)).toMatch(/^DreamVerse project updates since your last step:/)
  })
})
