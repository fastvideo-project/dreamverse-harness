/**
 * The Blender panel: how to connect the user's Blender while none is connected, and its live viewport with the
 * viewport controls (see `controls.tsx`) while one is, with the button that puts the viewport on the open project's
 * canvas. The connection string is the page's own origin, the address Blender must dial (through the SSH tunnel it is
 * the tunnel's local address), `#`, and the pairing token.
 *
 * @module @fastvideo/dreamverse-ui-blender/BlenderPanel
 */
import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { useCurrentProject } from '@dv/ui-kit/current-project.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import { buttons, ViewportControls } from './controls.tsx'
import { useLiveView, type FrameDrawer } from './live-view.ts'
import type { BlenderSource, BlenderStatus } from './viewer.ts'

// The panel draws on the `--dv-*` theme variables of @dv/ui-shell, so it matches the app in both themes.
const column: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, padding: 16, fontSize: 13, lineHeight: '20px', color: 'var(--dv-text)' }
const row: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }
const heading: CSSProperties = { marginTop: 6, marginBottom: 0, fontSize: 13, lineHeight: '20px', fontWeight: 600 }
const note: CSSProperties = { margin: 0, fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-2)' }
const problem: CSSProperties = { ...note, color: 'var(--dv-danger)' }
const code: CSSProperties = {
  display: 'block', padding: '8px 10px', fontFamily: 'var(--dv-font-mono)', fontSize: 12, lineHeight: '16px', wordBreak: 'break-all',
  borderRadius: 'var(--dv-radius-md)', background: 'var(--dv-surface-3)', boxShadow: 'inset 0 0 0 1px var(--dv-line)', userSelect: 'all',
}
const statusDot: CSSProperties = { width: 8, height: 8, flex: 'none', borderRadius: 9999, background: 'var(--dv-ok)' }
const divider: CSSProperties = { height: 1, margin: '2px 0', background: 'var(--dv-line)' }

/**
 * Save a file the page holds, through a temporary object URL and a programmatic link click.
 * @param blob - the file.
 * @param name - the file name the browser saves it under.
 */
function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, 60_000)
}

/**
 * The Blender panel.
 * @param props - the host half, and the clipboard writer, file saver and frame drawer the tests replace.
 * @returns the panel.
 */
