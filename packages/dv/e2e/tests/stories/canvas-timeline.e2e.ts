// User stories of the canvas (画布) and the timeline editor (时间线), walked in Chromium against the shipped profile with a
// fake video backend that renders playable VP9 videos and a scripted agent model. Projects are seeded through the
// `/api/dv` routes, so each story starts from takes and several timelines without waiting for an agent. Every story
// asserts what the creator must see after the action; a story whose expected behavior is not built yet fails.
import type { Browser, BrowserContext, Locator, Page } from 'playwright'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { placedAssets, type ProjectRecord, type WireState } from '../wire-state.ts'
import { bootHarness, escapeRegExp, playwright, waitFor, type BootedHarness } from '../harness.ts'
import { startScriptedModel, type ScriptedModel } from '../scripted-model.ts'

/** A 2×2 PNG with other bytes than {@link PNG_BASE64}, so its import is a new asset. */
const OTHER_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEIGBkZGBgYAAAhGQIBk6M1bQAAAABJRU5ErkJggg=='

/** A 1×1 opaque PNG. */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** The prompt field of the `dv.prompt` composer in the open node editor. */
const EDITOR_PROMPT = '[data-testid="dv-canvas-node-editor"] [data-dv-prompt] [contenteditable="true"]'

/** The Shot render operation of every seeded shot; the e2e profile serves fasth3 for task ref2v only. */
const RENDER_OPERATION = 'shot.render'

/**
 * The minimum frame height of each window node type that the resize story puts on the canvas: a text card's one line
 * and footer, and a reference card of one reference at 4:3 of its 104-unit minimum width above its footer.
 */
const WINDOW_MIN_HEIGHTS: Readonly<Record<string, number>> = { character: 110, location: 110, style: 110, text: 58 }

/** A seeded project: its ID, the rendered take assets in shot order (the clips of timeline t1), and the shot records. */
interface Seeded { id: string; clipAssets: string[]; shots: string[] }

let harness: BootedHarness
let model: ScriptedModel
let browser: Browser
const contexts: BrowserContext[] = []

/**
 * Run one operation as a user action through `/api/dv/operation`.
 * @param project - the project.
 * @param operation - the operation name.
 * @param params - the operation params.
 * @param inputs - the input references.
 * @returns the record.
 */
async function runOperation(
  project: string,
  operation: string,
  params: Record<string, unknown>,
  inputs: Array<{ role: string; ref: string }> = [],
): Promise<ProjectRecord> {
  return await harness.api.post('/api/dv/operation', { project, operation, params, inputs, surface: 'canvas', intent: `seed: ${operation}` }) as ProjectRecord
}

/** @returns the project's current state. */
async function stateOf(project: string): Promise<WireState> {
  return await harness.api.get(`/api/dv/state?project=${project}`) as WireState
}

/**
 * The clip ID at a position of a project's first timeline on `main`, which the clip operations take in `clip`.
 * @param project - the project.
 * @param position - the 1-based position.
 * @returns the clip ID.
 */
async function clipAt(project: string, position: number): Promise<string> {
  const clip = (await stateOf(project)).components.timeline.timelines[0]?.clips[position - 1]
  if (clip === undefined) throw new Error(`timeline t1 of ${project} has no clip at position ${String(position)}`)
  return clip.id
}

/**
 * Seed a project: an imported reference, a character, takes of shots that last 1 s, 2 s, 1 s, … rendered from the
 * character, timeline t1 holding the takes in shot order, and extra timelines made of the first clips.
 * @param title - the project title.
 * @param shots - how many shots to render.
 * @param timelines - for each extra timeline (t2, t3, …, created without a name), how many clips it starts with.
 * @returns the project, its clip assets, and its shot records.
 */
async function seedProject(title: string, shots = 3, timelines: number[] = []): Promise<Seeded> {
  const created = await harness.api.post('/api/dv/projects', { title, surface: 'canvas' }) as { id: string }
  const id = created.id
  const imported = await runOperation(id, 'asset.import', { base64: PNG_BASE64, mime: 'image/png', name: 'ref.png' })
  await runOperation(id, 'character.create', { character: 'c1', name: 'Dancer' }, [{ role: 'reference', ref: imported.outputs[0] ?? '' }])
  const renders: ProjectRecord[] = []
  for (let index = 0; index < shots; index += 1) {
    renders.push(await runOperation(id, RENDER_OPERATION, {
      modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: `${title} shot ${String(index + 1)}`, duration_sec: 1 + (index % 2),
    }, [{ role: 'reference', ref: 'c1@1' }]))
  }
  const clipAssets = renders.map(render => render.outputs[0] ?? '')
  await runOperation(id, 'timeline.create', { timeline: 't1', assets: clipAssets })
  for (const [index, count] of timelines.entries()) {
    await runOperation(id, 'timeline.create', { timeline: `t${String(index + 2)}`, assets: clipAssets.slice(0, count) })
  }
  return { id, clipAssets, shots: renders.map(render => render.id) }
}

/**
 * Open a fresh browser page with the session cookie, recording console errors and uncaught exceptions.
 * @param options - the browser language and color scheme.
 * @returns the page; `errors` collects the messages.
 */
async function openPage(options: { lang?: string; scheme?: 'light' | 'dark' } = {}): Promise<Page & { errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: options.lang ?? 'zh-CN', colorScheme: options.scheme ?? 'light' })
  contexts.push(context)
  context.setDefaultTimeout(10_000)
  const page = await context.newPage() as Page & { errors: string[] }
  page.errors = []
  page.on('console', (message) => { if (message.type() === 'error') page.errors.push(message.text()) })
  page.on('pageerror', (error) => { page.errors.push(`pageerror: ${error.message}`) })
  await page.goto(harness.tokenUrl, { waitUntil: 'load' })
  // A fresh browser profile first shows DSH's one-time beta notice (内测声明) over the whole page.
  const notice = page.getByRole('button', { name: /^(继续|Continue)$/ })
  await notice.waitFor({ timeout: 2500 }).then(() => notice.click(), () => undefined)
  return page
}

/**
 * Load a project location the way a shared link or a reload does, and wait until the center shows that project. A
 * fresh browser can land on the project of DSH's last session instead of the linked one, a defect that the navigation
 * stories pin; the story then opens the project from the session switcher, so canvas and timeline stories do not depend on it.
 * @param page - the page.
 * @param project - the project.
 * @param view - the center view.
 */
async function gotoProject(page: Page, project: string, view: 'canvas' | 'timeline' = 'canvas'): Promise<void> {
  const projects = await harness.api.get('/api/dv/projects') as Array<{ id: string; title: string }>
  const title = projects.find(entry => entry.id === project)?.title ?? project
  await page.goto(`${harness.origin}/#project=${project}${view === 'timeline' ? '&view=timeline' : ''}`)
  await page.reload({ waitUntil: 'load' })
  const crumb = page.locator('[data-dv-workspace] header').first()
  const settled = async (): Promise<boolean> => {
    // The center keeps the project for two consecutive reads 750 ms apart.
    const first = await crumb.textContent({ timeout: 1000 }).catch(() => '')
    await page.waitForTimeout(750)
    const second = await crumb.textContent({ timeout: 1000 }).catch(() => '')
    return (first ?? '').startsWith(title) && (second ?? '').startsWith(title)
  }
  if (!await settled()) {
    await openProjectByTitle(page, title)
    await expect.poll(settled, { timeout: 15_000 }).toBe(true)
    if (view === 'timeline') await viewToggle(page, '时间线').or(viewToggle(page, 'Timeline')).first().click()
  }
  if (view === 'canvas') await page.locator('[data-testid="dv-canvas-view"]').waitFor({ timeout: 30_000 })
  else await page.locator('[data-testid="dv-timeline-editor"]').waitFor({ timeout: 30_000 })
}

/**
 * Open a project by its title the way a creator does: from the 其他项目 list of the session switcher menu in the
 * workspace top bar, because an open project collapses the left sidebar, or from the navigator on the entry page.
 * @param page - the page.
 * @param title - the project title.
 */
async function openProjectByTitle(page: Page, title: string): Promise<void> {
  const switcher = page.locator('[data-dv-workspace] header button[aria-haspopup="menu"]')
  if (await switcher.count() === 0) {
    await page.locator('nav, aside, body').getByText(title, { exact: true }).first().click()
    return
  }
  await switcher.click()
  // The menu lists the open project under its own heading and every other project under 其他项目; when the page
  // settled on the wanted project meanwhile, the menu only needs closing.
  const menu = page.getByRole('menu')
  const other = menu.getByRole('menuitem', { name: title, exact: true })
  const open = menu.getByText(new RegExp(`^${escapeRegExp(title)} · (会话|Chats)$`))
  await expect.poll(async () => await other.count() + await open.count()).toBeGreaterThan(0)
  if (await other.count() > 0) await other.click()
  else await page.keyboard.press('Escape')
}

/** The 画布 | 时间线 toggle button in the workspace top bar. */
function viewToggle(page: Page, name: string): Locator {
  return page.locator('[data-dv-workspace] header [role="tab"]', { hasText: name })
}

/** One timeline tab of the timeline editor. */
function timelineTab(page: Page, name: string): Locator {
  return page.locator('[data-testid="dv-timeline-editor"] [role="tab"]', { hasText: name })
}

/** @returns the timeline tab labels, the selected one marked with `*`. */
async function timelineTabs(page: Page): Promise<string[]> {
  return await page.locator('[data-testid="dv-timeline-editor"] [role="tab"]').evaluateAll(tabs => tabs.map(tab => `${tab.textContent ?? ''}${tab.getAttribute('aria-selected') === 'true' ? '*' : ''}`))
}

/** @returns the timeline time label, such as `0:01.5 / 0:04.0`, as two numbers in seconds. */
async function timelineTime(page: Page): Promise<[number, number]> {
  const text = await page.locator('[data-testid="dv-timeline-time"]').textContent() ?? ''
  const seconds = (part: string): number => { const [m, s] = part.trim().split(':'); return Number(m) * 60 + Number(s) }
  const [position = '0:0', total = '0:0'] = text.split('/')
  return [seconds(position), seconds(total)]
}

/** @returns the asset ID the visible timeline viewer element shows, or null. */
async function viewerAsset(page: Page): Promise<string | null> {
  return await page.locator('[data-testid="dv-timeline-viewer"] video').evaluateAll((videos) => {
    const shown = videos.find(video => (video as HTMLVideoElement).style.visibility !== 'hidden')
    return /\/dv\/assets\/([0-9a-f]+)/.exec(shown?.getAttribute('src') ?? '')?.[1] ?? null
  })
}

/** @returns the positions of the clips on V1 in track order, the selected one marked with `*`. */
async function trackClips(page: Page): Promise<string[]> {
  return await page.locator('[data-clip-position]').evaluateAll(clips => clips.map(clip => `${(clip as HTMLElement).dataset['clipPosition'] ?? ''}${clip.getAttribute('aria-pressed') === 'true' ? '*' : ''}`))
}

/** @returns the clip IDs on V1 in track order, as the page renders them. */
async function trackClipIds(page: Page): Promise<string[]> {
  return await page.locator('[data-clip-position]').evaluateAll(clips => clips.map(clip => clip.getAttribute('data-clip') ?? ''))
}

/** @returns the pixels per second of the timeline zoom slider. */
async function pxPerSecond(page: Page): Promise<number> {
  return Number(await page.locator('[data-testid="dv-timeline-editor"] input[type="range"]').inputValue())
}

/** @returns the clips of one timeline as `assetId[in-out]` strings in playback order. */
async function timelineClips(project: string, timelineId = 't1'): Promise<string[]> {
  const timeline = (await stateOf(project)).components.timeline.timelines.find(entry => entry.id === timelineId)
  return (timeline?.clips ?? []).map(clip => `${(clip.asset ?? 'pending').slice(0, 8)}[${String(clip.in_sec ?? '')}-${String(clip.out_sec ?? '')}]`)
}

/** Click 适应 on the canvas zoom control. */
async function fitCanvas(page: Page): Promise<void> {
  await page.locator('[data-testid="dv-canvas-view"] button', { hasText: /^(适应|Fit)$/ }).click()
  await page.waitForTimeout(300)
}

/** The relative luminance of a CSS `rgb()` color, 0 (black) to 1 (white). */
function luminance(color: string): number {
  const [r = 0, g = 0, b = 0] = color.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number) ?? []
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** @returns the first opaque background color from an element up to the document root. */
async function backgroundOf(locator: Locator): Promise<string> {
  return await locator.evaluate((element) => {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor
      if (color !== '' && color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color)) return color
    }
    return 'rgb(255, 255, 255)'
  })
}

/** Open the 素材库 tab of the right panel and wait for the asset tiles. */
async function openAssets(page: Page): Promise<void> {
  await page.getByText(/^(素材库|Asset pool)$/).first().click()
  await page.locator('[data-asset-id]').first().waitFor({ timeout: 15_000 })
}

/** @returns pairs of canvas nodes whose boxes overlap on screen. */
async function overlappingNodes(page: Page): Promise<string[]> {
  return await page.locator('[data-node-id]').evaluateAll((nodes) => {
    const boxes = nodes.map(node => ({ id: node.getAttribute('aria-label') ?? '', box: node.getBoundingClientRect() }))
    const pairs: string[] = []
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]?.box
        const b = boxes[j]?.box
        if (a !== undefined && b !== undefined && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) pairs.push(`${boxes[i]?.id ?? ''} × ${boxes[j]?.id ?? ''}`)
      }
    }
    return pairs
  })
}

