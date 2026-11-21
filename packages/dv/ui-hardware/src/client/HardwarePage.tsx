/** Connection editor backed by revision-fenced Harness settings and its credential store. */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import {
  Button, IconChevronRightOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, Input, Switch,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RunPodView, WorkerConfig, WorkerView } from '@dv/hardware/types'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { useCopy } from './locales.ts'
import css from './RuntimeSettings.module.css'

/** One model a worker reports, with the tasks it serves and whether its weights are held. */
export interface InstalledModel { id: string; tasks: string[]; installed: boolean; loaded: boolean }

/** The installed-model catalog and residency actions of the configured devices. */
export interface DeviceModels {
  catalog(this: void, worker: string): Promise<InstalledModel[]>
  action(this: void, worker: string, action: 'load' | 'unload', model: string, task: string): Promise<void>
}

export interface HardwareProps {
  form: ConfigForm<{ workers: Record<string, WorkerConfig> }>
  routing: ConfigForm<{ useHardware: boolean }>
  models: DeviceModels
  check(this: void): Promise<WorkerView[]>
  runpodPods(this: void, ref: string): Promise<RunPodView[]>
  storeCredential(this: void, ref: string, value: string): Promise<void>
  removeCredential(this: void, ref: string): Promise<void>
}

const blank: WorkerConfig = { label: '', provider: 'fastvideo', enabled: true, transport: 'api',
  baseUrl: 'http://127.0.0.1:18000', credentialRef: '', sshHost: '', remoteHost: '127.0.0.1', remotePort: 18000 }

/** Whether an API worker URL names a loopback server, which the editor presents as a local placement. */
const isLoopback = (baseUrl: string): boolean => /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)

/** A GPU box drawn in the current text color. */
function DeviceGlyph() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
    <rect x="2" y="3" width="12" height="8" rx="1.5" /><path d="M5.5 13.5h5M8 11v2.5" /><path d="M5 6h2M5 8h4" strokeLinecap="round" />
  </svg>
}

