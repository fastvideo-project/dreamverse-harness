/**
 * The script teleprompter of the Voice panel: load a script into the project as a text asset, then record its lines one
 * at a time with the current line shown large. A kept take is imported as `<script stem>-line-<NN>.wav`, so the lines
 * that already have a take are marked after a reload, and the next line comes up. Keys while the teleprompter has focus:
 * Space starts and stops a take, Enter keeps it, the left and right arrows move between lines.
 *
 * @module @fastvideo/dreamverse-ui-voice-convert/ScriptPanel
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import type { DvClient } from '@dv/ui-kit/api.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { ProjectAsset } from '@dv/ui-kit/types.ts'
import { lineFileName, lineOfFile, parseScript, scriptStem, type ScriptLine } from './script.ts'
import { useTake } from './useTake.ts'
import type { Recorder } from './VoicePanel.tsx'

/** A loaded script: its stem and its lines. */
export interface LoadedScript {
  stem: string
  lines: ScriptLine[]
}

/** The teleprompter's props. */
export interface ScriptPanelProps {
  projectId: string
  session: string | null
  client: DvClient
  recorder: Recorder
  /** The project's assets, newest first. */
  assets: readonly ProjectAsset[]
  /** Read a text asset's content. */
  readText: (asset: string) => Promise<string>
  /** Called with the loaded script, and with null while none is loaded. */
  onScript: (script: LoadedScript | null) => void
  /** Called with a kept take's asset and its line. */
  onKept: (asset: string, line: ScriptLine) => void
  /** Read the project state again, so a new script or take shows before the project's next event. */
  reload: () => void
  fail: (error: unknown) => void
}

const column: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }
const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }
const note: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--dv-text-muted, inherit)' }
const prompter: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, padding: 16, borderRadius: 8, outline: 'none',
  background: 'var(--dv-surface-2, rgba(127, 127, 127, 0.12))',
}
const speaker: CSSProperties = { fontSize: 13, fontWeight: 600, letterSpacing: 1 }
const words: CSSProperties = { fontSize: 24, lineHeight: 1.35, fontWeight: 500 }

/** Whether an asset is a script: a plain-text or Markdown file. */
function isScript(asset: ProjectAsset): boolean {
  return asset.mime === 'text/plain' || asset.mime === 'text/markdown'
}

/**
 * The teleprompter.
 * @param props - the project, the microphone, the project's assets and the callbacks.
 * @returns the section.
 */