beforeAll(async () => {
  model = await startScriptedModel()
  harness = await bootHarness({ modelBaseUrl: model.baseURL, playableVideos: true })
  const executablePath = process.env['DSH_PLAYWRIGHT_EXECUTABLE_PATH']
  browser = await playwright.chromium.launch(executablePath === undefined ? {} : { executablePath })
}, 150_000)

// Each story's pages close before the next story, so no playing video or open stream outlives its story.
afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close().catch(() => undefined)
})

afterAll(async () => {
  await browser?.close().catch(() => undefined)
  await harness?.close()
  await model?.close()
})

describe('canvas stories', () => {
  it('fit shows every node; pan, zoom, and a dragged node are restored after a reload', async () => {
    const project = await seedProject('canvas-layout')
    const page = await openPage()
    await gotoProject(page, project.id)
    await page.locator('[data-node-id]').first().waitFor()
    await fitCanvas(page)
    // After 适配 every node lies inside the visible canvas.
    const outside = await page.locator('[data-testid="dv-canvas-view"]').evaluate((canvas) => {
      const frame = canvas.getBoundingClientRect()
      return [...canvas.querySelectorAll('[data-node-id]')].filter((node) => {
        const box = node.getBoundingClientRect()
        return box.left < frame.left || box.right > frame.right || box.top < frame.top || box.bottom > frame.bottom
      }).map(node => node.getAttribute('aria-label'))
    })
    expect(outside).toEqual([])
    const take = page.locator('[data-node-type="shot"]').first()
    const id = await take.getAttribute('data-node-id') ?? ''
    const before = await take.boundingBox()
    if (before === null) throw new Error('take node has no box')
    await page.mouse.move(before.x + 40, before.y + 40)
    await page.mouse.down()
    await page.mouse.move(before.x + 160, before.y + 90, { steps: 8 })
    await page.mouse.up()
    // A drag moves the node and does not open its editor.
    expect(await page.locator('[data-testid="dv-canvas-node-editor"]').count()).toBe(0)
    const frame = await page.locator('[data-testid="dv-canvas-view"]').boundingBox()
    if (frame === null) throw new Error('canvas has no box')
    await page.mouse.move(frame.x + 30, frame.y + frame.height - 120)
    await page.mouse.down()
    await page.mouse.move(frame.x + 90, frame.y + frame.height - 160, { steps: 5 })
    await page.mouse.up()
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2)
    await page.mouse.wheel(0, -200)
    await page.waitForTimeout(1200)
    const node = page.locator(`[data-node-id="${id}"]`)
    const placed = {
      left: await node.evaluate(el => (el as HTMLElement).style.left),
      top: await node.evaluate(el => (el as HTMLElement).style.top),
    }
    const transform = await page.locator('[data-testid="dv-canvas-view"] > div[style*="transform"]').evaluate(el => (el as HTMLElement).style.transform)
    await page.reload({ waitUntil: 'load' })
    await page.locator(`[data-node-id="${id}"]`).waitFor({ timeout: 30_000 })
    await page.waitForTimeout(500)
    expect({
      left: await node.evaluate(el => (el as HTMLElement).style.left),
      top: await node.evaluate(el => (el as HTMLElement).style.top),
    }).toEqual(placed)
    expect(await page.locator('[data-testid="dv-canvas-view"] > div[style*="transform"]').evaluate(el => (el as HTMLElement).style.transform)).toBe(transform)
    expect(page.errors).toEqual([])
  })

  it('double-clicking a node opens the floating editor; ✕ and Escape close it', async () => {
    const project = await seedProject('canvas-editor')
    const page = await openPage()
    await gotoProject(page, project.id)
    const editor = page.locator('[data-testid="dv-canvas-node-editor"]')
    await page.locator('[data-node-type="shot"]').first().dblclick()
    await expect.poll(() => editor.count()).toBe(1)
    // The take editor names the model and task of the take's record.
    expect(await editor.locator('[data-testid="dv-canvas-render-mode"]').textContent()).toBe('fasth3 · 参考图生成')
    await editor.getByRole('button', { name: '关闭' }).click()
    await expect.poll(() => editor.count()).toBe(0)
    await page.locator('[data-node-type="shot"]').first().dblclick()
    await page.locator(EDITOR_PROMPT).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => editor.count()).toBe(0)
    // Escape also closes the editor when focus left it, for example after clicking the editor's video.
    await page.locator('[data-node-type="shot"]').first().dblclick()
    await expect.poll(() => editor.count()).toBe(1)
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
    await page.keyboard.press('Escape')
    await expect.poll(() => editor.count()).toBe(0)
  })

  it('clicking empty canvas closes the floating editor', async () => {
    const project = await seedProject('canvas-editor-bg')
    const page = await openPage()
    await gotoProject(page, project.id)
    await fitCanvas(page)
    await page.locator('[data-node-type="character"]').first().dblclick()
    const editor = page.locator('[data-testid="dv-canvas-node-editor"]')
    await expect.poll(() => editor.count()).toBe(1)
    const frame = await page.locator('[data-testid="dv-canvas-view"]').boundingBox()
    if (frame === null) throw new Error('canvas has no box')
    // The bottom-right corner of the canvas holds no node, no editor, and no toolbar.
    await page.mouse.click(frame.x + frame.width - 20, frame.y + frame.height - 20)
    await expect.poll(() => editor.count(), { timeout: 2000 }).toBe(0)
  })

  it('switching to the timeline and back, or to another project, leaves no editor behind', async () => {
    const first = await seedProject('canvas-leave-a')
    const second = await seedProject('canvas-leave-b', 2)
    const page = await openPage()
    await gotoProject(page, first.id)
    const editor = page.locator('[data-testid="dv-canvas-node-editor"]')
    await page.locator('[data-node-type="shot"]').first().dblclick()
    await expect.poll(() => editor.count()).toBe(1)
    await viewToggle(page, '时间线').click()
    await page.locator('[data-testid="dv-timeline-editor"]').waitFor()
    expect(await editor.count()).toBe(0)
    await viewToggle(page, '画布').click()
    await page.locator('[data-node-id]').first().waitFor()
    expect(await editor.count()).toBe(0)
    await page.locator('[data-node-type="shot"]').first().dblclick()
    await expect.poll(() => editor.count()).toBe(1)
    await openProjectByTitle(page, 'canvas-leave-b')
    await expect.poll(() => page.locator('[data-dv-workspace] header').first().textContent()).toContain('canvas-leave-b')
    expect(await editor.count()).toBe(0)
    expect(page.url()).toContain(second.id)
  })

  it('the take editor plays the take', async () => {
    const project = await seedProject('canvas-play', 2)
    const page = await openPage()
    await gotoProject(page, project.id)
    await page.locator('[data-node-type="shot"]').first().dblclick()
    const video = page.locator('[data-testid="dv-canvas-node-editor"] video')
    await video.waitFor()
    await expect.poll(
      () => video.evaluate(el => ({ error: (el as HTMLVideoElement).error?.code ?? 0, moving: (el as HTMLVideoElement).currentTime > 0 })),
      { timeout: 10_000 },
    )
      .toEqual({ error: 0, moving: true })
  })

  it('渲染新版本 adds a version to the same node: the card shows v2 with version frames behind it, and the editor lists both versions', async () => {
    const project = await seedProject('canvas-take', 2)
    const page = await openPage()
    await gotoProject(page, project.id)
    const takes = page.locator('[data-node-type="shot"]')
    await expect.poll(() => takes.count()).toBe(2)
    const original = await takes.first().getAttribute('data-node-id') ?? ''
    const node = page.locator(`[data-testid="dv-canvas-view"] [data-node-id="${original}"]`)
    expect(await node.locator('[data-node-version-frame]').count(), 'a node of one version has no version frames').toBe(0)
    await node.dblclick()
    const editor = page.locator('[data-testid="dv-canvas-node-editor"]')
    expect(await editor.locator('[data-testid="dv-canvas-version-strip"]').count(), 'a node of one version has no version strip').toBe(0)
    await page.locator(EDITOR_PROMPT).fill('canvas-take shot 1, take two')
    const requests = harness.backend.requests.length
    await page.getByRole('button', { name: '渲染新版本' }).click()
    await expect.poll(() => editor.count()).toBe(0)
    await expect.poll(() => harness.backend.requests.length, { timeout: 30_000 }).toBe(requests + 1)
    const retake = await waitFor(async () => {
      const latest = (await stateOf(project.id)).components.proj.records.filter(record => record.operation === RENDER_OPERATION).at(-1)
      return latest?.status === 'done' && latest.based_on === original ? latest : null
    }, 'the new version renders')
    // The new version joins the original node: no new node, and the card shows the newest version.
    expect((await stateOf(project.id)).components.canvas.nodes[original]?.versions).toEqual([original, retake.id])
    expect(await takes.count()).toBe(2)
    await expect.poll(() => node.locator('span', { hasText: /^v2( · |$)/ }).count(), { timeout: 15_000 }).toBe(1)
    expect(await node.locator('[data-node-version-frame]').count()).toBe(2)
    await node.dblclick()
    const strip = editor.locator('[data-testid="dv-canvas-version-strip"]')
    await strip.waitFor()
    expect(await strip.locator('[data-version]').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-version')))).toEqual([original, retake.id])
    expect(await strip.textContent()).toContain('第 2 / 2 版')
    await strip.locator(`[data-version="${original}"]`).click()
    await expect.poll(() => strip.textContent()).toContain('第 1 / 2 版')
    expect(page.errors).toEqual([])
  })

  it('问 agent prefills the chat with a reference to the node and closes the editor', async () => {
    const project = await seedProject('canvas-ask', 2)
    const page = await openPage()
    await gotoProject(page, project.id)
    const node = page.locator('[data-node-type="shot"]').first()
    const title = await node.getAttribute('aria-label') ?? ''
    expect(title).not.toBe('')
    await node.dblclick()
    await page.getByRole('button', { name: '问 agent' }).click()
    await expect.poll(() => page.locator('[data-testid="dv-canvas-node-editor"]').count()).toBe(0)
    // The reference names the node by the title its card shows.
    await expect.poll(() => page.locator('[data-dv-chat] [contenteditable="true"]').first().innerText(), { timeout: 10_000 }).toContain(title)
  })

  it('the canvas follows the light and the dark theme', async () => {
    const project = await seedProject('canvas-theme', 2)
    const light = await openPage({ scheme: 'light' })
    await gotoProject(light, project.id)
    expect(luminance(await backgroundOf(light.locator('[data-testid="dv-canvas-view"]')))).toBeGreaterThan(0.8)
    expect(luminance(await backgroundOf(light.locator('[data-node-type="shot"]').first()))).toBeGreaterThan(0.8)
    const dark = await openPage({ scheme: 'dark' })
    await gotoProject(dark, project.id)
    expect(luminance(await backgroundOf(dark.locator('[data-testid="dv-canvas-view"]')))).toBeLessThan(0.25)
    expect(luminance(await backgroundOf(dark.locator('[data-node-type="shot"]').first()))).toBeLessThan(0.3)
  })

  it('at fit zoom node text is readable and cards do not overlap, also after a trim badge', async () => {
    const project = await seedProject('canvas-readable', 3)
    // A split marks clip 2 as trimmed, which adds a badge row to its card.
    await runOperation(project.id, 'timeline.clip_split', { clip: await clipAt(project.id, 2), at_sec: 0.5 })
    const page = await openPage()
    await gotoProject(page, project.id)
    await fitCanvas(page)
    // The smallest line box among the card elements that hold text directly: titles, type labels, durations, and badges.
    const smallest = await page.locator('[data-node-id]').evaluateAll(nodes => Math.min(...nodes.flatMap(node => [...node.querySelectorAll('*')]
      .filter(element => [...element.childNodes].some(child => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() !== ''))
      .map(element => element.getBoundingClientRect().height))))
    expect(smallest).toBeGreaterThanOrEqual(12)
    expect(await overlappingNodes(page)).toEqual([])
  })

  it('the first visit shows every node without pressing 适配, after the right panel opened', async () => {
    const project = await seedProject('canvas-first-fit', 3)
    const page = await openPage()
    await gotoProject(page, project.id)
    await page.locator('[data-node-id]').first().waitFor()
    await page.waitForTimeout(2000)
    const outside = await page.locator('[data-testid="dv-canvas-view"]').evaluate((canvas) => {
      const frame = canvas.getBoundingClientRect()
      return [...canvas.querySelectorAll('[data-node-id]')].filter((node) => {
        const box = node.getBoundingClientRect()
        return box.left < frame.left || box.right > frame.right || box.top < frame.top || box.bottom > frame.bottom
      }).map(node => node.getAttribute('aria-label'))
    })
    expect(outside).toEqual([])
  })

  it('a 22-shot project fits on screen without overlapping cards', async () => {
    const project = await seedProject('canvas-many', 22)
    const page = await openPage()
    await gotoProject(page, project.id)
    await expect.poll(() => page.locator('[data-node-type="shot"]').count(), { timeout: 30_000 }).toBe(22)
    await fitCanvas(page)
    expect(await overlappingNodes(page)).toEqual([])
    const outside = await page.locator('[data-testid="dv-canvas-view"]').evaluate((canvas) => {
      const frame = canvas.getBoundingClientRect()
      return [...canvas.querySelectorAll('[data-node-id]')].filter((node) => {
        const box = node.getBoundingClientRect()
        return box.left < frame.left || box.right > frame.right || box.top < frame.top || box.bottom > frame.bottom
      }).length
    })
    expect(outside).toBe(0)
  })

  it('an empty project shows the empty-canvas hint and no stray controls', async () => {
    const created = await harness.api.post('/api/dv/projects', { title: 'canvas-empty', surface: 'canvas' }) as { id: string }
    const page = await openPage()
    await gotoProject(page, created.id)
    await expect.poll(() => page.locator('[data-testid="dv-canvas-view"]').innerText()).toContain('画布还是空的')
    expect(await page.locator('[data-node-id]').count()).toBe(0)
  })

  it('takes whose character changed are drawn stale (red) on the canvas and their clips on the track until the creator keeps them', async () => {
    const project = await seedProject('canvas-stale', 2)
    const state = await stateOf(project.id)
    const frame = state.assets.find(asset => asset.mime.startsWith('image/') && asset.name !== 'ref.png')
    await runOperation(project.id, 'character.update', { character: 'c1' }, [{ role: 'reference', ref: frame?.id ?? '' }])
    const page = await openPage()
    await gotoProject(page, project.id)
    const staleTakes = page.locator('[data-node-type="shot"][data-node-stale="true"]')
    await expect.poll(() => staleTakes.count()).toBe(2)
    // The stale card's outline is the first ring of its frame's box shadow.
    const border = await staleTakes.first().locator('[data-node-frame]').evaluate(el => getComputedStyle(el).boxShadow)
    const [r = 0, g = 0, b = 0] = border.match(/\d+/g)?.map(Number) ?? []
    expect(r).toBeGreaterThan(150)
    expect(g + b).toBeLessThan(r)
    await viewToggle(page, '时间线').click()
    await expect.poll(() => page.locator('[data-clip-stale="true"]').count()).toBe(2)
    // Keeping both takes (proj.stale_accept) clears the marks on the track and, back on the canvas, on the take nodes.
    for (const shot of project.shots) {
      await harness.api.post('/api/dv/stale/accept', { project: project.id, record: shot, surface: 'canvas' })
    }
    await expect.poll(() => page.locator('[data-clip-stale="true"]').count()).toBe(0)
    await viewToggle(page, '画布').click()
    await expect.poll(() => page.locator('[data-node-stale="true"]').count()).toBe(0)
  })

  it('the agent\'s take joins the canvas at once and is drawn like every other take', async () => {
    const project = await seedProject('canvas-agent', 2)
    model.rules.push({
      match: 'agent-shot-please',
      steps: [{ calls: [{ name: 'dv_shot_render', args: {
        reason: 'agent shot', modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'canvas-agent extra shot', duration_sec: 1, inputs: { reference: ['c1@1'] },
      } }] }],
      endText: '拍好了',
    })
    const page = await openPage()
    await gotoProject(page, project.id)
    const composer = page.locator('[data-dv-chat] [contenteditable="true"]').first()
    await composer.waitFor({ timeout: 30_000 })
    await composer.click()
    await page.keyboard.type('agent-shot-please')
    await page.keyboard.press('Enter')
    const takes = page.locator('[data-node-type="shot"]')
    await expect.poll(() => takes.count(), { timeout: 60_000 }).toBe(3)
    const outlines = await takes.evaluateAll(elements => elements.map(element => getComputedStyle(element).outlineStyle))
    expect(outlines).not.toContain('dashed')
    expect(await page.locator('[data-testid="dv-canvas-view"] button', { hasText: '接受' }).count()).toBe(0)
    expect((await stateOf(project.id)).components.proj.records.filter(record => record.operation === RENDER_OPERATION)).toHaveLength(3)
  })

  it('the agent reads the open canvas and moves two nodes with dv_canvas_node_position, which every open page of the project shows at once and keeps after a reload', async () => {
    const project = await seedProject('canvas-agent-move', 2)
    let results: unknown[] = []
    const targets: Array<{ node: string; x: number; y: number }> = []
    model.rules.push({
      match: 'agent-move-please',
      steps: [
        { calls: [{ name: 'dv_canvas_read', args: {} }] },
        (view) => {
          const read = view.toolResults[0] as { cards?: Array<{ id: string }> }
          for (const [index, card] of (read.cards ?? []).slice(0, 2).entries()) targets.push({ node: card.id, x: 2000 + index * 300, y: 0 })
          return { calls: targets.map(target => ({ name: 'dv_canvas_node_position', args: { reason: 'tidy the canvas', ...target } })) }
        },
        (view) => {
          results = view.toolResults
          return { text: '挪好了' }
        },
      ],
    })
    const page = await openPage()
    await gotoProject(page, project.id)
    await page.locator('[data-node-id]').first().waitFor({ timeout: 30_000 })
    const other = await openPage()
    await gotoProject(other, project.id)
    await other.locator('[data-node-id]').first().waitFor({ timeout: 30_000 })
    const drawn = await page.locator('[data-testid="dv-canvas-view"]').first().locator('[data-node-id]')
      .evaluateAll(nodes => nodes.map(node => node.getAttribute('data-node-id') ?? ''))
    expect(drawn.length, 'the seeded canvas draws at least two nodes').toBeGreaterThanOrEqual(2)
    const composer = page.locator('[data-dv-chat] [contenteditable="true"]').first()
    await composer.waitFor({ timeout: 30_000 })
    await composer.click()
    await page.keyboard.type('agent-move-please')
    await page.keyboard.press('Enter')
    await expect.poll(() => results.length, { timeout: 60_000, message: 'the agent turn reaches the reply after dv_canvas_node_position' }).toBe(3)
    const read = results[0] as { project?: string; cards?: Array<{ id: string; type: string; versions: number }> } | string
    if (typeof read !== 'object') throw new Error(`dv_canvas_read failed: ${JSON.stringify(results)}`)
    expect(read.project, 'dv_canvas_read reads the open project').toBe(project.id)
    expect((read.cards ?? []).map(card => card.id).sort(), 'dv_canvas_read lists the nodes that the page draws').toEqual([...drawn].sort())
    const state = await stateOf(project.id)
    expect(targets.map(target => state.components.canvas.nodes[target.node]?.position), 'the node list holds the moves; each node keeps its size')
      .toEqual(targets.map(({ node, x, y }) => ({ ...state.components.canvas.nodes[node]?.position, x, y })))
    const moves = state.components.proj.records.filter(record => record.operation === 'canvas.node_position')
    expect(moves.map(record => [record.actor, record.params['node']]), 'each move is one record of the agent').toEqual(targets.map(target => ['agent', target.node]))
    const placed = (on: Page) => async (): Promise<string[]> => await Promise.all(targets.map(async target => await on.locator('[data-testid="dv-canvas-view"]').first()
      .locator(`[data-node-id="${target.node}"]`).evaluate(el => `${(el as HTMLElement).style.left},${(el as HTMLElement).style.top}`)))
    const expected = targets.map(target => `${String(target.x)}px,${String(target.y)}px`)
    await expect.poll(placed(page), { timeout: 10_000, message: 'the page that asked draws the moved nodes at their targets without a reload' }).toEqual(expected)
    await expect.poll(placed(other), { timeout: 10_000, message: 'the other page of the project draws them too without a reload' }).toEqual(expected)
    await page.reload({ waitUntil: 'load' })
    await page.locator('[data-node-id]').first().waitFor({ timeout: 30_000 })
    await expect.poll(placed(page), { timeout: 10_000, message: 'the moved nodes stay at their targets after a reload' }).toEqual(expected)
    expect([page.errors, other.errors]).toEqual([[], []])
  })

  it('a corner handle resizes every kind of node: a media node keeps its aspect ratio, a window node changes width and height apart, each stops at its minimum size, and dv_canvas_read and a reload keep the size', async () => {
    const project = await seedProject('canvas-resize', 1)
    const reference = (await stateOf(project.id)).assets[0]?.id ?? ''
    const extra = await runOperation(project.id, 'asset.import', { base64: OTHER_PNG_BASE64, mime: 'image/png', name: 'extra.png' })
    await runOperation(project.id, 'asset.place', {}, [{ role: 'asset', ref: extra.outputs[0] ?? '' }])
    await runOperation(project.id, 'location.create', { location: 'l1', name: 'Street' }, [{ role: 'reference', ref: reference }])
    await runOperation(project.id, 'style.create', { style: 's1', name: 'Noir' }, [{ role: 'reference', ref: reference }])
    await runOperation(project.id, 'textnode.write', { path: 'beats.md', body: 'Hero opens the door.', base_version: 0 })
    // The e2e profile runs no image or audio server, so these takes fail; a failed take keeps its frame and its handles.
    await runOperation(project.id, 'image.generate', { modality: 'image', task: 't2i', provider: 'sglang-diffusion', model: 'qwen-image-2.1-turbo', prompt: 'a door' })
    await runOperation(project.id, 'audio.generate', { modality: 'audio', task: 't2a', provider: 'sglang-omni', model: 'fish-audio-drama-3', prompt: 'a knock' })
    let read: unknown[] = []
    model.rules.push({
      match: 'resize-read-please',
      steps: [{ calls: [{ name: 'dv_canvas_read', args: {} }] }, (view) => { read = view.toolResults; return { text: '读好了' } }],
    })
    const kinds = { media: ['asset', 'shot', 'image', 'audio'], window: Object.keys(WINDOW_MIN_HEIGHTS) }
    const page = await openPage()
    await gotoProject(page, project.id)
    await page.locator('[data-node-id]').first().waitFor({ timeout: 30_000 })
    await fitCanvas(page)
    // Every host producer's node kind is a registered UI node type key: its card carries the kind and is no plain card,
    // whose frame shows only the kind.
    const listed = (await stateOf(project.id)).components.canvas
    expect(new Set(Object.values(listed.nodes).map(node => node.kind)), 'the seeded canvas holds every node kind').toEqual(new Set([...kinds.media, ...kinds.window]))
    for (const id of listed.order) {
      const card = page.locator(`[data-testid="dv-canvas-view"] [data-node-id="${id}"]`)
      const kind = listed.nodes[id]?.kind ?? ''
      expect([await card.getAttribute('data-node-type'), (await card.locator('[data-node-frame]').textContent())?.trim() === kind], `node ${id} of kind ${kind} is drawn by its node type`).toEqual([kind, false])
    }
    const zoom = Number(/scale\(([\d.]+)\)/.exec(await page.locator('[data-testid="dv-canvas-view"] > div[style*="transform"]').evaluate(el => (el as HTMLElement).style.transform))?.[1])
    // The frame box of a node in canvas units, as the canvas stores it.
    const boxOf = async (node: Locator): Promise<{ width: number; height: number }> => await node.evaluate(el => ({
      width: Number.parseFloat((el as HTMLElement).style.width), height: Number.parseFloat(el.querySelector<HTMLElement>('[data-node-frame]')?.style.height ?? ''),
    }))
    const drag = async (node: Locator, dx: number, dy: number): Promise<void> => {
      const handle = await node.locator('[data-node-handle="se"]').boundingBox()
      if (handle === null) throw new Error('the selected node shows no south-east handle')
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x + handle.width / 2 + dx, handle.y + handle.height / 2 + dy, { steps: 8 })
      await page.mouse.up()
    }
    const resized: Record<string, { width: number; height: number }> = {}
    for (const [kind, types] of Object.entries(kinds)) {
      for (const type of types) {
        const node = page.locator(`[data-testid="dv-canvas-view"] [data-node-type="${type}"]`).first()
        const id = await node.getAttribute('data-node-id') ?? ''
        await node.click({ position: { x: 12, y: 8 } })
        const before = await boxOf(node)
        await drag(node, 60, 40)
        const after = await boxOf(node)
        expect([after.width !== before.width, after.height !== before.height], `a ${type} node changes both width and height`).toEqual([true, true])
        if (kind === 'media') {
          expect(Math.abs(after.height - after.width * before.height / before.width), `a ${type} node keeps its aspect ratio`).toBeLessThanOrEqual(1)
        } else {
          expect([Math.abs(after.width - before.width - 60 / zoom), Math.abs(after.height - before.height - 40 / zoom)].every(off => off <= 2), `a ${type} node follows the pointer in width and height apart`).toBe(true)
        }
        await drag(node, -2000, -2000)
        const smallest = await boxOf(node)
        await drag(node, -200, -200)
        expect(await boxOf(node), `a ${type} node stays at its minimum size`).toEqual(smallest)
        const minimum = WINDOW_MIN_HEIGHTS[type]
        expect(Math.abs(smallest.width - 104), `a ${type} node stops at its minimum width`).toBeLessThanOrEqual(1)
        expect(Math.abs(smallest.height - (minimum ?? smallest.width * before.height / before.width)), `a ${type} node stops at its minimum height`).toBeLessThanOrEqual(1)
        resized[id] = smallest
      }
    }
    const stored = async (): Promise<Record<string, { width: number | null; height: number | null }>> =>
      Object.fromEntries(Object.entries((await stateOf(project.id)).components.canvas.nodes).map(([id, node]) => [id, node.position]))
    // A frame's style rounds its size to three decimals.
    const near = (actual: { width: number | null; height: number | null } | undefined, size: { width: number; height: number }): boolean =>
      typeof actual?.width === 'number' && typeof actual.height === 'number' && Math.abs(actual.width - size.width) < 0.01 && Math.abs(actual.height - size.height) < 0.01
    for (const [id, size] of Object.entries(resized)) await expect.poll(async () => near((await stored())[id], size), { message: `the node list holds the size of ${id}` }).toBe(true)
    const composer = page.locator('[data-dv-chat] [contenteditable="true"]').first()
    await composer.click()
    await page.keyboard.type('resize-read-please')
    await page.keyboard.press('Enter')
    await expect.poll(() => read.length, { timeout: 60_000, message: 'the agent turn reaches the reply after dv_canvas_read' }).toBe(1)
    const cards = (read[0] as { cards?: Array<{ id: string; width: number; height: number }> }).cards ?? []
    for (const [id, size] of Object.entries(resized)) expect(near(cards.find(card => card.id === id), size), `dv_canvas_read reports the stored size of ${id}`).toBe(true)
    await page.reload({ waitUntil: 'load' })
    await page.locator('[data-node-id]').first().waitFor({ timeout: 30_000 })
    for (const [id, size] of Object.entries(resized)) {
      expect(await boxOf(page.locator(`[data-testid="dv-canvas-view"] [data-node-id="${id}"]`)), `${id} keeps its size after a reload`).toEqual(size)
    }
    expect(page.errors).toEqual([])
  })

  it('an image imported in 素材库 joins the canvas when dragged there, stays after a reload, and 从画布移除 leaves it in 素材库; both are records', async () => {
    const project = await seedProject('canvas-drop', 2)
    const extra = await harness.api.post('/api/dv/operation', {
      project: project.id, operation: 'asset.import', params: { base64: OTHER_PNG_BASE64, mime: 'image/png', name: 'extra.png' }, inputs: [],
      surface: 'asset_pool', intent: 'seed: asset.import',
    }) as ProjectRecord
    const page = await openPage()
    await gotoProject(page, project.id)
    await openAssets(page)
    const nodes = await page.locator('[data-node-id]').count()
    const canvas = page.locator('[data-testid="dv-canvas-view"]')
    const frame = await canvas.boundingBox()
    if (frame === null) throw new Error('canvas has no box')
    const tile = page.locator(`[data-asset-id="${extra.outputs[0] ?? ''}"]`)
    expect(await page.locator('[data-node-type="asset"]').count()).toBe(0)
    // The canvas accepts a 素材库 tile drag.
    const accepted = await canvas.evaluate((element, assetId) => {
      const transfer = new DataTransfer()
      transfer.setData('application/x-dv-asset', assetId)
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 400, clientY: 500 })
      element.dispatchEvent(over)
      return over.defaultPrevented
    }, extra.outputs[0] ?? '')
    expect(accepted).toBe(true)
    await tile.dragTo(canvas, { targetPosition: { x: 120, y: frame.height - 140 } })
    // Dropping puts the asset on the canvas, with its node under the pointer; the node ID is the asset.place record.
    const nodeId = await waitFor(async () => (await stateOf(project.id)).components.canvas.assets[extra.outputs[0] ?? ''], 'the asset node of the drop', 5000)
    const node = page.locator(`[data-node-id="${nodeId}"]`)
    await expect.poll(async () => {
      const box = await node.boundingBox()
      const point = { x: frame.x + 120, y: frame.y + frame.height - 140 }
      return box !== null && box.x <= point.x && point.x <= box.x + box.width && box.y <= point.y && point.y <= box.y + box.height
    }, { timeout: 5000 }).toBe(true)
    expect(await page.locator('[data-node-id]').count()).toBe(nodes + 1)
    // The placement is an asset.place record of the project, so the node is still there after a reload.
    await expect.poll(async () => placedAssets(await stateOf(project.id)), { timeout: 5000 }).toEqual([extra.outputs[0]])
    await gotoProject(page, project.id)
    await node.waitFor({ timeout: 15_000 })
    // 从画布移除 takes the node off the canvas list; the image stays in 素材库.
    const editor = page.locator('[data-testid="dv-canvas-node-editor"]')
    await waitFor(async () => {
      await node.dblclick({ timeout: 10_000 })
      return await editor.isVisible()
    }, 'the asset editor', 30_000)
    page.once('dialog', (dialog) => { void dialog.accept() })
    await editor.getByRole('button', { name: '从画布移除', exact: true }).click()
    await expect.poll(() => node.count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(async () => placedAssets(await stateOf(project.id))).toEqual([])
    // The drop is two records, asset.place then canvas.node_position under the pointer; the removal is canvas.node_remove.
    const placements = (await stateOf(project.id)).components.proj.records.filter(record => record.operation !== null && ['asset.place', 'canvas.node_remove', 'canvas.node_position'].includes(record.operation))
    expect(placements.map(record => [record.operation, record.surface])).toEqual([['asset.place', 'canvas'], ['canvas.node_position', 'canvas'], ['canvas.node_remove', 'canvas']])
    expect(placements[0]?.id).toBe(nodeId)
    expect(placements[1]?.params['node']).toBe(nodeId)
    await openAssets(page)
    expect(await page.locator(`[data-testid="dv-asset-pool-panel"]:visible [data-asset-id="${extra.outputs[0] ?? ''}"]`).count()).toBe(1)
  })
  it('a file dropped on the canvas is not also attached to the chat', async () => {
    const project = await seedProject('canvas-file-drop', 2)
    const page = await openPage()
    await gotoProject(page, project.id)
    await page.locator('[data-dv-chat] [contenteditable="true"]').first().waitFor({ timeout: 30_000 })
    const canvas = page.locator('[data-testid="dv-canvas-view"]')
    const frame = await canvas.boundingBox()
    if (frame === null) throw new Error('canvas has no box')
    const transfer = await page.evaluateHandle((base64) => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'dropped-on-canvas.png', { type: 'image/png' }))
      data.items.add(new File(['notes'], 'notes-on-canvas.txt', { type: 'text/plain' }))
      return data
    }, OTHER_PNG_BASE64)
    const at = { clientX: frame.x + 160, clientY: frame.y + 160 }
    for (const type of ['dragenter', 'dragover', 'drop']) await canvas.dispatchEvent(type, { dataTransfer: transfer, ...at })
    // Each dropped file joins the canvas list as an asset node; the first, the image, sits under the drop point.
    await expect.poll(() => page.locator('[data-node-type="asset"]').count(), { timeout: 10_000 }).toBe(2)
    const image = await waitFor(async () => {
      const state = await stateOf(project.id)
      const asset = state.assets.find(each => each.name === 'dropped-on-canvas.png')?.id
      return asset === undefined ? undefined : state.components.canvas.assets[asset]
    }, 'the node of the dropped image', 10_000)
    await expect.poll(async () => {
      const box = await page.locator(`[data-node-id="${image}"]`).boundingBox()
      if (box === null) return false
      return box.x <= at.clientX && at.clientX <= box.x + box.width && box.y <= at.clientY && at.clientY <= box.y + box.height
    }, { timeout: 5000 }).toBe(true)
    // The composer shows a dropped attachment as a chip with its file name; only the canvas notice may name the file.
    await page.waitForTimeout(500)
    const outside = await page.getByText('notes-on-canvas.txt').evaluateAll(nodes => nodes.filter(node => node.closest('[data-testid="dv-canvas-view"]') === null).length)
    expect(outside).toBe(0)
  })
})

