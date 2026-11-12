/**
 * The 插件市场 / Marketplace page in the main column, opened from its entry in the left navigator: a heading and an intro
 * line, then one card per catalog plugin with its description, what it needs besides the install, its state in the
 * profile, and Install, Turn on, or Remove; a removal asks once more before it runs.
 *
 * @module @dv/ui-plugin-catalog/CatalogPage
 */
import { useState, type ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CatalogEntry } from '@dv/plugin-catalog/types'
import { useText } from '@dv/ui-kit/locale.ts'
import {
  approveScriptsAndInstall, enablePlugin, installPlugin, openPluginsPage, pluginState, removePlugin, useCatalog, type PluginOutcome,
  type PluginState,
} from './catalog.ts'
import css from './CatalogPage.module.css'

/**
 * The navigator entry's icon: a storefront, an awning with a scalloped edge over the shop and its door.
 * @param props - the sidebar's icon share: the requested edge.
 * @returns the icon element.
 */
export function MarketplacePanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M3.5 9.5 5 4.5h14l1.5 5a2.125 2.125 0 0 1-4.25 0 2.125 2.125 0 0 1-4.25 0 2.125 2.125 0 0 1-4.25 0 2.125 2.125 0 0 1-4.25 0ZM5.5 12v7.5h13V12M10 19.5V15.5h4v4"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The Marketplace page: the heading, the intro line, the catalog's problems, and the cards.
 * @returns the page element.
 */
export function CatalogPage(): ReactNode {
  const t = useText()
  return (
    <section className={css.page} data-dv-marketplace="">
      <header className={css.head}>
        <h1 className={css.heading}>{t('插件市场', 'Marketplace')}</h1>
        <p className={css.intro}>
          {t('这些插件经过审核，从 npm 安装到当前 profile。已安装的插件在', 'These plugins are reviewed and install from npm into this profile. Manage installed plugins on the ')}
          <button type="button" className={css.inlineLink} onClick={openPluginsPage}>{t('插件', 'Plugins')}</button>
          {t('页面管理。', ' page.')}
        </p>
      </header>
      <CatalogList />
    </section>
  )
}

/**
 * The catalog's problems and cards, or the line that stands in for them while the catalog is read or cannot be.
 * @returns the list element.
 */
function CatalogList(): ReactNode {
  const t = useText()
  const state = useCatalog()
  if (state.catalogError !== null) {
    return <p className={css.error} role="alert">{t(`插件目录读取失败：${state.catalogError}`, `Could not read the plugin catalog: ${state.catalogError}`)}</p>
  }
  if (state.catalog === null) return <p className={css.intro}>{t('正在读取插件目录…', 'Reading the plugin catalog…')}</p>
  return (
    <div className={css.list}>
      {state.manageable ? null : (
        <p className={css.intro}>{t('这个 profile 没有插件管理器，无法在这里安装插件。', 'This profile has no plugin manager, so plugins cannot be installed here.')}</p>
      )}
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
                removable={state.bundles?.get(entry.package)?.removable === true}
                installedVersion={state.bundles?.get(entry.package)?.version} outcome={state.outcomes.get(entry.package)}
              />
            ))}
          </div>
        )}
    </div>
  )
}

/**
 * One catalog plugin.
 * @param props - the entry, its state, whether the plugin manager is reachable, whether the plugin manager can remove its
 * bundle, the installed version, and the last outcome.
 * @returns the card.
 */
