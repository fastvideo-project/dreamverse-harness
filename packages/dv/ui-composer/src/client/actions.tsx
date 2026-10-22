/**
 * The composer's commands on other surfaces, each of which prefills the chat composer through `dv:compose`: 问 agent /
 * Ask the agent on every canvas node, and 让智能体使用 / Ask the agent to use it in the asset preview.
 *
 * @module @dv/ui-composer/actions
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NodeAction, NodeView } from '@dv/ui-canvas/contract'
import { dispatchCompose } from '@dv/ui-kit/compose.ts'
import { pickText, useText } from '@dv/ui-kit/locale.ts'
import type {} from '@dv/ui-media/contract'

/**
 * 问 agent / Ask the agent on every node: a draft 修改 {title}： / Change {title}: with a reference to the node's kernel
 * reference, else its record, else the node itself, shown by the node's preview or first asset; then the editor closes.
 */
export const askAgentAction: NodeAction = {
  id: '@dv/ui-composer:ask-agent',
  label: () => pickText('问 agent', 'Ask the agent'),
  order: 10,
  shows: (_node): _node is NodeView => true,
  run(node, host) {
    const shown = node.preview ?? node.assets[0]
    const ref = node.ref ?? { kind: 'record', id: node.record?.id ?? node.id }
    dispatchCompose({
      text: pickText(`修改 ${node.title}：`, `Change ${node.title}: `),
      refs: [{ ...ref, label: node.title, ...shown === undefined ? {} : { assetId: shown } }],
    })
    host.close()
  },
}

/**
 * 让智能体使用 / Ask the agent to use it, beside 关闭 in the asset preview: a draft 使用这个素材： / Use this asset: with a
 * reference to the asset; then the preview closes.
 * @param props - the previewed asset, the preview's button class and its close callback.
 * @returns the button.
 */
export function UseAssetAction(props: PropsRuntime<'dv.media.preview.action'>): ReactNode {
  const t = useText()
  const { asset } = props
  return (
    <button type="button" className={props.buttonClass} onClick={() => {
      dispatchCompose({ text: t('使用这个素材：', 'Use this asset: '), refs: [{ kind: 'asset', id: asset.id, label: asset.name, assetId: asset.id }] })
      props.close()
    }}>
      {t('让智能体使用', 'Ask the agent to use it')}
    </button>
  )
}
