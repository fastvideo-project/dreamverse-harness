/**
 * A scripted OpenAI-compatible chat-completions server for browser stories that need the agent to act. The profile's
 * agent route speaks `openai-completions` (`POST /v1/chat/completions`, streamed), so `bootHarness({ modelBaseUrl })`
 * points `DV_DEEPSEEK_BASE_URL` here. Each request is answered from the rules: the first rule whose `match` fits the
 * newest user message supplies the reply, and the number of assistant messages after that user message picks the
 * step, so one user message can drive several tool calls in a row; a step function may be async, so a story can change
 * the project between two steps of one turn before the model answers. Requests without tools (session titles) get a
 * short text.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { expect } from 'vitest'

/** One chat-completions message as the agent sends it. */
export interface ChatMessage {
  role: string
  content?: unknown
  tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

/** One recorded request body. */
export interface ChatRequest {
  messages: ChatMessage[]
  tools?: Array<{ function?: { name?: string; parameters?: { properties?: Record<string, { enum?: unknown[] }> } } }>
  [key: string]: unknown
}

/** What a step function sees: the newest user message and the tool results that followed it. */
export interface TurnView {
  userText: string
  /** Tool results after the newest user message, parsed as JSON when they are JSON, else the raw text. */
  toolResults: unknown[]
  request: ChatRequest
}

/** One model reply: plain text, or tool calls (with optional text before them). */
export type ScriptedStep =
  | { text: string; delayMs?: number }
  | { calls: Array<{ name: string; args: Record<string, unknown> }>; text?: string; delayMs?: number }

/** Replies to one kind of user message. */
export interface ScriptedRule {
  /** A substring or pattern of the newest user message. */
  match: string | RegExp
  /** The replies in order; past the end the model answers `endText`. */
  steps: Array<ScriptedStep | ((view: TurnView) => ScriptedStep | Promise<ScriptedStep>)>
  /** The text after the last step; default `完成。`. */
  endText?: string
}

/** A running scripted model. */
export interface ScriptedModel {
  /** The base URL including `/v1`, ready for `DV_DEEPSEEK_BASE_URL`. */
  baseURL: string
  /** Every request with tools (agent turns), in arrival order. */
  requests: ChatRequest[]
  /** The rules; tests may push more while the harness runs. */
  rules: ScriptedRule[]
  close(): Promise<void>
}

/** The plain text of a message's content. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : '')).join('')
  }
  return ''
}

/**
 * The asset ID of one output role in an operation tool result: the `outputs` entry of a JSON result, else the
 * `- <role>: <id>` line of the text rendering.
 * @param result - one entry of `TurnView.toolResults`.
 * @param role - the output role, such as `asset` or `video`.
 * @returns the ID, or the empty string.
 */
export function assetIdOf(result: unknown, role: string): string {
  if (typeof result === 'object' && result !== null && 'outputs' in result && Array.isArray(result.outputs)) {
    const output = (result.outputs as Array<{ role?: string; asset_id?: string }>).find(entry => entry.role === role)
    return output?.asset_id ?? ''
  }
  return new RegExp(`- ${role}: ([0-9a-f]{16,})`).exec(String(result))?.[1] ?? ''
}

/**
 * The records an operation tool result scheduled, from its `scheduled: <id>, <id>` line.
 * @param result - one entry of `TurnView.toolResults`.
 * @returns the record IDs; empty when the result scheduled none.
 */
export function scheduledOf(result: unknown): string[] {
  return /^scheduled: (.+)$/m.exec(String(result))?.[1]?.split(', ') ?? []
}

/**
 * Assert that each request extends the one before it: every request field other than the messages is equal, and the
 * earlier messages are unchanged at the start of the later request.
 * @param requests - the agent requests of one chat session, in arrival order.
 */
export function expectEachRequestExtendsThePrevious(requests: readonly ChatRequest[]): void {
  for (let index = 1; index < requests.length; index += 1) {
    const { messages: previous, ...previousFields } = requests[index - 1] as ChatRequest
    const { messages: next, ...nextFields } = requests[index] as ChatRequest
    expect(nextFields, `request ${String(index)} fields`).toEqual(previousFields)
    expect(next.length, `request ${String(index)} length`).toBeGreaterThan(previous.length)
    expect(next.slice(0, previous.length), `request ${String(index)} prefix`).toEqual(previous)
  }
}

/** Parse a tool message into JSON when possible. */
function parseResult(content: unknown): unknown {
  const text = textOf(content)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** The user messages that DSH and DreamVerse add as context: runtime context, system reminders, tool-result images, the
 *  @ reference expansion, and the project state and update messages. */
export const CONTEXT_MESSAGE
  = /^(<system-reminder>|Current runtime context|Attached image|The user referenced these project items|DreamVerse project)/

/**
 * Pick the reply for one agent request.
 * @param rules - the script.
 * @param request - the request body.
 * @returns the step to stream.
 */
async function replyFor(rules: ScriptedRule[], request: ChatRequest): Promise<ScriptedStep> {
  const messages = request.messages
  let last = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user' && !CONTEXT_MESSAGE.test(textOf(messages[index]?.content))) { last = index; break }
  }
  const userText = last < 0 ? '' : textOf(messages[last]?.content)
  const after = messages.slice(last + 1)
  const stepIndex = after.filter(message => message.role === 'assistant').length
  const toolResults = after.filter(message => message.role === 'tool').map(message => parseResult(message.content))
  const rule = rules.find(candidate => typeof candidate.match === 'string' ? userText.includes(candidate.match) : candidate.match.test(userText))
  if (rule === undefined) return { text: stepIndex === 0 ? '好的。' : '完成。' }
  const step = rule.steps[stepIndex]
  if (step === undefined) return { text: rule.endText ?? '完成。' }
  return typeof step === 'function' ? await step({ userText, toolResults, request }) : step
}

/** The SSE `data:` payloads of one step. */
function eventsOf(step: ScriptedStep, callBase: number): string[] {
  const chunk = (delta: object, finish: string | null = null): string => JSON.stringify({
    id: 'chatcmpl-scripted', object: 'chat.completion.chunk', model: 'deepseek-v4.1', choices: [{ index: 0, delta, finish_reason: finish }],
  })
  const events = [chunk({ role: 'assistant', content: '' })]
  const text = 'text' in step ? step.text : undefined
  if (text !== undefined && text !== '') events.push(chunk({ content: text }))
  if ('calls' in step) {
    step.calls.forEach((call, index) => {
      events.push(chunk({ tool_calls: [{ index, id: `call_${String(callBase + index)}`, type: 'function', function: { name: call.name, arguments: '' } }] }))
      events.push(chunk({ tool_calls: [{ index, function: { arguments: JSON.stringify(call.args) } }] }))
    })
  }
  events.push(JSON.stringify({
    id: 'chatcmpl-scripted', object: 'chat.completion.chunk', model: 'deepseek-v4.1',
    choices: [{ index: 0, delta: {}, finish_reason: 'calls' in step ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }))
  events.push('[DONE]')
  return events
}

/**
 * Start the scripted model.
 * @param rules - the initial rules.
 * @returns the running model.
 */
export async function startScriptedModel(rules: ScriptedRule[] = []): Promise<ScriptedModel> {
  const requests: ChatRequest[] = []
  let calls = 0
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      void (async () => {
        if (request.method !== 'POST' || !(request.url ?? '').endsWith('/chat/completions')) {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-v4.1', object: 'model' }] }))
          return
        }
        const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as ChatRequest
        const agentTurn = Array.isArray(body.tools) && body.tools.length > 0
        if (agentTurn) requests.push(body)
        const step = agentTurn ? await replyFor(rules, body) : { text: '测试对话' }
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'close' })
        const events = eventsOf(step, calls)
        if ('calls' in step) calls += step.calls.length
        const [first, ...rest] = events
        response.write(`data: ${first ?? ''}\n\n`)
        if (step.delayMs !== undefined) await new Promise(resolve => setTimeout(resolve, step.delayMs))
        for (const event of rest) {
          if (response.destroyed) return
          response.write(`data: ${event}\n\n`)
        }
        response.end()
      })()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return {
    baseURL: `http://127.0.0.1:${String(port)}/v1`,
    requests,
    rules,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => { resolve() }))
    },
  }
}
