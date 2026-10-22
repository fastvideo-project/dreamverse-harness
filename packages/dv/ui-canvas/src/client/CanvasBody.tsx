/**
 * The canvas as a right-Sidebar tab body: the project and undo bar (`ProjectBar`) above a {@link CanvasView} of the
 * selected project's current state, whose assets draw through `dv.media` and open the `dvMedia` preview. The body
 * declares no canvas slot and passes no slot renderer, so its entry editors show only their header and its asset picker
 * lists only the version items; the center view (`CanvasCenter.tsx`) renders the `dv.canvas.editor` and
 * `dv.canvas.picker` entries.
 */
import { useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { DvClient } from '@dv/ui-kit/api.ts'
import { ProjectBar } from '@dv/ui-kit/ProjectBar.tsx'
import type { ProjectBarLabels } from '@dv/ui-kit/ProjectBar.tsx'
import type { DvCanvas } from '@dv/ui-kit/registries.ts'
import type { Asset } from '@dv/ui-kit/types.ts'
import { useViewSession } from '@dv/ui-kit/useView.ts'
import { CanvasView } from './CanvasView.tsx'
import type {} from './locales.ts'

/** What the plugin hands the body beside the standard props of its DSH UI slot. */
export interface CanvasInjected {
  client: DvClient
  /** The `dvCanvas` registries that the plugin provides. */
  canvas: DvCanvas
  /** Opens the asset preview of `dvMedia`; nothing opens while `@dv/ui-media` is not loaded. */
  preview: (asset: Asset, opener: Element | null) => void
}

/** The body's composed props: the tab it draws, the API client, the canvas registries, the preview, its copy, and the
 *  Factory renderer. */
export type CanvasBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & CanvasInjected & PropsLocale<'dvCanvas'> & PropsRenderFactories

const root: CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontSize: 12, lineHeight: '16px' }

/**
 * The project and undo bar's copy in the canvas namespace.
 * @param t - namespace-bound translate.
 * @returns the labels.
 */
export function barLabels(t: CanvasBodyProps['t']): ProjectBarLabels {
  return {
    project: t('bar.project'), undo: t('bar.undo'), newProject: t('bar.newProject'), newProjectPrompt: t('bar.newProjectPrompt'),
    noProject: t('bar.noProject'),
  }
}

/**
 * The body.
 * @param props - the API client, the canvas registries, the preview, the copy and the Factory renderer; the tab
 *   information is unused because the canvas keeps one page per kind.
 * @returns the element.
 */
export function CanvasBody({ client, canvas, preview, t, renderFactorySlot }: CanvasBodyProps): ReactNode {
  const view = useViewSession(client, 'canvas')
  const labels = useMemo(() => barLabels(t), [t])
  let content: ReactNode
  if (view.projects.value !== null && view.projects.value.length === 0) content = <p style={{ padding: 8 }}>{t('empty.projects')}</p>
  else if (view.project === null) content = <p style={{ padding: 8 }}>{t('loading')}</p>
  else {
    content = (
      <div style={{ flex: 1, minHeight: 0 }}>
        <CanvasView
          projectId={view.project} client={client} session={view.session} t={t} canvas={canvas} preview={preview}
          renderFactorySlot={renderFactorySlot}
        />
      </div>
    )
  }
  return (
    <div style={root} data-testid="dv-canvas-body">
      <ProjectBar {...view.bar} labels={labels} />
      {content}
    </div>
  )
}
