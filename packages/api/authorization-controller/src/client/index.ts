/**
 * Browser half of the Codex sign-in plugin. It mounts the `authorization`
 * Remote this package generates, then adds one settings page. The Host
 * controller and the credential store stay on the other side of that Remote.
 */
import type { Context } from '@deepseek-ai/cordis'
import authorizationRemote from '@deepseek-ai/dsh-api-authorization-controller/remote'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { CodexSignInSection } from './CodexSignIn.tsx'
import type { CodexSignInInjected } from './CodexSignIn.tsx'
import { en, zh, type CodexKey } from './locales.ts'
import { SignInStore } from './sign-in.ts'

export type { CodexKey } from './locales.ts'
export type { CodexSignInInjected } from './CodexSignIn.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Codex sign-in page copy. */
    'settings.codex': CodexKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.codex'

/** Services the page needs after the Remote namespace is mounted. */
export const inject = ['remote', 'slots', 'locale']

/**
 * Register the settings page once `settings.section` exists.
 * @param ctx - client context, after `remote.authorization` is mounted.
 */
function registerPage(ctx: Context): void {
  const disposeCopy = ctx.locale.register(NS, { en, zh })
  ctx.effect(() => disposeCopy, 'authorization-controller: copy dictionaries')
  const store = new SignInStore(ctx.remote.authorization)
  const t = ctx.locale.bind(NS)
  const injected = (): CodexSignInInjected => ({
    store,
    hooks: { signIn: store.store },
    t,
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'codex',
    order: 12,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, CodexSignInSection))
  ctx.effect(() => () => { store.dispose() }, 'authorization-controller: sign-in store')
}

/**
 * Mount this package's Remote, then the settings page.
 * @param ctx - client runtime owning the gateway Remote, dictionaries, and slots.
 * @returns disposer that withdraws the page and the Remote namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(authorizationRemote)
  const page = ctx.inject(['remote.authorization', 'slots', 'locale'], registerPage)
  try {
    await page
  } catch (error) {
    await page.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await page.dispose()
    await disposeRemote()
  }
}
