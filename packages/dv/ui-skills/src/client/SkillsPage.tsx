/**
 * The Skills page in the main column, the 技能 / Skills tab of the entry page's 探索 / Explore section, and the navigator
 * icon that opens the page. The page and the tab list the skills a creator can start with `/name`: one card per skill
 * with its name, its description, and 使用 / Use.
 *
 * @module @dv/ui-skills/SkillsPage
 */
import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { useText } from '@dv/ui-kit/locale.ts'
import css from './SkillsPage.module.css'

/** What the page and tab registrations inject. */
export interface SkillsInjected {
  /** Read the skills a creator can start with `/name`; an empty list before any chat session exists. */
  list: () => Promise<readonly SkillEntry[]>
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
            '技能是写好的影视生成流程。点「使用」会把 /技能名 放进对话框，补充你的需求后发送；智能体也会在合适的时候自己选用技能。',
            'A skill is a ready-made video-making procedure. Use puts /name into the chat box; add what you want and send. The agent also picks a skill on its own when one fits.',
          )}
        </p>
      </header>
      <SkillList list={props.list} use={props.use} />
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
      <SkillList list={props.list} use={props.use} />
    </div>
  )
}

/**
 * The skill cards, an empty note, or the failure with 重试 / Retry. The list is read each time the component mounts.
 * @param props - the list read and use action.
 * @returns the list element.
 */
function SkillList(props: SkillsInjected): ReactNode {
  const { list, use } = props
  const t = useText()
  const [state, setState] = useState<ListState>({ phase: 'loading' })
  const load = useCallback(() => {
    setState({ phase: 'loading' })
    list().then(
      (skills) => { setState({ phase: 'ready', skills: [...skills].sort((a, b) => a.name.localeCompare(b.name)) }) },
      (error: unknown) => { setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) }) },
    )
  }, [list])
  useEffect(load, [load])
  return (
    <>
      {state.phase === 'loading' && <p className={css.note}>{t('正在读取技能…', 'Loading skills…')}</p>}
      {state.phase === 'failed' && (
        <p className={css.note} role="alert">
          {t(`读取技能失败：${state.message}`, `Could not load skills: ${state.message}`)}
          {' '}
          <button type="button" className={css.textButton} onClick={load}>{t('重试', 'Retry')}</button>
        </p>
      )}
      {state.phase === 'ready' && state.skills.length === 0 && (
        <p className={css.note}>{t('还没有可用的技能。', 'No skills are available yet.')}</p>
      )}
      {state.phase === 'ready' && state.skills.length > 0 && (
        <ul className={css.grid}>
          {state.skills.map(skill => (
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
