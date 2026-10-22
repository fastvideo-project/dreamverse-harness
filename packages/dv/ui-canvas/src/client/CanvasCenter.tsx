/**
 * The canvas as a view of the workspace center (`dv.center.view`): an occurrence of the `dv.canvas` Factory for the
 * project and chat session that the center passes, which opens the node of the record that the center's request names
 * (`{ record }`, as History shows a record).
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CenterRequest } from '@dv/ui-shell/contract'
import type { CanvasFocus } from './CanvasView.tsx'
import type {} from './CanvasFactory.tsx'

/** The entry's composed props: the center's project, chat session and request, and the Factory renderer. */
export type CanvasCenterProps = PropsRuntime<'dv.center.view'> & PropsRenderFactories

/**
 * The center view.
 * @param props - the project, chat session and request that the center passes, and the Factory renderer.
 * @returns the element.
 */
export function CanvasCenter({ projectId, session, request, renderFactorySlot }: CanvasCenterProps): ReactNode {
  const focus = useMemo(() => focusOf(request), [request])
  return renderFactorySlot('dv.canvas', { projectId, session, focus })
}

function focusOf(request: CenterRequest | null): CanvasFocus | null {
  const record = request?.value['record']
  return request === null || typeof record !== 'string' ? null : { record, take: request.take }
}
