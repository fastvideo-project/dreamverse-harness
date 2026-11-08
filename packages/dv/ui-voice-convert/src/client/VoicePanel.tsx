/**
 * The Voice panel of one project: record a spoken line with the microphone and keep it as an audio asset through
 * `POST /api/dv/assets/import`, then convert a recording of the project into a voice of an `a2a` model with one
 * `voice.convert` run as the user. The converted take lands in the asset pool and on the canvas like any generation.
 *
 * @module @fastvideo/dreamverse-ui-voice-convert/VoicePanel
 */
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { assetUrl, errorMessage, type DvClient } from '@dv/ui-kit/api.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import type { ProjectAsset, WireModelEntry } from '@dv/ui-kit/types.ts'
import { useProjectState } from '@dv/ui-kit/useProject.ts'
import { lineOfFile } from './script.ts'
import { ScriptPanel, type LoadedScript } from './ScriptPanel.tsx'
import { useTake } from './useTake.ts'
import { schemaVoices } from './voice-bar.ts'
import { encodeWav, mixToMono } from './wav.ts'

/** A microphone: `start` begins a recording and resolves with the function that stops it and returns the WAV file. */
export interface Recorder {
  start(): Promise<() => Promise<File>>
}

/** The Voice panel's props: the project, the chat session beside it, the API client, the microphone, and a text reader. */
export interface VoicePanelProps {
  projectId: string
  session: string | null
  client: DvClient
  recorder: Recorder
  /** Read a text asset's content, such as a script. */
  readText: (asset: string) => Promise<string>
}

/**
 * Read a text asset through `GET /dv/assets/<AssetId>`.
 * @param asset - the asset ID.
 * @returns the asset's text.
 * @throws Error naming the HTTP status when the asset cannot be read.
 */
export async function readAssetText(asset: string): Promise<string> {
  const response = await fetch(assetUrl(asset))
  if (!response.ok) throw new Error(`The asset ${asset} cannot be read: HTTP ${String(response.status)}.`)
  return response.text()
}

/** One voice to convert to: the model key that serves it and the voice's key and label. */
interface VoiceChoice {
  value: string
  label: string
  model: Pick<WireModelEntry, 'modality' | 'task' | 'provider' | 'model'>
  key: string
}

/**
 * The voices of every `a2a` model of the catalog, in catalog order.
 * @param models - the catalog.
 * @returns one choice per voice of each model.
 */
export function voiceChoices(models: readonly WireModelEntry[]): VoiceChoice[] {
  return models.filter(entry => entry.task === 'a2a').flatMap(({ modality, task, provider, model, schema }) =>
    schemaVoices(schema).map(voice => ({
      value: `${provider}/${model}/${voice.key}`, label: voice.label, model: { modality, task, provider, model }, key: voice.key,
    })))
}

/** The time stamp of a recording's file name, such as `20261104-103512`. */
function stamp(now: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${String(now.getFullYear())}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
}

/**
 * The browser microphone: `MediaRecorder` over `getUserMedia`, decoded with an `AudioContext` and stored as mono WAV.
 * @returns the recorder.
 */
export function browserRecorder(): Recorder {
  return {
    async start() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const parts: Blob[] = []
      recorder.ondataavailable = (event) => { parts.push(event.data) }
      recorder.start()
      return async () => {
        const stopped = new Promise((resolve) => { recorder.onstop = resolve })
        recorder.stop()
        await stopped
        for (const track of stream.getTracks()) track.stop()
        const context = new AudioContext()
        try {
          const decoded = await context.decodeAudioData(await new Blob(parts).arrayBuffer())
          const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index))
          const wav = encodeWav(mixToMono(channels), decoded.sampleRate)
          return new File([wav], `line-${stamp(new Date())}.wav`, { type: 'audio/wav' })
        } finally {
          await context.close()
        }
      }
    },
  }
}

const column: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }
const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }
const heading: CSSProperties = { marginTop: 8, marginBottom: 0, fontSize: 13, fontWeight: 600 }
const note: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--dv-text-muted, inherit)' }
const problem: CSSProperties = { ...note, color: 'var(--dv-danger)' }

/**
 * The Voice panel.
 * @param props - the project, the chat session, the client and the microphone.
 * @returns the panel.
 */
