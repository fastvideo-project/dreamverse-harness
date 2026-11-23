/**
 * The servers DreamVerse suggests, as a section of the MCP page: a heading, an introduction line, and one card per tool;
 * a card adds its preset to the MCP roster, and an added card shows its connection state.
 *
 * @module @dv/ui-mcp-presets/McpShelf
 */
import type { ReactNode } from 'react'
import { useText } from '@dv/ui-kit/locale.ts'
import { addMcpPreset, toolState, useMcpShelf, type McpToolState } from './shelf.ts'
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
 * The `mcp.page.section` entry: the heading, the introduction line, and the cards.
 * @returns the section.
 */
export function McpShelf(): ReactNode {
  const t = useText()
  const shelf = useMcpShelf()
  return (
    <section className={css.shelf} aria-labelledby="dv-mcp-presets">
      <h2 id="dv-mcp-presets" className={css.heading}>{t('DreamVerse 推荐', 'Suggested by DreamVerse')}</h2>
      <p className={css.intro}>{t('点一下就能把工具接给 agent，之后在对话里直接让它用。', 'Add a tool in one click, then ask the agent to use it in chat.')}</p>
      <div className={css.cards}>
        {TOOLS.map(tool => <ToolCard key={tool.name} tool={tool} state={toolState(shelf, tool.name)} />)}
      </div>
    </section>
  )
}

/**
 * One tool: a tile, its description, and its state; an available tool is added on click, and an added tool is inert.
 * @param props - the tool and its card state.
 * @returns the card.
 */
function ToolCard({ tool, state }: { tool: McpTool; state: McpToolState }): ReactNode {
  const t = useText()
  const shelf = useMcpShelf()
  const failure = shelf.error?.tool === tool.name ? shelf.error.message : null
  const status: Record<McpToolState, string> = {
    loading: t('正在读取…', 'Loading…'),
    available: failure === null ? t('添加', 'Add') : t('添加失败，点击重试', 'Could not add; click to retry'),
    adding: t('添加中…', 'Adding…'),
    connecting: t('已添加 · 连接中…', 'Added · Connecting…'),
    connected: t('已添加 · 已连接', 'Added · Connected'),
    failed: t('已添加 · 连接失败', 'Added · Connection failed'),
  }
  const shown = state === 'available' && failure !== null ? 'error' : state
  return (
    <button
      type="button" className={css.card} data-tool={tool.name} data-state={shown}
      disabled={state !== 'available'} title={failure ?? undefined}
      onClick={() => { addMcpPreset(tool.name) }}
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