/** Save worker coordinates without exposing saved keys or accepting private keys. */
export function HardwarePage({ form, routing, models, check, storeCredential, removeCredential, runpodPods }: HardwareProps) {
  const t = useCopy()
  const snapshot = useSyncExternalStore(
    useCallback(listener => form.subscribe(listener), [form]), useCallback(() => form.getSnapshot(), [form]))
  const routingState = useSyncExternalStore(
    useCallback(listener => routing.subscribe(listener), [routing]), useCallback(() => routing.getSnapshot(), [routing]))
  const [expanded, setExpanded] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<{
    worker: string
    status: 'loading' | 'ready' | 'failed'
    rows: InstalledModel[]
    failure: string | null
  } | null>(null)
  const [modelPending, setModelPending] = useState<string | null>(null)
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
    setPlacement(worker.transport === 'ssh' ? 'ssh' : worker.baseUrl.endsWith('.proxy.runpod.net') ? 'runpod' : isLoopback(worker.baseUrl) ? 'local' : 'api')
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
  /** Read one device's installed catalog; an answer for a device the person already left is dropped. */
  const readModels = async (worker: string): Promise<void> => {
    setCatalog({ worker, status: 'loading', rows: [], failure: null })
    try {
      const rows = await models.catalog(worker)
      setCatalog(current => current?.worker === worker ? { worker, status: 'ready', rows, failure: null } : current)
    } catch (error) {
      setCatalog(current => current?.worker === worker
        ? { worker, status: 'failed', rows: [], failure: errorMessage(error) } : current)
    }
  }
  const act = async (worker: string, model: InstalledModel, kind: 'load' | 'unload'): Promise<void> => {
    setModelPending(`${worker}:${model.id}`)
    setFailure(null)
    try {
      await models.action(worker, kind, model.id, model.tasks[0] ?? '')
      setNotice(t.actionDone)
      await readModels(worker)
    } catch (error) { setFailure(errorMessage(error)) } finally { setModelPending(null) }
  }
  const ready = views.filter(view => view.enabled && view.status === 'ready').length
  const ids = Object.keys(workers)
  return <section className={css.page}>
    <header className={css.header}><div><h2>{t.hardware}</h2><p>{t.hardwareIntro}</p></div></header>
    <p role="status" className={css.notice}>{notice}</p>
    {failure === null ? null : <div role="alert" className={css.alert}><p>{failure}</p>
      {editor !== null ? null : <Button size="sm" disabled={checking} onClick={() => { void refresh() }}>{t.retry}</Button>}</div>}
    {!writable ? <p>{t.unavailable}</p> : null}
    {editor === null ? <>
      <section className={css.group} aria-label={t.connected}>
        <div className={css.groupHeading}><h3>{t.connected}</h3><p>{t.slots}</p></div>
        <div className={css.card}>
          <div className={css.cardHead}>
            <span>{t.deviceCount.replace('{count}', String(ids.length))}{ids.length === 0 ? '' : ` · ${t.readyCount.toLowerCase()} ${ready}`}</span>
            <span className={css.headActions}>
              <button type="button" className={css.iconButton} aria-label={checking ? t.checking : t.check} title={t.check}
                disabled={checking || pending} onClick={() => { void refresh() }}><IconRefreshOutlineRegular size={14} /></button>
              {ids.length === 0 ? null : <button type="button" className={css.iconButton} aria-label={t.add} title={t.add}
                disabled={!writable || pending} onClick={() => { edit(null) }}><IconPlusOutlineRegular size={14} /></button>}
            </span>
          </div>
          {ids.length === 0 ? <div className={css.emptyRow}><strong>{t.empty}</strong><p>{t.deviceHelp}</p>
            <Button variant="primary" disabled={!writable || pending} onClick={() => { edit(null) }}>{t.add}</Button></div> : null}
          <ul className={css.list}>{Object.entries(workers).map(([id, worker]) => {
            const view = views.find(value => value.id === id)
            const status = !worker.enabled ? 'disabled' : view?.status ?? 'unchecked'
            const held = view?.busy === true || view?.loadingModel != null
            const placement = worker.transport === 'ssh' ? t.ssh : worker.baseUrl.endsWith('.proxy.runpod.net') ? t.runpod : isLoopback(worker.baseUrl) ? t.local : t.api
            const open = expanded === id
            return <li key={id} className={css.device}>
              <button type="button" className={css.deviceRow} aria-expanded={open}
                onClick={() => { setExpanded(open ? null : id); if (!open) void readModels(id) }}>
                <span className={css.deviceMark} aria-hidden="true"><DeviceGlyph /></span>
                <span className={css.identity}><strong>{worker.label}</strong>
                  <span className={css.meta}><span className={css.dot} data-status={status} />{t[status]}, {placement}</span></span>
                <span className={css.resident}>{view?.loadingModel != null ? `${t.loading}: ${view.loadingModel}` : view?.loadedModel ?? ''}</span>
                <IconChevronRightOutlineRegular size={14} className={css.chevron} data-open={open} />
              </button>
              {!open ? null : <div className={css.deviceDetails}>
                <div className={css.models}>
                  <div className={css.modelsHead}>
                    <strong>{t.models}</strong>
                    <button type="button" className={css.iconButton} aria-label={t.refresh} title={t.refresh}
                      onClick={() => { void readModels(id) }}><IconRefreshOutlineRegular size={14} /></button>
                  </div>
                  {catalog?.worker !== id ? null : catalog.status === 'loading'
                    ? <p className={css.modelNote}>{t.loadingModels}</p>
                    : catalog.status === 'failed'
                      ? <div role="alert" className={css.modelNote}><p>{catalog.failure ?? t.refreshFailed}</p>
                        <Button size="sm" onClick={() => { void readModels(id) }}>{t.retry}</Button></div>
                      : catalog.rows.length === 0
                        ? <p className={css.modelNote}>{t.emptyModels}</p>
                        : <ul className={css.modelsList}>{catalog.rows.map((model) => {
                          const busy = modelPending === `${id}:${model.id}`
                          return <li key={model.id} className={css.modelRow}>
                            <span className={css.modelName}><strong>{model.id}</strong>
                              <span>{model.tasks.map(task => task.toUpperCase()).join(' · ')}</span></span>
                            <Button size="sm" disabled={!writable || held || busy || !model.installed}
                              onClick={() => { void act(id, model, model.loaded ? 'unload' : 'load') }}>
                              {busy ? t.loadPending : model.loaded ? t.unload : t.load}
                            </Button>
                          </li>
                        })}</ul>}
                </div>
                <dl className={css.facts}>
                  <div><dt>{t.resident}</dt><dd>{view?.loadingModel != null ? `${t.loading}: ${view.loadingModel}` : view?.loadedModel ?? t.none}</dd></div>
                  <div><dt>{t.transport}</dt><dd className={css.coordinate}>{worker.transport === 'ssh' ? `${worker.sshHost} → ${worker.remoteHost}:${worker.remotePort}` : worker.baseUrl}</dd></div>
                  <div><dt>{t.id}</dt><dd className={css.coordinate}>{id}</dd></div>
                </dl>
                <div className={css.actions}><Button variant="outline" disabled={!writable || pending} onClick={() => { edit(id) }}>{t.edit}</Button>
                  <Button className={css.danger} disabled={!writable || pending || checking || held}
                    onClick={() => { setRemoving(id) }}>{t.remove}</Button></div>
                {removing !== id ? null : <div className={css.confirm} role="group" aria-label={t.removeTitle}>
                  <strong>{t.removeTitle}</strong><p>{t.removeHelp}</p><div className={css.actions}>
                    <Button autoFocus disabled={pending} onClick={() => { setRemoving(null) }}>{t.cancel}</Button>
                    <Button className={css.danger} variant="outline" disabled={pending || held} onClick={() => { void remove(id) }}>{t.confirmRemove}</Button>
                  </div></div>}
              </div>}
            </li>
          })}</ul>
        </div>
      </section>
      {routingState.status !== 'ready' ? null : <section className={css.group} aria-label={t.execution}>
        <div className={css.groupHeading}><h3>{t.execution}</h3><p>{t.independentHelp}</p></div>
        <div className={css.card}>
          <div className={css.settingRow}>
            <span className={css.settingText}><strong>{t.mode}</strong><span>{t.modeHelp}</span></span>
            <Switch checked={routingState.value?.useHardware ?? false} label={t.mode}
              disabled={!routingState.writable || pending} onChange={(next) => {
                setFailure(null); void routing.set('useHardware', next).then((ok) => {
                  if (!ok) setFailure(t.conflict)
                }, (error: unknown) => { setFailure(errorMessage(error)) })
              }} />
          </div>
          <div className={css.settingRow}>
            <span className={css.settingText}><strong>{t.distributed}</strong><span>{t.distributedHelp}</span></span>
            <Switch checked={false} disabled label={t.distributed} onChange={() => {}} />
          </div>
        </div>
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
