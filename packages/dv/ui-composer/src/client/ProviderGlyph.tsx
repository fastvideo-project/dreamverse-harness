/** The provider mark shared by the composer's pickers. */
import type { ComponentType } from 'react'
import css from './picker.module.css'

/**
 * Draw a provider mark: the provider's logo, or the first letter of its name when the plugin draws none.
 * @param props - the logo component, when there is one, and the provider's display name.
 * @returns the mark.
 */
export function ProviderGlyph({ logo: Logo, name }: { logo?: ComponentType<{ size: number }> | undefined; name: string }) {
  return <span className={css.glyph} aria-hidden="true">{Logo === undefined ? name.slice(0, 1).toUpperCase() : <Logo size={12} />}</span>
}
