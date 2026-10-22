/**
 * The canvas as a view of the workspace center (`dv.center.view`): a {@link CanvasView} of the project and chat session
 * that the center passes, whose editors render the slots that this entry declares: the `dv.canvas.editor` entries of the
 * node entries, and the asset pool's `dv.canvas.picker` entry. Its assets draw through `dv.media`. The view opens the node of the
 * record that the center's request names (`{ record }`, as History shows a record).
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CenterRequest } from '@dv/ui-shell/contract'
import type { CanvasInjected } from './CanvasBody.tsx'
import { CanvasView } from './CanvasView.tsx'
import type { CanvasFocus } from './CanvasView.tsx'

/** The entry's composed props: the center's project, chat session and request, the API client, the registries, the
 *  preview, the editor slots, and the Factory renderer. */
export type CanvasCenterProps = PropsRuntime<'dv.center.view'> & CanvasInjected
  & PropsRenderSlots<'dv.canvas.editor' | 'dv.canvas.picker'> & PropsRenderFactories

/**
 * The center view.
 * @param props - the project, chat session and request that the center passes, the client, registries and preview that
 *   the plugin injects, the `renderSlot` of the editor slots, and the Factory renderer.
 * @returns the element.
 */
export function CanvasCenter(
  { projectId, session, request, client, canvas, preview, renderSlot, renderFactorySlot }: CanvasCenterProps,
): ReactNode {
  const focus = useMemo(() => focusOf(request), [request])
  return (
    <CanvasView
      projectId={projectId} session={session} client={client} canvas={canvas} renderSlot={renderSlot}
      renderFactorySlot={renderFactorySlot} preview={preview} focus={focus}
    />
  )
}

function focusOf(request: CenterRequest | null): CanvasFocus | null {
  const record = request?.value['record']
  return request === null || typeof record !== 'string' ? null : { record, take: request.take }
}
