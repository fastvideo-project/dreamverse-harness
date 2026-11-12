/** Connection editor backed by revision-fenced Harness settings and its credential store. */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RunPodView, WorkerConfig, WorkerView } from '@dv/hardware/types'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { useCopy } from './locales.ts'
import css from './RuntimeSettings.module.css'

export interface HardwareProps {
  form: ConfigForm<{ workers: Record<string, WorkerConfig> }>
  routing: ConfigForm<{ useHardware: boolean }>
  check(this: void): Promise<WorkerView[]>
  runpodPods(this: void, ref: string): Promise<RunPodView[]>
  storeCredential(this: void, ref: string, value: string): Promise<void>
  removeCredential(this: void, ref: string): Promise<void>
}

const blank: WorkerConfig = { label: '', provider: 'fastvideo', enabled: true, transport: 'api',
  baseUrl: 'http://127.0.0.1:18000', credentialRef: '', sshHost: '', remoteHost: '127.0.0.1', remotePort: 18000 }

/** Save worker coordinates without exposing saved keys or accepting private keys. */
export function HardwarePage({ form, routing, check, storeCredential, removeCredential, runpodPods }: HardwareProps) {
  const t = useCopy()
  const snapshot = useSyncExternalStore(
    useCallback(listener => form.subscribe(listener), [form]), useCallback(() => form.getSnapshot(), [form]))
  const routingState = useSyncExternalStore(
    useCallback(listener => routing.subscribe(listener), [routing]), useCallback(() => routing.getSnapshot(), [routing]))
  const [views, setViews] = useState<WorkerView[]>([])
  const [editor, setEditor] = useState<{
    id: string
    original: string | null
    value: WorkerConfig
    revision: number | undefined
  } | null>(null)
  const [key, setKey] = useState('')
  const [pending, setPending] = useState(false)
  const [checking, setChecking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const [placement, setPlacement] = useState<'local' | 'api' | 'ssh' | 'runpod'>('local')
  const [accountKey, setAccountKey] = useState('')
  const [pods, setPods] = useState<RunPodView[]>([])
  const workers = snapshot.value?.workers ?? {}
  const writable = snapshot.status === 'ready' && snapshot.writable
  useEffect(() => { let active = true; setChecking(true)
    check().then((value) => { if (active) setViews(value) }, () => { if (active) setFailure(t.connectionFailed) })
      .finally(() => { if (active) setChecking(false) })
    return () => { active = false } }, [check, t.connectionFailed])
  const refresh = async (): Promise<void> => {
    setChecking(true); setFailure(null)
    try { setViews(await check()) } catch (error) { setFailure(errorMessage(error)) } finally { setChecking(false) }
  }
  const edit = (id: string | null): void => {
    setKey(''); setAccountKey(''); setPods([]); setFailure(null); setNotice(''); setRemoving(null)
    const worker = id === null ? blank : workers[id]
    if (worker === undefined) return
    setPlacement(worker.transport === 'ssh' ? 'ssh' : worker.baseUrl.endsWith('.proxy.runpod.net') ? 'runpod' : /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(worker.baseUrl) ? 'local' : 'api')
    setEditor({ id: id ?? '', original: id, value: { ...worker }, revision: snapshot.revision })
  }
  const suggestedId = (name: string): string => {
    const stem = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'worker'
    const base = /^[a-z]/.test(stem) ? stem.slice(0, 56) : 'gpu-' + stem.slice(0, 52)
    let id = base; let suffix = 2
    while (Object.hasOwn(workers, id)) { id = `${base}-${suffix++}` }
    return id
  }
  const update = (patch: Partial<WorkerConfig>): void => {
    setEditor(value => value === null ? null : { ...value, value: { ...value.value, ...patch } })
  }
  const discoverPods = async (): Promise<void> => {
    setPending(true); setFailure(null)
    try {
      const ref = 'DV_RUNPOD_API_KEY'
      if (accountKey !== '') {
        await storeCredential(ref, accountKey.trim())
        setAccountKey('')
      }
      setPods(await runpodPods(ref))
    } catch (error) { setFailure(errorMessage(error)) } finally { setPending(false) }
  }
  const save = async (): Promise<void> => {
    if (editor === null) return
    setFailure(null); setNotice('')
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(editor.id) || editor.value.label.trim() === ''
      || (editor.original === null && Object.hasOwn(workers, editor.id))) { setFailure(t.invalid); return }
    if (placement === 'runpod' && !/^https:\/\/[a-z0-9]+-[0-9]+\.proxy\.runpod\.net\/?$/i.test(editor.value.baseUrl)) { setFailure(t.runpodChoose); return }
    setPending(true)
    try {
      const value = { ...editor.value }
      if (key !== '') {
        if (!/^[\x21-\x7e]+$/.test(key.trim())) throw new Error(t.invalid)
        value.credentialRef = `DV_WORKER_${editor.id.replaceAll('-', '_').toUpperCase()}_KEY_${randomUUID().replaceAll('-', '_')}`
        await storeCredential(value.credentialRef, key.trim())
      }
      const accepted = await form.mutate([{ op: 'set', path: ['workers', editor.id], value }], editor.revision)
      if (!accepted) {
        if (key !== '') await removeCredential(value.credentialRef)
        throw new Error(t.conflict)
      }
      setKey('')
      setEditor(null); setNotice(t.saved); await refresh()
    } catch (error) { setFailure(errorMessage(error)) } finally { setPending(false) }
  }
  const remove = async (id: string): Promise<void> => {
    setPending(true); setFailure(null)
    try {
      const next = Object.fromEntries(Object.entries(workers).filter(([key]) => key !== id))
      if (!await form.mutate([{ op: 'set', path: ['workers'], value: Object.fromEntries(Object.entries(next).map(([key, value]) => [key, { ...value }])) }], snapshot.revision)) throw new Error(t.conflict)
      setNotice(t.removed); setRemoving(null); setViews(previous => previous.filter(view => view.id !== id))
    } catch (error) { setFailure(errorMessage(error)) } finally { setPending(false) }
  }
  const enabled = Object.values(workers).filter(worker => worker.enabled).length
  const totals = [
    [t.enabledCount, enabled],
    [t.readyCount, views.filter(view => view.enabled && view.status === 'ready').length],
    [t.activeCount, views.filter(view => view.enabled && (view.busy || view.loadingModel !== null)).length],
  ] as const
  return <section className={css.page}>
    <header className={css.header}><div><h2>{t.hardware}</h2><p>{t.hardwareIntro}</p></div>
      {editor !== null ? null : <Button variant="primary" disabled={!writable || pending} onClick={() => { edit(null) }}>{t.add}</Button>}
    </header>
    <p role="status" className={css.notice}>{notice}</p>
    {failure === null ? null : <div role="alert" className={css.alert}><p>{failure}</p>
      {editor !== null ? null : <Button size="sm" disabled={checking} onClick={() => { void refresh() }}>{t.retry}</Button>}</div>}
    {!writable ? <p>{t.unavailable}</p> : null}
    {editor === null ? <>
      <dl className={css.stats} aria-label={t.statusSummary}>
        {totals.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <div className={css.sectionHeading}><div><h3>{t.connected}</h3><p>{t.slots}</p></div>
        <Button variant="outline" disabled={checking || pending} onClick={() => { void refresh() }}>{checking ? t.checking : t.check}</Button></div>
      {Object.keys(workers).length === 0 ? <div className={css.empty}><h3>{t.empty}</h3><p>{t.deviceHelp}</p></div> : null}
      <ul className={css.list}>{Object.entries(workers).map(([id, worker]) => {
        const view = views.find(value => value.id === id)
        const status = !worker.enabled ? 'disabled' : view?.status ?? 'unchecked'
        const held = view?.busy === true || view?.loadingModel != null
        return <li key={id} className={css.device}>
          <div className={css.row}><div className={css.identity}><strong>{worker.label}</strong>
            <span className={css.meta}>{worker.transport === 'ssh' ? t.ssh : worker.baseUrl.endsWith('.proxy.runpod.net') ? t.runpod : /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(worker.baseUrl) ? t.local : t.api}</span></div>
          <span className={css.badge} data-status={status}>{t[status]}</span></div>
          <p>{view?.loadingModel != null ? `${t.loading}: ${view.loadingModel}` : `${t.resident}: ${view?.loadedModel ?? t.none}`}</p>
          <details className={css.details}><summary>{t.connectionDetails}</summary>
            <p className={css.coordinate}>{worker.transport === 'ssh' ? `${worker.sshHost} → ${worker.remoteHost}:${worker.remotePort}` : worker.baseUrl}</p>
            <p className={css.coordinate}>{t.id}: {id}</p></details>
          <div className={css.actions}><Button variant="outline" disabled={!writable || pending} onClick={() => { edit(id) }}>{t.edit}</Button>
            <Button className={css.danger} disabled={!writable || pending || checking || held}
              onClick={() => { setRemoving(id) }}>{t.remove}</Button></div>
          {removing !== id ? null : <div className={css.confirm} role="group" aria-label={t.removeTitle}>
            <strong>{t.removeTitle}</strong><p>{t.removeHelp}</p><div className={css.actions}>
              <Button autoFocus disabled={pending} onClick={() => { setRemoving(null) }}>{t.cancel}</Button>
              <Button className={css.danger} variant="outline" disabled={pending || held} onClick={() => { void remove(id) }}>{t.confirmRemove}</Button>
            </div></div>}
        </li>
      })}</ul>
      {routingState.status !== 'ready' ? null : <section className={css.policy}>
        <h3>{t.execution}</h3><p>{t.independentHelp}</p>
        <label className={css.toggle}><input type="checkbox" checked={routingState.value?.useHardware ?? false}
          disabled={!routingState.writable || pending} onChange={(event) => {
            setFailure(null); void routing.set('useHardware', event.target.checked).then((ok) => {
              if (!ok) setFailure(t.conflict)
            }, (error: unknown) => { setFailure(errorMessage(error)) })
          }} />{t.mode}</label><p>{t.modeHelp}</p>
        <details className={css.details}><summary>{t.distributed}</summary><p>{t.distributedHelp}</p></details>
      </section>}
    </> : <form className={css.editor} aria-label={editor.original === null ? t.add : t.edit}
      onSubmit={(event) => { event.preventDefault(); void save() }}>
      <div><h3>{editor.original === null ? t.add : t.edit}</h3><p>{t.deviceHelp}</p></div>
      <fieldset disabled={pending} className={css.fields}>
        <label>{t.label}<Input autoFocus required placeholder="Studio GPU" value={editor.value.label} onChange={(event) => { const label = event.target.value; setEditor({ ...editor, id: editor.original === null ? suggestedId(label) : editor.id, value: { ...editor.value, label } }) }} /></label>
        <label>{t.transport}<select value={placement} onChange={(event) => {
          const next = event.target.value as 'local' | 'api' | 'ssh' | 'runpod'; setPlacement(next)
          update({ transport: next === 'ssh' ? 'ssh' : 'api', ...(next === 'local' ? { baseUrl: blank.baseUrl } : {}) })
        }}><option value="local">{t.local}</option><option value="ssh">{t.ssh}</option><option value="api">{t.api}</option><option value="runpod">{t.runpod}</option></select></label>
        <p>{placement === 'local' ? t.localHelp : placement === 'ssh' ? t.sshHelp : placement === 'runpod' ? t.runpodHelp : t.apiHelp}</p>
        {placement !== 'runpod' ? null : <div className={css.fields}>
          <label>{t.runpodAccountKey}<Input type="password" autoComplete="new-password" value={accountKey}
            onChange={(event) => { setAccountKey(event.target.value) }} /></label>
          <p>{t.runpodAccountHelp}</p>
          <Button variant="outline" onClick={() => { void discoverPods() }}>{t.runpodDiscover}</Button>
          {pods.length === 0 ? <p>{t.runpodEmpty}</p> : <label>{t.runpodEndpoint}<select
            value={pods.flatMap(pod => pod.endpoints).some(endpoint => endpoint.baseUrl === editor.value.baseUrl) ? editor.value.baseUrl : ''}
            onChange={(event) => { update({ baseUrl: event.target.value }) }}>
            <option value="">{t.runpodChoose}</option>
            {pods.filter(pod => pod.status === 'RUNNING').flatMap(pod => pod.endpoints.map(endpoint =>
              <option key={endpoint.baseUrl} value={endpoint.baseUrl}>{pod.name} · {endpoint.port}</option>))}
          </select></label>}
        </div>}
        {editor.value.transport === 'api' ? <label>{t.endpoint}<Input type="url" required value={editor.value.baseUrl} onChange={(event) => { update({ baseUrl: event.target.value }) }} /></label>
          : <label>{t.alias}<Input required placeholder="gpu-server" value={editor.value.sshHost} onChange={(event) => { update({ sshHost: event.target.value }) }} /></label>}
        <label>{t.key} · {t.optional}<Input type="password" aria-label={t.key} autoComplete="new-password" value={key} onChange={(event) => { setKey(event.target.value) }} /></label><p>{t.keyHelp}</p>
        <details className={css.details}><summary>{t.advanced}</summary><div className={css.fields}>
          <label>{t.id}<Input required pattern="[a-z][a-z0-9-]{0,63}" disabled={editor.original !== null} value={editor.id} onChange={(event) => { setEditor({ ...editor, id: event.target.value }) }} /></label>
          <label>{t.ref}<Input value={editor.value.credentialRef}
            onChange={(event) => { update({ credentialRef: event.target.value }) }} /></label>
          {editor.value.transport !== 'ssh' ? null : <><label>{t.host}<Input required value={editor.value.remoteHost} onChange={(event) => { update({ remoteHost: event.target.value }) }} /></label>
            <label>{t.port}<Input type="number" min={1} max={65535} required value={editor.value.remotePort} onChange={(event) => { update({ remotePort: Number(event.target.value) }) }} /></label></>}
        </div></details>
        <label className={css.toggle}><input type="checkbox" checked={editor.value.enabled} onChange={(event) => { update({ enabled: event.target.checked }) }} />{t.enabled}</label>
      </fieldset>
      <div className={css.editorFooter}><Button disabled={pending} onClick={() => { setEditor(null); setKey(''); setAccountKey(''); setFailure(null) }}>{t.cancel}</Button>
        <Button type="submit" variant="primary" disabled={pending || !writable}>{pending ? t.saving : t.saveCheck}</Button></div>
    </form>}
  </section>
}
