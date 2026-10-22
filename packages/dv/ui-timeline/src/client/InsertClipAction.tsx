/**
 * 插入片段 / Insert clip in the asset preview of `@dv/ui-media`: an entry of `dv.media.preview.action` that shows for a
 * video asset of the open project, and asks the plugin to insert the asset into the project's timeline view.
 */
import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { mediaTypeOf } from '@dv/ui-kit/media-type.ts'
import type {} from '@dv/ui-media/contract'
import type {} from './locales.ts'

/** What the plugin injects into the action: the open project and the insert gesture. */
export interface InsertClipInjected {
  hooks: { openProject: HostObservable<string | null> }
  /**
   * Show the timeline view of the open project with a request to insert the asset.
   * @param assetId - the asset.
   */
  insert: (assetId: string) => void
}

/** The action's composed props: the previewed asset, the close callback, the injected gesture, and the copy. */
export type InsertClipActionProps = PropsRuntime<'dv.media.preview.action'> & InjectFace<InsertClipInjected> & PropsLocale<'dvTimeline'>

/**
 * The button.
 * @param props - the asset and its project, the preview's button class, the close callback, the open project, the
 *   insert gesture, and the copy.
 * @returns the button, or nothing for an asset that is not a video or not of the open project.
 */
export function InsertClipAction(props: InsertClipActionProps): ReactNode {
  const { asset, projectId, useOpenProject, insert, t } = props
  const open = useOpenProject(project => project)
  if (projectId !== open || mediaTypeOf(asset.mime) !== 'video') return null
  return (
    <button type="button" className={props.buttonClass} onClick={() => { insert(asset.id); props.close() }}>
      {t('preview.insert')}
    </button>
  )
}