/** @returns the style box of a drawn node in canvas units: left and top of the node, width and height of its frame. */
async function styleBoxOf(node: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  return await node.evaluate((element) => {
    const style = (element as HTMLElement).style
    const frame = element.querySelector<HTMLElement>('[data-node-frame]')?.style.height ?? ''
    const number = Number.parseFloat
    return { x: number(style.left), y: number(style.top), width: number(style.width), height: number(frame) }
  })
}

/** @returns the newest record of the current state, which a canvas gesture writes. */
async function newestRecord(project: string): Promise<ProjectRecord | undefined> {
  return (await stateOf(project)).components.proj.records.at(-1)
}

describe('the canvas node list', () => {
  it('a drag writes one 移动节点 step that a reload keeps and Undo reverts to the old position', async () => {
    const project = await seedProject('nodes-move', 2)
    const page = await openPage()
    await gotoProject(page, project.id)
    const id = project.shots[0] ?? ''
    const node = page.locator(`[data-testid="dv-canvas-view"] [data-node-id="${id}"]`)
    await node.waitFor({ timeout: 30_000 })
    const before = await styleBoxOf(node)
    const stored = (await stateOf(project.id)).components.canvas.nodes[id]?.position
    const screen = await node.boundingBox()
    if (screen === null) throw new Error('the shot node has no box')
    await page.mouse.move(screen.x + 40, screen.y + 40)
    await page.mouse.down()
    await page.mouse.move(screen.x + 160, screen.y + 90, { steps: 8 })
    await page.mouse.up()
    const move = await waitFor(async () => {
      const record = await newestRecord(project.id)
      return record?.operation === 'canvas.node_position' ? record : null
    }, 'the canvas.node_position record of the drag', 10_000)
    expect(move.params['node']).toBe(id)
    expect(Object.keys(move.params).sort(), 'a move gives the corner only').toEqual(['node', 'x', 'y'])
    const moved = await styleBoxOf(node)
    expect([moved.x !== before.x, moved.y !== before.y]).toEqual([true, true])
    expect((await stateOf(project.id)).components.canvas.nodes[id]?.position).toEqual({ ...stored, x: moved.x, y: moved.y })
    await page.reload({ waitUntil: 'load' })
    await node.waitFor({ timeout: 30_000 })
    await expect.poll(() => styleBoxOf(node), { message: 'a reload keeps the moved position' }).toEqual(moved)
    await openHistory(page)
    const row = historyPanel(page).locator(`[data-testid="dv-history-row"][data-record="${move.id}"]`)
    await expect.poll(() => row.innerText(), { timeout: 15_000 }).toContain('移动节点')
    expect(await historyPanel(page).locator('[data-testid="dv-history-row"]').evaluateAll(rows => rows.filter(each => each.textContent?.includes('移动节点')).length), 'the drag is one step').toBe(1)
    await historyPanel(page).locator('[data-testid="dv-history-undo"]').click()
    await expect.poll(async () => (await stateOf(project.id)).components.canvas.nodes[id]?.position, { timeout: 15_000, message: 'Undo restores the old position in the node list' }).toEqual(stored)
    await expect.poll(() => styleBoxOf(node), { timeout: 15_000, message: 'Undo draws the node at its old position' }).toEqual(before)
    expect(page.errors).toEqual([])
  })

  it('a corner resize writes one 调整大小 step and Undo reverts to the old size', async () => {
    const project = await seedProject('nodes-resize', 2)
    const page = await openPage()
    await gotoProject(page, project.id)
    const id = project.shots[0] ?? ''
    const node = page.locator(`[data-testid="dv-canvas-view"] [data-node-id="${id}"]`)
    await node.waitFor({ timeout: 30_000 })
    const before = await styleBoxOf(node)
    const stored = (await stateOf(project.id)).components.canvas.nodes[id]?.position
    expect([stored?.width, stored?.height], 'a new node has the default size of its type').toEqual([null, null])
    await node.click({ position: { x: 12, y: 8 } })
    const handle = await node.locator('[data-node-handle="se"]').boundingBox()
    if (handle === null) throw new Error('the selected node shows no south-east handle')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2 + 40, { steps: 8 })
    await page.mouse.up()
    const resize = await waitFor(async () => {
      const record = await newestRecord(project.id)
      return record?.operation === 'canvas.node_position' ? record : null
    }, 'the canvas.node_position record of the resize', 10_000)
    expect(resize.params['node']).toBe(id)
    const resized = await styleBoxOf(node)
    expect([resized.width > before.width, resized.height > before.height]).toEqual([true, true])
    const position = (await stateOf(project.id)).components.canvas.nodes[id]?.position
    // A frame's style rounds its size to three decimals.
    expect([Math.abs((position?.width ?? 0) - resized.width), Math.abs((position?.height ?? 0) - resized.height)].every(off => off < 0.01), 'the node list holds the new size').toBe(true)
    await openHistory(page)
    const row = historyPanel(page).locator(`[data-testid="dv-history-row"][data-record="${resize.id}"]`)
    await expect.poll(() => row.innerText(), { timeout: 15_000 }).toContain('调整大小')
    expect(await historyPanel(page).locator('[data-testid="dv-history-row"]').evaluateAll(rows => rows.filter(each => each.textContent?.includes('调整大小')).length), 'the resize is one step').toBe(1)
    await historyPanel(page).locator('[data-testid="dv-history-undo"]').click()
    await expect.poll(async () => (await stateOf(project.id)).components.canvas.nodes[id]?.position, { timeout: 15_000, message: 'Undo restores the old size in the node list' }).toEqual(stored)
    await expect.poll(() => styleBoxOf(node), { timeout: 15_000, message: 'Undo draws the node at its old size' }).toEqual(before)
    expect(page.errors).toEqual([])
  })

  it('the agent moves a node with dv_canvas_node_position while no canvas is open; the project state shows it and the canvas draws it once opened', async () => {
    const project = await seedProject('nodes-agent-closed', 2)
    const id = project.shots[1] ?? ''
    const target = { x: 1500, y: 600 }
    let results: unknown[] = []
    model.rules.push({
      match: 'node-position-closed-please',
      steps: [
        { calls: [{ name: 'dv_canvas_node_position', args: { reason: 'move the second shot', node: id, ...target } }] },
        (view) => { results = view.toolResults; return { text: '移好了' } },
      ],
    })
    const page = await openPage()
    await gotoProject(page, project.id)
    await viewToggle(page, '时间线').click()
    await page.locator('[data-testid="dv-timeline-editor"]').waitFor()
    await expect.poll(() => page.locator('[data-testid="dv-canvas-view"]').count(), { message: 'the page shows no canvas' }).toBe(0)
    const composer = page.locator('[data-dv-chat] [contenteditable="true"]').first()
    await composer.waitFor({ timeout: 30_000 })
    await composer.click()
    await page.keyboard.type('node-position-closed-please')
    await page.keyboard.press('Enter')
    await expect.poll(() => results.length, { timeout: 60_000, message: 'the agent turn reaches the reply after dv_canvas_node_position' }).toBe(1)
    const state = await stateOf(project.id)
    expect(state.components.canvas.nodes[id]?.position, `the node list holds the move: ${JSON.stringify(results)}`).toEqual({ ...target, width: null, height: null })
    expect(state.components.proj.records.at(-1)).toMatchObject({ operation: 'canvas.node_position', actor: 'agent', status: 'done' })
    await viewToggle(page, '画布').click()
    const node = page.locator(`[data-testid="dv-canvas-view"] [data-node-id="${id}"]`)
    await node.waitFor({ timeout: 30_000 })
    await expect.poll(async () => { const box = await styleBoxOf(node); return { x: box.x, y: box.y } }).toEqual(target)
    expect(page.errors).toEqual([])
  })

  it('从画布移除 in the right-click menu asks first, removes the node in one step that a reload keeps, and Undo brings it back at its old position', async () => {
    const project = await seedProject('nodes-remove', 2)
    const page = await openPage()
    await gotoProject(page, project.id)
    const id = project.shots[0] ?? ''
    const node = page.locator(`[data-testid="dv-canvas-view"] [data-node-id="${id}"]`)
    await node.waitFor({ timeout: 30_000 })
    const before = await styleBoxOf(node)
    const title = await node.getAttribute('aria-label') ?? ''
    const records = (await stateOf(project.id)).components.proj.records.length
    const removeFromMenu = async (): Promise<void> => {
      await node.click({ button: 'right', position: { x: 40, y: 40 } })
      await page.getByRole('menu', { name: '节点操作' }).getByRole('menuitem', { name: /从画布移除/ }).click()
    }
    const asked: string[] = []
    page.once('dialog', (dialog) => { asked.push(dialog.message()); void dialog.dismiss() })
    await removeFromMenu()
    await expect.poll(() => asked).toEqual([`从画布移除「${title}」？它的版本保留在素材库中，可在历史记录中恢复该节点。`])
    expect([await node.count(), (await stateOf(project.id)).components.proj.records.length], 'Cancel removes nothing').toEqual([1, records])
    page.once('dialog', (dialog) => { void dialog.accept() })
    await removeFromMenu()
    await expect.poll(() => node.count(), { timeout: 10_000, message: 'OK removes the node' }).toBe(0)
    const removal = await newestRecord(project.id)
    expect(removal).toMatchObject({ operation: 'canvas.node_remove', actor: 'user', surface: 'canvas', params: { nodes: [id] } })
    expect((await stateOf(project.id)).components.canvas.nodes[id], 'the node list no longer holds the node').toBeUndefined()
    await page.reload({ waitUntil: 'load' })
    await page.locator('[data-testid="dv-canvas-view"] [data-node-id]').first().waitFor({ timeout: 30_000 })
    expect(await node.count(), 'a reload keeps the removal').toBe(0)
    await openHistory(page)
    const row = historyPanel(page).locator(`[data-testid="dv-history-row"][data-record="${removal?.id ?? ''}"]`)
    await expect.poll(() => row.innerText(), { timeout: 15_000 }).toContain(`从画布移除「${title}」`)
    await historyPanel(page).locator('[data-testid="dv-history-undo"]').click()
    await node.waitFor({ timeout: 15_000 })
    await expect.poll(() => styleBoxOf(node), { timeout: 15_000, message: 'Undo draws the node back at its old position' }).toEqual(before)
    expect(page.errors).toEqual([])
  })

  it('the agent removes a node with dv_canvas_node_remove, and both open pages of the project drop it at once', async () => {
    const project = await seedProject('nodes-agent-remove', 2)
    const id = project.shots[1] ?? ''
    let results: unknown[] = []
    model.rules.push({
      match: 'node-remove-please',
      steps: [
        { calls: [{ name: 'dv_canvas_node_remove', args: { reason: 'drop the second shot', nodes: [id] } }] },
        (view) => { results = view.toolResults; return { text: '移除了' } },
      ],
    })
    const page = await openPage()
    await gotoProject(page, project.id)
    const other = await openPage()
    await gotoProject(other, project.id)
    const nodeOn = (on: Page): Locator => on.locator(`[data-testid="dv-canvas-view"] [data-node-id="${id}"]`)
    await nodeOn(page).waitFor({ timeout: 30_000 })
    await nodeOn(other).waitFor({ timeout: 30_000 })
    const composer = page.locator('[data-dv-chat] [contenteditable="true"]').first()
    await composer.waitFor({ timeout: 30_000 })
    await composer.click()
    await page.keyboard.type('node-remove-please')
    await page.keyboard.press('Enter')
    await expect.poll(() => results.length, { timeout: 60_000, message: 'the agent turn reaches the reply after dv_canvas_node_remove' }).toBe(1)
    expect((await stateOf(project.id)).components.proj.records.at(-1), JSON.stringify(results)).toMatchObject({ operation: 'canvas.node_remove', actor: 'agent', status: 'done' })
    await expect.poll(() => nodeOn(page).count(), { timeout: 10_000, message: 'the page that asked drops the node without a reload' }).toBe(0)
    await expect.poll(() => nodeOn(other).count(), { timeout: 10_000, message: 'the other page drops the node without a reload' }).toBe(0)
    expect([page.errors, other.errors]).toEqual([[], []])
  })
})

