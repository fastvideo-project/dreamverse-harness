/**
 * The stroke icons of the DreamVerse shell. Each draws in `currentColor` with a 1.5 px rendered stroke at every size and
 * is hidden from assistive technology; the button that holds it carries the accessible label.
 *
 * @module @dv/ui-shell/icons
 */
import type { ReactNode } from 'react'

/** The rendered stroke width in pixels; the 24-unit drawing grid scales it, so the attribute is this times 24 / size. */
const ICON_STROKE = 1.5

/**
 * One stroke icon.
 * @param props - the SVG children and the pixel size.
 * @returns the SVG element.
 */
function Icon({ children, size = 16 }: { children: ReactNode; size?: number }): ReactNode {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE * 24 / size}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    >{children}</svg>
  )
}

/** A house: 首页. */
export function HomeIcon(): ReactNode {
  return <Icon><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /></Icon>
}

/** A plus sign: create. */
export function PlusIcon(): ReactNode {
  return <Icon><path d="M12 5v14M5 12h14" /></Icon>
}

/** A check mark: the current entry. */
export function CheckIcon(): ReactNode {
  return <Icon><path d="m5 12 5 5L20 7" /></Icon>
}

/** A downward chevron: a menu opens. */
export function ChevronDownIcon(): ReactNode {
  return <Icon size={14}><path d="m6 9 6 6 6-6" /></Icon>
}

/** A rightward chevron: a collapsed row or a row that leads elsewhere. */
export function ChevronRightIcon(): ReactNode {
  return <Icon size={14}><path d="m9 6 6 6-6 6" /></Icon>
}

/** A window with its right column marked: the right panel. */
export function SidebarRightIcon(): ReactNode {
  return <Icon size={18}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></Icon>
}

/** Three dots: a row menu. */
export function MoreIcon(): ReactNode {
  return (
    <Icon>
      <circle cx="6" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** A pinwheel of four squares: the Plugins page and any other sidebar page without its own icon. */
export function PluginsIcon(): ReactNode {
  return <Icon><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></Icon>
}

/** A plug: the MCP page and MCP servers. */
export function PlugIcon({ size = 16 }: { size?: number } = {}): ReactNode {
  return <Icon size={size}><path d="M9 3v4M15 3v4M6.5 7h11v4a5.5 5.5 0 0 1-11 0V7Z" /><path d="M12 16.5V21" /></Icon>
}

/** A four-point spark: the Skills page. */
export function SkillsIcon(): ReactNode {
  return <Icon><path d="M12 3.5l2.1 6.4 6.4 2.1-6.4 2.1L12 20.5l-2.1-6.4L3.5 12l6.4-2.1L12 3.5Z" /></Icon>
}
