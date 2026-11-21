/**
 * A composer popover that lists models grouped by provider, with a filter rail, search, and a detail card on hover. The
 * detail card sits beside the list when the window has room on either side and above or below it otherwise.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconSearchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './picker.module.css'

/** One provider group of the list and the rail. */
export interface PickerGroup {
  id: string
  name: string
  icon: ReactNode
}

/** One rail button that narrows the list to the rows carrying its id in `PickerItem.filter`. */
export interface PickerFilter {
  id: string
  name: string
  icon: ReactNode
  /** The rail button's tooltip while no row carries this filter, which also disables the button. */
  emptyNote?: string
}

/** One selectable row. */
export interface PickerItem {
  id: string
  group: string
  /** The {@link PickerFilter} id this row belongs to, when the popover has filters. */
  filter?: string
  label: string
  /** The label while a rail filter is active, when the filter already names part of the label. */
  filteredLabel?: string
  /** Drawn before the label instead of the icon of the row's group. */
  icon?: ReactNode
  /** Words that search also matches, such as the provider and media type; the group heading already shows them. */
  keywords?: string
  selected: boolean
  /** Rows of the detail card, label then value. */
  facts: readonly (readonly [string, string])[]
  /** Extra controls at the bottom of the detail card, such as reasoning effort. */
  extra?: ReactNode
}

/** Props of {@link PickerPopover}. */
export interface PickerPopoverProps {
  /** Accessible name of the trigger and the dialog. */
  label: string
  /** The trigger's visible value text; it is truncated with an ellipsis, never wrapped. */
  value: string
  /** The untruncated value for the accessible name and tooltip when it differs from {@link value}. */
  fullValue?: string
  valueIcon?: ReactNode
  disabled?: boolean
  searchLabel: string
  /** Shown when search matches no row. */
  emptyLabel: string
  /**
   * Shown when the list has no model to offer: the hint to connect a provider.
   * @param filter - the active rail filter id, or null for the whole list.
   */
  noneLabel: (filter: string | null) => string
  /** Rows above the groups, such as Auto; a row with a `filter` shows only for that filter or with no filter. */
  leading?: readonly PickerItem[]
  groups: readonly PickerGroup[]
  /** Rail buttons; without them the rail lists the groups while there are two or more. */
  filters?: readonly PickerFilter[]
  items: readonly PickerItem[]
  /** Text shown below the list, such as where to configure more models. */
  footer?: ReactNode
  onOpen?: () => void
  /**
   * Choose a row.
   * @param id - the row's id.
   * @returns whether the popover closes.
   */
  onSelect: (id: string) => boolean
}

const LIST_WIDTH = 300
const RAIL_WIDTH = 45
const DETAIL_WIDTH = 260
const GAP = 8
const EDGE = 8

/** Where the detail card sits relative to the list. */
type DetailSide = 'right' | 'left' | 'stack'

/**
 * Draw the trigger and, while open, the rail, the grouped list, and the detail card of the row under the pointer.
 * @param props - the rows, their groups, and the selection callback.
 * @returns the trigger and the portal popover.
 */
