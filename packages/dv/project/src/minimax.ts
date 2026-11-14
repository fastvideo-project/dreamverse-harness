/** Official MiniMax skill identities shared by project creation, the UI and workflow routing. */
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
