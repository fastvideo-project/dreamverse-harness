/**
 * The row menu the DreamVerse shell uses for projects and chat sessions.
 *
 * @module @dv/ui-shell/RowMenu
 */
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { MoreIcon } from './icons.tsx'
import css from './shell.module.css'

/** One entry of a {@link RowMenu}. */
export interface RowMenuItem {
  label: string
  danger?: boolean
  run: () => void
}

/**
 * A ⋯ button that shows while its row is hovered or holds focus, and opens a small menu; a click outside the menu closes it.
 * @param props - the menu entries and the button's accessible label.
 * @returns the button and, while open, the menu.
 */
export function RowMenu({ items, label }: { items: RowMenuItem[]; label: string }): ReactNode {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => { document.removeEventListener('mousedown', close) }
  }, [open])
  return (
    <span ref={root} className={css.rowMenu} data-open={open ? '' : undefined}>
      <button
        type="button" className={css.rowMenuButton} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); setOpen(value => !value) }}
      ><MoreIcon /></button>
      {open && (
        <span className={css.rowMenuList} role="menu">
          {items.map(item => (
            <button
              key={item.label} type="button" role="menuitem" className={css.rowMenuItem} data-danger={item.danger === true ? '' : undefined}
              onClick={(event) => { event.stopPropagation(); setOpen(false); item.run() }}
            >{item.label}</button>
          ))}
        </span>
      )}
    </span>
  )
}
