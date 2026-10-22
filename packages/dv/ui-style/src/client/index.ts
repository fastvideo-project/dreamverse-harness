/**
 * Browser half of the style component: one `defineReferenceUi` declaration gives the style noun its canvas node type,
 * version kind, references in use, `dv.canvas.card` and `dv.canvas.editor` entries, `@` menu kind and History row.
 *
 * @module @dv/ui-style/client
 */
import type { StyleState } from '@dv/style/types'
import { defineReferenceUi } from '@dv/ui-reference-kit/reference-kit.tsx'

declare module '@dv/ui-kit/types.ts' { interface ComponentStates { style: StyleState } }

/** The style noun on the canvas, in the asset picker, in the `@` menu and in the History panel. */
export const { inject, apply } = defineReferenceUi({
  id: '@dv/ui-style', key: 'style', slice: state => state.components.style, color: 'var(--dv-node-7)',
  label: ['风格', 'Style'], mention: { section: ['风格', 'Styles'], order: 3 },
})
