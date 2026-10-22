/**
 * The card body of a plan node.
 *
 * @module @dv/ui-shot-plan/PlanCard
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@dv/ui-canvas/contract'
import { useText } from '@dv/ui-kit/locale.ts'

/**
 * The card body of a plan: the type label and the version on show, such as 分镜计划 · 第 2 版. A plan's versions count
 * from 1, so the version on show is one past the node's earlier versions.
 * @param props - the node and the text scale.
 * @returns the element.
 */
export function PlanCard({ node, textScale }: PropsRuntime<'dv.canvas.card'>): ReactNode {
  const pick = useText()
  const version = 1 + (node.records?.length ?? 0)
  return (
    <span style={{ display: 'block', padding: '0 10px 10px', fontSize: Math.round(12 * textScale), lineHeight: `${String(Math.round(16 * textScale))}px`, color: 'var(--dv-text-2)' }}>
      {`${pick('分镜计划', 'Plan')} · ${pick(`第 ${String(version)} 版`, `v${String(version)}`)}`}
    </span>
  )
}
