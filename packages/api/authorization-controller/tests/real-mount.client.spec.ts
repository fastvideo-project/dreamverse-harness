/**
 * The browser plugin mounts through the real client gateway, not a stand-in.
 * A mount that never settles is what leaves the web app on "Loading plugins…".
 */
import { Context } from '@deepseek-ai/cordis'
import type {
  ClientConnectionRpc, ConnectionGenerationSource, ConnectionHandle, ConnectionLoop,
} from '@deepseek-ai/dsh-client-connection/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as gatewayApply, inject as gatewayInject } from '@deepseek-ai/dsh-api-gateway/client'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

/** In-process carrier. Mounting a namespace must not open a socket. */
function connection(): ConnectionHandle {
  let source: ConnectionGenerationSource | undefined
  const rpc: ClientConnectionRpc = {
    async call() {
      return { ok: true, value: undefined }
    },
    async *open() {
      throw new Error('real-mount test did not expect a stream')
    },
  }
  const start = (): ConnectionLoop => ({ stop() {} })
  return {
    isLoopback: true,
    generation: {
      getSnapshot: () => undefined,
      subscribe: () => () => {},
    },
    state: {
      getSnapshot: () => undefined,
      subscribe: () => () => {},
    },
    rpc,
    reconnect() {},
    registerGenerationSource(next) {
      source = next
      return () => {
        if (source === next) source = undefined
      }
    },
    start,
  }
}

describe('authorization client real mount', () => {
  it('finishes mounting the authorization Remote and the settings page', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    ctx.provide('connection', connection())
    await ctx.plugin({ inject: [...gatewayInject], apply: gatewayApply })
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('en')
    ctx.provide('locale', locale)
    const slots = ctx.get('slots')
    if (!(slots instanceof SlotRegistry)) throw new Error('slots did not start')
    slots.register({
      name: 'root',
      children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    try {
      const plugin = ctx.plugin({ inject: [...inject], apply })
      const outcome = await Promise.race([
        plugin.then(() => 'ready' as const),
        new Promise<'timeout'>((resolve) => { setTimeout(() => { resolve('timeout') }, 4000) }),
      ])
      expect(outcome).toBe('ready')
      expect(slots.entries('settings.section').some(item => item.options.id === 'codex')).toBe(true)
      await plugin.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  }, 10000)
})
