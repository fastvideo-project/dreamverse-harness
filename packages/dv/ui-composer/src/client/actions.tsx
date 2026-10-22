/**
 * 让智能体使用 / Ask the agent to use it, beside 关闭 in the asset preview of `@dv/ui-media`: an entry of
 * `dv.media.preview.action` that prefills the chat composer through `dv:compose`.
 *
 * @module @dv/ui-composer/actions
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { dispatchCompose } from '@dv/ui-kit/compose.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type {} from '@dv/ui-media/contract'

/**
 * A draft 使用这个素材： / Use this asset: with a reference to the asset; then the preview closes.
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
