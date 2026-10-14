/**
 * DSH chrome that DreamVerse hides or replaces: the internal-testing welcome notice, the sidebar's New Session button,
 * page list in the expanded sidebar, and New-Session brand click, the right-panel guide that offers DSH tab types (workspace files,
 * terminal, the canvas and timeline tabs the center already shows), right-panel tab titles frozen in the language of the
 * moment they opened, a few DSH strings that name DeepSeek or Workspaces, and the developer details of the composer
 * (statistics, context meter, host slash commands).
 *
 * @module @dv/ui-shell/chrome
 */
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { useText } from '@dv/ui-kit/locale.ts'
import { ASSET_POOL_KIND, HISTORY_KIND } from './actions.ts'
import { CHAT_ID, TRAJECTORY_ID } from './tabs.tsx'
import css from './chrome.module.css'

/** Implementation identity of the 素材库 tab that `@dv/ui-asset-pool` registers. */
const ASSET_POOL_ID = '@dv/ui-asset-pool'

/** Implementation identity of the 历史 tab that `@dv/ui-history` registers. */
const HISTORY_ID = '@dv/ui-history'

/**
 * Sidebar controls DreamVerse hides. The DSH sidebar draws them without a DSH UI slot, so the shell hides them by their CSS
 * Module class names, whose hashed prefix varies and whose `_name` suffix does not: the New Session button (expanded
 * and rail), the page list while the sidebar is expanded (the navigator lists 插件, MCP, … below 首页; the collapsed rail
 * keeps the DSH icons, where the navigator draws nothing; only the expanded rows carry a `_panelTitle` label), and the
 * brand's New Session click. The composer's context-occupancy meter has no DSH UI slot either; its button is found by its
 * accessible label. Composer menu rows show their localized label only, without the internal name (`file`) beside it.
 * The brand mark slot holds an empty entry (no DSH whale), so its empty wrappers collapse, and the collapsed rail shows
 * its expand icon at rest instead of a blank button.
 */
const HIDDEN_CHROME_CSS = `
button[class$="_newSession"] { display: none !important; }
nav[class$="_panelList"]:has(span[class*="_panelTitle"]) { display: none !important; }
button[class*="_brand "] { pointer-events: none; cursor: default; }
button[aria-label^="上下文已用"], button[aria-label$=" of context used"] { display: none !important; }
[data-trigger-menu] span[class$="_itemAlias"] { display: none !important; }
span[class$="_brandMark"]:has(> [data-slot="sidebar.brand.mark"]:empty) { display: none !important; }
span[class$="_railMark"]:has(> [data-slot="sidebar.brand.mark"]:empty) { display: none !important; }
span[class$="_railMark"]:has(> [data-slot="sidebar.brand.mark"]:empty) ~ [class*="_panelIcon"] { display: inline !important; }
`

/** DSH dictionary entries DreamVerse rewords: namespace → key → [Chinese, English]. */
const TEXT_OVERRIDES: Record<string, Record<string, [string, string]>> = {
  chat: {
    'chat.deepDiving': ['思考中', 'Thinking…'],
    'message.turnProcess.deepDivingFor': ['思考中，用时{duration}', 'Thinking for {duration}'],
  },
  conversation: {
    // Shown while the entry page's chat session is still opening.
    'placeholder.workspace': ['正在准备对话…', 'Preparing the chat…'],
    'placeholder.default': ['描述你想做的视频，@ 引用片段、角色或素材', 'Describe the video you want; type @ to reference clips, characters, or assets'],
    'placeholder.hero': ['描述你想做的视频，@ 引用片段、角色或素材', 'Describe the video you want; type @ to reference clips, characters, or assets'],
  },
}

/*
 * The DreamVerse logo, drawn on the wordmark's grid: 544 x 64 units, letters 48 units tall (y 8 to 56) in Kanit Black
 * Italic slanted 18° like the FastVideo wordmark. The mark is its first three shapes: the speed lines, the D, and the
 * yellow film camera inside the D.
 */
/** The three speed lines before the D. */
const LOGO_LINES =
  'M13.80 56L29.40 8H33.60L18.00 56ZM8.80 56L24.40 8H26.80L11.20 56ZM5.00 56L20.60 8H21.80L6.20 56Z'

/** The D's outline; the film camera is painted over it. */
const LOGO_D =
  'M23.20 56.00 38.73 8.00L61.54 8.00Q67.51 8.00 71.88 10.16Q76.26 12.32 78.45 16.39' +
  'Q80.64 20.45 79.99 26.26Q79.83 27.68 79.47 29.17Q79.12 30.66 78.56 32.30Q75.77 40.57 71.60 45.83' +
  'Q67.43 51.08 61.23 53.54Q55.03 56.00 46.01 56.00Z'

