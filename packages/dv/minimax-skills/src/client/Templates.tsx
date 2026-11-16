/** MiniMax template cards and previews owned entirely by the skill-set plugin. */
import type { ReactNode } from 'react'
import { useText } from '@dv/ui-kit/locale.ts'
import { LABELS, MINIMAX_SKILLS, PREVIEWS, type MiniMaxSkill } from '../catalog.ts'
import css from './templates.module.css'

/** The existing conversation input is the only execution entry point. */
export interface TemplatesInjected {
  /** Put an explicit slash invocation in the current conversation draft. */
  use: (name: MiniMaxSkill) => void
}

/** @param props - explicit skill invocation through the existing composer.
 * @returns the plugin's nine preview cards.
 */
export function Templates(props: TemplatesInjected): ReactNode {
  const t = useText()
  return <section className={css.templates} aria-label={t('MiniMax 视频模板', 'MiniMax video templates')}>
    <h2 className={css.heading}>{t('从模板开始', 'Start from a template')}</h2>
    <p className={css.note}>{t('选择模板后补充需求，再发送消息使用技能。', 'Choose a template, add your requirements, and send the message to use the skill.')}</p>
    <div className={css.grid}>{MINIMAX_SKILLS.map(name => <button key={name} type="button" className={css.card}
      onClick={() => { props.use(name) }}>
      <span className={css.label}>{t(...LABELS[name])}</span>
      <img src={`/api/minimax/previews/${PREVIEWS[name]}`} className={css.preview} alt="" loading="lazy" decoding="async" width={480} height={270} />
    </button>)}</div>
  </section>
}
