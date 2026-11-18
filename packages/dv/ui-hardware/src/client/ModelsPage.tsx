/** Installed worker catalogs and model residency controls. */
import { useEffect, useId, useRef, useState } from 'react'
import { Button, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkerView } from '@dv/hardware/types'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { useCopy } from './locales.ts'
import css from './RuntimeSettings.module.css'

/** Native worker catalog rows, validated at the browser API parser. */
export interface InstalledModel { id: string; tasks: string[]; installed: boolean; loaded: boolean }
export interface ModelsPageProps {
  workers(this: void): Promise<WorkerView[]>
  catalog(this: void, worker: string): Promise<InstalledModel[]>
  action(this: void, worker: string, action: 'load' | 'unload', model: string, task: string): Promise<void>
}

/** Five kit variants; backend capability checks decide whether installation is available. */
const KIT_MODELS = [
  ['pika-qad', 'Pika H3 Flex QAD', 'Pika-H3-Flex-NVFP4-QAD', 'T2VA · I2VA · L2VA · FL2VA · Ref2VA · 6 forwards · BF16 attention'],
  ['pika-fp4-attention', 'Pika H3 Flex FP4 Attention QAD', 'Pika-H3-Flex-NVFP4-FP4Attn-QAD', 'T2VA · I2VA · L2VA · FL2VA · Ref2VA · 6 forwards · FP4 Q/K attention'],
  ['fasth3-omni', 'FastH3 Omni QAD', 'FastH3-Omni-NVFP4-QAD', 'Ref2VA · 8 forwards · sparse attention'],
  ['fasth3-qad-v2', 'FastH3 QAD v2', 'FastH3-QAD-v2', 'T2VA · 8 forwards · sparse attention'],
  ['fasth3-trim', 'FastH3 Trim 8-Step', 'FastVideo-FastH3-Trim-8-Step-NVFP4', 'T2VA · 8 forwards · 42 transformer blocks'],
] as const