/** The film camera inside the D: two reels, the body, and the lens. */
const LOGO_CAMERA =
  'M52.00 24.39C51.29 26.56 48.97 28.31 46.81 28.31C44.65 28.31 43.46 26.56 44.16 24.39' +
  'C44.87 22.23 47.19 20.48 49.35 20.48C51.52 20.48 52.70 22.23 52.00 24.39ZM61.26 24.39' +
  'C60.55 26.56 58.23 28.31 56.07 28.31C53.90 28.31 52.72 26.56 53.42 24.39' +
  'C54.13 22.23 56.45 20.48 58.61 20.48C60.77 20.48 61.96 22.23 61.26 24.39ZM43.96 28.84L58.56 28.84' +
  'Q59.63 28.84 59.28 29.91L56.51 38.46Q56.16 39.52 55.09 39.52L40.49 39.52Q39.42 39.52 39.77 38.46' +
  'L42.55 29.91Q42.90 28.84 43.96 28.84ZM58.55 34.36L66.25 29.29L62.98 39.35Z'

/** REAMVERSE, after the D. */
const LOGO_LETTERS =
  'M76.10 56.00 91.63 8.00L118.62 8.00Q125.62 8.00 129.10 11.88Q132.58 15.75 131.90 21.79' +
  'Q131.67 23.80 130.98 25.96Q129.47 30.81 126.04 34.42Q122.62 38.04 117.80 40.50Q118.88 41.47 119.01 42.96' +
  'L120.45 56.00L101.67 56.00L100.41 45.34Q100.29 43.78 98.80 43.78L98.05 43.78L94.14 56.00ZM102.69 29.69' +
  'L107.09 29.69Q111.48 29.69 112.65 25.96Q112.76 25.59 112.83 25.29Q112.91 24.99 112.94 24.70' +
  'Q113.23 22.09 109.80 22.09L105.11 22.09ZM126.50 56.00 142.03 8.00L180.41 8.00L176.20 20.97L155.85 20.97' +
  'L154.47 25.29L171.99 25.29L167.65 38.71L150.13 38.71L148.68 43.03L169.02 43.03L164.88 56.00Z' +
  'M167.87 56.00 201.89 8.00L220.60 8.00L223.55 56.00L205.66 56.00L205.10 47.06L193.48 47.06L187.18 56.00Z' +
  'M199.40 34.76L206.71 34.76L206.02 25.59ZM228.85 56.00 244.38 8.00L261.08 8.00L264.44 27.83L280.53 8.00' +
  'L298.12 8.00L282.59 56.00L264.56 56.00L270.03 39.16L262.94 47.80L253.77 47.80L252.36 39.16L246.89 56.00Z' +
  'M306.38 56.00 303.42 8.00L321.68 8.00L322.04 34.68L339.80 8.00L359.10 8.00L325.09 56.00Z' +
  'M348.80 56.00 364.33 8.00L402.71 8.00L398.50 20.97L378.15 20.97L376.77 25.29L394.29 25.29L389.95 38.71' +
  'L372.43 38.71L370.98 43.03L391.32 43.03L387.18 56.00ZM391.74 56.00 407.27 8.00L434.25 8.00' +
  'Q441.26 8.00 444.73 11.88Q448.21 15.75 447.53 21.79Q447.31 23.80 446.62 25.96Q445.10 30.81 441.68 34.42' +
  'Q438.25 38.04 433.43 40.50Q434.51 41.47 434.64 42.96L436.09 56.00L417.30 56.00L416.04 45.34' +
  'Q415.92 43.78 414.43 43.78L413.68 43.78L409.78 56.00ZM418.32 29.69L422.72 29.69' +
  'Q427.12 29.69 428.28 25.96Q428.40 25.59 428.47 25.29Q428.54 24.99 428.57 24.70Q428.87 22.09 425.44 22.09' +
  'L420.74 22.09ZM458.37 56.75Q453.30 56.75 448.89 55.89Q444.48 55.03 441.83 53.39L446.18 39.90' +
  'Q449.19 41.61 453.20 42.73Q457.21 43.85 460.64 43.85Q463.03 43.85 464.51 43.22Q466.00 42.58 466.13 41.39' +
  'Q466.27 40.20 464.18 39.53Q462.10 38.86 458.83 37.44Q454.28 35.43 452.18 32.93Q450.07 30.43 450.53 26.41' +
  'Q450.75 24.40 451.52 22.24Q454.01 14.63 460.02 10.94Q466.02 7.25 477.50 7.25Q479.88 7.25 482.68 7.59' +
  'Q485.47 7.93 488.10 8.45Q490.72 8.97 492.52 9.57L488.09 23.13Q484.63 21.42 481.68 20.82' +
  'Q478.72 20.22 476.34 20.22Q475.00 20.22 473.56 20.37Q472.13 20.52 471.08 20.97Q470.02 21.42 469.92 22.31' +
  'Q469.82 23.20 471.37 23.69Q472.91 24.17 476.08 25.22Q482.13 27.08 484.23 29.91Q486.34 32.75 485.88 36.77' +
  'Q485.76 37.89 485.47 39.08Q485.19 40.27 484.74 41.61Q483.26 46.16 480.08 49.59Q476.90 53.02 471.62 54.88' +
  'Q466.35 56.75 458.37 56.75ZM485.37 56.00 500.90 8.00L539.29 8.00L535.07 20.97L514.72 20.97L513.34 25.29' +
  'L530.86 25.29L526.52 38.71L509.00 38.71L507.55 43.03L527.90 43.03L523.76 56.00Z'