describe('renaming canvas nodes', () => {
  it('F2 renames a shot and the agent renames a text node; a rerun keeps the name, a reload keeps both, Undo clears the agent\'s, and 重命名 in the menu names it again', async () => {
    const project = await seedProject('nodes-rename', 2)
    const text = await runOperation(project.id, 'textnode.write', { path: 'beats.md', body: 'Hero opens the door.', base_version: 0 })
    const page = await openPage()
    await gotoProject(page, project.id)
    const shot = project.shots[0] ?? ''
    const card = (id: string): Locator => page.locator(`[data-testid="dv-canvas-view"] [data-node-id="${id}"]`)
    await card(shot).waitFor({ timeout: 30_000 })
    await card(shot).click({ position: { x: 12, y: 8 } })
    await page.keyboard.press('F2')
    const field = card(shot).getByRole('textbox', { name: '节点名称' })
    await field.waitFor()
    await field.fill('港口黎明')
    await page.keyboard.press('Enter')
    const rename = await waitFor(async () => {
      const record = await newestRecord(project.id)
      return record?.operation === 'canvas.node_rename' ? record : null
    }, 'the canvas.node_rename record of the F2 rename', 10_000)
    expect([rename.params, rename.actor, rename.surface]).toEqual([{ node: shot, name: '港口黎明' }, 'user', 'canvas'])
    await expect.poll(() => card(shot).getAttribute('aria-label')).toBe('港口黎明')

    // A rerun of the renamed shot adds a version to the same node, which keeps its name.
    const original = (await stateOf(project.id)).components.proj.records.find(record => record.id === shot)
    const rerun = await harness.api.post('/api/dv/operation', {
      project: project.id, operation: RENDER_OPERATION, params: { ...original?.params, prompt: 'nodes-rename shot 1, take two' },
      inputs: [{ role: 'reference', ref: 'c1@1' }], based_on: shot, surface: 'canvas', intent: 'rerun the renamed shot',
    }) as ProjectRecord
    await waitFor(async () => (await stateOf(project.id)).components.proj.records.find(record => record.id === rerun.id)?.status === 'done' || null, 'the rerun renders')
    expect((await stateOf(project.id)).components.canvas.nodes[shot]).toMatchObject({ name: '港口黎明', versions: [shot, rerun.id] })
    await expect.poll(() => card(shot).locator('span', { hasText: /^v2( · |$)/ }).count(), { timeout: 15_000 }).toBe(1)
    expect(await card(shot).getAttribute('aria-label')).toBe('港口黎明')

    const staleBefore = Object.keys((await stateOf(project.id)).components.proj.stale)
    let results: unknown[] = []
    model.rules.push({
      match: 'node-rename-text-please',
      steps: [
        { calls: [{ name: 'dv_canvas_node_rename', args: { reason: 'name the beats', node: text.id, name: 'Story beats' } }] },
        (view) => { results = view.toolResults; return { text: '改好了' } },
      ],
    })
    const composer = page.locator('[data-dv-chat] [contenteditable="true"]').first()
    await composer.waitFor({ timeout: 30_000 })
    await composer.click()
    await page.keyboard.type('node-rename-text-please')
    await page.keyboard.press('Enter')
    await expect.poll(() => results.length, { timeout: 60_000, message: 'the agent turn reaches the reply after dv_canvas_node_rename' }).toBe(1)
    await expect.poll(() => card(text.id).getAttribute('aria-label'), { timeout: 15_000, message: `the open canvas shows the agent's name: ${JSON.stringify(results)}` }).toBe('Story beats')
    const renamed = await stateOf(project.id)
    expect(renamed.components.proj.records.at(-1)).toMatchObject({ operation: 'canvas.node_rename', actor: 'agent', status: 'done' })
    expect(Object.keys((renamed.components['textnode'] as { texts: Record<string, unknown> }).texts), 'the text node keeps its path').toEqual(['beats.md'])
    expect(Object.keys(renamed.components.proj.stale), 'a rename makes nothing stale').toEqual(staleBefore)

    await page.reload({ waitUntil: 'load' })
    await card(text.id).waitFor({ timeout: 30_000 })
    expect([await card(shot).getAttribute('aria-label'), await card(text.id).getAttribute('aria-label')], 'a reload keeps both names').toEqual(['港口黎明', 'Story beats'])
    await openHistory(page)
    const row = historyPanel(page).locator(`[data-testid="dv-history-row"][data-record="${rename.id}"]`)
    await expect.poll(() => row.innerText(), { timeout: 15_000 }).toContain('重命名为「港口黎明」')
    await historyPanel(page).locator('[data-testid="dv-history-undo"]').click()
    await expect.poll(async () => (await stateOf(project.id)).components.canvas.nodes[text.id]?.name, { timeout: 15_000, message: 'Undo clears the agent\'s name' }).toBeNull()
    await expect.poll(() => card(text.id).getAttribute('aria-label'), { timeout: 15_000 }).not.toBe('Story beats')
    expect(await card(shot).getAttribute('aria-label'), 'Undo leaves the earlier rename').toBe('港口黎明')

    await card(text.id).click({ button: 'right', position: { x: 40, y: 40 } })
    await page.getByRole('menu', { name: '节点操作' }).getByRole('menuitem', { name: '重命名' }).click()
    const menuField = card(text.id).getByRole('textbox', { name: '节点名称' })
    await menuField.fill('Beat sheet')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await newestRecord(project.id))?.params, { timeout: 10_000, message: 'the menu rename writes one canvas.node_rename' }).toEqual({ node: text.id, name: 'Beat sheet' })
    await expect.poll(() => card(text.id).getAttribute('aria-label')).toBe('Beat sheet')
    expect(page.errors).toEqual([])
  })
})

