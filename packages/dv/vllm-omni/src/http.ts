/**
 * The HTTP calls that every `@dv/vllm-omni` entry makes to its vLLM-Omni server, and the served-model check on
 * `GET /v1/models`. vLLM-Omni answers an error with the OpenAI body `{"error": {"message": ...}}`.
 *
 * @module @dv/vllm-omni/http
 */

/**
 * The text of an error answer: `error.message` of a JSON body, else the body as sent.
 * @param text - the body of the answer.
 * @returns the text to quote in the error.
 */
function serverMessage(text: string): string {
  try {
    const message: unknown = (JSON.parse(text) as { error?: { message?: unknown } } | null)?.error?.message
    if (typeof message === 'string') return message
  } catch {
    // SyntaxError: the body is not JSON, so the error quotes it as sent.
  }
  return text
}

/**
 * Send one request to a vLLM-Omni server.
 * @param baseUrl - the HTTP base URL of the server.
 * @param route - the route, such as `/v1/models`.
 * @param init - the method, headers, body and abort signal.
 * @returns the answer, with a 2xx status.
 * @throws the signal's reason on abort; else Error naming the server, the method, the route and the HTTP status with
 *   the server's text, or the server that cannot be reached.
 */
export async function send(baseUrl: string, route: string, init: RequestInit = {}): Promise<Response> {
  const answer = await fetch(new URL(route, baseUrl), init).catch((error: unknown) => {
    // fetch rejects with the abort reason on abort, and with a TypeError when the server cannot be reached.
    throw init.signal?.aborted === true ? init.signal.reason : new Error(`The server at ${baseUrl} cannot be reached.`, { cause: error })
  })
  if (answer.ok) return answer
  const text = serverMessage(await answer.text())
  throw new Error(`The server at ${baseUrl} answered ${init.method ?? 'GET'} ${route} with HTTP ${String(answer.status)}: ${text}`)
}

/**
 * Send one JSON `POST` to a vLLM-Omni server.
 * @param baseUrl - the HTTP base URL of the server.
 * @param route - the route, such as `/v1/images/generations`.
 * @param body - the JSON body.
 * @param signal - cancels the request.
 * @returns the answer, with a 2xx status.
 * @throws as {@link send} throws.
 */
export function post(baseUrl: string, route: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  return send(baseUrl, route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...signal === undefined ? {} : { signal },
  })
}

/**
 * Check that a server serves a model. The check is needed because one server serves one model, and the config can
 * point a model at the server of another model.
 * @param baseUrl - the HTTP base URL of the server.
 * @param modelId - the ID that the server lists in `GET /v1/models`.
 * @throws Error naming the IDs that the server lists when `modelId` is not one of them, or as {@link send} throws.
 */
export async function checkServed(baseUrl: string, modelId: string): Promise<void> {
  const { data } = await (await send(baseUrl, '/v1/models')).json() as { data: Array<{ id: string }> }
  const ids = data.map(model => model.id)
  if (ids.includes(modelId)) return
  throw new Error(`The server at ${baseUrl} serves ${ids.join(', ')}, not ${modelId}; the dv-vllm-omni config points this model at `
    + 'the wrong server.')
}
