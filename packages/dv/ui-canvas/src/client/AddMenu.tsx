/**
 * The canvas's 添加 / Add menu, which opens above the toolbar's add button: one heading per registered
 * `AddMenuSection`, then its items, or the empty words for a section without items; an item that a node already shows
 * ends with the placed words. The canvas decides what a picked item does. The menu names no section.
 */
import type { MutableRefObject, ReactNode } from 'react'
import type { AddMenuItem, AddMenuSection } from './contract/index.ts'

/** One section with the items of the current project state. */
export interface ShownSection {
  section: AddMenuSection
  items: readonly AddMenuItem[]
}

/** Props of {@link AddMenu}. */
export interface AddMenuProps {
  sections: readonly ShownSection[]
  /** The menu's accessible name. */
  label: string
  /** The words of a section without items, and of a menu without sections. */
  empty: string
  /** The words at the end of an item that a node already shows. */
  placed: string
  onPick: (item: AddMenuItem) => void
  /** The menu element, so the canvas can tell a press inside it from one outside. */
  menuRef: MutableRefObject<HTMLDivElement | null>
}

const sectionHeadStyle = { margin: 0, padding: '6px 10px 2px', fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-3)' }
const emptyRowStyle = { margin: 0, padding: '6px 10px', fontSize: 13, lineHeight: '20px', color: 'var(--dv-text-2)' }

/**
 * The add menu, in the style of the node menu.
 * @param props - the sections with their items, the label, the empty and placed words, the pick callback and the menu ref.
 * @returns the element.
 */
export function AddMenu({ sections, label, empty, placed, onPick, menuRef }: AddMenuProps): ReactNode {
  return (
    <div
      ref={menuRef} role="menu" aria-label={label} data-testid="dv-canvas-add-menu"
      style={{ position: 'absolute', left: 16, bottom: 60, zIndex: 12, minWidth: 200, maxHeight: '60%', overflowY: 'auto', padding: 6, boxSizing: 'border-box', background: 'var(--dv-surface-1)', boxShadow: '0 0 0 1px var(--dv-line-strong), var(--dv-shadow-2)', borderRadius: 'var(--dv-radius-xl)' }}
      onPointerDown={(event) => { event.stopPropagation() }}
      onContextMenu={(event) => { event.preventDefault() }}
    >
      {sections.length === 0 ? <p style={emptyRowStyle}>{empty}</p> : null}
      {sections.map(({ section, items }) => (
        <div key={section.id} role="group" aria-label={section.label()}>
          <p aria-hidden="true" style={sectionHeadStyle}>{section.label()}</p>
          {items.length === 0 ? <p style={emptyRowStyle}>{empty}</p> : null}
          {items.map(item => (
            <button
              key={item.key} type="button" role="menuitem" className="dv-canvas-btn" data-add-item={`${section.id}:${item.key}`}
              style={{ display: 'flex', alignItems: 'center', width: '100%', height: 32, padding: '0 10px', border: 'none', borderRadius: 'var(--dv-radius-md)', fontFamily: 'inherit', fontSize: 13, lineHeight: '20px', textAlign: 'left', cursor: 'pointer', color: 'var(--dv-text)' }}
              onClick={() => { onPick(item) }}
            >
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
              {item.node === null ? null : <span style={{ flex: 'none', marginLeft: 12, fontSize: 12, lineHeight: '16px', color: 'var(--dv-text-3)' }}>{placed}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
