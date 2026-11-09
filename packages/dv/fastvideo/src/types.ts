/**
 * Types of the `dv-fastvideo` plugin: what one served model accepts for one task, and how it names its references.
 *
 * @module @dv/fastvideo/types
 */
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { RenderRequest } from '@dv/models'
import type { AssignReferenceLabels } from './reference-labels.ts'

/**
 * The top-level type of an asset's MIME type, such as `image`, `video` or `audio`, as `dvAssetPool.mediaType` returns
 * it.
 */
export type MediaType = string

/** An input of a render request: `reference` (the reference assets in input order), `first_frame` or `last_frame`. */
export type InputRole = 'reference' | 'first_frame' | 'last_frame'

/** One input that a task of a model accepts. */
export interface InputDeclaration {
  /** The fewest assets that a render needs in this input. */
  min: number
  /** The media types the input accepts; at least one. */
  mediaTypes: readonly MediaType[]
}

/** The inputs one task of a model accepts, by role; a role left out takes no asset. */
export type TaskInputs = Partial<Record<InputRole, InputDeclaration>>

/**
 * One task this plugin can serve a model for: the entry's description, what the model accepts for it, and its prompt
 * skill.
 */
export interface ServedTask {
  description: string
  /** Native OpenAI task selector; absent for servers that infer their task. */
  openaiTask?: 't2va' | 'i2va' | 'l2va' | 'fl2va' | 'ref2va'
  inputs: TaskInputs
  /** The model's own parameters for this task, passed in the request's `extra`; empty when it has none. */
  extra: ParameterSchemaSpec
  /** How the model names the references in its prompt; a citation of a reference becomes its label. */
  assignReferenceLabels: AssignReferenceLabels
  /** The problems of a request's prompt under the model's own prompt rules, one sentence each; absent when it has none. */
  promptProblems?: (request: RenderRequest) => string[]
  /** Additional model input requirements after role, media-type and count validation. */
  inputProblems?: (request: RenderRequest, mediaTypeOf: (asset: RenderRequest['references'][number]) => string) => string[]
  skill: { name: string; description: string; file: string }
}
