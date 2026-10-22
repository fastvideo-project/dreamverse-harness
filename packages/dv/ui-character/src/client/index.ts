/**
 * Browser half of the character component: one `defineReferenceUi` declaration gives the character noun its canvas node
 * type, version kind, references in use, `dv.canvas.card` and `dv.canvas.editor` entries, `@` menu kind and History row.
 *
 * @module @dv/ui-character/client
 */
import type { CharacterState } from '@dv/character/types'
import { defineReferenceUi } from '@dv/ui-reference-kit/reference-kit.tsx'
import type { ReferenceNodeData } from '@dv/ui-reference-kit/reference-kit.tsx'

declare module '@dv/ui-kit/types.ts' { interface ComponentStates { character: CharacterState } }
declare module '@dv/ui-canvas/contract' { interface NodeDataMap { character: ReferenceNodeData } }

/** The character noun on the canvas, in the asset picker, in the `@` menu and in the History panel. */
export const { inject, apply } = defineReferenceUi({
  id: '@dv/ui-character', key: 'character', slice: state => state.components.character,
  label: ['角色', 'Character'], mention: { section: ['角色', 'Characters'], order: 1 },
})
