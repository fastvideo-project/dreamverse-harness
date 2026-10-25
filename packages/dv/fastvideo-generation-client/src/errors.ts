/**
 * The error that the FastVideo generation backend reports for one video job.
 *
 * @module @dv/fastvideo-generation-client/errors
 */

/** A job failure that the generation backend reported, with HTTP 400 at submission or with job status `failed`. */
export class GenerationSegmentError extends Error {
  override name = 'GenerationSegmentError'

  /**
   * @param message - the backend's failure message.
   * @param errorType - `invalid_request` for a refused submission, `generation_failed` for a failed job.
   */
  constructor(message: string, readonly errorType: 'invalid_request' | 'generation_failed') {
    super(message)
  }
}
