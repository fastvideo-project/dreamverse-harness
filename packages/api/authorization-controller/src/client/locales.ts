/** Copy dictionaries for the Codex sign-in settings page. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'OpenAI Codex',
  intro: 'Sign in with ChatGPT to use Codex models. A device code works from any browser. Browser login works only on this computer.',
  signInRegion: 'Sign in to {label}',
  signInSignedIn: 'Signed in',
  signInSignedOut: 'Not signed in',
  signIn: 'Sign in',
  signOut: 'Sign out',
  signInCancel: 'Cancel sign-in',
  signInSubmit: 'Submit',
  signInDecline: 'Skip',
  signInStarting: 'Starting sign-in…',
  signInRecommended: 'Recommended',
  signInElsewhere: 'A sign-in is already running in another window.',
  signInFailed: 'Sign-in failed',
  signInRetry: 'Try again',
}

/** Chinese strings, one entry per English key. */
export const zh = {
  nav: 'OpenAI Codex',
  intro: '使用 ChatGPT 登录以使用 Codex 模型。设备码可在任意浏览器完成。浏览器登录只在这台电脑上可用。',
  signInRegion: '登录 {label}',
  signInSignedIn: '已登录',
  signInSignedOut: '未登录',
  signIn: '登录',
  signOut: '退出登录',
  signInCancel: '取消登录',
  signInSubmit: '提交',
  signInDecline: '跳过',
  signInStarting: '正在开始登录…',
  signInRecommended: '推荐',
  signInElsewhere: '另一个窗口中已有登录正在进行。',
  signInFailed: '登录失败',
  signInRetry: '重试',
}

/** One English key. */
export type CodexKey = keyof typeof en
