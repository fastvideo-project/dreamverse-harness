/**
 * Browser half of voice conversion: the `voice.convert` records as voice takes through one `defineGenerationUi`
 * declaration of `@dv/ui-generation`, with the voice chip, the `@` filter of one recording and the take editor's words of
 * `voice-bar.ts`; and the `dv-voice` right-Sidebar tab type whose body is the Voice panel of the project the shell has
 * open, which records a line with the browser microphone and converts a recording into an allowed voice.
 *
 * @module @fastvideo/dreamverse-ui-voice-convert/client
 */
import { createElement, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { defineGenerationUi } from '@dv/ui-generation/generation-kit.tsx'
import { DvClient } from '@dv/ui-kit/api.ts'
import { useCurrentProject } from '@dv/ui-kit/current-project.ts'
import { pickText, useText } from '@dv/ui-kit/locale.ts'
import { voiceBar } from './voice-bar.ts'
import { browserRecorder, readAssetText, VoicePanel, type Recorder } from './VoicePanel.tsx'

export { VoicePanel, type VoicePanelProps, type Recorder } from './VoicePanel.tsx'

/** The tab kind this package owns. */
export const VOICE_KIND = 'dv-voice'

/** This implementation's identity in the tab system, and the key its body and its takes register under. */
export const VOICE_ID = '@fastvideo/dreamverse-ui-voice-convert'

/** The Voice tab type: a page type the guide offers, with no resource address. */
export const voiceDefinition: SidebarRightTabDefinition = {
  id: VOICE_ID,
  kind: VOICE_KIND,
  priority: 'builtin',
  keepMounted: true,
  title: () => pickText('配音', 'Voice'),
  guide: [{
    id: 'voice', order: 36, title: () => pickText('配音', 'Voice'),
    description: () => pickText('录制台词并转换为允许的音色', 'Record a line and convert it to an allowed voice'),
  }],
}

/** What the plugin hands the tab body. */
interface VoiceTabInjected {
  client: DvClient
  recorder: Recorder
}

/**
 * The tab body: the Voice panel of the project the DreamVerse shell has open, beside the tab's chat session.
 * @param props - the tab's chat session, the client and the microphone.
 * @returns the panel, or a notice while no project is open.
 */
function VoiceTabBody(props: PropsRuntime<'sidebar.right.pane.tab'> & VoiceTabInjected): ReactNode {
  const project = useCurrentProject()
  const t = useText()
  if (project === null) return createElement('p', { style: { padding: 16 } }, t('先打开一个项目', 'Open a project first'))
  // Keyed by project so a switch starts from an empty panel.
  return createElement(VoicePanel, {
    key: project, projectId: project, session: props.sessionId, client: props.client, recorder: props.recorder,
    readText: readAssetText,
  })
}

const takes = defineGenerationUi({
  id: VOICE_ID, type: 'voice', operations: ['voice.convert'], label: ['配音', 'Voice'], color: 'var(--dv-node-6)',
  // The audio view's waveform and play button fill a lower body than the 16:9 frame.
  bodyHeight: 72,
  status: { running: ['转换中…', 'Converting…'], failed: ['转换失败', 'Conversion failed'], done: ['已转换', 'Converted'] },
  bar: voiceBar,
})

/** Required browser services: the tab registry and the DSH UI slot registry, besides the generation kit's own. */
export const inject = [...new Set([...takes.inject, 'slots', 'sidebarRightTabs'])]

/**
 * Client plugin body: the voice takes, and the Voice tab type with its body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  takes.apply(ctx)
  ctx.effect(() => ctx.sidebarRightTabs.register(voiceDefinition), 'ui-voice-convert: tab type')
  const injected: VoiceTabInjected = { client: new DvClient(), recorder: browserRecorder() }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: VOICE_ID, inject: () => injected },
    VoiceTabBody,
  )), 'ui-voice-convert: tab body')
}
