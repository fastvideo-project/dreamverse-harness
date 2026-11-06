/**
 * The Plugins tab in the entry page's 探索 section: one card per catalog plugin with its description, what it needs
 * besides the install, its state in the profile, and Install, Turn on, or Remove; a removal asks once more before it runs.
 *
 * @module @dv/ui-plugin-catalog/CatalogShelf
 */
import { useState, type ReactNode } from 'react'
import type { CatalogEntry } from '@dv/plugin-catalog/types'
import { useText } from '@dv/ui-kit/locale.ts'
import {
  enablePlugin, installPlugin, openPluginsPage, pluginState, removePlugin, useCatalog, type PluginOutcome, type PluginState,
} from './catalog.ts'
import css from './CatalogShelf.module.css'

/**
 * The `dv.explore` entry: an intro line, the catalog's problems, and the cards.
 * @returns the Plugins tab.
 */
export function CatalogShelf(): ReactNode {
  const t = useText()
  const state = useCatalog()
  if (state.catalogError !== null) {
    return <p className={css.error} role="alert">{t(`插件目录读取失败：${state.catalogError}`, `Could not read the plugin catalog: ${state.catalogError}`)}</p>
  }
  if (state.catalog === null) return <p className={css.intro}>{t('正在读取插件目录…', 'Reading the plugin catalog…')}</p>
  return (
    <div className={css.shelf}>
      <p className={css.intro}>
        {state.manageable
          ? t('这些插件经过审核，从 npm 安装到当前 profile。', 'These plugins are reviewed and install from npm into this profile.')
          : t('这个 profile 没有插件管理器，无法在这里安装插件。', 'This profile has no plugin manager, so plugins cannot be installed here.')}
      </p>
      {state.catalog.problems.map(problem => (
        <p key={problem.source} className={css.error} role="alert">
          {t(`目录源 ${problem.source} 无法使用：${problem.message}`, `Catalog source ${problem.source} could not be used: ${problem.message}`)}
        </p>
      ))}
      {state.catalog.plugins.length === 0
        ? <p className={css.intro}>{t('目录里还没有插件。', 'The catalog lists no plugins yet.')}</p>
        : (
          <div className={css.cards}>
            {state.catalog.plugins.map(entry => (
              <PluginCard
                key={entry.package} entry={entry} state={pluginState(state, entry.package)} manageable={state.manageable}
                outcome={state.outcomes.get(entry.package)}
              />
            ))}
          </div>
        )}
    </div>
  )
}

/**
 * One catalog plugin.
 * @param props - the entry, its state, whether the plugin manager is reachable, and the last outcome.
 * @returns the card.
 */
function PluginCard(props: {
  entry: CatalogEntry
  state: PluginState
  manageable: boolean
  outcome: PluginOutcome | undefined
}): ReactNode {
  const { entry, state, manageable, outcome } = props
  const t = useText()
  const [confirming, setConfirming] = useState(false)
  const status: Record<PluginState, string> = {
    unknown: '',
    absent: t('未安装', 'Not installed'),
    on: t('已安装 · 已开启', 'Installed · On'),
    off: t('已安装 · 已关闭', 'Installed · Off'),
    installing: t('安装中…', 'Installing…'),
    removing: t('移除中…', 'Removing…'),
    enabling: t('开启中…', 'Turning on…'),
  }
  return (
    <article className={css.card} data-plugin={entry.package} data-state={state}>
      <header className={css.head}>
        <span className={css.title}>{t(entry.title.zh, entry.title.en)}</span>
        <code className={css.package}>{entry.package}</code>
        {status[state] === '' ? null : <span className={css.status} data-state={state}>{status[state]}</span>}
      </header>
      <p className={css.description}>{t(entry.description.zh, entry.description.en)}</p>
      {entry.setup === undefined ? null : (
        <p className={css.setup}><span className={css.setupLabel}>{t('还需要', 'Also needs')}</span>{t(entry.setup.zh, entry.setup.en)}</p>
      )}
      {entry.homepage === undefined ? null : <a className={css.link} href={entry.homepage} target="_blank" rel="noreferrer">{t('主页', 'Homepage')}</a>}
      {manageable && (
        <div className={css.actions}>
          {state === 'absent' && <button type="button" className={css.primary} onClick={() => { installPlugin(entry.package) }}>{t('安装', 'Install')}</button>}
          {state === 'off' && <button type="button" className={css.primary} onClick={() => { enablePlugin(entry.package) }}>{t('开启', 'Turn on')}</button>}
          {(state === 'on' || state === 'off') && !confirming && (
            <button type="button" className={css.secondary} onClick={() => { setConfirming(true) }}>{t('移除', 'Remove')}</button>
          )}
          {(state === 'on' || state === 'off') && confirming && (
            <>
              <button type="button" className={css.danger} onClick={() => { setConfirming(false); removePlugin(entry.package) }}>{t('确认移除', 'Confirm remove')}</button>
              <button type="button" className={css.secondary} onClick={() => { setConfirming(false) }}>{t('取消', 'Cancel')}</button>
            </>
          )}
        </div>
      )}
      {outcome === undefined ? null : <Outcome outcome={outcome} />}
    </article>
  )
}

/**
 * The last request's outcome under a card.
 * @param props - the outcome.
 * @returns the line.
 */
function Outcome({ outcome }: { outcome: PluginOutcome }): ReactNode {
  const t = useText()
  switch (outcome.kind) {
    case 'installed': return <p className={css.done} role="status">{t('已安装并开启。', 'Installed and turned on.')}</p>
    case 'enabled': return <p className={css.done} role="status">{t('已开启。', 'Turned on.')}</p>
    case 'removed': return <p className={css.done} role="status">{t('已移除。', 'Removed.')}</p>
    case 'installed-restart':
      return <p className={css.done} role="status">{t('已安装。重启 harness 后生效。', 'Installed. Restart the harness to load it.')}</p>
    case 'removed-restart':
      return <p className={css.done} role="status">{t('已移除。重启 harness 后生效。', 'Removed. Restart the harness to unload it.')}</p>
    case 'scripts':
      return (
        <p className={css.error} role="alert">
          {t(`需要允许这些包的安装脚本：${outcome.packages.join(', ')}。请到`, `These packages need their install scripts approved: ${outcome.packages.join(', ')}. Finish in `)}
          <button type="button" className={css.inlineLink} onClick={openPluginsPage}>{t('插件页', 'Plugins')}</button>
          {t('完成。', '.')}
        </p>
      )
    case 'failed': return <p className={css.error} role="alert">{t(`失败：${outcome.message}`, `Failed: ${outcome.message}`)}</p>
  }
}
