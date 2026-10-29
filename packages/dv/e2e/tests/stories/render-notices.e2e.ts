// Render notices: the shipped video-harness profile (`dsh web`, the fake video backend, a scripted model). The agent
// approves a one-shot plan and ends its turn while the render is held; the user chats once more and the agent answers
// while the render still runs; the render then finishes, and the idle agent is woken with the project update, reads the
// project, and reports the result. Every agent request extends the one before it.
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootHarness, playwright, waitFor, waitForRecords, type BootedHarness } from '../harness.ts'
import {
  UPDATE_HEAD, assetIdOf, expectEachRequestExtendsThePrevious, scheduledOf, startScriptedModel, textOf, type ChatRequest,
  type ScriptedModel, type ScriptedRule,
} from '../scripted-model.ts'

/** A 1×1 opaque PNG, the agent's product image. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

describe('finished renders reach the agent without being asked', () => {
  let harness: BootedHarness
  let model: ScriptedModel
  let browser: Browser
  let projectId = ''
  let scheduled: string[] = []

  const rules: ScriptedRule[] = [
    { match: /只回复\S+/, steps: [view => ({ text: `收到${/只回复(\S+)/.exec(view.userText)?.[1] ?? ''}` })] },
    {
      match: /^DreamVerse project updates since your last step:/,
      steps: [
        async () => {
          await waitForRecords(harness.api, projectId, scheduled)
          return { calls: [{ name: 'dv_proj_state', args: {} }] }
        },
        view => ({ text: `镜头已渲染完成：${/- video: ([0-9a-f]{16,})/.exec(view.userText)?.[1] ?? '没有视频'}` }),
      ],
    },
    {
      match: '渲染一个镜头',
      steps: [
        { calls: [{ name: 'dv_asset_import', args: { reason: '产品图', base64: PNG_BASE64, mime: 'image/png', name: 'cup.png' } }] },
        view => ({ calls: [{ name: 'dv_plan_create', args: {
          reason: '规划', title: '杯子', references: [assetIdOf(view.toolResults[0], 'asset')],
          shots: [{ prompt: 'Picture 1 红色杯子旋转', duration_sec: 1, modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3' }],
        } }] }),
        { calls: [{ name: 'dv_story_preview', args: { reason: '预览计划', plan: 'p1' } }] },
        { calls: [{ name: 'dv_story_approve', args: { reason: '用户同意', plan: 'p1', user_approved: true } }] },
        (view) => {
          scheduled = scheduledOf(view.toolResults.at(-1))
          return { text: '镜头正在后台渲染。' }
        },
      ],
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

  /** Wait until the chat shows the text. */
  async function waitChat(page: Page, text: string): Promise<void> {
    await page.locator('[data-dv-chat]:visible').first().getByText(text, { exact: false }).first().waitFor({ timeout: 90_000 })
  }

  /** Send a chat message and wait until the chat shows the reply. */
  async function chat(page: Page, text: string, reply: string): Promise<void> {
    const composer = page.locator('[data-dv-chat]:visible [contenteditable="true"]:visible').first()
    await composer.waitFor({ timeout: 30_000 })
    await composer.click()
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
    await waitChat(page, reply)
  }

  /** The statuses of the scheduled renders. */
  async function renderStatuses(): Promise<string[]> {
    const history = await harness.api.post('/api/dv/history', { project: projectId, records: scheduled }) as {
      entries: Array<{ record: { operation: string; status: string } }>
    }
    return history.entries.filter(entry => entry.record.operation === 'shot.render').map(entry => entry.record.status)
  }

  it('wakes the idle agent with the update after it ended its turn and answered another message while the render ran', async () => {
    const page = await openProject()
    harness.backend.hold()
    await chat(page, '渲染一个镜头', '镜头正在后台渲染')
    expect(await renderStatuses()).toEqual(['running'])
    await chat(page, '只回复十', '收到十')
    expect(await renderStatuses()).toEqual(['running'])
    const answered = model.requests.length
    harness.backend.releaseAll()
    await waitChat(page, '镜头已渲染完成')

    const requests = model.requests
    expectEachRequestExtendsThePrevious(requests)
    // The finished render opened a turn: its first request ends with the update right after the agent's last reply.
    const woken = (requests[answered] as ChatRequest).messages
    const at = woken.findLastIndex(message => message.role === 'user' && textOf(message.content).startsWith(UPDATE_HEAD))
    expect([woken[at - 1]?.role, textOf(woken[at - 1]?.content)]).toEqual(['assistant', '收到十'])
    const update = textOf(woken[at]?.content)
    expect(update).toMatch(/^- done \S+ \(scheduled\): .*\n {2}- video: [0-9a-f]{16,} \(video\/mp4\) /m)
    // The agent processed the update: its reply names the rendered video.
    expect(await page.locator('[data-dv-chat]:visible').first().getByText(/镜头已渲染完成：[0-9a-f]{16,}/).count()).toBe(1)
    // Each scheduled record is reported once, and the render wake itself never reached a request.
    const last = (requests.at(-1) as ChatRequest).messages.map(message => textOf(message.content)).join('\n')
    for (const record of scheduled) expect(last.match(new RegExp(`^- (done|failed|cancelled) ${record} `, 'gm')), record).toHaveLength(1)
    expect(last).not.toContain('DreamVerse operations you started')
  })
})
