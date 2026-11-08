// @vitest-environment jsdom
/**
 * The workspace center with the real timeline and canvas views under the real shell: center requests, the open
 * project's center fields, and the URL hash.
 */
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { mountWorkspace, releaseWorkspaces, timelineEditor, timelineTabs } from './workspace.client.tsx'
import type { Workspace } from './workspace.client.tsx'

afterEach(releaseWorkspaces)

function showView(workspace: Workspace, name: string): void {
  const toggle = workspace.center.view.getByRole('tablist', { name: /视图|View/ })
  fireEvent.click(within(toggle).getByRole('tab', { name }))
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
}

describe('the workspace center', () => {
  it('leaves the open project\'s timeline, URL and cover alone when the tab body of another project picks a timeline', async () => {
    const workspace = await mountWorkspace('#project=p1&view=timeline&session=s1')
    await waitFor(async () => { expect(timelineTabs(await timelineEditor(workspace.center))).toEqual(['*时间线 1', '片尾']) })
    await timelineEditor(workspace.tab)
    await settle()
    fireEvent.click(within(await timelineEditor(workspace.tab)).getByRole('tab', { name: '片尾' }))
    expect(timelineTabs(await timelineEditor(workspace.tab))).toEqual(['时间线 1', '*片尾'])
    await settle()
    expect(timelineTabs(await timelineEditor(workspace.center))).toEqual(['*时间线 1', '片尾'])
    expect(workspace.hash()).toBe('#project=p1&view=timeline&session=s1')
    expect(workspace.summaries.filter(query => 'timeline' in query)).toEqual([])
  })

  it('opens the node of a shown record once, so a remounted canvas keeps the editor that the user closed closed', async () => {
    const workspace = await mountWorkspace('#project=p1&session=s1')
    workspace.show({ view: 'canvas', target: { record: 'g1' } })
    await waitFor(() => { expect(workspace.center.view.getByTestId('dv-canvas-node-editor')).toBeTruthy() })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(workspace.center.view.queryByTestId('dv-canvas-node-editor')).toBeNull() })
    showView(workspace, '时间线')
    await timelineEditor(workspace.center)
    showView(workspace, '画布')
    await waitFor(() => { expect(workspace.center.container.querySelector('[data-node-id]')).not.toBeNull() })
    await settle()
    expect(workspace.center.view.queryByTestId('dv-canvas-node-editor')).toBeNull()
  })

  it('keeps the timeline of an old canvas link as the project\'s timeline: no canvas target, and the cover and the timeline view use it', async () => {
    const workspace = await mountWorkspace('#project=p1&timeline=t2&session=s1')
    await waitFor(() => { expect(workspace.center.container.querySelector('[data-node-id]')).not.toBeNull() })
    await settle()
    expect(workspace.hash()).toBe('#project=p1&timeline=t2&session=s1')
    expect(workspace.summaries).toContainEqual({ project: 'p1', timeline: 't2' })
    showView(workspace, '时间线')
    const center = await timelineEditor(workspace.center)
    await waitFor(() => { expect(timelineTabs(center)).toEqual(['时间线 1', '*片尾']) })
    expect(workspace.hash()).toBe('#project=p1&view=timeline&timeline=t2&session=s1')
  })

  it('narrows the cover by the picked timeline only, not by the record that History shows on the canvas', async () => {
    const workspace = await mountWorkspace('#project=p1&view=timeline&session=s1')
    const center = await timelineEditor(workspace.center)
    fireEvent.click(within(center).getByRole('tab', { name: '片尾' }))
    await waitFor(() => { expect(workspace.summaries.at(-1)).toEqual({ project: 'p1', timeline: 't2' }) })
    workspace.show({ view: 'canvas', target: { record: 'g1' } })
    await waitFor(() => { expect(workspace.center.view.getByTestId('dv-canvas-node-editor')).toBeTruthy() })
    await settle()
    expect(workspace.summaries.filter(query => 'record' in query)).toEqual([])
    expect(workspace.hash()).toBe('#project=p1&timeline=t2&session=s1')
  })

  it('writes a timeline picked in the center view into the URL, and Back returns the view to the previous timeline', async () => {
    const workspace = await mountWorkspace('#project=p1&view=timeline&session=s1')
    const center = await timelineEditor(workspace.center)
    fireEvent.click(within(center).getByRole('tab', { name: '片尾' }))
    expect(workspace.hash()).toBe('#project=p1&view=timeline&timeline=t2&session=s1')
    showView(workspace, '画布')
    expect(workspace.hash()).toBe('#project=p1&timeline=t2&session=s1')
    act(() => {
      window.history.replaceState(null, '', '/#project=p1&view=timeline&timeline=t1&session=s1')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => { expect(timelineTabs(workspace.center.view.getByTestId('dv-timeline-editor'))).toEqual(['*时间线 1', '片尾']) })
  })
})
