/**
 * The model facts that a FastVideo deployment's operator configures, and the `ConfiguredFacts` derived from them. The
 * operator writes the served alias and the reference limits; the server publishes the output choices on
 * `GET /v1/model_info`.
 *
 * @module @dv/fastvideo-generation-client/model-facts
 */
import z from '@deepseek-ai/schemastery'
import { closedObject } from './closed-object.ts'
import { REFERENCE_FIELDS, type ReferenceMediaType } from './references.ts'
import type { ConfiguredFacts } from './types.ts'

/** The configured facts of the served model. */
export interface ModelFactsConfig {
  /** Exact model alias that `GET /v1/model_info` reports as `served_model_name`. */
  modelId: string
  /** The most references that one request carries across media types, a first frame included. */
  maxReferences: number
  /** The most references of each accepted media type in one request; a media type left out is not accepted. */
  referenceMediaTypes: Partial<Record<ReferenceMediaType, {
    /** The most references of the media type in one request. */
    maxCount: number
  }>>
}

const mediaType = z.union(Object.keys(REFERENCE_FIELDS) as ReferenceMediaType[])

/** Loader validation of the configured facts; `deriveConfiguredFacts` checks the relations between the fields. */
export const modelFactsConfig: z<ModelFactsConfig> = closedObject('modelFacts', {
  modelId: z.string().required(),
  maxReferences: z.natural().required(),
  referenceMediaTypes: z.dict(z.object({ maxCount: z.natural().required() }), mediaType).required(),
}) as z<ModelFactsConfig>

/**
 * The configured facts of a configuration.
 * @param config - the configured facts.
 * @returns the facts.
 * @throws Error naming a media type limit above `maxReferences`.
 */
export function deriveConfiguredFacts(config: ModelFactsConfig): ConfiguredFacts {
  for (const [type, limit] of Object.entries(config.referenceMediaTypes)) {
    if (limit.maxCount > config.maxReferences) {
      throw new Error(`FastVideo modelFacts of ${config.modelId}: referenceMediaTypes.${type}.maxCount ${limit.maxCount} exceeds maxReferences ${config.maxReferences}.`)
    }
  }
  return { modelId: config.modelId, maxReferences: config.maxReferences, referenceMediaTypes: { ...config.referenceMediaTypes } }
}
