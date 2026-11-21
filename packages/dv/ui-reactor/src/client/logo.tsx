/** Reactor's mark, drawn in the current text color. */

/**
 * Draw the Reactor logo.
 * @param props - the square size in pixels.
 * @returns the logo SVG.
 */
export function ReactorLogo({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="4 4 16 16" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M6.6 7h10.8A1.6 1.6 0 0 1 19 8.6v2.5a1.6 1.6 0 0 1-1.6 1.6H6.6A1.6 1.6 0 0 1 5 11.1V8.6A1.6 1.6 0 0 1 6.6 7Zm.6 1.6v2.5h9.6V8.6Z" />
    <path d="M7.3 13.3h1.9L6.9 17H5Zm3.7 0h2V17h-2Zm3.8 0h1.9L19 17h-2.1Z" />
  </svg>
}