/** A screen box: left, top, width, height in CSS pixels. */
type Box = [number, number, number, number]

/** One recorded zoom transition: the box the moving element starts at and the box it ends at. */
interface Zoom { from: Box; to: Box }

/**
 * Record the zoom transitions of the pop-ups from now on: for every `element.animate` call whose keyframes move the
 * element, the box of its first and its last keyframe on screen, worked out from the element's box and the keyframe's
 * `translate(…) scale(…)`.
 * @param page - the page.
 */
async function recordZooms(page: Page): Promise<void> {
  await page.evaluate(() => {
    const zooms: Array<{ from: number[]; to: number[] }> = []
    Reflect.set(window, '__dvZooms', zooms)
    const animate: Element['animate'] = Reflect.get(Element.prototype, 'animate')
    Element.prototype.animate = function (
      this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions,
    ) {
      const frames = Array.isArray(keyframes) ? keyframes : []
      if (frames.some(frame => String(frame.transform ?? '').includes('translate'))) {
        const rect = this.getBoundingClientRect()
        const boxOf = (frame: Keyframe | undefined): number[] => {
          const match = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+), ([-\d.e]+)\)/.exec(String(frame?.transform ?? ''))
          if (match === null) return [rect.left, rect.top, rect.width, rect.height]
          const [dx, dy, sx, sy] = match.slice(1).map(Number) as [number, number, number, number]
          return [rect.left + dx, rect.top + dy, rect.width * sx, rect.height * sy]
        }
        zooms.push({ from: boxOf(frames[0]), to: boxOf(frames.at(-1)) })
      }
      return animate.call(this, keyframes, options)
    }
  })
}

/** @returns the zoom transitions recorded since {@link recordZooms}. */
async function recordedZooms(page: Page): Promise<Zoom[]> {
  return await page.evaluate(() => Reflect.get(window, '__dvZooms') as Zoom[])
}

/** @returns the element's box on screen. */
async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('the element has no box')
  return [box.x, box.y, box.width, box.height]
}

/**
 * Expect two screen boxes to match within a pixel.
 * @param actual - the box found.
 * @param expected - the box wanted.
 */
function expectSameBox(actual: Box | undefined, expected: Box): void {
  expect(actual).toBeDefined()
  for (const [index, value] of expected.entries()) expect(Math.abs((actual?.[index] ?? Number.NaN) - value)).toBeLessThan(1.5)
}