export function ScriptPanel(props: ScriptPanelProps): ReactNode {
  const { client, projectId, session, fail } = props
  const t = useText()
  const scripts = useMemo(() => props.assets.filter(isScript), [props.assets])
  const [chosen, setChosen] = useState('')
  const script = scripts.find(asset => asset.id === chosen) ?? scripts[0]
  const [lines, setLines] = useState<ScriptLine[] | null>(null)
  const [at, setAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const takes = useTake(props.recorder, fail)
  const box = useRef<HTMLDivElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  const stem = script === undefined ? '' : scriptStem(script.name)

  // The callbacks change on every render of the owner; the effect reads the newest ones and reruns on a new script only.
  const callbacks = useRef({ readText: props.readText, onScript: props.onScript, fail })
  callbacks.current = { readText: props.readText, onScript: props.onScript, fail }
  const scriptId = script?.id
  const scriptName = script?.name
  useEffect(() => {
    setLines(null)
    setAt(0)
    if (scriptId === undefined || scriptName === undefined) {
      callbacks.current.onScript(null)
      return
    }
    let live = true
    callbacks.current.readText(scriptId).then((text) => {
      if (!live) return
      const parsed = parseScript(text)
      setLines(parsed)
      callbacks.current.onScript({ stem: scriptStem(scriptName), lines: parsed })
    }, (error: unknown) => { callbacks.current.fail(error) })
    return () => { live = false }
  }, [scriptId, scriptName])

  const recorded = useMemo(() => new Set(props.assets.flatMap((asset) => {
    const index = lineOfFile(stem, asset.name)
    return index === null ? [] : [index]
  })), [props.assets, stem])

  const load = (file: File): void => {
    // A browser gives a Markdown file no media type; the asset pool needs one.
    const typed = file.type === '' ? new File([file], file.name, { type: 'text/plain' }) : file
    setBusy(true)
    client.importAsset(projectId, typed, 'asset_pool', session).then(({ asset }) => {
      setChosen(asset)
      props.reload()
    }, fail)
      .finally(() => { setBusy(false) })
  }
  const keep = (line: ScriptLine, file: File): void => {
    setBusy(true)
    const named = new File([file], lineFileName(stem, line.index), { type: 'audio/wav' })
    client.importAsset(projectId, named, 'asset_pool', session).then(({ asset }) => {
      takes.drop()
      props.reload()
      props.onKept(asset, line)
      setAt(index => Math.min(index + 1, (lines as ScriptLine[]).length - 1))
      box.current?.focus()
    }, fail).finally(() => { setBusy(false) })
  }
  const current = lines?.[at]
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || current === undefined || busy) return
    if (event.key === ' ') {
      event.preventDefault()
      if (takes.recording) takes.stop()
      else takes.start()
    } else if (event.key === 'Enter' && takes.take !== null) {
      event.preventDefault()
      keep(current, takes.take.file)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      takes.drop()
      setAt(index => Math.max(0, Math.min((lines as ScriptLine[]).length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))))
    }
  }

  return (
    <div style={column}>
      <div style={row}>
        {scripts.length === 0 ? null : (
          <label style={row}>
            {t('剧本', 'Script')}
            <select value={(script as ProjectAsset).id} onChange={(event) => { setChosen(event.currentTarget.value) }}>
              {scripts.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
            </select>
          </label>
        )}
        <button type="button" onClick={() => { (upload.current as HTMLInputElement).click() }} disabled={busy}>{t('载入剧本', 'Load script')}</button>
        <input
          ref={upload} type="file" accept=".txt,.md,text/plain,text/markdown" hidden data-testid="dv-voice-script-upload"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file !== undefined) load(file)
            event.currentTarget.value = ''
          }}
        />
      </div>
      {script === undefined
        ? <p style={note}>{t('载入一个 .txt 或 .md 剧本，逐句录制。每行写成「名字: 台词」，或用剧本格式：大写的角色名，下面是台词。', 'Load a .txt or .md script to record it line by line: write each line as "NAME: words", or in screenplay form, a speaker in capitals with the words below.')}</p>
        : null}
      {lines === null || script === undefined ? null : lines.length === 0
        ? <p style={note}>{t('这个剧本里没有台词。', 'This script has no lines.')}</p>
        : (
          <>
            <div ref={box} tabIndex={0} onKeyDown={onKey} style={prompter} data-testid="dv-voice-prompter" aria-label={t('提词器', 'Teleprompter')}>
              <span style={note}>
                {t(`第 ${String(at + 1)} / ${String(lines.length)} 句`, `Line ${String(at + 1)} / ${String(lines.length)}`)}
                {recorded.has((current as ScriptLine).index) ? ` · ${t('已录制', 'recorded')} ✓` : ''}
              </span>
              {(current as ScriptLine).character === null ? null : <span style={speaker}>{(current as ScriptLine).character}</span>}
              <span style={words} data-testid="dv-voice-prompter-line">{(current as ScriptLine).text}</span>
            </div>
            <div style={row}>
              <button type="button" onClick={() => { takes.drop(); setAt(index => index - 1) }} disabled={at === 0 || takes.recording}>{t('上一句', 'Previous')}</button>
              {takes.recording
                ? <button type="button" onClick={takes.stop}>{t('停止', 'Stop')}</button>
                : <button type="button" onClick={takes.start} disabled={busy}>{t('录制这一句', 'Record line')}</button>}
              <button type="button" onClick={() => { takes.drop(); setAt(index => index + 1) }} disabled={at === lines.length - 1 || takes.recording}>{t('下一句', 'Next')}</button>
              {takes.recording ? <span style={note}>{t('录音中…', 'Recording…')}</span> : null}
            </div>
            {takes.take === null ? null : (
              <div style={row}>
                <audio controls src={takes.take.url} aria-label={lineFileName(stem, (current as ScriptLine).index)} />
                <button type="button" onClick={() => { keep(current as ScriptLine, (takes.take as { file: File }).file) }} disabled={busy}>{t('保存这条', 'Keep take')}</button>
                <button type="button" onClick={takes.start} disabled={busy}>{t('重录', 'Retake')}</button>
              </div>
            )}
            <p style={note}>{t('提词器获得焦点时：空格开始/停止，回车保存，← → 切换台词。', 'With the teleprompter focused: Space starts and stops, Enter keeps, ← → move between lines.')}</p>
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
              {lines.map((line, index) => (
                <li key={line.index} style={{ cursor: 'pointer', fontWeight: index === at ? 600 : 400 }}>
                  <button
                    type="button" onClick={() => { takes.drop(); setAt(index) }} disabled={takes.recording}
                    style={{ all: 'unset', cursor: 'pointer' }}
                  >
                    {recorded.has(line.index) ? '✓ ' : ''}{line.character === null ? '' : `${line.character}: `}{line.text}
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
    </div>
  )
}
