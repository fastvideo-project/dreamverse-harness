/** Configure cloud video through existing settings and credential services. */
import { useCallback, useState, useSyncExternalStore } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { OpenRouterSettings, VideoModel } from '@dv/openrouter/types'
import { useText } from '@dv/ui-kit/locale.ts'
import css from './openrouter.module.css'

export interface OpenRouterPageProps {
  form: ConfigForm<OpenRouterSettings>
  storeKey(this: void, ref: string, key: string): Promise<void>
  discover(this: void): Promise<VideoModel[]>
  enableOperator(this: void, ref: string): Promise<void>
}

/** Installing a cloud model means enabling its API entry, never downloading weights. */
export function OpenRouterPage({ form, storeKey, discover, enableOperator }: OpenRouterPageProps) {
  const text = useText()
  const state = useSyncExternalStore(useCallback(listener => form.subscribe(listener), [form]),
    useCallback(() => form.getSnapshot(), [form]))
  const [key, setKey] = useState('')
  const [models, setModels] = useState<VideoModel[]>([])
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const writable = state.status === 'ready' && state.writable
  const configured = state.value?.models ?? {}
  const load = async (): Promise<void> => {
    setPending(true); setError(null); setNotice('')
    try {
      if (key !== '') { await storeKey(state.value?.credentialRef ?? 'OPENROUTER_API_KEY', key.trim()); setKey('') }
      setModels(await discover())
      setNotice(text('已读取视频目录。', 'Video catalog loaded.'))
    } catch { setError(text('无法读取视频模型。请检查已保存的密钥和连接。', 'Could not load video models. Check the saved key and connection.')) }
    finally { setPending(false) }
  }
  const connectOperator = async (): Promise<void> => {
    setPending(true); setError(null); setNotice('')
    try {
      const ref = state.value?.credentialRef ?? 'OPENROUTER_API_KEY'
      if (key !== '') { await storeKey(ref, key.trim()); setKey('') }
      await discover()
      await enableOperator(ref)
      setNotice(text('OpenRouter 操作员模型已启用。请在聊天中选择 LLM。', 'OpenRouter operator models enabled. Choose an LLM in chat.'))
    } catch { setError(text('无法启用操作员模型。请检查密钥或使用“模型”设置。',
      'Could not enable operator models. Check the key or use Models settings.')) }
    finally { setPending(false) }
  }
  const choose = async (model: VideoModel): Promise<void> => {
    setPending(true); setError(null); setNotice('')
    try {
      const existing = Object.entries(configured).find(([, id]) => id === model.id)?.[0]
      const alias = model.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120)
      if (existing === undefined && configured[alias] !== undefined) throw new Error('Alias collision')
      const next = existing === undefined ? { ...configured, [alias]: model.id }
        : Object.fromEntries(Object.entries(configured).filter(([, id]) => id !== model.id))
      if (!await form.mutate([{ op: 'set', path: ['models'], value: next }], state.revision)) throw new Error('Refused settings')
      setModels(await discover())
      setNotice(existing === undefined ? text('模型已添加到聊天选择器。', 'Model added to the chat picker.')
        : text('模型已从后续生成选项中移除。', 'Model removed from future generation choices.'))
    } catch { setError(text('无法保存模型选择。请刷新设置后重试。', 'Could not save the model choice. Refresh settings and try again.')) }
    finally { setPending(false) }
  }
  return <section className={css.page} aria-label={text('OpenRouter 视频 API', 'OpenRouter video API')}>
    <header><h2>{text('视频 API', 'Video APIs')}</h2><p>{text('通过 OpenRouter 连接云端视频模型。', 'Connect cloud video models through OpenRouter.')}</p></header>
    <p>{text('操作员 LLM 使用现有“模型”设置页：添加 OpenRouter，然后在聊天框中选择 LLM。',
      'For the operator LLM, add OpenRouter on the existing Models settings page, then choose that LLM in chat.')}</p>
    <fieldset disabled={!writable || pending} className={css.fields}>
      <label>{text('OpenRouter API 密钥', 'OpenRouter API key')}<Input type="password" autoComplete="new-password" value={key}
        onChange={(event) => { setKey(event.target.value) }} /></label>
      <p>{text('密钥保存在现有凭据存储中。留空使用已保存的密钥。读取目录不会生成或收费。',
        'Keys use the existing credential store. Leave blank to use the saved key. Reading the catalog does not generate a video.')}</p>
      <Button variant="primary" onClick={() => { void load() }}>{pending ? text('连接中…', 'Connecting…')
        : text('保存密钥并读取视频模型', 'Save key and load video models')}</Button>
      <Button variant="outline" onClick={() => { void connectOperator() }}>
        {text('为操作员 LLM 启用 OpenRouter', 'Enable OpenRouter for operator LLM')}</Button>
    </fieldset>
    {error === null ? null : <p role="alert">{error}</p>}
    <p role="status">{notice}</p>
    {!writable ? <p>{text('当前连接无法编辑视频 API 设置。', 'Video API settings are unavailable in this connection.')}</p> : null}
    <label>{text('搜索视频模型', 'Search video models')}<Input type="search" value={query}
      onChange={(event) => { setQuery(event.target.value) }} /></label>
    <ul className={css.models}>{models.filter(model => `${model.id} ${model.name}`.toLowerCase().includes(query.toLowerCase())).map((model) => {
      const added = Object.values(configured).includes(model.id)
      return <li key={model.id} className={css.model}><div><strong>{model.name}</strong><p>{model.id}</p>
        <p>{model.durations.join(', ')}s · {model.resolutions.join(', ')} · {model.aspectRatios.join(', ')}</p>
        <p>{model.frames.includes('first_frame') ? model.frames.includes('last_frame') ? 'T2V · I2V · FL2V' : 'T2V · I2V' : 'T2V'}</p></div>
      <Button variant="outline" disabled={!writable || pending} onClick={() => { void choose(model) }}>
        {added ? text('移除', 'Remove') : text('添加到聊天', 'Add to chat')}</Button></li>
    })}</ul>
    <p>{text('云端生成按服务商定价收费。停止本地监控不会取消云端任务；不要自动重试付费提交。',
      'Cloud generations use provider pricing. Stopping local monitoring does not cancel the cloud job; paid submissions are never automatically retried.')}</p>
  </section>
}