export function PickerPopover(props: PickerPopoverProps) {
  const { label, value, fullValue = value, valueIcon, disabled, searchLabel, emptyLabel, noneLabel, leading = [], groups, filters,
    items, footer, onOpen, onSelect } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [position, setPosition] = useState<{ style: CSSProperties; side: DetailSide; list: number; height: number } | null>(null)
  const rail: readonly PickerFilter[] = filters ?? (groups.length < 2 ? [] : groups)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const panel = useRef<HTMLDivElement | null>(null)
  const listId = useId()

  useLayoutEffect(() => {
    if (!open || trigger.current === null) return
    const place = (event?: Event) => {
      if (event?.target instanceof Node && panel.current?.contains(event.target)) return
      const rect = trigger.current?.getBoundingClientRect()
      if (rect === undefined) return
      const railWidth = rail.length === 0 ? 0 : RAIL_WIDTH
      const list = Math.min(LIST_WIDTH, window.innerWidth - 2 * EDGE - railWidth)
      const main = list + railWidth
      const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - EDGE - main - GAP - DETAIL_WIDTH))
      const side: DetailSide = left + main + GAP + DETAIL_WIDTH <= window.innerWidth - EDGE ? 'right'
        : left - GAP - DETAIL_WIDTH >= EDGE ? 'left' : 'stack'
      // The card hangs beside the list, so the popover always opens downward from the trigger and its own height
      // stops at the window's bottom edge; a card taller than that space scrolls inside itself.
      const below = rect.bottom + GAP
      const fits = window.innerHeight - EDGE - below >= 240
      const top = fits ? Math.max(EDGE, Math.min(below, window.innerHeight - EDGE - 240))
        : Math.max(EDGE, rect.top - GAP - 440)
      const height = window.innerHeight - top - EDGE
      setPosition({ side, list, height, style: { top, left, maxHeight: height,
        ...(side === 'stack' ? { flexDirection: 'column', width: main } : {}) } })
    }
    place()
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [open, rail.length])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (panel.current?.contains(target) === true || trigger.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const needle = query.trim().toLowerCase()
  const visible = useMemo(() => items.filter(item => (filter === null || (filters === undefined ? item.group : item.filter) === filter)
    && `${item.label} ${item.keywords ?? ''}`.toLowerCase().includes(needle)), [items, filters, filter, needle])
  const shownGroups = groups.filter(entry => visible.some(item => item.group === entry.id))
  const shownLeading = needle === '' ? leading.filter(item => filter === null || item.filter === filter) : []
  // The detail card follows the pointer and the keyboard, and stays out of the way when neither is on a row.
  const detail = focus === null ? undefined : [...shownLeading, ...visible].find(item => item.id === focus)

  const choose = (id: string): void => {
    if (!onSelect(id)) return
    setOpen(false)
    trigger.current?.focus()
  }
  const move = (event: ReactKeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = [...panel.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []]
    const next = rows.indexOf(document.activeElement as HTMLElement) + (event.key === 'ArrowDown' ? 1 : -1)
    event.preventDefault()
    if (next >= 0) rows[Math.min(next, rows.length - 1)]?.focus()
    else panel.current?.querySelector<HTMLElement>('input')?.focus()
  }
  const row = (item: PickerItem) => <li key={item.id} role="none">
    <button type="button" role="option" aria-selected={item.selected} className={css.row}
      onMouseEnter={() => { setFocus(item.id) }} onFocus={() => { setFocus(item.id) }} onClick={() => { choose(item.id) }}>
      <span className={css.rowIcon}>{item.icon ?? groups.find(entry => entry.id === item.group)?.icon}</span>
      <span className={css.rowLabel}>{filter !== null && item.filteredLabel !== undefined ? item.filteredLabel : item.label}</span>
      {item.selected ? <IconCheckOutlineRegular size={14} className={css.check} /> : null}
    </button>
  </li>

  return <>
    <button ref={trigger} type="button" className={css.trigger} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${label}: ${fullValue}`} title={fullValue} disabled={disabled}
      onClick={() => {
        if (!open) { onOpen?.(); setQuery(''); setFilter(null); setFocus(null) }
        setOpen(current => !current)
      }}>
      {valueIcon === undefined ? null : <span className={css.triggerIcon}>{valueIcon}</span>}
      <span className={css.triggerValue}>{value}</span>
      <IconChevronDownOutlineRegular size={12} />
    </button>
    {!open || position === null ? null : createPortal(<div ref={panel} className={css.popover} style={position.style} onKeyDown={move}
      data-side={position.side} role="dialog" aria-label={label}>
      <div className={css.main} style={{
        maxHeight: Math.min(440, position.side === 'stack' && detail !== undefined ? position.height * 0.6 - GAP : position.height),
      }}>
        {rail.length === 0 ? null : <nav className={css.rail} aria-label={label}>
          {rail.map((entry) => {
            const empty = filters !== undefined && !items.some(item => item.filter === entry.id)
            return <button key={entry.id} type="button" className={css.railButton} title={empty ? entry.emptyNote ?? entry.name : entry.name}
              aria-label={entry.name} aria-pressed={filter === entry.id} disabled={empty}
              onClick={() => { setFilter(filter === entry.id ? null : entry.id); setFocus(null) }}>{entry.icon}</button>
          })}
        </nav>}
        <div className={css.listPane} style={{ width: position.list }}>
          <label className={css.search}>
            <IconSearchOutlineRegular size={14} />
            <input autoFocus type="search" placeholder={searchLabel} aria-label={searchLabel} aria-controls={listId}
              value={query} onChange={(event) => { setQuery(event.target.value); setFocus(null) }} />
          </label>
          <ul id={listId} className={css.list} role="listbox" aria-label={label}>
            {shownLeading.map(row)}
            {shownGroups.map(entry => <li key={entry.id} role="none" className={css.groupBlock}>
              <span className={css.groupHeading}><span className={css.groupIcon}>{entry.icon}</span>{entry.name}</span>
              <ul role="group" aria-label={entry.name} className={css.groupList}>
                {visible.filter(item => item.group === entry.id).map(row)}
              </ul>
            </li>)}
            {visible.length > 0 ? null
              : <li role="none" className={css.empty}>{needle === '' ? noneLabel(filter) : emptyLabel}</li>}
          </ul>
          {footer === undefined ? null : <div className={css.footer}>{footer}</div>}
        </div>
      </div>
      {detail === undefined ? null : <aside className={css.detail}
        style={{ width: position.side === 'stack' ? undefined : DETAIL_WIDTH,
          maxHeight: position.side === 'stack' ? position.height * 0.4 : position.height }}
        aria-live="polite">
        <header className={css.detailHead}>
          <span className={css.rowIcon}>{detail.icon ?? groups.find(entry => entry.id === detail.group)?.icon}</span>
          <strong>{detail.label}</strong>
        </header>
        {detail.facts.length === 0 ? null : <dl className={css.facts}>
          {detail.facts.map(([name, fact]) => <div key={name}><dt>{name}</dt><dd>{fact}</dd></div>)}
        </dl>}
        {detail.extra}
      </aside>}
    </div>, document.body)}
  </>
}
