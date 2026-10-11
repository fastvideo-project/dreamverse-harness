/** MCP server dashboard on the MCP plugin page: the roster with live connection state, and the add-server dialog. */
import { useState, type FormEvent } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconCordisPluginOutlineRegular, IconPlusOutlineRegular,
  IconRefreshOutlineRegular, IconTrashOutlineRegular, Input, Modal, SegmentedControl, StateDot, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { McpServerPhase, McpServerSpec, McpServerView } from '@deepseek-ai/dsh-mcp-servers/types'
import type { McpRosterState } from './roster.ts'
import { NS } from './locales.ts'
import css from './McpServersPage.module.css'

/** Roster observation and Host actions the dashboard receives from its slot entry. */
export interface McpServersInjected {
  hooks: { mcpRoster: HostObservable<McpRosterState> }
  /** Save a server into the profile. */
  add: (name: string, spec: McpServerSpec) => Promise<void>
  /** Delete a server from the profile. */
  remove: (name: string) => Promise<void>
  /** Reconnect a configured server. */
  retry: (name: string) => Promise<void>
}

type Translate = PropsLocale<typeof NS>['t']
type Props = InjectFace<McpServersInjected> & PropsLocale<typeof NS>

const PHASE_DOT: Record<McpServerPhase, StateDotState> = { connecting: 'ongoing', connected: 'done', failed: 'error' }

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/** The launch command or endpoint of one server, as one line. */
function specLine(spec: McpServerSpec): string {
  return spec.transport === 'stdio' ? [spec.command, ...spec.args].join(' ') : spec.url
}

/**
 * Parse `KEY<separator>VALUE` lines into a record; blank lines are skipped.
 * @param text - one pair per line.
 * @param separator - `=` for environment variables, `:` for headers.
 * @param t - dictionary for the malformed-line message.
 * @returns the record, or the first malformed line as an error message.
 */
function parsePairs(text: string, separator: string, t: Translate): Record<string, string> | string {
  const pairs: Record<string, string> = {}
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue
    const at = line.indexOf(separator)
    const key = at <= 0 ? '' : line.slice(0, at).trim()
    if (key === '') return t('form.badLine', { line: String(index + 1), text: line })
    pairs[key] = line.slice(at + 1).trim()
  }
  return pairs
}

/** One server row: name, launch line, connection state, actions, and its tool list. */
function ServerRow({ server, busy, onRetry, onRemove, t }: {
  readonly server: McpServerView
  readonly busy: boolean
  readonly onRetry: () => void
  readonly onRemove: () => void
  readonly t: Translate
}) {
  const [open, setOpen] = useState(false)
  const stateText = server.phase === 'connected'
    ? t('phase.connected', { count: String(server.tools.length) }) : t(`phase.${server.phase}`)
  return (
    <li className={css.row} data-mcp-server={server.name} {...server.phase === 'failed' ? { 'data-state': 'failed' } : {}}>
      <div className={css.rowLine}>
        <span className={css.rowIcon} aria-hidden="true"><IconCordisPluginOutlineRegular size={18} /></span>
        <div className={css.rowMain}>
          <span className={css.rowName}>{server.name}</span>
          <code className={css.rowSpec}>{specLine(server.spec)}</code>
        </div>
        <span className={css.rowState} role="status"><StateDot state={PHASE_DOT[server.phase]} />{stateText}</span>
        <div className={css.rowActions}>
          {server.phase === 'failed'
            ? (
              <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular size={13} />} disabled={busy}
                aria-label={t('retryLabel', { name: server.name })} onClick={onRetry}>{t('retry')}</Button>
            )
            : null}
          <Button variant="ghost" size="sm" icon={<IconTrashOutlineRegular size={13} />} disabled={busy}
            aria-label={t('removeLabel', { name: server.name })} onClick={onRemove}>{t('remove')}</Button>
        </div>
      </div>
      {server.error === undefined ? null : <p className={css.rowFailure} role="alert">{server.error}</p>}
      {server.phase === 'connected'
        ? (
          <div className={css.tools}>
            <button type="button" className={css.toolsToggle} aria-expanded={open} aria-label={t('toolsLabel', { name: server.name })}
              onClick={() => { setOpen(value => !value) }}>
              {open ? <IconChevronDownOutlineRegular size={14} /> : <IconChevronRightOutlineRegular size={14} />}
              {t('tools')}<span className={css.count}>{server.tools.length}</span>
            </button>
            {open
              ? server.tools.length === 0
                ? <p className={css.status}>{t('noTools')}</p>
                : (
                  <ul className={css.toolList}>
                    {server.tools.map(tool => (
                      <li key={tool.name}><code>{tool.name}</code>{tool.description === '' ? null : <span>{tool.description}</span>}</li>
                    ))}
                  </ul>
                )
              : null}
          </div>
        )
        : null}
    </li>
  )
}

