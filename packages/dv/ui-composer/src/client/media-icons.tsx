/**
 * The media-type icons of the generation picker's filter rail. The primitives icon set has no image or music glyph, so
 * both are stroke icons on a 24-unit grid that draw in `currentColor` like the primitives icons.
 */
import type { ReactNode } from 'react'

/** The pixel size and stroke every icon draws with. */
interface MediaIconProps { size: number }

/** One stroke icon on the 24-unit grid. */
function Stroke({ size, children }: MediaIconProps & { children: ReactNode }): ReactNode {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
}

/**
 * A framed picture with a sun and a hill: the image media type.
 * @param props - the pixel size.
 * @returns the SVG element.
 */
export function ImageIcon({ size }: MediaIconProps): ReactNode {
  return <Stroke size={size}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </Stroke>
}

/**
 * A beamed music note: the audio media type.
 * @param props - the pixel size.
 * @returns the SVG element.
 */
export function MusicNoteIcon({ size }: MediaIconProps): ReactNode {
  return <Stroke size={size}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Stroke>
}
