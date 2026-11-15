/**
 * The Skills page in the main column, the 技能 / Skills tab of the entry page's 探索 / Explore section, and the navigator
 * icon that opens the page. The page and the tab list the skills a creator can start with `/name`: one card per skill
 * with its name, its description, and 使用 / Use.
 *
 * @module @dv/ui-skills/SkillsPage
 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UserSkillEntry } from '@dv/ui-kit/api.ts'
import type { SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { useText } from '@dv/ui-kit/locale.ts'
import css from './SkillsPage.module.css'

/** What the page and tab registrations inject. */
export interface SkillsInjected {
  /** Read the skills a creator can start with `/name`; an empty list before any chat session exists. */
  list: () => Promise<readonly SkillEntry[]>
  /** List persistent user uploads, independently of the current chat. */
  listMine?: () => Promise<readonly UserSkillEntry[]>
  /** Validate and save a Markdown file or ZIP bundle on the server. */
  upload?: (file: File) => Promise<UserSkillEntry>
  /** Close the page and put `/name` into the chat composer. */
  use: (name: string) => void
}

/** The page's read of the skill list. */
type ListState =
  | { phase: 'loading' }
  | { phase: 'ready'; skills: readonly SkillEntry[] }
  | { phase: 'failed'; message: string }

/**
 * The four-point spark the navigator shows beside 技能 / Skills.
 * @returns the icon element.
 */
export function SkillsPanelIcon(): ReactNode {
  return (
    <svg
      width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    ><path d="M12 3.5l2.1 6.4 6.4 2.1-6.4 2.1L12 20.5l-2.1-6.4L3.5 12l6.4-2.1L12 3.5Z" /></svg>
  )
}

/** @param props - opens the persistent skill library from the chat composer.
 * @returns the composer's Skills shortcut.
 */
export function SkillsLauncher({ open }: { open: () => void }): ReactNode {
  const t = useText()
  return <button type="button" className={css.launcher} onClick={open}><SkillsPanelIcon />{t('技能', 'Skills')}</button>
}

/**
 * The Skills page: a heading and an introduction, then the skill list.
 * @param props - the injected list read and use action.
 * @returns the page element.
 */
export function SkillsPage(props: InjectFace<SkillsInjected>): ReactNode {
  const t = useText()
  return (
    <section className={css.page} data-dv-skills="">
      <header className={css.head}>
        <h1 className={css.title}>{t('技能', 'Skills')}</h1>
        <p className={css.intro}>
          {t(
            '技能是写好的影视生成流程。点「使用」把 /技能名 放进对话框，补充需求后发送；智能体也会在合适的时候自己选用技能。',
            'A skill is a ready-made video-making procedure. Choose “Use” to put /name in the chat box, then add what you want and send. The agent also picks a skill on its own when one fits.',
          )}
        </p>
      </header>
      <SkillList {...props} />
    </section>
  )
}

/**
 * The 技能 / Skills tab of 探索 / Explore on the entry page: an introduction line, then the skill list.
 * @param props - the injected list read and use action.
 * @returns the tab body.
 */
export function SkillsShelf(props: InjectFace<SkillsInjected>): ReactNode {
  const t = useText()
  return (
    <div className={css.shelf} data-dv-skills-shelf="">
      <p className={css.intro}>{t('点「使用」把 /技能名 放进对话框，补充需求后发送。', 'Choose “Use” to put /name in the chat box, then add what you want and send.')}</p>
      <SkillList {...props} />
    </div>
  )
}

/**
 * The skill cards, an empty note, or the failure with 重试 / Retry. The list is read each time the component mounts.
 * @param props - the list read and use action.
 * @returns the list element.
 */