/**
 * Open a pop-up from an element and close it, and expect the pop-up to grow out of that element into its final box and
 * shrink back into the element.
 * @param page - the page, with {@link recordZooms} running.
 * @param opener - the element that opens the pop-up.
 * @param popup - the element that grows and shrinks.
 * @param close - closes the pop-up.
 * @param gesture - the gesture on the opener that opens the pop-up; a canvas node opens its editor on a double click.
 */
async function expectZoomFrom(page: Page, opener: Locator, popup: Locator, close: () => Promise<void>, gesture: 'click' | 'dblclick' = 'click'): Promise<void> {
  const origin = await boxOf(opener)
  const before = (await recordedZooms(page)).length
  await opener[gesture]()
  await popup.waitFor()
  // The open transition lasts 300 ms; the pop-up then rests at its final box.
  await page.waitForTimeout(600)
  const final = await boxOf(popup)
  await close()
  await expect.poll(() => popup.count()).toBe(0)
  const [open, shrink] = (await recordedZooms(page)).slice(before)
  expectSameBox(open?.from, origin)
  expectSameBox(open?.to, final)
  expectSameBox(shrink?.from, final)
  expectSameBox(shrink?.to, origin)
}

describe('node states and pop-ups', () => {
  it('closing the editor keeps its node selected, and the editor grows out of the node and shrinks back into it', async () => {
    const project = await seedProject('canvas-selection', 2)
    const page = await openPage()
    await gotoProject(page, project.id)
    await fitCanvas(page)
    await recordZooms(page)
    const take = page.locator('[data-node-type="shot"]').first()
    const editor = page.locator('[data-testid="dv-canvas-node-editor"]')
    await expectZoomFrom(page, take, editor, async () => { await editor.getByRole('button', { name: '关闭' }).click() }, 'dblclick')
    // The ring tells the creator which node the closed editor belonged to; empty canvas clears it.
    expect(await take.getAttribute('data-node-selected')).toBe('true')
    const frame = await boxOf(page.locator('[data-testid="dv-canvas-view"]'))
    await page.mouse.click(frame[0] + frame[2] - 20, frame[1] + frame[3] - 20)
    await expect.poll(() => take.getAttribute('data-node-selected')).toBeNull()
  })

  it('渲染新版本 renders once on a double click, then keeps its node selected, which shows 渲染中… for the new version and then an unseen dot until opened', async () => {
    const project = await seedProject('canvas-render-feedback', 2)
    const page = await openPage()
    await gotoProject(page, project.id)
    const takes = page.locator('[data-node-type="shot"]')
    await expect.poll(() => takes.count()).toBe(2)
    const original = takes.first()
    const originalId = await original.getAttribute('data-node-id') ?? ''
    await original.dblclick()
    const requests = harness.backend.requests.length
    // The render stays running until the story releases it, as a real render does for a minute.
    harness.backend.hold()
    try {
      await page.getByRole('button', { name: '渲染新版本' }).dblclick()
      await expect.poll(() => page.locator('[data-testid="dv-canvas-node-editor"]').count(), { timeout: 15_000 }).toBe(0)
      // The new version joins the original node, so the selection stays on it.
      const fresh = page.locator('[data-node-type="shot"][data-node-selected="true"]')
      await expect.poll(() => fresh.count(), { timeout: 15_000 }).toBe(1)
      expect(await fresh.getAttribute('data-node-id')).toBe(originalId)
      await expect.poll(() => fresh.textContent(), { timeout: 15_000 }).toContain('渲染中…')
      await expect.poll(() => harness.backend.requests.length, { timeout: 15_000 }).toBe(requests + 1)
      // The second click of the double click started no second render.
      await page.waitForTimeout(1000)
      expect(await takes.count()).toBe(2)
      expect(harness.backend.requests.length).toBe(requests + 1)
      expect((await stateOf(project.id)).components.canvas.nodes[originalId]?.versions).toHaveLength(2)
      harness.backend.releaseAll()
      const node = page.locator(`[data-node-id="${originalId}"]`)
      await expect.poll(() => node.getAttribute('data-node-unseen'), { timeout: 30_000 }).toBe('true')
      expect(await takes.nth(1).getAttribute('data-node-unseen')).toBeNull()
      await node.dblclick()
      await expect.poll(() => node.getAttribute('data-node-unseen')).toBeNull()
    } finally {
      harness.backend.releaseAll()
    }
  })

  it('a chat video card and a chat image open in a page-wide viewer that grows out of them and shrinks back into them', async () => {
    const project = await seedProject('chat-viewer', 1)
    const state = await stateOf(project.id)
    const image = state.assets.find(asset => asset.mime.startsWith('image/'))?.id ?? ''
    const video = project.clipAssets[0] ?? ''
    model.rules.push({ match: 'show-media-please', steps: [{ text: `[点此播放](/dv/assets/${video})\n\n![参考图](/dv/assets/${image})` }] })
    const page = await openPage()
    await gotoProject(page, project.id)
    const composer = page.locator('[data-dv-chat] [contenteditable="true"]').first()
    await composer.waitFor({ timeout: 30_000 })
    await composer.click()
    await page.keyboard.type('show-media-please')
    await page.keyboard.press('Enter')
    const card = page.locator(`[data-dv-chat-video="${video}"] button`)
    await card.waitFor({ timeout: 60_000 })
    const thumbnail = page.getByRole('button', { name: '查看大图: 参考图' })
    await thumbnail.waitFor()
    await recordZooms(page)
    const viewer = page.locator('[data-testid="dv-chat-media-viewer"]')
    await expectZoomFrom(page, card, viewer.locator('video'), async () => { await page.keyboard.press('Escape') })
    // Focus returns to the card that opened the viewer.
    expect(await card.evaluate(element => element === document.activeElement)).toBe(true)
    await expectZoomFrom(page, thumbnail, viewer.locator('img'), async () => { await viewer.getByRole('button', { name: '关闭' }).click() })
  })

  it('the 素材库 preview grows out of its tile and shrinks back into it', async () => {
    const project = await seedProject('assets-preview-zoom', 1)
    const page = await openPage()
    await gotoProject(page, project.id)
    await openAssets(page)
    await recordZooms(page)
    const tile = page.locator(`[data-asset-id="${project.clipAssets[0] ?? ''}"]`)
    const dialog = page.getByRole('dialog')
    await expectZoomFrom(page, tile, dialog.locator('> div').nth(1), async () => { await page.keyboard.press('Escape') })
  })
})