/** The blue (`#356CFF`) and yellow (`#FDC717`) path data of the full wordmark, for the sidebar brand. */
export const DREAMVERSE_WORDMARK = { blue: LOGO_LINES + LOGO_D + LOGO_LETTERS, yellow: LOGO_CAMERA }

/** The DreamVerse mark (speed lines, D, and film camera) in a 64-unit square, as a data URL for the browser tab. */
export const DREAMVERSE_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g transform="translate(-3.10 5.78) scale(0.8193)">' +
  `<path fill="#356CFF" d="${LOGO_LINES}${LOGO_D}"/><path fill="#FDC717" d="${LOGO_CAMERA}"/></g></svg>`,
)}`

/** Renders nothing in place of a DSH UI slot entry DreamVerse hides. */
function Hidden(): ReactNode {
  return null
}

/**
 * Remove the host slash commands (feedback, compact, permission, export, goal, plan) from the composer: DreamVerse
 * has no slash commands for creators, and the composer's ＋ menu keeps its file action. The command catalog fetcher
 * of `ctx.commandUi` is replaced by one that lists nothing; `ui-commands` has no public filter for host commands.
 * @param commandUi - the `commandUi` service.
 * @returns a disposer that restores the fetcher.
 */
function hideHostCommands(commandUi: unknown): () => void {
  const directory: unknown = Reflect.get(commandUi as object, 'directory')
  if (directory === null || typeof directory !== 'object') return () => {}
  const fetchCommands: unknown = Reflect.get(directory, 'fetchCommands')
  const invalidate = (): void => { Reflect.apply(Reflect.get(directory, 'invalidateAll') as () => void, directory, []) }
  if (typeof fetchCommands !== 'function') return () => {}
  Reflect.set(directory, 'fetchCommands', () => Promise.resolve([]))
  invalidate()
  return () => {
    Reflect.set(directory, 'fetchCommands', fetchCommands)
    invalidate()
  }
}

/** The right-panel tab kinds the DreamVerse guide offers, in order. */
const GUIDE_KINDS = ['dv-chat', ASSET_POOL_KIND, HISTORY_KIND, 'dv-trajectory'] as const

/**
 * Rewrite the DSH dictionary entries in `TEXT_OVERRIDES` in place. The locale runtime keeps one dictionary object per
 * namespace and language and reads it on every translation, so editing the registered object changes the text without
 * a second registration, which the runtime refuses.
 * @param locale - `ctx.locale`.
 */
function overrideTexts(locale: unknown): void {
  const dicts: unknown = Reflect.get(locale as object, 'dicts')
  if (!(dicts instanceof Map)) return
  for (const [ns, entries] of Object.entries(TEXT_OVERRIDES)) {
    const byLocale: unknown = dicts.get(ns)
    if (!(byLocale instanceof Map)) continue
    for (const [key, [zh, en]] of Object.entries(entries)) {
      const zhDict: unknown = byLocale.get('zh')
      const enDict: unknown = byLocale.get('en')
      if (zhDict !== null && typeof zhDict === 'object') Reflect.set(zhDict, key, zh)
      if (enDict !== null && typeof enDict === 'object') Reflect.set(enDict, key, en)
    }
  }
}

/**
 * The welcome-notice onboarding step in DreamVerse: completes at once, so the DSH internal-testing modal never shows.
 * @param props - the onboarding coordinator's props.
 * @returns nothing.
 */
function SkipWelcome({ complete }: { complete: () => void }): ReactNode {
  useEffect(() => { complete() }, [complete])
  return null
}

/** A right-panel tab title that follows the interface language, for the 对话 / 素材库 / 历史 / 轨迹 tabs. */
function liveTitle(zh: string, en: string): (props: PropsRuntime<'sidebar.right.pane.tab.title'>) => ReactNode {
  return function LiveTitle(): ReactNode {
    const t = useText()
    return <>{t(zh, en)}</>
  }
}

/**
 * The right-panel guide (the page a new tab shows): a short hint and the four DreamVerse panels. The canvas and the
 * timeline live in the center and DSH's tab types do not belong to a creator, so neither is offered.
 * @param props - the guide chain props.
 * @returns the guide.
 */
function DreamVerseGuide({ useTabInfo }: PropsRuntime<'sidebar.right.tab.guide'>): ReactNode {
  const { tab } = useTabInfo()
  const t = useText()
  const labels: Record<(typeof GUIDE_KINDS)[number], [string, string]> = {
    'dv-chat': [t('对话', 'Chat'), t('和智能体对话，让它规划和渲染', 'Talk with the agent to plan and render')],
    [ASSET_POOL_KIND]: [t('素材库', 'Asset pool'), t('项目的图片和视频', "The project's images and videos")],
    [HISTORY_KIND]: [t('历史', 'History'), t('项目的每一条记录：谁在哪里做了什么', 'Every record of the project: who did what, and where')],
    'dv-trajectory': [t('轨迹', 'Trajectory'), t('智能体的每一步调用（开发者视图）', 'Every agent step (developer view)')],
  }
  return (
    <div className={css.guide} data-dv-guide="">
      <p className={css.hint}>{t('选择要在这里打开的面板', 'Choose a panel to open here')}</p>
      {GUIDE_KINDS.map(kind => (
        <button key={kind} type="button" className={css.entry} onClick={() => { tab.actions.openTab(kind, { replaceTab: true }) }}>
          <span className={css.entryTitle}>{labels[kind][0]}</span>
          <span className={css.entryDescription}>{labels[kind][1]}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Register the DreamVerse replacements for DSH chrome.
 * @param ctx - client root context with the DSH UI slots and `locale`.
 */
export function applyChrome(ctx: ClientContext): void {
  // The browser tab shows the DreamVerse icon: the page's icon links (DSH's whale) are swapped out while the shell is
  // loaded.
  ctx.effect(() => {
    const icons = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')]
    for (const link of icons) link.remove()
    const icon = document.createElement('link')
    icon.rel = 'icon'
    icon.href = DREAMVERSE_ICON
    document.head.append(icon)
    return () => { icon.remove(); document.head.append(...icons) }
  }, 'ui-shell: DreamVerse tab icon')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@dv/ui-shell/chrome'
    style.textContent = HIDDEN_CHROME_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'ui-shell: hidden DSH chrome')
  ctx.effect(() => {
    // `settings.onboarding` is declared by a settings package this bundle does not type against, so the registry is
    // reached untyped for this one registration.
    const slots: { inject(key: string, fn: () => () => void): () => void; register(options: object, component: unknown): () => void } = Reflect.get(ctx, 'slots')
    return slots.inject('settings.onboarding', () => slots.register(
      { name: 'settings.onboarding', id: 'welcome-notice', order: -100, priority: -1 }, SkipWelcome,
    ))
  }, 'ui-shell: skip the DSH welcome notice')
  ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
    { name: 'conversation.composer.dock', id: 'stats', priority: -1 }, Hidden,
  )), 'ui-shell: hide the composer statistics')
  ctx.effect(() => ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register(
    { name: 'sidebar.brand.mark', priority: -1 }, Hidden,
  )), 'ui-shell: hide the DSH brand mark')
  ctx.inject(['commandUi'], (scope) => {
    scope.effect(() => hideHostCommands(scope.get('commandUi')), 'ui-shell: hide host slash commands')
  })
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.guide', () => ctx.slots.register(
    { name: 'sidebar.right.tab.guide', select: () => true }, DreamVerseGuide,
  )), 'ui-shell: right-panel guide')
  const titles: Array<[string, string, string]> = [
    [CHAT_ID, '对话', 'Chat'], [ASSET_POOL_ID, '素材库', 'Asset pool'], [HISTORY_ID, '历史', 'History'], [TRAJECTORY_ID, '轨迹', 'Trajectory'],
  ]
  for (const [key, zh, en] of titles) {
    ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
      { name: 'sidebar.right.pane.tab.title', key }, liveTitle(zh, en),
    )), `ui-shell: live title ${key}`)
  }
  ctx.effect(() => {
    const locale: unknown = ctx.get('locale')
    overrideTexts(locale)
    // Dictionaries registered later are rewritten when the runtime announces them.
    const subscribe: unknown = locale === undefined ? undefined : Reflect.get(locale as object, 'subscribe')
    if (typeof subscribe !== 'function') return () => {}
    const unsubscribe: unknown = Reflect.apply(subscribe, locale, [() => { overrideTexts(locale) }])
    return typeof unsubscribe === 'function' ? () => { Reflect.apply(unsubscribe, undefined, []) } : () => {}
  }, 'ui-shell: DreamVerse wording')
}
