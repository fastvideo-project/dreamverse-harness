/**
 * The Skills page in the main column and the navigator icon that opens it. The page lists the skills a creator can start
 * with `/name`: one card per skill with its name, its description, and 使用 / Use.
 *
 * @module @dv/ui-skills/SkillsPage
 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SavedUserSkillText, UserSkillEntry, UserSkillText } from '@dv/ui-kit/api.ts'
import type { SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
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
  /** Read the name, description, instructions and SKILL.md path of a saved skill. */
  read?: (name: string) => Promise<SavedUserSkillText>
  /** Save a new skill from its name, description and instructions. */
  create?: (text: UserSkillText) => Promise<UserSkillEntry>
  /** Replace a saved skill's description and instructions; its name stays. */
  update?: (text: UserSkillText) => Promise<UserSkillEntry>
  /** Delete a saved skill with its bundle files. */
  remove?: (name: string) => Promise<void>
  /** Read a built-in skill's name, description, instructions and SKILL.md path ('' for a skill no file defines); null when it is gone. */
  readBuiltIn?: (name: string) => Promise<SavedUserSkillText | null>
  /** Close the page and put `/name` into the chat composer. */
  use: (name: string) => void
}

/** One section's read of its skill list. */
type ListState =
  | { phase: 'loading' }
  | { phase: 'ready'; skills: readonly Skill[] }
  | { phase: 'failed'; message: string }

/** What a card shows: a skill of either list. */
type Skill = Pick<SkillEntry, 'name' | 'description'>

/** The skill the panel shows, with the read of its text that opening it started (undefined for a new skill). */
interface OpenSkill {
  name: string
  /** The description the list shows, drawn until the read settles. */
  description: string
  /** A built-in skill, shown read-only. */
  builtIn: boolean
  load: Promise<SavedUserSkillText | null> | undefined
}

/**
 * Read one list each time `read` changes, sorted by name, and offer a reload; a read that a later one replaced is dropped.
 * @param read - the list read, or undefined when the page has no such list.
 * @returns the read state and the reload action.
 */
function useSkillRead(read: (() => Promise<readonly Skill[]>) | undefined): [ListState, () => void] {
  const generation = useRef(0)
  const [state, setState] = useState<ListState>({ phase: 'loading' })
  const load = useCallback(() => {
    if (read === undefined) return
    setState({ phase: 'loading' })
    const current = ++generation.current
    read().then(
      (skills) => { if (current === generation.current) setState({ phase: 'ready', skills: [...skills].sort((a, b) => a.name.localeCompare(b.name)) }) },
      (error: unknown) => { if (current === generation.current) setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) }) },
    )
  }, [read])
  useEffect(() => { load(); return () => { generation.current += 1 } }, [load])
  return [state, load]
}

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

/**
 * The plus that leads 新建技能 / New skill, drawn as the shell's 新建项目 / Create project plus: a 1.5 px stroke at 16 px.
 * @returns the icon element.
 */
