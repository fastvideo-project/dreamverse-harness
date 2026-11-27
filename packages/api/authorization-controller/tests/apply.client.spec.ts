/** Client plugin: mounts the authorization Remote and registers the Codex settings page. */
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { CodexSignInSection } from '../src/client/CodexSignIn.tsx'
import { SignInStore } from '../src/client/sign-in.ts'

/** Scripted Remote methods. The page registration does not call them. */
function client() {
  return {
    list: vi.fn(),
    begin: vi.fn(),
    answer: vi.fn(),
    decline: vi.fn(),
    cancel: vi.fn(),
    signOut: vi.fn(),
  }
}

/**
 * A gateway stand-in: `$mount` publishes `remote.authorization` the way the real gateway does.
 */
class FakeRemote extends Service {
  /** Set when the mount disposer runs. */
  disposed = false

  constructor(ctx: Context, private readonly methods: ReturnType<typeof client>) {
    super(ctx, 'remote')
  }

  /**
   * Publish the namespace, then return its disposer.
   * @returns disposer that drops the namespace.
   */
  async $mount(): Promise<() => Promise<void>> {
    const methods = this.methods
    const fiber = this.ctx.plugin(class extends Service {
      constructor(inner: Context) {
        super(inner, 'remote.authorization')
        Object.assign(this, methods)
      }
    })
    await fiber
    return async () => {
      this.disposed = true
      await fiber.dispose()
    }
  }
}

/** A locale whose dictionary registration fails, so apply must unmount the Remote. */
class BoomLocale extends Service {
  constructor(ctx: Context) {
    super(ctx, 'locale')
  }

  /** @returns never. */
  register(): void {
    throw new Error('locale failed')
  }
}

/**
 * The inject function returns an untyped slot payload. Confirm it is the page store.
 * @param value - whatever the slot entry's inject function returned.
 * @returns the store and its copy function.
 */
function pageInject(value: unknown): { store: SignInStore; t: (key: 'nav') => string } {
  if (typeof value !== 'object' || value === null || !('store' in value) || !('t' in value)) {
    throw new Error('the Codex page inject did not return the store')
  }
  const { store, t } = value
  if (!(store instanceof SignInStore) || !isNavTranslator(t)) {
    throw new Error('the Codex page inject did not return the store')
  }
  return {
    store,
    t: (key) => {
      const text: unknown = t(key)
      if (typeof text !== 'string') throw new Error('the Codex page copy was not text')
      return text
    },
  }
}

/**
 * @param value - a candidate copy function.
 * @returns whether it can be called with the nav key.
 */
function isNavTranslator(value: unknown): value is (key: 'nav') => unknown {
  return typeof value === 'function'
}

/** Declare the settings section slot the page waits for. */
function declare(slots: SlotRegistry): void {
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('authorization client apply', () => {
  it('declares the services it waits for', () => {
    expect(inject).toEqual(['remote', 'slots', 'locale'])
  })

  it('registers the Codex page and withdraws it with the Remote', async () => {
    const ctx = new Context()
    const remote = new FakeRemote(ctx, client())
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('en')
    ctx.provide('locale', locale)
    const slots = ctx.get('slots') as SlotRegistry
    declare(slots)
    try {
      const plugin = ctx.plugin({ inject: [...inject], apply })
      await plugin.await()
      const entry = slots.entries('settings.section').find(item => item.options.id === 'codex')
      expect(entry?.component).toBe(CodexSignInSection)
      expect(entry?.options).toMatchObject({ id: 'codex', order: 12 })
      expect(resolveSlotLabel(entry?.options.label)).toBe('OpenAI Codex')
      if (typeof entry?.inject !== 'function') throw new Error('the Codex page did not register an inject function')
      const injected = pageInject(entry.inject())
      expect(injected.store).toBeInstanceOf(SignInStore)
      expect(injected.t('nav')).toBe('OpenAI Codex')
      await plugin.dispose()
      expect(slots.entries('settings.section').some(item => item.options.id === 'codex')).toBe(false)
      expect(remote.disposed).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('unmounts the Remote when the page fails to register', async () => {
    const ctx = new Context()
    const remote = new FakeRemote(ctx, client())
    await ctx.plugin(SlotRegistry).await()
    await ctx.plugin(BoomLocale).await()
    try {
      const plugin = ctx.plugin({ inject: [...inject], apply })
      await expect(plugin).rejects.toThrow('locale failed')
      expect(remote.disposed).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