/** Add-server dialog: stdio launch settings or an HTTP endpoint. */
function AddServerDialog({ open, onClose, onSave, t }: {
  readonly open: boolean
  readonly onClose: () => void
  readonly onSave: (name: string, spec: McpServerSpec) => Promise<void>
  readonly t: Translate
}) {
  const [name, setName] = useState(''), [transport, setTransport] = useState<McpServerSpec['transport']>('stdio')
  const [command, setCommand] = useState(''), [args, setArgs] = useState(''), [env, setEnv] = useState('')
  const [url, setUrl] = useState(''), [headers, setHeaders] = useState('')
  const [error, setError] = useState(''), [saving, setSaving] = useState(false)
  const reset = (): void => {
    setName(''); setTransport('stdio'); setCommand(''); setArgs(''); setEnv(''); setUrl(''); setHeaders(''); setError('')
  }
  const close = (): void => { reset(); onClose() }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    let spec: McpServerSpec
    if (transport === 'stdio') {
      const parsedEnv = parsePairs(env, '=', t)
      if (typeof parsedEnv === 'string') { setError(parsedEnv); return }
      spec = { transport, command: command.trim(), args: args.split('\n').map(arg => arg.trim()).filter(arg => arg !== ''), env: parsedEnv }
    } else {
      const parsedHeaders = parsePairs(headers, ':', t)
      if (typeof parsedHeaders === 'string') { setError(parsedHeaders); return }
      spec = { transport, url: url.trim(), headers: parsedHeaders }
    }
    setSaving(true); setError('')
    try { await onSave(name.trim(), spec); close() } catch (failure) { setError(t('failed', { message: errorText(failure) })) } finally { setSaving(false) }
  }
  const ready = name.trim() !== '' && (transport === 'stdio' ? command.trim() !== '' : url.trim() !== '')
  return (
    <Modal open={open} onClose={close} title={t('form.title')} description={t('form.description')} closeLabel={t('form.close')}
      footer={(
        <div className={css.formActions}>
          <Button variant="ghost" size="sm" onClick={close}>{t('form.cancel')}</Button>
          <Button variant="primary" size="sm" type="submit" form="mcp-add-server" disabled={!ready || saving}>{t('form.save')}</Button>
        </div>
      )}>
      <form id="mcp-add-server" className={css.form} onSubmit={(event) => { void submit(event) }}>
        <label className={css.field}>
          <span>{t('form.name')}</span>
          <Input value={name} placeholder={t('form.namePlaceholder')} onChange={(event) => { setName(event.target.value) }} autoFocus />
          <small>{t('form.nameHelp')}</small>
        </label>
        <div className={css.field}>
          <span>{t('form.transport')}</span>
          <SegmentedControl id="mcp-transport" label={t('form.transport')} value={transport} onChange={setTransport}
            options={[{ value: 'stdio', label: t('form.stdio') }, { value: 'streamable-http', label: t('form.http') }]} />
        </div>
        {transport === 'stdio'
          ? (
            <>
              <label className={css.field}>
                <span>{t('form.command')}</span>
                <Input value={command} placeholder={t('form.commandPlaceholder')} onChange={(event) => { setCommand(event.target.value) }} />
              </label>
              <label className={css.field}>
                <span>{t('form.args')}</span>
                <textarea className={css.textarea} rows={3} value={args} onChange={(event) => { setArgs(event.target.value) }} />
                <small>{t('form.argsHelp')}</small>
              </label>
              <label className={css.field}>
                <span>{t('form.env')}</span>
                <textarea className={css.textarea} rows={2} value={env} onChange={(event) => { setEnv(event.target.value) }} />
                <small>{t('form.envHelp')}</small>
              </label>
            </>
          )
          : (
            <>
              <label className={css.field}>
                <span>{t('form.url')}</span>
                <Input value={url} placeholder={t('form.urlPlaceholder')} onChange={(event) => { setUrl(event.target.value) }} />
              </label>
              <label className={css.field}>
                <span>{t('form.headers')}</span>
                <textarea className={css.textarea} rows={2} value={headers} onChange={(event) => { setHeaders(event.target.value) }} />
                <small>{t('form.headersHelp')}</small>
              </label>
            </>
          )}
        {error === '' ? null : <p className={css.formError} role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

/** The roster section rendered on the MCP plugin page. */
export function McpServersPage({ useMcpRoster, add, remove, retry, t }: Props) {
  const state = useMcpRoster(value => value)
  const [adding, setAdding] = useState(false), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('')
  const run = async (name: string, action: () => Promise<void>): Promise<void> => {
    setBusy(name); setError('')
    try { await action() } catch (failure) { setError(t('failed', { message: errorText(failure) })) } finally { setBusy(null) }
  }
  const servers = state.roster?.servers ?? []
  return (
    <section className={css.section} data-mcp-servers>
      <div className={css.head}>
        <h4 className={css.title}>{t('title')}</h4>
        {state.roster === null ? null : <span className={css.count}>{t('count', { count: String(servers.length) })}</span>}
        <Button className={css.addButton} variant="outline" size="sm" icon={<IconPlusOutlineRegular size={13} />}
          disabled={!state.connected} onClick={() => { setAdding(true) }}>{t('add')}</Button>
      </div>
      <p className={css.intro}>{t('intro')}</p>
      {state.roster === null ? <p className={css.status} role="status">{t(state.error === null ? 'loading' : 'reconnecting')}</p> : null}
      {state.error === null ? null : <p className={css.formError} role="alert">{state.error}</p>}
      {state.roster !== null && servers.length === 0 ? <p className={css.status}>{t('empty')}</p> : null}
      {servers.length === 0
        ? null
        : (
          <ul className={css.rows}>
            {servers.map(server => (
              <ServerRow key={server.name} server={server} busy={busy === server.name || !state.connected} t={t}
                onRetry={() => { void run(server.name, () => retry(server.name)) }}
                onRemove={() => { void run(server.name, () => remove(server.name)) }} />
            ))}
          </ul>
        )}
      {error === '' ? null : <p className={css.formError} role="alert">{error}</p>}
      <AddServerDialog open={adding} onClose={() => { setAdding(false) }} onSave={add} t={t} />
    </section>
  )
}