function PlusIcon(): ReactNode {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" /></svg>
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
 * The search box, then two sections that read their lists independently: 我的技能 / Your skills (the upload box and the
 * saved library, when the page has one) and 内置技能 / Built-in skills (the skills the agent can use, without those of the
 * library). Search filters both sections.
 * @param props - the list reads, the upload, and the use action.
 * @returns the list element.
 */
function SkillList(props: SkillsInjected): ReactNode {
  const { list, listMine, upload, read, create, update, remove, readBuiltIn, use } = props
  const t = useText()
  const [query, setQuery] = useState('')
  // The skill the panel shows: null when closed; name '' for a new skill; builtIn for a built-in skill, shown read-only.
  // The description comes from the list, so the panel shows it before its own read settles.
  const [editing, setEditing] = useState<OpenSkill | null>(null)
  const [mine, loadMine] = useSkillRead(listMine)
  const [builtIn, loadBuiltIn] = useSkillRead(list)
  const refresh = (): void => { loadMine(); loadBuiltIn() }
  // Opening a skill starts the read of its text once; the panel keeps that read while it is open.
  const open = (skill: Skill, fromBuiltIn: boolean): void => {
    setEditing({ ...skill, builtIn: fromBuiltIn, load: (fromBuiltIn ? readBuiltIn : read)?.(skill.name) })
  }
  const saved = new Set(mine.phase === 'ready' ? mine.skills.map(skill => skill.name) : [])
  const builtInOnly: ListState = builtIn.phase === 'ready'
    ? { phase: 'ready', skills: builtIn.skills.filter(skill => !saved.has(skill.name)) } : builtIn
  const matches = (skill: Skill): boolean =>
    `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())
  return (
    <>
      <div className={css.toolbar}>
        <input type="search" className={css.search} value={query} aria-label={t('搜索技能', 'Search skills')}
          placeholder={t('搜索 Skill', 'Search skills')} onChange={(event) => { setQuery(event.target.value) }} />
      </div>
      {listMine !== undefined && (
        <SkillSection id="dv-skills-mine" title={t('我的技能', 'Your skills')} state={mine} matches={matches} use={use}
          onRetry={loadMine} empty={t('还没有保存的技能，新建或上传你的第一个 Skill。', 'Create or upload your first skill to start your library.')}
          onOpen={read !== undefined && update !== undefined ? (skill) => { open(skill, false) } : undefined}
          openLabel={name => t(`编辑 ${name}`, `Edit ${name}`)}
          actions={create === undefined ? undefined
            : <Button variant="outline" icon={<PlusIcon />} onClick={() => { setEditing({ name: '', description: '', builtIn: false, load: undefined }) }}>{t('新建技能', 'New skill')}</Button>}>
          {upload !== undefined && <UploadBox upload={upload} onSaved={() => { setQuery(''); refresh() }} />}
        </SkillSection>
      )}
      {editing !== null && (editing.builtIn
        ? <SkillEditor name={editing.name} description={editing.description} load={editing.load}
          save={undefined} remove={undefined} readOnly onClose={() => { setEditing(null) }} onSaved={() => { setEditing(null) }} />
        : <SkillEditor
          name={editing.name} description={editing.description} load={editing.load}
          save={editing.name === '' ? create : update} remove={editing.name === '' ? undefined : remove}
          readOnly={false} onClose={() => { setEditing(null) }} onSaved={() => { setEditing(null); refresh() }} />
      )}
      <SkillSection id="dv-skills-built-in" title={t('内置技能', 'Built-in skills')} state={builtInOnly} matches={matches} use={use}
        onRetry={loadBuiltIn} empty={t('还没有可用的内置技能。', 'No built-in skills are available yet.')}
        onOpen={readBuiltIn === undefined ? undefined : (skill) => { open(skill, true) }}
        openLabel={name => t(`查看 ${name}`, `View ${name}`)} />
    </>
  )
}

/** What one section of the page draws. */
interface SectionProps {
  /** The heading's element id, which names the section region. */
  id: string
  title: string
  state: ListState
  /** Whether a skill matches the search. */
  matches: (skill: Skill) => boolean
  /** The note of a section whose list is empty. */
  empty: string
  onRetry: () => void
  use: (name: string) => void
  /** Open a skill in the panel by clicking its card; absent when the section's skills cannot be opened. */
  onOpen?: ((skill: Skill) => void) | undefined
  /** The accessible name of a card's open button, such as 编辑 / Edit or 查看 / View and the skill name. */
  openLabel?: (name: string) => string
  /** Buttons aligned right on the heading's line, such as 新建技能 / New skill. */
  actions?: ReactNode
  /** Controls drawn under the heading, such as the upload box. */
  children?: ReactNode
}

/**
 * One section: its heading, any controls, then its cards, an empty note, a no-match note, or the failure with 重试 / Retry.
 * @param props - the section's heading, read state, search filter, empty note, retry, and use action.
 * @returns the section element.
 */
function SkillSection(props: SectionProps): ReactNode {
  const { id, title, state, matches, empty, onRetry, use, onOpen, openLabel, actions, children } = props
  const t = useText()
  const shown = state.phase === 'ready' ? state.skills.filter(matches) : []
  return (
    <section className={css.section} aria-labelledby={id}>
      <div className={css.sectionHead}>
        <h2 id={id} className={css.sectionTitle}>{title}</h2>
        {actions}
      </div>
      {children}
      {state.phase === 'loading' && <p className={css.note}>{t('正在读取技能…', 'Loading skills…')}</p>}
      {state.phase === 'failed' && (
        <p className={css.note} role="alert">
          {t(`读取技能失败：${state.message}`, `Could not load skills: ${state.message}`)}
          {' '}
          <button type="button" className={css.textButton} onClick={onRetry}>{t('重试', 'Retry')}</button>
        </p>
      )}
      {state.phase === 'ready' && state.skills.length === 0 && <p className={css.note}>{empty}</p>}
      {state.phase === 'ready' && state.skills.length > 0 && shown.length === 0 && <p className={css.note}>{t('没有匹配的技能', 'No matching skills')}</p>}
      {shown.length > 0 && (
        <ul className={css.rows}>
          {shown.map(skill => (
            <li key={skill.name} className={css.row}>
              {onOpen === undefined
                ? (
                  <span className={css.rowText}>
                    <span className={css.name} title={skill.name}>{skill.name}</span>
                    <span className={css.description} title={skill.description}>{skill.description}</span>
                  </span>
                )
                : (
                  <button type="button" className={`${css.rowText ?? ''} ${css.rowOpen ?? ''}`} aria-label={openLabel?.(skill.name) ?? skill.name}
                    onClick={() => { onOpen({ name: skill.name, description: skill.description }) }}>
                    <span className={css.name} title={skill.name}>{skill.name}</span>
                    <span className={css.description} title={skill.description}>{skill.description}</span>
                  </button>
                )}
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
    </section>
  )
}

/**
 * The upload box of 我的技能 / Your skills: the file button, the format help, and the save state.
 * @param props - the upload, and what to do once a skill is saved.
 * @returns the upload box.
 */
function UploadBox({ upload, onSaved }: { upload: (file: File) => Promise<UserSkillEntry>; onSaved: () => void }): ReactNode {
  const t = useText()
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [saved, setSaved] = useState('')
  const [filename, setFilename] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const sendFile = async (file: File): Promise<void> => {
    setBusy(true)
    setFilename(file.name)
    setUploadError('')
    setSaved('')
    try {
      const skill = await upload(file)
      setSaved(skill.name)
      onSaved()
    } catch (error) { setUploadError(error instanceof Error ? error.message : String(error)) }
    finally {
      setBusy(false)
      if (fileInput.current !== null) fileInput.current.value = ''
    }
  }
  return (
    <div className={css.upload}>
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
    </div>
  )
}

/** What the skill editor needs: the skill it edits ('' for a new one), its reads and writes, and its close actions. */
interface SkillEditorProps {
  name: string
  /** The description the list shows, drawn until the read settles. */
  description: string
  /** The read of the skill's fields and path that opening it started; null when the skill is gone; undefined for a new skill. */
  load: Promise<SavedUserSkillText | null> | undefined
  save: ((text: UserSkillText) => Promise<UserSkillEntry>) | undefined
  /** Delete the saved skill; undefined for a new skill. */
  remove: ((name: string) => Promise<void>) | undefined
  /** Show the skill without editing: a built-in skill, which DreamVerse or a plugin defines. */
  readOnly: boolean
  onClose: () => void
  onSaved: () => void
}

/**
 * The panel that writes a new skill or edits a saved one: 名称 / Name (fixed for a saved skill, because it is its
 * `/name` command), 描述 / Description, and 指令 / Instructions. A saved skill's panel is titled by its name, loads its
 * fields, shows where its SKILL.md is saved, and offers 删除 / Delete behind a confirmation. A refused save or delete
 * shows the server's reason and keeps the fields. A read-only panel shows a built-in skill's fields and file without
 * Save or Delete.
 * @param props - the skill, its read, save and delete, whether it is read-only, and the close actions.
 * @returns the panel.
 */
function SkillEditor({ name, description, load, save, remove, readOnly, onClose, onSaved }: SkillEditorProps): ReactNode {
  const t = useText()
  const editingSaved = name !== ''
  const [fields, setFields] = useState<UserSkillText>({ name, description, instructions: '' })
  const [path, setPath] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(editingSaved)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The skill disappeared from its catalog between the list read and the panel's read.
  const [gone, setGone] = useState(false)
  // The loading note appears only for a read that is still running after a moment, so a fast read never flashes it.
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!loading) return
    const timer = setTimeout(() => { setSlow(true) }, 300)
    return () => { clearTimeout(timer) }
  }, [loading])
  useEffect(() => {
    if (load === undefined) return
    let current = true
    load.then(
      (text) => {
        if (!current) return
        if (text === null) {
          setGone(true)
          setLoading(false)
          return
        }
        setFields({ name: text.name, description: text.description, instructions: text.instructions })
        // The path comes from the server; a server without the field shows no saved location.
        setPath(typeof text.path === 'string' ? text.path : '')
        setLoading(false)
      },
      (failure: unknown) => { if (current) { setError(failure instanceof Error ? failure.message : String(failure)); setLoading(false) } },
    )
    return () => { current = false }
  }, [load])
  const submit = async (): Promise<void> => {
    if (save === undefined) return
    setBusy(true)
    setError('')
    try {
      await save({ name: fields.name.trim(), description: fields.description.trim(), instructions: fields.instructions })
      onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const erase = async (): Promise<void> => {
    if (remove === undefined) return
    setBusy(true)
    setError('')
    try {
      await remove(name)
      setConfirming(false)
      onSaved()
    } catch (failure) {
      setConfirming(false)
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally { setBusy(false) }
  }
  // The skill's folder as the library names it, such as dreamverse-skills/test: the last two parts of the SKILL.md's folder.
  const folder = path === '' ? name : path.split(/[\\/]/u).slice(-3, -1).join('/')
  const ready = !loading && fields.name.trim() !== '' && fields.description.trim() !== '' && fields.instructions.trim() !== ''
  return (
    <>
      <Modal
      // While the confirmation is open, Escape belongs to it, so the panel ignores its own close.
        open onClose={confirming ? () => {} : onClose} closeLabel={t('关闭', 'Close')} className={css.editor ?? ''}
        contentClassName={css.editorContent ?? ''}
        title={editingSaved ? name : t('新建技能', 'New skill')}
        footer={readOnly ? <Button variant="ghost" onClick={onClose}>{t('关闭', 'Close')}</Button> : (
          <>
            <Button variant="ghost" onClick={onClose}>{t('取消', 'Cancel')}</Button>
            {remove !== undefined && (
              <Button variant="outline" className={css.deleteButton} disabled={loading || busy} onClick={() => { setConfirming(true) }}>
                {t('删除', 'Delete')}
              </Button>
            )}
            <Button variant="primary" disabled={!ready || busy} onClick={() => { void submit() }}>
              {busy ? t('正在保存…', 'Saving…') : t('保存', 'Save')}
            </Button>
          </>
        )}
      >
        <form className={css.editorForm} onSubmit={(event) => { event.preventDefault(); if (ready && !busy) void submit() }}>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('名称', 'Name')}</span>
            <Input value={fields.name} disabled={editingSaved} placeholder="my-video-skill" autoFocus={!editingSaved}
              onChange={(event) => { setFields({ ...fields, name: event.target.value }) }} />
            <span className={css.fieldHint}>
              {readOnly
                ? t('内置技能由 DreamVerse 或插件提供，不能编辑；可以新建自己的技能来改写它。', 'Built-in skills come with DreamVerse or a plugin and cannot be edited; create your own skill to change one.')
                : editingSaved
                  ? t('名称就是 /命令，保存后不能修改。', 'The name is the /command, so it cannot change once saved.')
                  : t('小写字母、数字和连字符，例如 my-video-skill；它就是 /命令。', 'Lowercase letters, numbers and hyphens, such as my-video-skill; it becomes the /command.')}
            </span>
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('描述', 'Description')}</span>
            <Input value={fields.description} readOnly={readOnly || loading}
              placeholder={t('什么时候使用这个技能', 'When to use this skill')}
              onChange={(event) => { setFields({ ...fields, description: event.target.value }) }} />
          </label>
          <label className={css.field}>
            <span className={css.fieldLabel}>{t('指令', 'Instructions')}</span>
            <textarea className={css.instructions} value={fields.instructions} readOnly={readOnly || loading} rows={12}
              placeholder={t('智能体应遵循的步骤', 'The steps the agent should follow')}
              onChange={(event) => { setFields({ ...fields, instructions: event.target.value }) }} />
          </label>
          {loading && slow && <p className={css.note} role="status">{t('正在读取技能…', 'Loading skill…')}</p>}
          {error !== '' && <p className={css.note} role="alert">{error}</p>}
          {gone && <p className={css.note} role="alert">{t('这个技能已不可用。', 'This skill is no longer available.')}</p>}
          {path !== '' && (
            <p className={css.savedPath}>
              {readOnly ? t('文件', 'File') : t('保存位置', 'Saved at')} <code title={path}>{path}</code>
            </p>
          )}
          {readOnly && !loading && error === '' && !gone && path === '' && (
            <p className={css.savedPath}>{t('由插件在运行时提供，没有对应的文件。', 'Provided by a plugin at run time, with no file on disk.')}</p>
          )}
        </form>
      </Modal>
      <Modal
        open={confirming} onClose={() => { if (!busy) setConfirming(false) }} closeLabel={t('关闭', 'Close')}
        title={t(`删除 ${name}？`, `Delete ${name}?`)}
        description={t(`删除 ${folder} 及其中的所有文件。`, `Removes ${folder} and every file in it.`)}
        footer={(
          <>
            <Button variant="ghost" disabled={busy} onClick={() => { setConfirming(false) }}>{t('取消', 'Cancel')}</Button>
            <Button variant="primary" className={css.deleteButton} disabled={busy} onClick={() => { void erase() }}>
              {busy ? t('正在删除…', 'Deleting…') : t('删除', 'Delete')}
            </Button>
          </>
        )}
      />
    </>
  )
}
