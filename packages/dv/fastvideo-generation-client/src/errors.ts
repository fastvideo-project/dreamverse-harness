/**
 * The error that the FastVideo generation backend reports for one segment request.
 *
 * @module @dv/fastvideo-generation-client/errors
 */

/** A segment request that FastVideo refuses: HTTP 400 from `POST /v1/videos/sync`, or a reference of another media type. */
export class GenerationSegmentError extends Error {
  override name = 'GenerationSegmentError'
}