describe('timeline stories', () => {
  it('one tab per timeline; switching moves the viewer, playhead, time, and selection with it', async () => {
    const project = await seedProject('timeline-tabs', 3, [2, 0])
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    expect(await timelineTabs(page)).toEqual(['时间线 1*', '时间线 2', '时间线 3'])
    expect(await timelineTime(page)).toEqual([0, 4])
    const ruler = await page.locator('[data-testid="dv-timeline-ruler"]').boundingBox()
    if (ruler === null) throw new Error('ruler has no box')
    await page.mouse.click(ruler.x + 2.5 * await pxPerSecond(page), ruler.y + 10)
    await page.locator('[data-clip-position="2"]').click()
    expect(await trackClips(page)).toEqual(['1', '2*', '3'])
    expect((await timelineTime(page))[0]).toBeCloseTo(2.5, 1)
    await timelineTab(page, '时间线 2').click()
    expect(await timelineTabs(page)).toEqual(['时间线 1', '时间线 2*', '时间线 3'])
    expect(await trackClips(page)).toEqual(['1', '2'])
    await expect.poll(() => timelineTime(page), { timeout: 3000 }).toEqual([0, 3])
    await expect.poll(() => viewerAsset(page)).toBe(project.clipAssets[0])
    await timelineTab(page, '时间线 3').click()
    expect(await trackClips(page)).toEqual([])
    await expect.poll(() => timelineTime(page), { timeout: 3000 }).toEqual([0, 0])
    expect(await viewerAsset(page)).toBeNull()
    await expect.poll(() => page.locator('[data-testid="dv-timeline-viewer-empty"]').count()).toBe(1)
    expect(page.errors).toEqual([])
  })

  it('＋ 新建 adds the next 时间线 N, selects it, and its empty track explains what to do', async () => {
    const project = await seedProject('timeline-new', 2)
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await page.locator('[data-testid="dv-timeline-editor"]').getByRole('button', { name: '＋ 新建' }).click()
    await expect.poll(() => timelineTabs(page)).toEqual(['时间线 1', '时间线 2*'])
    await page.locator('[data-testid="dv-timeline-editor"]').getByRole('button', { name: '＋ 新建' }).click()
    await expect.poll(() => timelineTabs(page)).toEqual(['时间线 1', '时间线 2', '时间线 3*'])
    expect((await stateOf(project.id)).components.timeline.timelines.map(timeline => timeline.name)).toEqual(['', '', ''])
    await expect.poll(() => page.locator('[data-testid="dv-timeline-editor"]').innerText()).toContain('这条时间线还没有片段')
  })

  it('an empty timeline explains what to do once, not twice', async () => {
    const project = await seedProject('timeline-empty-hint', 2, [0])
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await timelineTab(page, '时间线 2').click()
    const text = await page.locator('[data-testid="dv-timeline-editor"]').innerText()
    expect(text.split('这条时间线还没有片段').length - 1).toBe(1)
  })

  it('a timeline created in English is titled 时间线 2 in the Chinese interface', async () => {
    const project = await seedProject('timeline-title-language', 2)
    const english = await openPage({ lang: 'en-US' })
    await gotoProject(english, project.id, 'timeline')
    await english.locator('[data-testid="dv-timeline-editor"] [role="tablist"]').getByRole('button', { name: '＋ New' }).click()
    await expect.poll(() => timelineTabs(english)).toEqual(['Timeline 1', 'Timeline 2*'])
    const chinese = await openPage({ lang: 'zh-CN' })
    await gotoProject(chinese, project.id, 'timeline')
    expect(await timelineTabs(chinese)).toEqual(['时间线 1*', '时间线 2'])
  })

  it('a very short clip can still be selected by clicking its middle at the default zoom', async () => {
    const project = await seedProject('timeline-narrow', 3)
    await runOperation(project.id, 'timeline.clip_trim', { clip: await clipAt(project.id, 1), out_sec: 0.2 })
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    const clip = await page.locator('[data-clip-position="1"]').boundingBox()
    if (clip === null) throw new Error('clip 1 has no box')
    await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
    await expect.poll(() => trackClips(page)).toEqual(['1*', '2', '3'])
  })

  it('a timeline can be renamed by double-clicking its tab', async () => {
    const project = await seedProject('timeline-rename', 2, [1])
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await timelineTab(page, '时间线 2').dblclick()
    const box = page.locator('[data-testid="dv-timeline-editor"] [role="tablist"] input')
    await box.waitFor({ timeout: 3000 })
    await box.fill('片尾')
    await box.press('Enter')
    await expect.poll(() => timelineTabs(page)).toEqual(['时间线 1', '片尾*'])
    await expect.poll(async () => (await stateOf(project.id)).components.timeline.timelines.find(timeline => timeline.id === 't2')?.name).toBe('片尾')
  })

  it('a timeline can be deleted from its tab menu after a confirmation', async () => {
    const project = await seedProject('timeline-delete', 2, [1, 0])
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await timelineTab(page, '时间线 2').click()
    page.once('dialog', (dialog) => { void dialog.accept() })
    await timelineTab(page, '时间线 2').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /删除/ }).click({ timeout: 3000 })
    const confirm = page.getByRole('dialog').getByRole('button', { name: /删除/ })
    if (await confirm.count() > 0) await confirm.click()
    await expect.poll(() => timelineTabs(page)).toEqual(['时间线 1*', '时间线 3'])
    await expect.poll(async () => (await stateOf(project.id)).components.timeline.timelines.map(timeline => timeline.id)).toEqual(['t1', 't3'])
  })

  it('deleting a timeline can be undone from the toolbar', async () => {
    const project = await seedProject('timeline-delete-undo', 2, [1])
    const page = await openPage()
    page.on('dialog', (dialog) => { void dialog.accept() })
    await gotoProject(page, project.id, 'timeline')
    await timelineTab(page, '时间线 2').click({ button: 'right' })
    await page.getByRole('menuitem', { name: /删除/ }).click()
    const confirm = page.getByRole('dialog').getByRole('button', { name: /删除/ })
    if (await confirm.count() > 0) await confirm.click()
    await expect.poll(() => timelineTabs(page)).toEqual(['时间线 1*'])
    const undo = page.getByRole('button', { name: '撤销' })
    await expect.poll(() => undo.isEnabled()).toBe(true)
    await undo.click()
    await expect.poll(() => timelineTabs(page)).toContain('时间线 2')
    expect((await stateOf(project.id)).components.timeline.timelines.map(timeline => timeline.id)).toEqual(['t1', 't2'])
  })

  it('deleting the last timeline leaves an honest empty state', async () => {
    const project = await seedProject('timeline-delete-last', 2)
    const page = await openPage()
    page.on('dialog', (dialog) => { void dialog.accept() })
    await gotoProject(page, project.id, 'timeline')
    await timelineTab(page, '时间线 1').click({ button: 'right' })
    const remove = page.getByRole('menuitem', { name: /删除/ })
    // Refusing to delete the only timeline is also acceptable.
    if (await remove.count() === 0) return
    await remove.click()
    const confirm = page.getByRole('dialog').getByRole('button', { name: /删除/ })
    if (await confirm.count() > 0) await confirm.click()
    await expect.poll(() => timelineTabs(page)).toEqual([])
    // With no timeline, nothing may talk about "this timeline" (这条时间线) or offer a disabled ＋; ＋ 新建 is the way forward.
    const text = await page.locator('[data-testid="dv-timeline-editor"]').innerText()
    expect(text).not.toContain('这条时间线')
    expect(await page.locator('[data-testid="dv-timeline-editor"]').getByRole('button', { name: '＋ 新建' }).isEnabled()).toBe(true)
  })

  it('play runs the whole timeline continuously across its clips to the end', async () => {
    const project = await seedProject('timeline-play', 3)
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await expect.poll(() => viewerAsset(page)).toBe(project.clipAssets[0])
    await page.getByRole('button', { name: '播放', exact: true }).click()
    const shown = new Set<string>()
    const started = Date.now()
    for (;;) {
      const asset = await viewerAsset(page)
      if (asset !== null) shown.add(asset)
      const [position, total] = await timelineTime(page)
      // The timecode shows hundredths, so the loop waits for the end itself instead of a position that rounds to it.
      if (position >= total || Date.now() - started > 12_000) break
      await page.waitForTimeout(100)
    }
    // Four seconds of clips play in about four seconds and every clip appears in the viewer on the way.
    const players = await page.locator('[data-testid="dv-timeline-viewer"] video').evaluateAll(videos => videos.map((video) => {
      const element = video as HTMLVideoElement
      return `${element.style.visibility}:${String(element.currentTime)}:${element.paused ? 'paused' : 'playing'}:ready=${String(element.readyState)}:error=${String(element.error?.code ?? 0)}`
    }).join(' | '))
    expect(await timelineTime(page), players).toEqual([4, 4])
    expect(Date.now() - started).toBeLessThan(9000)
    expect([...shown].sort()).toEqual([...new Set(project.clipAssets)].sort())
    await expect.poll(() => page.getByRole('button', { name: '播放', exact: true }).count(), { timeout: 2000 }).toBe(1)
  })

  it('scrubbing the ruler moves the playhead, the time, and the viewer frame', async () => {
    const project = await seedProject('timeline-scrub', 3)
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    const ruler = await page.locator('[data-testid="dv-timeline-ruler"]').boundingBox()
    if (ruler === null) throw new Error('ruler has no box')
    const px = await pxPerSecond(page)
    await page.mouse.move(ruler.x + 0.2 * px, ruler.y + 10)
    await page.mouse.down()
    await page.mouse.move(ruler.x + 1.6 * px, ruler.y + 10, { steps: 6 })
    await page.mouse.up()
    expect((await timelineTime(page))[0]).toBeCloseTo(1.6, 1)
    const playhead = await page.locator('[data-testid="dv-timeline-playhead"]').boundingBox()
    expect(Math.abs((playhead?.x ?? 0) - (ruler.x + 1.6 * px))).toBeLessThan(4)
    await expect.poll(() => viewerAsset(page)).toBe(project.clipAssets[1])
  })

  it('split at the playhead, trim by the edges, reorder by drag, and Delete each edit the timeline once', async () => {
    const project = await seedProject('timeline-edit', 3)
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await page.getByRole('button', { name: '适配' }).click()
    const px = await pxPerSecond(page)
    const ruler = await page.locator('[data-testid="dv-timeline-ruler"]').boundingBox()
    if (ruler === null) throw new Error('ruler has no box')
    const [a, b, c] = project.clipAssets.map(id => id.slice(0, 8))
    // Clip 2 spans 1 s to 3 s; splitting at 2 s makes two 1-second halves.
    await page.mouse.click(ruler.x + 2 * px, ruler.y + 10)
    await page.getByRole('button', { name: '拆分' }).click()
    await expect.poll(() => timelineClips(project.id)).toEqual([`${a ?? ''}[-]`, `${b ?? ''}[-1]`, `${b ?? ''}[1-]`, `${c ?? ''}[-]`])
    await expect.poll(() => trackClips(page)).toHaveLength(4)
    // Drag the end edge of clip 1 left by 0.5 s.
    const first = await page.locator('[data-clip-position="1"]').boundingBox()
    if (first === null) throw new Error('clip 1 has no box')
    await page.mouse.move(first.x + first.width - 3, first.y + 20)
    await page.mouse.down()
    await page.mouse.move(first.x + first.width - 3 - 0.5 * px, first.y + 20, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => timelineClips(project.id)).toEqual([`${a ?? ''}[-0.5]`, `${b ?? ''}[-1]`, `${b ?? ''}[1-]`, `${c ?? ''}[-]`])
    // The track redraws after the refetch; the next drag needs the shortened layout (3.5 s in total).
    await expect.poll(async () => (await timelineTime(page))[1]).toBeCloseTo(3.5, 1)
    // Drag the start edge of the last clip right by 0.25 s.
    const last = await page.locator('[data-clip-position="4"]').boundingBox()
    if (last === null) throw new Error('clip 4 has no box')
    await page.mouse.move(last.x + 3, last.y + 20)
    await page.mouse.down()
    await page.mouse.move(last.x + 3 + 0.25 * px, last.y + 20, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => timelineClips(project.id)).toEqual([`${a ?? ''}[-0.5]`, `${b ?? ''}[-1]`, `${b ?? ''}[1-]`, `${c ?? ''}[0.25-]`])
    await expect.poll(async () => (await timelineTime(page))[1]).toBeCloseTo(3.25, 1)
    // Drag clip 4 by its body to the front.
    const moving = await page.locator('[data-clip-position="4"]').boundingBox()
    const target = await page.locator('[data-clip-position="1"]').boundingBox()
    if (moving === null || target === null) throw new Error('clip has no box')
    await page.mouse.move(moving.x + moving.width / 2, moving.y + 30)
    await page.mouse.down()
    await page.mouse.move(target.x + 2, moving.y + 30, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => timelineClips(project.id)).toEqual([`${c ?? ''}[0.25-]`, `${a ?? ''}[-0.5]`, `${b ?? ''}[-1]`, `${b ?? ''}[1-]`])
    // The track redraws after the refetch; a click before that lands on the clip that was at the position before the move.
    const movedOrder = (await stateOf(project.id)).components.timeline.timelines[0]?.clips.map(clip => clip.id)
    await expect.poll(() => trackClipIds(page)).toEqual(movedOrder)
    // After the move, only the moved clip (now at position 1) may be selected.
    expect((await trackClips(page)).filter(position => position.endsWith('*') && position !== '1*')).toEqual([])
    // Select clip 2 and press Delete.
    await page.locator('[data-clip-position="2"]').click()
    await page.keyboard.press('Delete')
    await expect.poll(() => timelineClips(project.id)).toEqual([`${c ?? ''}[0.25-]`, `${b ?? ''}[-1]`, `${b ?? ''}[1-]`])
    await expect.poll(() => trackClips(page)).toEqual(['1', '2', '3'])
    expect(page.errors).toEqual([])
  })

  it('＋ inserts a picked asset at the end of the timeline', async () => {
    const project = await seedProject('timeline-plus', 2, [0])
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await timelineTab(page, '时间线 2').click()
    await page.getByRole('button', { name: '插入片段' }).click()
    const picker = page.getByRole('dialog', { name: '选一个素材插入到末尾' })
    await picker.waitFor()
    await picker.getByRole('button').first().click()
    await expect.poll(() => picker.count()).toBe(0)
    await expect.poll(async () => (await timelineClips(project.id, 't2')).length).toBe(1)
    await expect.poll(() => trackClips(page)).toEqual(['1'])
    expect(await timelineClips(project.id, 't1')).toHaveLength(2)
  })

  it('dragging a video tile from 素材库 onto the track inserts it where it is dropped', async () => {
    const project = await seedProject('timeline-drop', 2)
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await openAssets(page)
    const track = page.locator('[data-testid="dv-timeline-editor"] [role="list"]')
    await page.locator(`[data-asset-id="${project.clipAssets[1] ?? ''}"]`).dragTo(track, { targetPosition: { x: 4, y: 30 } })
    await expect.poll(() => timelineClips(project.id)).toEqual([project.clipAssets[1], project.clipAssets[0], project.clipAssets[1]].map(id => `${(id ?? '').slice(0, 8)}[-]`))
  })

  it('插入片段 in the 素材库 preview adds the clip to the open timeline', async () => {
    const project = await seedProject('timeline-add-from-preview', 2, [0])
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await timelineTab(page, '时间线 2').click()
    await openAssets(page)
    await page.locator(`[data-asset-id="${project.clipAssets[0] ?? ''}"]`).click()
    await page.getByRole('dialog').getByRole('button', { name: '插入片段' }).click()
    await expect.poll(() => timelineClips(project.id, 't2'), { timeout: 5000 }).toEqual([`${(project.clipAssets[0] ?? '').slice(0, 8)}[-]`])
    await expect.poll(() => trackClips(page)).toEqual(['1'])
  })

  it('undo reverts the last edit, and redo brings it back', async () => {
    const project = await seedProject('timeline-undo', 3)
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    const original = await timelineClips(project.id)
    await page.locator('[data-clip-position="1"]').click()
    await page.keyboard.press('Delete')
    await expect.poll(() => timelineClips(project.id)).toHaveLength(2)
    const edited = await timelineClips(project.id)
    await page.getByRole('button', { name: '撤销' }).click()
    await expect.poll(() => timelineClips(project.id)).toEqual(original)
    await expect.poll(() => trackClips(page)).toHaveLength(3)
    expect(edited).toHaveLength(2)
    const redo = page.getByRole('button', { name: '重做', exact: true })
    await expect.poll(() => redo.isEnabled()).toBe(true)
    await redo.click()
    await expect.poll(() => timelineClips(project.id)).toEqual(edited)
    await expect.poll(() => trackClips(page)).toHaveLength(2)
    await expect.poll(() => redo.isEnabled()).toBe(false)
  })

  it('export produces one playable video as long as the timeline', async () => {
    const project = await seedProject('timeline-export', 3)
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await page.getByRole('button', { name: '导出' }).click()
    const link = page.locator('[data-testid="dv-timeline-exported"]')
    await link.waitFor({ timeout: 60_000 })
    const href = await link.getAttribute('href') ?? ''
    const assetId = /\/dv\/assets\/([0-9a-f]+)/.exec(href)?.[1] ?? ''
    const exported = (await stateOf(project.id)).assets.find(asset => asset.id === assetId)
    expect(exported?.mime.startsWith('video/')).toBe(true)
    const duration = await page.evaluate(async url => await new Promise<number>((resolve) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => { resolve(video.duration) }
      video.onerror = () => { resolve(-1) }
      video.src = url
    }), href)
    expect(duration).toBeGreaterThan(3.8)
    expect(duration).toBeLessThan(4.3)
    // The export link belongs to this timeline only.
    await page.locator('[data-testid="dv-timeline-editor"]').getByRole('button', { name: '＋ 新建' }).click()
    await expect.poll(() => link.count()).toBe(0)
  })

  it('a timeline of 3 running renders shows 3 placeholder clips at once, each becomes playable as its render finishes, and export waits for all', async () => {
    const created = await harness.api.post('/api/dv/projects', { title: 'timeline-pending', surface: 'canvas' }) as { id: string }
    const project = created.id
    const imported = await runOperation(project, 'asset.import', { base64: PNG_BASE64, mime: 'image/png', name: 'ref.png' })
    await runOperation(project, 'character.create', { character: 'c1', name: 'Dancer' }, [{ role: 'reference', ref: imported.outputs[0] ?? '' }])
    harness.backend.hold()
    // Each render call waits at the held backend until a release, so its record stays running.
    const rendering = [1, 2, 3].map(shot => runOperation(project, RENDER_OPERATION, {
      modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: `timeline-pending shot ${String(shot)}`, duration_sec: shot === 2 ? 2 : 1,
    }, [{ role: 'reference', ref: 'c1@1' }]))
    try {
      const running = await waitFor(async () => {
        const renders = (await stateOf(project)).components.proj.records.filter(record => record.operation === RENDER_OPERATION)
        return renders.length === 3 ? renders.sort((a, b) => String(a.params['prompt']).localeCompare(String(b.params['prompt']))) : null
      }, 'three running renders of timeline-pending')
      // Timeline t1 lays out the video outputs of the running renders as placeholders right away.
      await runOperation(project, 'timeline.create', { timeline: 't1' }, running.map(render => ({ role: 'clip', ref: `${render.id}#0` })))
      const clipAssets = async () => (await stateOf(project)).components.timeline.timelines[0]?.clips.map(clip => clip.asset)
      await expect.poll(clipAssets).toEqual([null, null, null])
      const page = await openPage()
      await gotoProject(page, project)
      const takes = page.locator('[data-node-type="shot"]')
      await expect.poll(() => takes.count()).toBe(3)
      expect(await takes.allTextContents()).toEqual([expect.stringContaining('渲染中…'), expect.stringContaining('渲染中…'), expect.stringContaining('渲染中…')])
      await viewToggle(page, '时间线').click()
      const status = (): Promise<string[]> => page.locator('[data-clip-position]').evaluateAll(clips => clips.map(clip => clip.getAttribute('data-clip-status') ?? ''))
      await expect.poll(status).toEqual(['rendering', 'rendering', 'rendering'])
      // Each placeholder keeps the length of its shot, so the timeline is as long as the three shots.
      expect((await timelineTime(page))[1]).toBeCloseTo(4, 1)
      expect(await page.locator('[data-clip-position="1"]').getAttribute('title')).toContain('渲染中…')
      expect(await page.locator('[data-clip-position="1"] [data-trim]').count()).toBe(0)
      expect(await page.locator('[data-testid="dv-timeline-viewer-placeholder"]').textContent()).toBe('片段 1：渲染中…')
      const exportButton = page.getByRole('button', { name: '导出' })
      expect(await exportButton.isDisabled()).toBe(true)
      expect(await page.locator('[data-testid="dv-timeline-export-waiting"]').textContent()).toBe('片段 1, 2, 3 还没就绪，全部就绪后才能导出')
      // The export operation refuses the call too, naming the clips that are not ready.
      const refused = await harness.api.post('/api/dv/operation', {
        project, operation: 'timeline.export', params: { timeline: 't1' }, inputs: [], surface: 'timeline', intent: 'export early',
      }).then(() => '', (error: unknown) => String(error))
      expect(refused).toContain('Clips 1, 2, 3 of timeline t1 are not ready yet.')
      // Each finished render turns its placeholder into a clip the viewer plays; the others stay placeholders.
      for (let finished = 1; finished <= 3; finished += 1) {
        harness.backend.release()
        await expect.poll(async () => (await status()).filter(entry => entry === 'ready').length, { timeout: 60_000 }).toBe(finished)
        const clips = (await stateOf(project)).components.timeline.timelines[0]?.clips ?? []
        const ready = (await status()).flatMap((entry, index) => entry === 'ready' ? [index] : [])
        for (const index of ready) {
          const clip = page.locator(`[data-clip-position="${String(index + 1)}"]`)
          const box = await clip.boundingBox()
          const ruler = await page.locator('[data-testid="dv-timeline-ruler"]').boundingBox()
          if (box === null || ruler === null) throw new Error(`clip ${String(index + 1)} or the ruler is not on screen`)
          await page.mouse.click(box.x + box.width / 2, ruler.y + ruler.height / 2)
          await expect.poll(() => viewerAsset(page)).toBe(clips[index]?.asset)
        }
        expect(await exportButton.isDisabled()).toBe(finished < 3)
      }
      expect(await page.locator('[data-testid="dv-timeline-export-waiting"]').count()).toBe(0)
      expect((await timelineTime(page))[1]).toBeCloseTo(4, 1)
      await exportButton.click()
      await page.locator('[data-testid="dv-timeline-exported"]').waitFor({ timeout: 60_000 })
      expect(page.errors).toEqual([])
    } finally {
      harness.backend.releaseAll()
      await Promise.allSettled(rendering)
    }
  })

  it('a timeline the agent creates appears as a tab without moving the creator off the open timeline', async () => {
    const project = await seedProject('timeline-agent', 2, [1])
    model.rules.push({ match: 'make-timeline-four', steps: [{ calls: [{ name: 'dv_timeline_create', args: { reason: '新建时间线 4', timeline: 't4', assets: [] } }] }] })
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await timelineTab(page, '时间线 2').click()
    await page.locator('[data-clip-position="1"]').click()
    const composer = page.locator('[data-dv-chat] [contenteditable="true"]').first()
    await composer.waitFor({ timeout: 30_000 })
    await composer.click()
    await page.keyboard.type('make-timeline-four')
    await page.keyboard.press('Enter')
    await expect.poll(() => timelineTabs(page), { timeout: 60_000 }).toEqual(['时间线 1', '时间线 2*', '时间线 4'])
    expect(await trackClips(page)).toEqual(['1*'])
  })

  it('an edit from elsewhere does not move the selection onto a different clip', async () => {
    const project = await seedProject('timeline-external', 3)
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await page.locator('[data-clip-position="2"]').click()
    const selectedAsset = project.clipAssets[1]
    await runOperation(project.id, 'timeline.clip_remove', { clip: await clipAt(project.id, 1) })
    await expect.poll(() => trackClips(page)).toHaveLength(2)
    // Whatever stays selected must be the clip the creator picked, so Delete cannot remove a clip they never chose.
    const selected = await page.locator('[data-clip-position][aria-pressed="true"]').evaluateAll(clips => clips.map(clip => clip.getAttribute('aria-label') ?? ''))
    const clips = (await stateOf(project.id)).components.timeline.timelines[0]?.clips ?? []
    for (const label of selected) {
      const position = Number(/(\d+)/.exec(label)?.[1])
      expect(clips[position - 1]?.asset).toBe(selectedAsset)
    }
  })

  it('the selected timeline survives canvas ↔ timeline switches and a reload', async () => {
    const project = await seedProject('timeline-location', 2, [1, 0])
    const page = await openPage()
    await gotoProject(page, project.id, 'timeline')
    await timelineTab(page, '时间线 2').click()
    for (let round = 0; round < 3; round += 1) {
      await viewToggle(page, '画布').click()
      await page.locator('[data-testid="dv-canvas-view"]').waitFor()
      await viewToggle(page, '时间线').click()
      await page.locator('[data-testid="dv-timeline-editor"]').waitFor()
    }
    expect(await timelineTabs(page)).toEqual(['时间线 1', '时间线 2*', '时间线 3'])
    await page.reload({ waitUntil: 'load' })
    await page.locator('[data-testid="dv-timeline-editor"] [role="tab"]').first().waitFor({ timeout: 30_000 })
    await expect.poll(() => timelineTabs(page), { timeout: 5000 }).toEqual(['时间线 1', '时间线 2*', '时间线 3'])
    expect(await trackClips(page)).toEqual(['1'])
    expect(page.errors).toEqual([])
  })

  it('the timeline editor follows the light theme of the app', async () => {
    const project = await seedProject('timeline-theme', 2)
    const page = await openPage({ scheme: 'light' })
    await gotoProject(page, project.id, 'timeline')
    // The track area and toolbar sit on the app's light surface; only the video viewer stays black.
    expect(luminance(await backgroundOf(page.locator('[data-testid="dv-timeline-editor"]')))).toBeGreaterThan(0.8)
  })
})

