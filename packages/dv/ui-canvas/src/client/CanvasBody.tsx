/**
 * The canvas as a right-Sidebar tab body: the project and undo bar (`ProjectBar`) above an occurrence of the `dv.canvas`
 * Factory for the selected project, so the tab draws the same cards, editors and picker as the center view.
 */
import { useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { DvClient } from '@dv/ui-kit/api.ts'
import { ProjectBar } from '@dv/ui-kit/ProjectBar.tsx'
import type { ProjectBarLabels } from '@dv/ui-kit/ProjectBar.tsx'
import { useViewSession } from '@dv/ui-kit/useView.ts'
import type {} from './CanvasFactory.tsx'
import type {} from './locales.ts'

/** What the plugin hands the body beside the standard props of its DSH UI slot. */
export interface CanvasInjected {
  client: DvClient
}

/** The body's composed props: the tab it draws, the API client, its copy, and the Factory renderer. */
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
 * @param props - the API client, the copy and the Factory renderer; the tab information is unused because the canvas
 *   keeps one page per kind.
 * @returns the element.
 */
export function CanvasBody({ client, t, renderFactorySlot }: CanvasBodyProps): ReactNode {
  const view = useViewSession(client, 'canvas')
  const labels = useMemo(() => barLabels(t), [t])
  let content: ReactNode
  if (view.projects.value !== null && view.projects.value.length === 0) content = <p style={{ padding: 8 }}>{t('empty.projects')}</p>
  else if (view.project === null) content = <p style={{ padding: 8 }}>{t('loading')}</p>
  else {
    content = (
      <div style={{ flex: 1, minHeight: 0 }}>
        {renderFactorySlot('dv.canvas', { projectId: view.project, session: view.session, focus: null })}
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
