/** Tool-level preflight for the pinned MiniMax workflows, not a model or endpoint health check. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { MiniMaxSkill } from './minimax-routing.ts'

const CAPABILITIES = {
  images: { tools: ['dv_image_generate'], note: 'hub_generate_image; verify the image model and reference-input support.' },
  video: { tools: ['dv_shot_render', 'dv_proj_wait', 'dv_models_list', 'dv_models_get'], note: 'hub_generate_video; verify model/task, references, duration and native audio before dispatch.' },
  canvas: { tools: ['dv_textnode_write', 'dv_textnode_read', 'dv_asset_import', 'dv_asset_place', 'dv_proj_state'], note: 'hub_canvas_get_node and durable text/media outputs; no Hub grouping.' },
  assembly: { tools: ['dv_timeline_create', 'dv_timeline_update', 'dv_timeline_export'], note: 'hub_video_edit is only partially mapped: order/trim/export, not audio mixing or beat-synced editing.' },
  speech: { tools: ['dv_audio_generate'], note: 'hub_synthesize_speech/hub_generate_audio only for supported model tasks, not arbitrary music or sound effects.' },
  approvals: { tools: ['ask_user_question'], note: 'Choice cards; if unavailable, disclose the limitation and ask in chat, then wait.' },
  music: { tools: [], note: 'hub_generate_music: no standalone music-generation mapping.' },
  audioMix: { tools: [], note: 'No audio-track replacement, ducking, or Master Audio mixing mapping.' },
  analysis: { tools: [], note: 'hub_analyse_media/hub_audio_meta: no general video/audio analysis or beat-detection mapping; image inspection alone is insufficient.' },
  search: { tools: [], note: 'hub_image_search: no verified source-search mapping; request supplied/verified assets.' },
  groups: { tools: [], note: 'hub_canvas_group_recent_outputs: no Hub canvas grouping mapping; separate nodes only.' },
} satisfies Record<string, { tools: string[]; note: string }>

// Includes conditional stages: the official workflow decides which are mandatory for the chosen deliverable.
const REQUIREMENTS: Record<MiniMaxSkill, Array<keyof typeof CAPABILITIES>> = {
  'h3-prompt-writing': [],
  'handdrawn-live-video-generator': ['video', 'canvas', 'approvals'],
  'minimalist-product-ad-generator': ['images', 'video', 'canvas', 'assembly', 'approvals', 'music', 'audioMix', 'analysis', 'groups'],
  'brand-promo-video-generator': ['images', 'video', 'canvas', 'assembly', 'speech', 'approvals', 'music', 'audioMix', 'analysis', 'search', 'groups'],
  '3d-animation-short-generator': ['images', 'video', 'canvas', 'assembly', 'approvals', 'music', 'audioMix', 'groups'],
  'music-video-subtitle-generator': ['images', 'video', 'canvas', 'assembly', 'approvals', 'music', 'audioMix', 'analysis'],
  'papercraft-stop-motion-explainer': ['images', 'video', 'canvas', 'assembly', 'speech', 'approvals', 'music', 'audioMix'],
  'paper-collage-explainer-generator': ['images', 'video', 'canvas', 'assembly', 'approvals', 'audioMix'],
  'co-op-game-intro-generator': ['images', 'video', 'canvas', 'approvals'],
}

/**
 * Report registered mappings and unsupported requirements before media execution.
 * @param ctx - plugin context with the existing tool registry.
 * @param agent - caller whose scoped tools are checked.
 * @param skill - selected official workflow.
 * @returns model-visible capability report, also written to the existing logger.
 */
export function miniMaxPreflight(ctx: Context, agent: Agent, skill: MiniMaxSkill): string {
  const lines = REQUIREMENTS[skill].map((key) => {
    const capability = CAPABILITIES[key]
    const missing = capability.tools.filter(name => ctx.tools.get(name, agent) === undefined)
    const status = capability.tools.length === 0 ? 'unsupported'
      : missing.length > 0 ? `missing tools: ${missing.join(', ')}` : `registered: ${capability.tools.join(', ')}`
    const line = `${key}: ${status}. ${capability.note}`
    const log = `MiniMax capability: skill=${skill}; session=${agent.id}; ${line}`
    if (capability.tools.length === 0 || missing.length > 0) ctx.logger.warn(log)
    else ctx.logger.info(log)
    return `- ${line}`
  })
  return [
    'DreamVerse capability preflight (includes conditional stages; registered tools do not guarantee a configured model or healthy backend):',
    ...lines,
    'Before any paid generation, disclose missing mandatory capabilities and agree on the deliverable. Stop at unsupported stages or explicitly agree to pre-production only; never claim full completion. Recheck actual tools and model capabilities before dispatch.',
  ].join('\n')
}

/** Tool observations identify operations, not successful completion of asynchronous generation jobs. */
export const MINIMAX_STEPS: Readonly<Record<string, string>> = {
  dv_textnode_write: 'planning-artifact',
  ask_user_question: 'user-approval',
  dv_image_generate: 'image-generation-request',
  dv_shot_render: 'video-generation-request',
  dv_audio_generate: 'audio-generation-request',
  dv_proj_wait: 'generation-job-wait',
  dv_timeline_create: 'assembly-plan',
  dv_timeline_update: 'assembly-edit',
  dv_timeline_export: 'assembly-export',
  dv_minimax_read_reference: 'reference-read',
}
