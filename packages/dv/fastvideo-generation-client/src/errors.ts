/**
 * The error that the FastVideo generation backend reports for one segment request.
 *
 * @module @dv/fastvideo-generation-client/errors
 */

/** A segment failure that the generation backend reported, with HTTP 400 before its event stream or with an `error` event in it. */
export class GenerationSegmentError extends Error {
  override name = 'GenerationSegmentError'

  /**
   * @param message - the backend's failure message.
   * @param errorType - the backend's error code: `invalid_request` or `generation_failed`.
   */
  constructor(message: string, readonly errorType: string) {
    super(message)
  }
}
