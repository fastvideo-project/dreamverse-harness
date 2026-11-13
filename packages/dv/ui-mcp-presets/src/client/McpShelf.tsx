/**
 * The MCP tools in the entry page's 探索 section. While the MCP plugin is off, a notice row offers to switch it on and
 * the tool cards are dimmed; while it is on, a card adds its preset, and an added card opens the MCP page.
 *
 * @module @dv/ui-mcp-presets/McpShelf
 */
import type { ReactNode } from 'react'
import { useText } from '@dv/ui-kit/locale.ts'
import { addMcpPreset, openMcpPage, switchMcpOn, toolState, useMcpShelf, type McpToolState } from './shelf.ts'
import css from './McpShelf.module.css'

/** One tool card: the preset name `@dv/mcp-presets` offers to the MCP plugin, and its Chinese and English copy. */
interface McpTool {
  readonly name: string
  readonly title: string
  readonly zh: string
  readonly en: string
}

/** The tools the section shows, in order; each name matches a preset of the `dv-mcp-presets` row. */
const TOOLS: readonly McpTool[] = [
  {
    name: 'blender',
    title: 'Blender',
    zh: '让 agent 在运行中的 Blender 里搭建和检查 3D 场景，需要 Blender 开着 MCP 插件（端口 9876）。',
    en: 'Let the agent build and inspect 3D scenes in a running Blender with the MCP add-on on port 9876.',
  },
  {
    name: 'comfyui',
    title: 'ComfyUI',
    zh: '让 agent 运行 ComfyUI 工作流、跟踪任务并取回结果，需要本机 127.0.0.1:8188 上运行着 ComfyUI。',
    en: 'Let the agent run ComfyUI workflows, watch jobs, and collect outputs from a ComfyUI at 127.0.0.1:8188.',
  },
]

/** A plug glyph drawn with a 1.5 px rendered stroke at every size; the 24-unit drawing grid scales the stroke attribute. */
function PlugIcon({ size }: { size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5 * 24 / size} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3v4M15 3v4M6.5 7h11v4a5.5 5.5 0 0 1-11 0V7Z" /><path d="M12 16.5V21" />
    </svg>
  )
}

/**
 * The `dv.explore` entry: the notice row while the MCP plugin is off, or an intro line while it is on, and the cards.
 * @returns the MCP tools.
 */
export function McpShelf(): ReactNode {
  const t = useText()
  const shelf = useMcpShelf()
  return (
    <div className={css.shelf}>
      {shelf.on
        ? <p className={css.intro}>{t('点一下就能把工具接给 agent，之后在对话里直接让它用。', 'Add a tool in one click, then ask the agent to use it in chat.')}</p>
        : <McpNotice />}
      <div className={css.cards}>
        {TOOLS.map(tool => <ToolCard key={tool.name} tool={tool} state={toolState(shelf, tool.name)} />)}
      </div>
    </div>
  )
}

/**
 * The notice row while the MCP plugin is off: what the tools need, the switch, and a failed switch with a link to the
 * Plugins page.
 * @returns the notice row.
 */
function McpNotice(): ReactNode {
  const t = useText()
  const shelf = useMcpShelf()
  const failure = shelf.error !== null && shelf.error.tool === null ? shelf.error.message : null
  return (
    <div className={css.notice} data-mcp-locked="">
      <span className={css.noticeIcon}><PlugIcon size={16} /></span>
      <span className={css.noticeText}>
        <span className={css.noticeTitle}>{t('接入 Blender、ComfyUI 等工具', 'Connect Blender, ComfyUI, and more')}</span>
        <span className={css.noticeBody}>{t('开启 MCP 插件后，agent 可以在对话里直接使用这些工具。', 'Turn on the MCP plugin so the agent can use these tools in chat.')}</span>
      </span>
      <button type="button" className={css.noticeButton} disabled={shelf.enabling} onClick={switchMcpOn}>
        {shelf.enabling ? t('正在开启…', 'Turning on…') : t('开启 MCP', 'Turn on MCP')}
      </button>
      {failure !== null && (
        <p className={css.noticeError} role="alert" title={failure}>
          {t('MCP 开启失败。请重试，或到', 'Could not turn on MCP. Try again, or check the ')}
          <button type="button" className={css.link} onClick={() => { openMcpPage('plugins') }}>{t('插件页', 'Plugins page')}</button>
          {t('查看。', '.')}
        </p>
      )}
    </div>
  )
}

/**
 * One tool: a tile, its description, and its state; choosing an added tool opens the MCP page.
 * @param props - the tool and its card state.
 * @returns the card.
 */
function ToolCard({ tool, state }: { tool: McpTool; state: McpToolState }): ReactNode {
  const t = useText()
  const shelf = useMcpShelf()
  const failure = shelf.error?.tool === tool.name ? shelf.error.message : null
  const status: Record<McpToolState, string> = {
    locked: t('开启 MCP 后可添加', 'Available once MCP is on'),
    available: failure === null ? t('添加', 'Add') : t('添加失败，点击重试', 'Could not add; click to retry'),
    adding: t('添加中…', 'Adding…'),
    connecting: t('已添加 · 连接中…', 'Added · Connecting…'),
    connected: t('已添加 · 已连接', 'Added · Connected'),
    failed: t('已添加 · 连接失败', 'Added · Connection failed'),
  }
  const added = state === 'connecting' || state === 'connected' || state === 'failed'
  const shown = state === 'available' && failure !== null ? 'error' : state
  return (
    <button
      type="button" className={css.card} data-tool={tool.name} data-state={shown}
      disabled={state === 'locked' || state === 'adding'} title={failure ?? undefined}
      onClick={() => { if (added) openMcpPage('mcp'); else addMcpPreset(tool.name) }}
    >
      <span className={css.tile} data-tool={tool.name}>
        <span className={css.badge}><PlugIcon size={12} />MCP</span>
        <span className={css.tileName}>{tool.title}</span>
      </span>
      <span className={css.text}>
        <span className={css.title}>{tool.title}</span>
        <span className={css.description}>{t(tool.zh, tool.en)}</span>
        <span className={css.status} data-state={shown}>{status[state]}</span>
      </span>
    </button>
  )
}