export function BlenderPanel(props: {
  source: BlenderSource
  copy?: (text: string) => Promise<void>
  save?: (blob: Blob, name: string) => void
  draw?: FrameDrawer
}): ReactNode {
  const { source } = props
  const t = useText()
  const project = useCurrentProject()
  const [status, setStatus] = useState<BlenderStatus | null>(null)
  const live = useLiveView(source, props.draw)
  const { linked } = live
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [placing, setPlacing] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })

  useEffect(() => {
    let active = true
    source.status().then((answer) => {
      if (active) setStatus(answer)
    }, (failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => { active = false }
  }, [source])

  const connection = status === null ? '' : `${source.origin}#${status.token}`
  const copy = props.copy ?? ((text: string) => navigator.clipboard.writeText(text))
  const download = (): void => {
    setDownloadError(null)
    source.addon().then((blob) => { (props.save ?? save)(blob, 'dreamverse_blender.zip') }, (failure: unknown) => {
      setDownloadError(failure instanceof Error ? failure.message : String(failure))
    })
  }
  const place = (): void => {
    setPlacing({ busy: true, error: null })
    source.place().then(() => { setPlacing({ busy: false, error: null }) }, (failure: unknown) => {
      setPlacing({ busy: false, error: errorMessage(failure) })
    })
  }
  const regenerate = (): void => {
    source.regenerate().then(setStatus, (failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)) })
  }

  if (linked.linked && linked.state !== null) {
    const state = linked.state
    return (
      <div ref={live.root}>
        <div data-testid="dv-blender-panel" style={column}>
          <div style={row}>
            <span style={statusDot} />
            <strong style={{ fontWeight: 600 }}>{t(`已连接 Blender ${state.blender_version}`, `Connected to Blender ${state.blender_version}`)}</strong>
            <span style={note}>{state.file === '' ? t('未保存的文件', 'Unsaved file') : state.file}</span>
          </div>
          <ViewportControls live={live} source={source} surfaceTestId="dv-blender-surface" viewTestId="dv-blender-view" />
          <div style={divider} />
          <p style={note}>
            {state.allow_code
              ? t('agent 可以在这个 Blender 里运行 Python。', 'The agent can run Python in this Blender.')
              : t('这个 Blender 关闭了来自 harness 的代码，agent 只能查看。', 'This Blender has code from the harness switched off; the agent can only look.')}
          </p>
          <div style={row}>
            <button type="button" className={buttons.primary} disabled={project === null || placing.busy} onClick={place}>
              {t('把视口放到画布上', 'Put the viewport on the canvas')}
            </button>
            <button type="button" className={buttons.button} onClick={regenerate}>{t('断开并更换配对码', 'Disconnect and replace the pairing token')}</button>
          </div>
          {project === null ? <p style={note}>{t('打开一个项目后才能把视口放到它的画布上。', 'Open a project to put the viewport on its canvas.')}</p> : null}
          {placing.error === null ? null : <p style={problem}>{t(`没有放到画布上：${placing.error}`, `The viewport was not put on the canvas: ${placing.error}`)}</p>}
        </div>
      </div>
    )
  }

  return (
    <div ref={live.root}>
      <div data-testid="dv-blender-panel" style={column}>
        <h3 style={heading}>{t('连接 Blender', 'Connect Blender')}</h3>
        <p style={note}>
          {t('Blender 可以在你的电脑上，也可以和 harness 在同一台机器上。按下面三步连接：',
            'Blender can run on your computer or on the same machine as the harness. Connect it in three steps:')}
        </p>
        <h3 style={heading}>{t('1. 下载插件', '1. Download the add-on')}</h3>
        <div style={row}>
          <button type="button" className={buttons.primary} onClick={download}>{t('下载 dreamverse_blender.zip', 'Download dreamverse_blender.zip')}</button>
        </div>
        {downloadError === null ? null : <p style={problem}>{t(`下载失败：${downloadError}`, `The download failed: ${downloadError}`)}</p>}
        <h3 style={heading}>{t('2. 在 Blender 里安装', '2. Install it in Blender')}</h3>
        <p style={note}>
          {t('Blender 5.3：编辑 → 偏好设置 → 获取扩展 → 右上角菜单 → 从磁盘安装，选择下载的 zip。',
            'Blender 5.3: Edit → Preferences → Get Extensions → the menu at the top right → Install from Disk, then choose the downloaded zip.')}
        </p>
        <h3 style={heading}>{t('3. 粘贴连接串', '3. Paste the connection string')}</h3>
        <p style={note}>
          {t('在 Blender 3D 视图的侧栏（N）打开 DreamVerse 标签，粘贴下面的连接串，然后点 Connect。',
            'In the sidebar (N) of Blender\'s 3D view, open the DreamVerse tab, paste this connection string, and press Connect.')}
        </p>
        {status === null
          ? <p style={note}>{t('正在读取…', 'Loading…')}</p>
          : (
            <>
              <code data-testid="dv-blender-connection" style={code}>{connection}</code>
              <div style={row}>
                <button type="button" className={buttons.primary} onClick={() => { void copy(connection).then(() => { setCopied(true) }, () => { setCopied(false) }) }}>
                  {copied ? t('已复制', 'Copied') : t('复制连接串', 'Copy the connection string')}
                </button>
                <button type="button" className={buttons.button} onClick={regenerate}>{t('更换配对码', 'Replace the pairing token')}</button>
              </div>
              <p style={note}>
                {t('连接串里的配对码让 Blender 连到这个 harness，请像密码一样保管。Blender 在另一台电脑上时，地址要和浏览器用的一样（例如 SSH 隧道的本地地址）。',
                  'The pairing token in the string lets a Blender connect to this harness; keep it like a password. When Blender runs on another computer, it uses the same address as this browser, such as the local end of an SSH tunnel.')}
              </p>
            </>
          )}
        {error === null ? null : <p style={problem}>{t(`读取失败：${error}`, `Failed to load: ${error}`)}</p>}
      </div>
    </div>
  )
}
