/** Deterministic routing for the optional, pinned MiniMax H3 skills. */
import { MINIMAX_SKILLS, type MiniMaxSkill } from '@dv/project/minimax'
export { MINIMAX_SKILLS, isMiniMaxSkill, type MiniMaxSkill } from '@dv/project/minimax'

const RULES: ReadonlyArray<readonly [MiniMaxSkill, RegExp]> = [
  ['h3-prompt-writing', /(?:h3|minimax|海螺).*(?:prompt|提示词)|(?:prompt|提示词).*(?:h3|minimax|海螺)/iu],
  ['music-video-subtitle-generator', /music\s*video|\bMV\b|音乐视频|音乐短片|歌词.*(?:视频|短片)/iu],
  ['co-op-game-intro-generator', /co[ -]?op.*(?:game|intro)|合作游戏|双人游戏|联机游戏/iu],
  ['papercraft-stop-motion-explainer', /papercraft|paper.*stop[ -]?motion|纸艺|纸雕|折纸.*定格|定格.*纸/iu],
  ['paper-collage-explainer-generator', /paper[ -]?collage|纸张拼贴|纸质拼贴|剪纸拼贴|拼贴.*解说/iu],
  ['handdrawn-live-video-generator', /hand[ -]?drawn|手绘|蜡笔|粉笔/iu],
  ['3d-animation-short-generator', /(?:3d|三维|皮克斯|pixar).*(?:animat|short|story|动画|短片|故事)|(?:animat|动画).*(?:3d|三维)/iu],
  ['minimalist-product-ad-generator', /(?:minimalist|apple[ -]?style|极简|苹果风|苹果味).*(?:product|ad\b|commercial|产品|广告|电商)|(?:product|产品).*(?:minimalist|apple[ -]?style|极简|苹果风)|product\s+(?:ad\b|advertisement|commercial)|产品广告|电商(?:产品)?视频/iu],
  ['brand-promo-video-generator', /brand.*(?:promo|reel|launch)|promotional\s*(?:video|film)|品牌.*(?:宣传|推广|短片|广告)|宣传片|推广视频/iu],
]

/**
 * Select by official descriptions/categories; generic requests remain unmatched.
 * @param text - current user request.
 * @returns one matching name or null for the original Harness workflow.
 */
export function selectMiniMaxSkill(text: string): MiniMaxSkill | null {
  const exact = MINIMAX_SKILLS.find(name => new RegExp(`(?<![a-z0-9-])${name}(?![a-z0-9-])`, 'iu').test(text))
  if (exact !== undefined) return exact
  if (/KOC|talking[ -]head|口播广告|录屏|screen\s*demo/iu.test(text)) return null
  if (!/(?:制作|生成|创作|做|写|帮|想要|需要|来[一个条部]|create|make|generate|write|want|need|produce)/iu.test(text)) return null
  const videoIntent = /视频|短片|动画|广告|宣传片|解说|提示词|video|film|animation|short|ad\b|advertisement|commercial|explainer|intro|prompt|\bMV\b/iu
  if (!videoIntent.test(text)) return null
  return RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? null
}

/**
 * @param text - follow-up user message.
 * @returns whether an answer/revision should continue the selected workflow.
 */
export function continuesMiniMaxTask(text: string): boolean {
  if (/^\s*(?:取消|停止|换个任务|新任务|换个话题|另外|cancel\b|stop\b|new task\b|instead\b)/iu.test(text)) return false
  const confirmation = new RegExp('^(?:\\s*(?:好[的啊]?|可以|确认|继续|下一步|同意|开始[吧]?|请|按这个|就这样|没问题|是的|[1-9一二三四五六七八九]'
    + '|生成(?:\\s*(?:H3\\s*)?(?:视频|图片|分镜|素材))?[吧]?'
    + '|yes|ok(?:ay)?|confirm(?:ed)?|continue|proceed|go ahead|generate it|looks good)[\\s!！,.，。]*)+$', 'iu')
  const newRequest = new RegExp('^\\s*(?:请\\s*|please\\s+)?(?:帮我|制作|生成|创作|做|写|解释|查询|搜索|剪辑|剪掉|我想|我要'
    + '|create\\b|make\\b|generate\\b|write\\b|edit\\b|trim\\b|tell\\b|what\\b|how\\b|I want\\b)', 'iu')
  return confirmation.test(text)
    || /^(?:改成|改为|修改|换成|换个|用这个|这是|这里是|我选|选第|时长|比例|尺寸|分辨率|change|revise|use this|here is|here are|I choose|option\s*\d)/iu.test(text.trim())
    || /^\s*\d+\s*(?::|秒|seconds?|s\b)/iu.test(text)
    || /dv:(?:asset|record|node)\//u.test(text)
    // Free-form brief answers retain the workflow; explicit new requests are routed independently.
    || !newRequest.test(text)
}