function SkillList(props: SkillsInjected): ReactNode {
  const { list, listMine, upload, use } = props
  const t = useText()
  const [mine, setMine] = useState(listMine !== undefined)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [saved, setSaved] = useState('')
  const [filename, setFilename] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const [state, setState] = useState<ListState>({ phase: 'loading' })
  const load = useCallback(() => {
    setState({ phase: 'loading' })
    const current = ++generation.current
    const read = mine && listMine !== undefined ? listMine : list
    read().then(
      (skills) => { if (current === generation.current) setState({ phase: 'ready', skills: [...skills].sort((a, b) => a.name.localeCompare(b.name)) }) },
      (error: unknown) => { if (current === generation.current) setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) }) },
    )
  }, [list, listMine, mine])
  useEffect(() => { load(); return () => { generation.current += 1 } }, [load])
  const sendFile = async (file: File): Promise<void> => {
    if (upload === undefined) return
    setBusy(true)
    setFilename(file.name)
    setUploadError('')
    setSaved('')
    try {
      const skill = await upload(file)
      setSaved(skill.name)
      setQuery('')
      load()
    } catch (error) { setUploadError(error instanceof Error ? error.message : String(error)) }
    finally {
      setBusy(false)
      if (fileInput.current !== null) fileInput.current.value = ''
    }
  }
  const filtered = state.phase === 'ready' ? state.skills.filter(skill =>
    `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())) : []
  return (
    <>
      <div className={css.toolbar}>
        {listMine !== undefined && <div className={css.tabs} aria-label={t('技能来源', 'Skill library')}>
          <button type="button" className={css.tab} aria-pressed={mine} disabled={busy}
            onClick={() => { setMine(true); setQuery('') }}>{t('我的 Skills', 'My Skills')}</button>
          <button type="button" className={css.tab} aria-pressed={!mine} disabled={busy}
            onClick={() => { setMine(false); setQuery('') }}>{t('可用技能', 'Available skills')}</button>
        </div>}
        <input type="search" className={css.search} value={query} aria-label={t('搜索技能', 'Search skills')}
          placeholder={t('搜索 Skill', 'Search skills')} onChange={(event) => { setQuery(event.target.value) }} />
      </div>
      {mine && upload !== undefined && <div className={css.upload}>
        <div className={css.uploadLabel}>
          <span>{t('上传 Skill', 'Upload skill')}</span>
          <button type="button" className={css.useButton} disabled={busy}
            onClick={() => { fileInput.current?.click() }}>{t('选择文件', 'Choose file')}</button>
          <span className={css.filename} title={filename} aria-live="polite">
            {filename || t('未选择任何文件', 'No file selected')}
          </span>
          <input ref={fileInput} type="file" accept=".md,.zip" hidden disabled={busy}
            aria-label={t('上传 Skill 文件', 'Upload skill file')}
            onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) void sendFile(file) }} />
        </div>
        <p className={css.note}>{t('支持 Markdown 或含 SKILL.md 的 ZIP 技能包，保存后可在后续对话中使用。', 'Upload Markdown or a ZIP bundle containing SKILL.md. Saved skills stay available for later chats.')}</p>
        <details className={css.format}>
          <summary>{t('查看技能文件格式', 'Skill file format')}</summary>
          <pre>{t('---\nname: my-video-skill\ndescription: 描述什么时候使用这个技能\n---\n在这里填写智能体应遵循的步骤。', '---\nname: my-video-skill\ndescription: Describe when to use this skill\n---\nWrite the instructions for the agent here.')}</pre>
          <p className={css.note}>{t('如需附带 references、scripts 或其他素材，请将它们与 SKILL.md 放在同一文件夹内打包。', 'Bundle references, scripts and other resources in the same folder as SKILL.md.')}</p>
        </details>
        {busy && <p className={css.note} role="status">{t('正在保存技能…', 'Saving skill…')}</p>}
        {saved !== '' && <p className={css.note} role="status">{t(`已保存 /${saved}`, `Saved /${saved}`)}</p>}
        {uploadError !== '' && <p className={css.note} role="alert">{uploadError}</p>}
      </div>}
      {state.phase === 'loading' && <p className={css.note}>{t('正在读取技能…', 'Loading skills…')}</p>}
      {state.phase === 'failed' && (
        <p className={css.note} role="alert">
          {t(`读取技能失败：${state.message}`, `Could not load skills: ${state.message}`)}
          {' '}
          <button type="button" className={css.textButton} onClick={load}>{t('重试', 'Retry')}</button>
        </p>
      )}
      {state.phase === 'ready' && state.skills.length === 0 && (
        <p className={css.note}>{mine ? t('还没有保存的技能，上传你的第一个 Skill。', 'Upload your first skill to start your library.') : t('还没有可用的技能。', 'No skills are available yet.')}</p>
      )}
      {state.phase === 'ready' && state.skills.length > 0 && filtered.length === 0 && <p className={css.note}>{t('没有匹配的技能', 'No matching skills')}</p>}
      {state.phase === 'ready' && filtered.length > 0 && (
        <ul className={css.grid}>
          {filtered.map(skill => (
            <li key={skill.name} className={css.card}>
              <span className={css.name} title={skill.name}>{skill.name}</span>
              <span className={css.description} title={skill.description}>{skill.description}</span>
              <span className={css.foot}>
                <code className={css.command} title={`/${skill.name}`}>/{skill.name}</code>
                <button
                  type="button" className={css.useButton} aria-label={t(`使用 ${skill.name}`, `Use ${skill.name}`)}
                  onClick={() => { use(skill.name) }}
                >{t('使用', 'Use')}</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