export function VoicePanel(props: VoicePanelProps): ReactNode {
  const { client, projectId, session } = props
  const t = useText()
  const state = useProjectState(client, projectId)
  const [models, setModels] = useState<WireModelEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [script, setScript] = useState<LoadedScript | null>(null)
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null)
  const [recording, setRecording] = useState('')
  const [voice, setVoice] = useState('')
  const [line, setLine] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    client.listModels(controller.signal).then(setModels, () => { setModels([]) })
    return () => { controller.abort() }
  }, [client])

  const voices = useMemo(() => voiceChoices(models), [models])
  const assetsNewestFirst = useMemo(() => [...state.value?.assets ?? []]
    .sort((a, b) => b.created_at.localeCompare(a.created_at)), [state.value])
  const recordings = useMemo(() => assetsNewestFirst.filter(asset => asset.mime.startsWith('audio/')), [assetsNewestFirst])
  const chosenRecording = recordings.find(asset => asset.id === recording) ?? recordings[0]
  const chosenVoice = voices.find(choice => choice.value === voice) ?? voices[0]
  const fail = (error: unknown): void => { setMessage({ text: errorMessage(error), failed: true }) }
  const takes = useTake(props.recorder, fail)
  const choose = (asset: string): void => {
    setRecording(asset)
    // A take of a script line brings its words.
    if (script === null) return
    const index = lineOfFile(script.stem, (recordings.find(entry => entry.id === asset) as ProjectAsset).name)
    const words = script.lines.find(entry => entry.index === index)?.text
    if (words !== undefined) setLine(words)
  }

  const keep = (file: File): void => {
    setBusy(true)
    client.importAsset(projectId, file, 'asset_pool', session).then(({ asset }) => {
      setRecording(asset)
      takes.drop()
      setMessage({ text: t(`已保存录音「${file.name}」。`, `Kept the recording "${file.name}".`), failed: false })
    }, fail).finally(() => { setBusy(false) })
  }
  const convert = (chosenRecording: ProjectAsset, chosenVoice: VoiceChoice): void => {
    setBusy(true)
    setMessage(null)
    client.runOperation({
      project: projectId, operation: 'voice.convert', surface: 'asset_pool', ...session === null ? {} : { session },
      inputs: [{ role: 'reference', ref: chosenRecording.id }],
      params: { ...chosenVoice.model, prompt: line.trim(), voice: chosenVoice.key },
      intent: `convert ${chosenRecording.name} to ${chosenVoice.label}`,
    }).then(() => {
      setMessage({ text: t(`正在把「${chosenRecording.name}」转换为 ${chosenVoice.label}；新版本会出现在素材库和画布上。`,
        `Converting "${chosenRecording.name}" to ${chosenVoice.label}; the take appears in the asset pool and on the canvas.`), failed: false })
    }, fail).finally(() => { setBusy(false) })
  }

  return (
    <div data-testid="dv-voice-panel" style={column}>
      <h3 style={heading}>{t('按剧本录制', 'Record a script')}</h3>
      <ScriptPanel
        projectId={projectId} session={session} client={client} recorder={props.recorder} assets={assetsNewestFirst}
        readText={props.readText} onScript={setScript} fail={fail} reload={state.reload}
        onKept={(asset, kept) => {
          setRecording(asset)
          setLine(kept.text)
          setMessage({ text: t(`已保存第 ${String(kept.index)} 句。`, `Kept line ${String(kept.index)}.`), failed: false })
        }}
      />
      <h3 style={heading}>{t('录制台词', 'Record a line')}</h3>
      <div style={row}>
        {takes.recording
          ? <button type="button" onClick={takes.stop}>{t('停止', 'Stop')}</button>
          : <button type="button" onClick={takes.start} disabled={busy}>{t('开始录音', 'Record')}</button>}
        {takes.recording ? <span style={note}>{t('录音中…', 'Recording…')}</span> : null}
      </div>
      {takes.take === null ? null : (
        <div style={row}>
          <audio controls src={takes.take.url} aria-label={takes.take.file.name} />
          <button type="button" onClick={() => { keep((takes.take as { file: File }).file) }} disabled={busy}>{t('保存录音', 'Keep recording')}</button>
          <button type="button" onClick={takes.drop} disabled={busy}>{t('丢弃', 'Discard')}</button>
        </div>
      )}
      <h3 style={heading}>{t('转换音色', 'Convert voice')}</h3>
      {chosenVoice === undefined
        ? <p style={note}>{t('没有可用的音色模型；在配置里启用 dv-seed-vc 并列出允许的音色。', 'No voice model is available; enable dv-seed-vc in the config and list the allowed voices.')}</p>
        : (
          <>
            <label style={row}>
              {t('录音', 'Recording')}
              <select value={chosenRecording?.id ?? ''} onChange={(event) => { choose(event.currentTarget.value) }}>
                {recordings.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
              </select>
            </label>
            <label style={row}>
              {t('音色', 'Voice')}
              <select value={chosenVoice.value} onChange={(event) => { setVoice(event.currentTarget.value) }}>
                {voices.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </select>
            </label>
            <label style={{ ...row, alignItems: 'stretch', flexDirection: 'column' }}>
              {t('台词的文字', 'Words of the line')}
              <textarea rows={3} value={line} onChange={(event) => { setLine(event.currentTarget.value) }} />
            </label>
            <div style={row}>
              {chosenRecording === undefined
                ? <span style={note}>{t('先录制或导入一段音频。', 'Record or import a line first.')}</span>
                : <button type="button" onClick={() => { convert(chosenRecording, chosenVoice) }} disabled={busy}>{t('转换', 'Convert')}</button>}
            </div>
          </>
        )}
      {message === null ? null : <p role={message.failed ? 'alert' : 'status'} style={message.failed ? problem : note}>{message.text}</p>}
    </div>
  )
}