function PluginCard(props: {
  entry: CatalogEntry
  state: PluginState
  manageable: boolean
  removable: boolean
  installedVersion: string | undefined
  outcome: PluginOutcome | undefined
}): ReactNode {
  const { entry, state, manageable, removable, installedVersion, outcome } = props
  const t = useText()
  const [confirming, setConfirming] = useState(false)
  const status: Record<PluginState, string> = {
    unknown: '',
    absent: t('未安装', 'Not installed'),
    on: t('已安装 · 已开启', 'Installed · On'),
    off: t('已安装 · 已关闭', 'Installed · Off'),
    error: t('已安装 · 未加载', 'Installed · Not loaded'),
    installing: t('安装中…', 'Installing…'),
    removing: t('移除中…', 'Removing…'),
    enabling: t('开启中…', 'Turning on…'),
  }
  return (
    <article className={css.card} data-plugin={entry.package} data-state={state}>
      <header className={css.head}>
        <span className={css.title}>{t(entry.title.zh, entry.title.en)}</span>
        <code className={css.package}>{entry.package}@{entry.version}</code>
        {status[state] === '' ? null : <span className={css.status} data-state={state}>{status[state]}</span>}
      </header>
      <p className={css.description}>{t(entry.description.zh, entry.description.en)}</p>
      {entry.setup === undefined ? null : (
        <p className={css.setup}><span className={css.setupLabel}>{t('还需要', 'Also needs')}</span>{t(entry.setup.zh, entry.setup.en)}</p>
      )}
      {installedVersion !== undefined && installedVersion !== entry.version && (
        <p className={css.setup}>
          {t(`已安装 ${installedVersion}；目录审核的版本是 ${entry.version}。`, `Version ${installedVersion} is installed; the catalog lists ${entry.version}.`)}
        </p>
      )}
      {entry.homepage === undefined ? null : <a className={css.link} href={entry.homepage} target="_blank" rel="noreferrer">{t('主页', 'Homepage')}</a>}
      {manageable && (
        <div className={css.actions}>
          {state === 'absent' && <button type="button" className={css.primary} onClick={() => { installPlugin(entry) }}>{t('安装', 'Install')}</button>}
          {state === 'off' && <button type="button" className={css.primary} onClick={() => { enablePlugin(entry.package) }}>{t('开启', 'Turn on')}</button>}
          {removable && (state === 'on' || state === 'off' || state === 'error') && !confirming && (
            <button type="button" className={css.secondary} onClick={() => { setConfirming(true) }}>{t('移除', 'Remove')}</button>
          )}
          {removable && (state === 'on' || state === 'off' || state === 'error') && confirming && (
            <>
              <button type="button" className={css.danger} onClick={() => { setConfirming(false); removePlugin(entry.package) }}>{t('确认移除', 'Confirm remove')}</button>
              <button type="button" className={css.secondary} onClick={() => { setConfirming(false) }}>{t('取消', 'Cancel')}</button>
            </>
          )}
        </div>
      )}
      {outcome === undefined ? null : <Outcome entry={entry} outcome={outcome} />}
    </article>
  )
}

/**
 * The last request's outcome under a card; pending install scripts come with the button that allows them and installs
 * the plugin again.
 * @param props - the plugin's catalog entry and the outcome.
 * @returns the line.
 */
function Outcome({ entry, outcome }: { entry: CatalogEntry; outcome: PluginOutcome }): ReactNode {
  const t = useText()
  switch (outcome.kind) {
    case 'installed': return <p className={css.done} role="status">{t('已安装并开启。', 'Installed and turned on.')}</p>
    case 'enabled': return <p className={css.done} role="status">{t('已开启。', 'Turned on.')}</p>
    case 'removed': return <p className={css.done} role="status">{t('已移除。', 'Removed.')}</p>
    case 'installed-restart':
      return <p className={css.done} role="status">{t('已安装。重启 harness 后生效。', 'Installed. Restart the harness to load it.')}</p>
    case 'enabled-restart':
      return <p className={css.done} role="status">{t('已开启。重启 harness 后生效。', 'Turned on. Restart the harness to load it.')}</p>
    case 'removed-restart':
      return <p className={css.done} role="status">{t('已移除。重启 harness 后生效。', 'Removed. Restart the harness to unload it.')}</p>
    case 'scripts':
      return (
        <>
          <p className={css.error} role="alert">
            {t(`需要允许这些包的安装脚本：${outcome.packages.join(', ')}。`, `These packages need their install scripts approved: ${outcome.packages.join(', ')}.`)}
          </p>
          <div className={css.actions}>
            <button type="button" className={css.primary} onClick={() => { approveScriptsAndInstall(entry, outcome.packages) }}>
              {t('允许这些脚本并重试', 'Allow these scripts and retry')}
            </button>
          </div>
        </>
      )
    case 'failed': return <p className={css.error} role="alert">{t(`失败：${outcome.message}`, `Failed: ${outcome.message}`)}</p>
  }
}