/** Refresh a device snapshot after lifecycle actions; stale requests cannot overwrite another device. */
export function ModelsPage({ workers, catalog, action }: ModelsPageProps) {
  const t = useCopy()
  const tabsId = useId()
  const [tab, setTab] = useState<'installed' | 'library'>('installed')
  const [devices, setDevices] = useState<WorkerView[]>([])
  const [selected, setSelected] = useState('')
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [snapshot, setSnapshot] = useState<{ worker: string; models: InstalledModel[]; loading: boolean; error: string | null }>({ worker: '', models: [], loading: false, error: null })
  const [failure, setFailure] = useState<string | null>(null)
  const [mutation, setMutation] = useState<{ worker: string; model: string } | null>(null)
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const [discovering, setDiscovering] = useState(true)
  useEffect(() => { let active = true
    workers().then((value) => { if (active) { setDevices(value); setSelected(previous => value.some(worker => worker.id === previous && worker.provider === 'fastvideo') ? previous : value.find(worker => worker.enabled && worker.provider === 'fastvideo')?.id ?? '') } },
      (error: unknown) => { if (active) setFailure(errorMessage(error)) })
      .finally(() => { if (active) setDiscovering(false) })
    return () => { active = false }
  }, [workers, revision])
  useEffect(() => { let active = true
    if (selected === '') { setSnapshot({ worker: '', models: [], loading: false, error: null }); return }
    setSnapshot({ worker: selected, models: [], loading: true, error: null })
    catalog(selected).then((models) => { if (active) setSnapshot({ worker: selected, models, loading: false, error: null }) },
      (error: unknown) => { if (active) setSnapshot({ worker: selected, models: [], loading: false, error: errorMessage(error) }) })
    return () => { active = false }
  }, [selected, catalog, revision])
  const refresh = (): void => { setFailure(null); setRevision(value => value + 1) }
  const run = async (model: InstalledModel): Promise<void> => {
    const worker = selected
    const task = model.tasks[0]
    if (task === undefined) return
    setMutation({ worker, model: model.id }); setFailure(null); setNotice('')
    try { await action(worker, model.loaded ? 'unload' : 'load', model.id, task)
      if (selectedRef.current === worker) { setNotice(t.actionDone); setRevision(value => value + 1) }
    } catch (error) { if (selectedRef.current === worker) setFailure(errorMessage(error)) }
    finally { setMutation(null) }
  }
  const current = snapshot.worker === selected ? snapshot : { models: [], loading: selected !== '', error: null }
  const device = devices.find(worker => worker.id === selected)
  const held = device?.busy === true || device?.loadingModel != null
  const error = failure ?? current.error
  return <section className={css.page}>
    <header><h2>{t.models}</h2><p>{t.modelsIntro}</p></header>
    <div className={css.toolbar}><label className={css.workerSelect}>{t.modelWorker}<select value={selected} onChange={(event) => {
      setSelected(event.target.value); setFailure(null); setNotice('')
    }}><option value="">{t.selectWorker}</option>{devices.filter(worker => worker.provider === 'fastvideo').map(worker => <option key={worker.id} value={worker.id}>{worker.label}{worker.enabled ? '' : ` · ${t.disabled}`}</option>)}</select></label>
    <Button variant="outline" disabled={current.loading || discovering || mutation !== null} onClick={refresh}>{t.refresh}</Button></div>
    <p role="status" className={css.notice}>{notice}</p>
    {error === null ? null : <div role="alert" className={css.alert}><p>{error}</p><Button size="sm" onClick={refresh}>{t.retry}</Button></div>}
    <SegmentedTabs label={t.modelTabs} value={tab} onChange={setTab} items={[
      { value: 'installed', label: t.installedTab, id: `${tabsId}-installed`, panelId: `${tabsId}-installed-panel` },
      { value: 'library', label: t.libraryTab, id: `${tabsId}-library`, panelId: `${tabsId}-library-panel` },
    ]} />
    <div role="tabpanel" id={`${tabsId}-installed-panel`} aria-labelledby={`${tabsId}-installed`} hidden={tab !== 'installed'} className={css.panel}>
      {discovering || current.loading ? <p role="status">{t.loadingModels}</p> : null}
      {selected !== '' || discovering ? null : <div className={css.empty}><h3>{t.selectWorker}</h3><p>{t.backendRequired}</p></div>}
      {held ? <p className={css.callout}>{t.busyHelp}</p> : null}
      {selected === '' || current.loading || current.error !== null || current.models.length !== 0 ? null : <div className={css.empty}><h3>{t.emptyModels}</h3><p>{t.emptyModelsHelp}</p></div>}
      <ul className={css.list}>{current.models.map(model => <li key={model.id} className={css.device}>
        <div className={css.row}><strong className={css.coordinate}>{model.id}</strong><span className={css.badge} data-status={model.loaded ? 'ready' : 'unchecked'}>{!model.installed ? t.notInstalled : model.loaded ? t.resident : t.installed}</span></div>
        <p>{model.tasks.join(' · ')}</p><div className={css.actions}>
          <Button variant="outline" disabled={mutation !== null || !model.installed || model.tasks.length === 0 || held || device?.enabled !== true || ! device.reachable}
            onClick={() => { void run(model) }}>
            {mutation?.worker === selected && mutation.model === model.id ? t.loadPending : model.loaded ? t.unload : t.load}
          </Button>
        </div></li>)}</ul>
      <p>{t.selectionHelp}</p>
      <details className={css.policy}><summary>{t.custom}</summary><div className={css.fields}>
        <div><h3>{t.bringWeights}</h3><p>{t.bringWeightsHelp}</p></div>
        <div><h3>{t.bringApi}</h3><p>{t.bringApiHelp}</p><p>{t.compatibleHelp}</p></div>
      </div></details>
    </div>
    <div role="tabpanel" id={`${tabsId}-library-panel`} aria-labelledby={`${tabsId}-library`} hidden={tab !== 'library'} className={css.panel}>
      <div><h3>{t.catalog}</h3><p>{t.libraryHelp}</p></div>
      <div className={css.callout}><p>{t.unsupportedDownload}</p><p>{t.bringWeightsHelp}</p></div>
      <ul className={css.list}>{KIT_MODELS.map(([id, label, source, facts]) => <li key={id} className={css.device}>
        <div className={css.row}><strong>{label}</strong><a href={`https://huggingface.co/FastVideo/${source}`} target="_blank" rel="noreferrer" aria-label={`${t.source}: ${label}`}>{t.source}</a></div>
        <p>{facts}</p>
      </li>)}</ul>
    </div>
  </section>
}
