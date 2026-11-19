/** Client-safe identities and previews owned by the MiniMax skill-set plugin. */
export const MINIMAX_SKILLS = [
  'h3-prompt-writing', 'handdrawn-live-video-generator', 'minimalist-product-ad-generator',
  'brand-promo-video-generator', '3d-animation-short-generator', 'music-video-subtitle-generator',
  'papercraft-stop-motion-explainer', 'paper-collage-explainer-generator', 'co-op-game-intro-generator',
] as const

/** An exact official MiniMax skill name. */
export type MiniMaxSkill = typeof MINIMAX_SKILLS[number]

/**
 * @param name - name received from configuration or the browser.
 * @returns whether this installation contains the named skill.
 */
export function isMiniMaxSkill(name: string): name is MiniMaxSkill {
  return (MINIMAX_SKILLS as readonly string[]).includes(name)
}

/** Bundled GIF filename for each skill. */
export const PREVIEWS: Record<MiniMaxSkill, string> = {
  '3d-animation-short-generator': 'representative_3d_animation_compact.gif',
  'minimalist-product-ad-generator': 'minimalist_product_ad_with_text.gif',
  'brand-promo-video-generator': 'brand_promo_velocity_showcase.gif',
  'handdrawn-live-video-generator': 'hand_drawn_live_action_showcase.gif',
  'music-video-subtitle-generator': 'music_video_lyrics_showcase.gif',
  'papercraft-stop-motion-explainer': 'papercraft_stop_motion_showcase.gif',
  'paper-collage-explainer-generator': 'paper_collage_explainer_showcase.gif',
  'co-op-game-intro-generator': 'co_op_game_intro_showcase.gif',
  'h3-prompt-writing': 'h3_prompt_writing_showcase.gif',
}
