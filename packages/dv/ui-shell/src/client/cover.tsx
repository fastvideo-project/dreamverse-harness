/**
 * Project covers and card metadata for the entry page and the session switcher: the cover and the last edit time that
 * `GET /api/dv/projects/summary` computes from each project's current state.
 *
 * @module @dv/ui-shell/cover
 */
import type { ReactNode } from 'react'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { PickText } from '@dv/ui-kit/locale.ts'
import type { Asset, SummaryQuery, WireProjectCover, WireProjectSummary } from '@dv/ui-kit/types.ts'
import { useLoader } from '@dv/ui-kit/useProject.ts'
import type { MediaPurpose } from '@dv/ui-media/contract'
import { shellClient } from './store.ts'

/**
 * Read project card summaries in one request when the component mounts and again whenever `refresh` or `narrow`
 * changes, keeping the last summaries while a read is in flight or after it failed.
 * @param project - the one project to summarize, or null for every project.
 * @param refresh - a value whose change asks for a fresh read, such as the listed project IDs or a refetched state.
 * @param narrow - with `project`, what narrows its summary, such as the open project's center fields.
 * @returns the summaries by project ID, or null until the first read succeeds.
 */
export function useProjectSummaries(
  project: string | null, refresh: unknown, narrow: SummaryQuery = NO_NARROWING,
): ReadonlyMap<string, WireProjectSummary> | null {
  const key = JSON.stringify(narrow)
  return useLoader(async (signal) => {
    const list = await shellClient.listProjectSummaries(signal, project, narrow)
    return new Map(list.map(summary => [summary.project, summary]))
  }, [project, refresh, key]).value
}

const NO_NARROWING: SummaryQuery = {}

/**
 * The asset that `dv.media` draws for a cover. Each field of the wire cover is named by the MIME top-level type of its
 * asset, so the field that holds an asset gives the media type; the first one wins.
 * @param cover - the cover, or null.
 * @returns the asset, or null without a cover.
 */
export function coverAsset(cover: WireProjectCover | null): Asset | null {
  const [type, id] = Object.entries(cover ?? {}).find((field): field is [string, string] => field[1] !== null) ?? []
  if (type === undefined || id === undefined) return null
  return { id, mime: `${type}/*`, name: '', size_bytes: 0, created_by: null, created_at: '', width: null, height: null, duration_sec: null }
}

/**
 * A decorative cover frame beside the project title: the cover asset drawn through `dv.media`, or a neutral block
 * without a cover.
 * @param props - the cover, the purpose it is drawn at, the class of the frame box, the Factory renderer, and overlays
 *   drawn on the frame.
 * @returns the frame.
 */
export function CoverFrame(
  { cover, purpose, className, renderFactorySlot, children }: PropsRenderFactories & {
    cover: WireProjectCover | null
    purpose: MediaPurpose
    className: string | undefined
    children?: ReactNode
  },
): ReactNode {
  const asset = coverAsset(cover)
  return (
    <span className={className} aria-hidden="true">
      {asset !== null && renderFactorySlot('dv.media', { asset, purpose })}
      {children}
    </span>
  )
}

/**
 * Describe when a project was last edited: today's time, 昨天 / Yesterday, or the date.
 * @param iso - the ISO-8601 time.
 * @param t - the string picker.
 * @returns the text.
 */
export function editedText(iso: string, t: PickText): string {
  const at = new Date(iso)
  const today = new Date()
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(at.toDateString()).getTime()) / 86_400_000)
  const time = at.toLocaleTimeString(t('zh-CN', 'en-US'), { hour: '2-digit', minute: '2-digit', hour12: false })
  if (days === 0) return t(`今天 ${time}`, `Today ${time}`)
  if (days === 1) return t('昨天', 'Yesterday')
  return at.toLocaleDateString(t('zh-CN', 'en-US'), { month: 'short', day: 'numeric' })
}
