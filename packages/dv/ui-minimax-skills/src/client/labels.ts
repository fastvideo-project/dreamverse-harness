/** Card labels of the MiniMax template cards, in the order the cards appear. */
import type { MiniMaxSkill } from '@dv/minimax-skills/types'

/** Localized card name of each MiniMax skill, as a [Chinese, English] pair; key order is card order. */
export const LABELS: Record<MiniMaxSkill, readonly [string, string]> = {
  'h3-prompt-writing': ['H3 提示词编写', 'H3 prompt writing'],
  'handdrawn-live-video-generator': ['手绘实拍融合', 'Hand-drawn live action'],
  'minimalist-product-ad-generator': ['极简产品广告', 'Minimalist product ad'],
  'brand-promo-video-generator': ['品牌宣传片', 'Brand promo'],
  '3d-animation-short-generator': ['3D 动画短片', '3D animated short'],
  'music-video-subtitle-generator': ['音乐 MV 与歌词', 'Music video & lyrics'],
  'papercraft-stop-motion-explainer': ['纸艺定格解说', 'Papercraft stop motion'],
  'paper-collage-explainer-generator': ['纸张拼贴解说', 'Paper collage explainer'],
  'co-op-game-intro-generator': ['合作游戏开场', 'Co-op game intro'],
}

/** The MiniMax skills that have a template card, in card order. */
export const TEMPLATES = Object.keys(LABELS) as MiniMaxSkill[]