/** The visible History panel; a replaced panel can linger for a moment, so only the visible one counts. */
function historyPanel(page: Page): Locator {
  return page.locator('[data-testid="dv-history-panel"]:visible').first()
}

/**
 * Open the History tab of the right panel; the right-panel button reopens a collapsed panel.
 * @param page - a page showing a project workspace.
 */
async function openHistory(page: Page): Promise<void> {
  const tab = page.locator('[role="tab"]', { hasText: /^历史$/ }).filter({ visible: true }).first()
  const shown = await tab.waitFor({ timeout: 5000 }).then(() => true, () => false)
  if (!shown) await page.getByRole('button', { name: '打开右侧面板', exact: true }).click()
  // A project switch remounts the right panel's session seat, so the tab found first can be replaced mid-click.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await tab.click({ timeout: 3000 }).then(() => true, () => false)) break
  }
  await expect.poll(() => historyPanel(page).count(), { timeout: 15_000 }).toBe(1)
}

/**
 * Choose 回到这一步 in the ⋮ menu of one record's History row, and wait until the list marks that row as the current step.
 * @param page - a page showing the History panel.
 * @param record - the record to go to.
 */
async function goBackTo(page: Page, record: string): Promise<void> {
  const row = historyPanel(page).locator(`[data-testid="dv-history-row"][data-record="${record}"]`)
  await row.locator('[data-testid="dv-history-step-actions"]').click()
  await row.locator('[data-testid="dv-history-step-back"]').click()
  await expect.poll(() => row.getAttribute('data-place'), { timeout: 15_000 }).toBe('current')
}

describe('going back and keep anyway', () => {
  it('the workspace has no branch controls; 回到这一步 shows an earlier state on the canvas and the timeline, and moves forward to the later step again', async () => {
    const project = await seedProject('go-back', 1)
    const page = await openPage()
    await gotoProject(page, project.id)
    const takes = page.locator('[data-node-type="shot"]')
    await expect.poll(() => takes.count(), { timeout: 15_000 }).toBe(1)
    expect(await page.locator('[data-testid="dv-kit-branch-menu"]').count()).toBe(0)
    // A plain edit is the step to come back to.
    const earlier = (await runOperation(project.id, 'timeline.rename', { timeline: 't1', name: 'go-back base' })).id
    // Two more edits: one more take on the canvas and a second timeline.
    await runOperation(project.id, RENDER_OPERATION, { modality: 'video', task: 'ref2v', provider: 'fastvideo', model: 'fasth3', prompt: 'go-back shot', duration_sec: 1 }, [{ role: 'reference', ref: 'c1@1' }])
    await expect.poll(() => takes.count(), { timeout: 30_000 }).toBe(2)
    await viewToggle(page, '时间线').click()
    await page.locator('[data-testid="dv-timeline-editor"]').getByRole('button', { name: '＋ 新建' }).click()
    await expect.poll(() => timelineTabs(page)).toHaveLength(2)
    const later = (await stateOf(project.id)).head
    // Back to the step before the two edits: the timeline and the canvas show that state.
    await openHistory(page)
    await expect.poll(() => historyPanel(page).locator('[data-testid="dv-history-row"]').first().getAttribute('data-record')).toBe(later)
    await goBackTo(page, earlier)
    await expect.poll(() => timelineTabs(page), { timeout: 15_000 }).toHaveLength(1)
    await viewToggle(page, '画布').click()
    await expect.poll(() => takes.count()).toBe(1)
    expect((await stateOf(project.id)).components.timeline.timelines.map(timeline => timeline.id)).toEqual(['t1'])
    // Until a new edit, the later steps stay greyed in the history, so the project can move forward to them.
    expect(await historyPanel(page).locator(`[data-testid="dv-history-row"][data-record="${later}"]`).getAttribute('data-place')).toBe('after')
    await goBackTo(page, later)
    await expect.poll(() => takes.count(), { timeout: 15_000 }).toBe(2)
    expect((await stateOf(project.id)).components.timeline.timelines.map(timeline => timeline.id)).toEqual(['t1', 't2'])
    expect(page.errors).toEqual([])
  })

  it('仍然保留 on a stale take node and on a stale clip removes that mark', async () => {
    const project = await seedProject('keep-anyway', 2)
    const state = await stateOf(project.id)
    const frame = state.assets.find(asset => asset.mime.startsWith('image/') && asset.name !== 'ref.png')
    await runOperation(project.id, 'character.update', { character: 'c1' }, [{ role: 'reference', ref: frame?.id ?? '' }])
    const page = await openPage()
    await gotoProject(page, project.id)
    const staleTakes = page.locator('[data-node-type="shot"][data-node-stale="true"]')
    await expect.poll(() => staleTakes.count()).toBe(2)
    await staleTakes.first().dblclick()
    const editor = page.locator('[data-testid="dv-canvas-node-editor"]')
    await editor.getByRole('button', { name: '仍然保留', exact: true }).click()
    await expect.poll(() => staleTakes.count()).toBe(1)
    await page.keyboard.press('Escape')
    await viewToggle(page, '时间线').click()
    const staleClips = page.locator('[data-clip-stale="true"]')
    await expect.poll(() => staleClips.count()).toBe(1)
    await staleClips.first().click()
    await page.locator('[data-testid="dv-timeline-editor"]').getByRole('button', { name: '仍然保留', exact: true }).click()
    await expect.poll(() => staleClips.count()).toBe(0)
    await viewToggle(page, '画布').click()
    await expect.poll(() => staleTakes.count()).toBe(0)
  })
})

describe('English interface', () => {
  it('every canvas and timeline label, editor, picker, and empty state is in English', async () => {
    const project = await seedProject('english', 2, [0])
    const page = await openPage({ lang: 'en-US' })
    await gotoProject(page, project.id)
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en')
    /** CJK text in the workspace chrome; project titles and prompts here are ASCII, so any CJK is interface copy. */
    const chinese = async (): Promise<string[]> => await page.locator('[data-dv-workspace]').evaluate((root) => {
      const found = new Set<string>()
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent?.trim() ?? ''
        if (/[一-鿿]/.test(text)) found.add(text)
      }
      for (const element of root.querySelectorAll('[aria-label], [title], [placeholder]')) {
        for (const name of ['aria-label', 'title', 'placeholder']) {
          const value = element.getAttribute(name) ?? ''
          if (/[一-鿿]/.test(value)) found.add(`${name}=${value}`)
        }
      }
      return [...found]
    })
    expect(await chinese()).toEqual([])
    for (const kind of ['shot', 'character']) {
      await page.locator(`[data-node-type="${kind}"]`).first().dblclick()
      await page.locator('[data-testid="dv-canvas-node-editor"]').waitFor()
      expect(await chinese()).toEqual([])
      await page.locator('[data-testid="dv-canvas-node-editor"]').getByRole('button', { name: 'Close' }).click()
    }
    await viewToggle(page, 'Timeline').click()
    await page.locator('[data-testid="dv-timeline-editor"]').waitFor()
    expect(await timelineTabs(page)).toEqual(['Timeline 1*', 'Timeline 2'])
    expect(await chinese()).toEqual([])
    await timelineTab(page, 'Timeline 2').click()
    await page.getByRole('button', { name: 'Insert clip' }).click()
    expect(await chinese()).toEqual([])
    const created = await harness.api.post('/api/dv/projects', { title: 'english-empty', surface: 'canvas' }) as { id: string }
    await gotoProject(page, created.id)
    expect(await chinese()).toEqual([])
    await viewToggle(page, 'Timeline').click()
    await page.locator('[data-testid="dv-timeline-editor"]').waitFor()
    expect(await chinese()).toEqual([])
  })
})
