/**
 * The Feedback row above Settings in the left sidebar, its dialog, and the toast that thanks the person once the
 * feedback sheet stored their feedback. The dialog asks the questions of the DeepSeek Harness user feedback form.
 *
 * @module @dv/ui-feedback/client/FeedbackAction
 */
import { useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import { Button, IconPaperPlaneOutlineRegular, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { FeedbackArea, FeedbackKind } from '@dv/feedback/types'
import { errorMessage } from '@dv/ui-kit/api.ts'
import { useText } from '@dv/ui-kit/locale.ts'
import { sendFeedback, submissionOf, type FeedbackDraft } from './submission.ts'
import css from './FeedbackAction.module.css'

const EMPTY_DRAFT: FeedbackDraft = { kind: 'problem', areas: [], description: '', files: [], email: '' }

/**
 * The download URL of a chat session's log: the document-relative route of the DSH session log export, which answers
 * a ZIP of the session, its subagent sessions, and the images they reference.
 * @param session - the chat session.
 * @returns the URL.
 */
function exportUrl(session: string): string {
  return `api/session.export?${new URLSearchParams({ sessionId: session, includeDescendants: 'true' }).toString()}`
}

/**
 * @param bytes - a file size.
 * @returns the size in B, KB or MB.
 */
function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Render the Feedback row and, while it is open, the dialog. The draft survives closing the dialog and clears once the
 * feedback is sent; a failed send keeps the dialog open with the reason. 发送 / Send is enabled once every required
 * question has an answer: at least one area, a description, and at least one file.
 * @param props - whether the sidebar is wide (label shown) or a rail (icon only).
 * @returns the row, the dialog, and the toast.
 */
export function FeedbackAction({ wide }: PropsRuntime<'sidebar.footer.action'>): ReactNode {
  const t = useText()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<FeedbackDraft>(EMPTY_DRAFT)
  const [sending, setSending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [thanks, setThanks] = useState(0)
  const picker = useRef<HTMLInputElement | null>(null)
  // Complete records of the unions in the order the dialog lists them.
  const kinds: Record<FeedbackKind, string> = {
    problem: t('遇到问题', 'Report a problem'),
    feature: t('功能建议', 'Suggest a feature'),
    question: t('使用咨询', 'Ask a question'),
    other: t('其他', 'Other'),
  }
  const areas: Record<FeedbackArea, string> = {
    quality: t('回答与任务完成效果', 'Response and task quality'),
    files: t('文件与生成产物', 'Files and generated content'),
    tools: t('工具、插件与扩展', 'Tools, plugins and extensions'),
    interface: t('页面显示与操作', 'Interface and interactions'),
    stability: t('速度与稳定性', 'Speed and stability'),
    setup: t('DreamVerse 安装、登录与配置', 'DreamVerse setup, sign-in and settings'),
    safety: t('安全与隐私', 'Safety and privacy'),
    other: t('其他 / 不确定', 'Other / Not sure'),
  }
  const areaOrder = Object.keys(areas) as FeedbackArea[]
  const toggleArea = (area: FeedbackArea): void => {
    const chosen = draft.areas.includes(area) ? draft.areas.filter(item => item !== area) : [...draft.areas, area]
    setDraft({ ...draft, areas: areaOrder.filter(item => chosen.includes(item)) })
  }
  const addFiles = (list: FileList | null): void => {
    // Copy now: the picker empties its live FileList right after this call, before React runs the update.
    const files = list === null ? [] : Array.from(list)
    if (files.length === 0) return
    setDraft(current => ({ ...current, files: [...current.files, ...files] }))
  }
  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    // Pasted text stays in the field it was pasted into; only pasted files become attachments.
    if (event.clipboardData.files.length === 0) return
    event.preventDefault()
    addFiles(event.clipboardData.files)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    addFiles(event.dataTransfer.files)
  }
  const send = async (): Promise<void> => {
    setSending(true)
    setFailure(null)
    try {
      await sendFeedback(await submissionOf(draft))
      setDraft(EMPTY_DRAFT)
      setOpen(false)
      setThanks(count => count + 1)
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setSending(false)
    }
  }
  // The chat session that @dv/ui-shell writes into the URL hash; its log is what the hint's link downloads.
  const session = new URLSearchParams(window.location.hash.slice(1)).get('session')
  const logs = t('会话日志', 'conversation logs')
  const ready = draft.areas.length > 0 && draft.description.trim() !== '' && draft.files.length > 0
  const label = t('反馈', 'Feedback')
  // The form's question heading: a red * when the question is required, then its number.
  const heading = (number: number, needed: boolean): ReactNode => (
    <span aria-hidden="true">
      <span className={css.required}>{needed ? '*' : ''}</span>
      <span className={css.number}>{String(number)}</span>
    </span>
  )
  return (
    <>
      <div className={wide ? css.row : `${css.row} ${css.railRow}`}>
        <button
          type="button"
          className={wide ? css.trigger : `${css.trigger} ${css.rail}`}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(true) }}
        >
          <IconPaperPlaneOutlineRegular size={wide ? 16 : 18} />
          {wide && <span className={css.label}>{label}</span>}
        </button>
      </div>
      {thanks > 0 && (
        <Toast key={thanks} text={t('已收到你的反馈，谢谢！', 'Thanks, your feedback was sent.')} tone="success" onDone={() => { setThanks(0) }} />
      )}
      <Modal
        open={open}
        title={t('DreamVerse 用户反馈', 'DreamVerse User Feedback')}
        description={t(
          '遇到问题、有功能建议，或想咨询使用方法？欢迎告诉我们！',
          'Let us know if you run into any issues, have feature suggestions, or want to share anything else about your experience with DreamVerse!',
        )}
        closeLabel={t('关闭', 'Close')}
        onClose={() => { if (!sending) setOpen(false) }}
        className={css.dialog as string}
        contentClassName={css.content as string}
        footer={(
          <div className={css.footer}>
            {/* The reason stays above Send, outside the scrolling questions, so it is visible wherever they are scrolled. */}
            {failure !== null && (
              <p className={css.failure} role="alert">{t(`反馈没有发出去：${failure}`, `Feedback was not sent: ${failure}`)}</p>
            )}
            <Button variant="primary" className={css.submit} disabled={sending || !ready} onClick={() => { void send() }}>
              {sending ? t('发送中…', 'Sending…') : t('发送', 'Send')}
            </Button>
          </div>
        )}
      >
        <div onPaste={onPaste}>
          <p className={css.question}>{heading(1, true)}{t('你想反馈什么？', 'What would you like to share?')}</p>
          <div className={css.options} role="radiogroup" aria-label={t('你想反馈什么？', 'What would you like to share?')}>
            {(Object.keys(kinds) as FeedbackKind[]).map(kind => (
              <button
                key={kind}
                type="button"
                role="radio"
                className={draft.kind === kind ? `${css.option} ${css.optionActive}` : css.option}
                aria-checked={draft.kind === kind}
                disabled={sending}
                onClick={() => { setDraft({ ...draft, kind }) }}
              >
                <span className={`${css.mark} ${css.radio}`} aria-hidden="true" />
                {kinds[kind]}
              </button>
            ))}
          </div>
          <p className={css.question}>{heading(2, true)}{t('反馈涉及哪些方面？', 'Which areas does your feedback relate to?')}</p>
          <div className={css.options} role="group" aria-label={t('反馈涉及哪些方面？', 'Which areas does your feedback relate to?')}>
            {areaOrder.map(area => (
              <button
                key={area}
                type="button"
                role="checkbox"
                className={draft.areas.includes(area) ? `${css.option} ${css.optionActive}` : css.option}
                aria-checked={draft.areas.includes(area)}
                disabled={sending}
                onClick={() => { toggleArea(area) }}
              >
                <span className={`${css.mark} ${css.checkbox}`} aria-hidden="true" />
                {areas[area]}
              </button>
            ))}
          </div>
          <p className={css.question}>{heading(3, true)}{t('请描述你的问题或建议', 'Please describe your issue, suggestion, or question')}</p>
          <p className={css.hint}>{t('遇到问题时，可以说说你做了什么、发生了什么，以及你期待的结果', 'Please tell us what you did, what happened, and what you expected.')}</p>
          <textarea
            className={css.detail}
            aria-label={t('请描述你的问题或建议', 'Please describe your issue, suggestion, or question')}
            placeholder={t('在这里输入', 'Type here')}
            value={draft.description}
            readOnly={sending}
            onChange={(event) => { setDraft({ ...draft, description: event.target.value }) }}
          />
          <p className={css.question}>{heading(4, true)}{t('添加截图或会话日志', 'Upload screenshots or session log')}</p>
          <p className={css.hint}>
            {t('可附上截图或', 'You can attach screenshots or ')}
            {session === null ? logs : <a className={css.link} href={exportUrl(session)} download={`dsh-session-${session}.zip`}>{logs}</a>}
            {t(
              '以帮助说明问题；当前项目和对话的编号会自动附上。',
              ' to help explain the issue; the IDs of the open project and chat session are attached automatically.',
            )}
          </p>
          <div className={css.files}>
            <div className={css.drop} onDragOver={(event) => { event.preventDefault() }} onDrop={onDrop}>
              {t('粘贴或拖拽文件到这里', 'Paste or drag files here')}
            </div>
            <button type="button" className={css.upload} disabled={sending} onClick={() => { picker.current?.click() }}>
              {t('＋ 上传本地文件', '+ Upload local files')}
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              aria-label={t('上传本地文件', 'Upload local files')}
              onChange={(event) => { addFiles(event.target.files); event.target.value = '' }}
            />
            {draft.files.length > 0 && (
              <ul className={css.fileList}>
                {draft.files.map((file, index) => (
                  <li key={`${file.name}-${String(index)}`} className={css.file}>
                    <span className={css.fileName}>{file.name}</span>
                    <span className={css.fileSize}>{sizeOf(file.size)}</span>
                    <button
                      type="button"
                      className={css.remove}
                      aria-label={t(`移除 ${file.name}`, `Remove ${file.name}`)}
                      disabled={sending}
                      onClick={() => { setDraft({ ...draft, files: draft.files.filter((_, at) => at !== index) }) }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className={css.question}>{heading(5, false)}{t('联系邮箱（选填）', 'Email address (Optional)')}</p>
          <p className={css.hint}>{t('如果愿意让我们就这条反馈进一步联系你，请留下邮箱地址', "Please leave your email address if you'd like us to follow up.")}</p>
          <input
            type="email"
            className={css.email}
            aria-label={t('联系邮箱（选填）', 'Email address (Optional)')}
            placeholder={t('在这里输入', 'Type here')}
            value={draft.email}
            readOnly={sending}
            onChange={(event) => { setDraft({ ...draft, email: event.target.value }) }}
          />
          <p className={css.note}>
            {t(
              '发送时还会自动附带版本、浏览器、屏幕分辨率和当前视图。如果附上会话日志，整段对话的内容也会一起发送。',
              'Sending also includes the version, browser, screen resolution and open view. If you attach a conversation log, the whole conversation is sent too.',
            )}
          </p>
        </div>
      </Modal>
    </>
  )
}
