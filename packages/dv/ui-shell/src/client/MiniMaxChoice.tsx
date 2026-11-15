/** Project workflow choice, committed once when the project is created. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MINIMAX_SKILLS, isMiniMaxSkill, type MiniMaxSkill } from '@dv/ui-kit/minimax.ts'
import { useText, type PickText } from '@dv/ui-kit/locale.ts'
import type { ShellActions } from './actions.ts'
import { CheckIcon, SkillsIcon } from './icons.tsx'
import { setShell, useShell } from './store.ts'
import css from './shell.module.css'

const LABELS: Record<MiniMaxSkill, readonly [string, string]> = {
  '3d-animation-short-generator': ['3D 动画短片', '3D animated short'],
  'minimalist-product-ad-generator': ['极简产品广告', 'Minimalist product ad'],
  'brand-promo-video-generator': ['品牌宣传片', 'Brand promo'],
  'handdrawn-live-video-generator': ['手绘实拍融合', 'Hand-drawn live action'],
  'music-video-subtitle-generator': ['音乐 MV 与歌词', 'Music video & lyrics'],
  'papercraft-stop-motion-explainer': ['纸艺定格解说', 'Papercraft stop motion'],
  'paper-collage-explainer-generator': ['纸张拼贴解说', 'Paper collage explainer'],
  'co-op-game-intro-generator': ['合作游戏开场', 'Co-op game intro'],
  'h3-prompt-writing': ['H3 提示词编写', 'H3 prompt writing'],
}

/**
 * @param value - saved skill name or null for the original workflow.
 * @param t - active language picker.
 * @returns localized workflow name.
 */
export function miniMaxLabel(value: unknown, t: PickText): string {
  return typeof value === 'string' && isMiniMaxSkill(value) ? t(...LABELS[value]) : t('默认工作流', 'Default workflow')
}

/** @returns the next project's selection menu; the empty choice disables MiniMax. */
export function MiniMaxChoice(): ReactNode {
  const t = useText()
  const selected = useShell(s => s.minimaxSkill ?? '')
  return (
    <label className={css.skillChoice}>
      <span><SkillsIcon />{t('视频类型', 'Video type')}</span>
      <select aria-label={t('视频类型', 'Video type')} value={selected}
        onChange={(event) => { setShell({ minimaxSkill: event.target.value || null }) }}>
        <option value="">{t('默认工作流（关闭 MiniMax Skills）', 'Default workflow (MiniMax Skills off)')}</option>
        <optgroup label={t('MiniMax 视频风格', 'MiniMax video styles')}>
          {MINIMAX_SKILLS.filter(name => name !== 'h3-prompt-writing').map(name => (
            <option key={name} value={name}>{t(...LABELS[name])}</option>
          ))}
        </optgroup>
        <optgroup label={t('提示词', 'Prompt writing')}>
          <option value="h3-prompt-writing">{t(...LABELS['h3-prompt-writing'])}</option>
        </optgroup>
      </select>
    </label>
  )
}

/** @returns the Home template buttons; pressing the active skill again restores the default workflow. */
export function MiniMaxTemplates(): ReactNode {
  const t = useText()
  const selected = useShell(s => s.minimaxSkill ?? null)
  return (
    <section className={css.templates} aria-label={t('从模板开始', 'Start from a template')}>
      <h2 className={css.templatesLabel}>{t('从模板开始', 'Start from a template')}</h2>
      <div className={css.templateGrid}>
        {MINIMAX_SKILLS.map(name => (
          <button key={name} type="button" className={css.templateChip} aria-pressed={selected === name}
            onClick={() => { setShell({ minimaxSkill: selected === name ? null : name }) }}>
            <SkillsIcon />
            <span>{t(...LABELS[name])}</span>
            <span className={css.templateCheck}>{selected === name && <CheckIcon />}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/**
 * @param props - existing project creation action.
 * @returns the native modal, which traps focus and supports Escape.
 */
export function NewProjectDialog({ shell }: { shell: Pick<ShellActions, 'newProject'> }): ReactNode {
  const t = useText()
  const opened = useShell(s => s.createProjectOpen === true)
  const skill = useShell(s => s.minimaxSkill ?? null)
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (opened) { setError(''); dialog.current?.showModal() }
    else if (dialog.current?.open === true) dialog.current.close()
  }, [opened])
  const close = (): void => { if (!busy) setShell({ createProjectOpen: false, minimaxSkill: null }) }
  const create = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try { await shell.newProject(skill) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return createPortal(
    <dialog ref={dialog} className={css.projectDialog} aria-labelledby="dv-create-title"
      onCancel={(event) => { event.preventDefault(); close() }}>
      <h2 id="dv-create-title">{t('新建项目', 'Create project')}</h2>
      <fieldset disabled={busy}><MiniMaxChoice /></fieldset>
      {error !== '' && <p role="alert" className={css.projectError}>{error}</p>}
      <div className={css.projectDialogActions}>
        <button type="button" disabled={busy} onClick={close}>{t('取消', 'Cancel')}</button>
        <button type="button" disabled={busy} onClick={() => { void create() }}>
          {busy ? t('创建中…', 'Creating…') : t('创建项目', 'Create project')}
        </button>
      </div>
    </dialog>, document.body,
  )
}
