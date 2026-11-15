/**
 * The error that the FastVideo generation backend reports for one segment request.
 *
 * @module @dv/fastvideo-generation-client/errors
 */

/** A segment request that FastVideo refuses: HTTP 400 from `POST /v1/videos/sync`, or a reference of another media type. */
export class GenerationSegmentError extends Error {
  override name = 'GenerationSegmentError'
}

/**
 * The text of a backend failure: `error.message` of an `application/json` body, else the body; a Python traceback
 * becomes its final exception line, and text longer than 2,048 characters is truncated.
 * @param response - the failed response.
 * @returns the text.
 */
export async function backendErrorText(
  response: { headers: { get(name: string): string | null }; text(): Promise<string> },
): Promise<string> {
  const body = await response.text()
  let value: unknown = null
  if (response.headers.get('content-type')?.startsWith('application/json') === true) {
    try {
      value = JSON.parse(body)
    } catch { /* SyntaxError: an `application/json` body that is not JSON is reported as sent, beside its HTTP status. */ }
  }
  let message = typeof value === 'object' && value !== null && 'error' in value
    && typeof value.error === 'object' && value.error !== null && 'message' in value.error
    && typeof value.error.message === 'string' ? value.error.message : body
  if (message.includes('Traceback (most recent call last)')) {
    // The trimmed traceback ends with its exception line.
    message = (message.trim().split('\n').at(-1) as string).trim()
  }
  const limit = 2048
  return message.length <= limit ? message : `${message.slice(0, limit)}… [truncated; see FastVideo server logs]`
}
