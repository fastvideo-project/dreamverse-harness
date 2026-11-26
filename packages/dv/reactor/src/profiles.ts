/** DreamVerse task mappings for the documented Reactor model command schemas. */
import type { RenderModelFacts, TaskOfPrimitive } from '@dv/models'

/**
 * Reactor Clip Generation HTTP request: `first` and `last` name the model's input fields for the opening and closing
 * frame file IDs, and `resolution` sends the `resolution` input.
 */
export interface GenerationFields {
  first?: string
  last?: string
  resolution?: true
}

/** Clip Generation request over HTTP, queued world clip over an SDK session, finite scripted take, or chunked video stream. */
export type Workflow =
  | ({ kind: 'generation' } & GenerationFields)
  | { kind: 'queue' }
  | { kind: 'take' }
  | {
    kind: 'chunks'
    prompt: 'set_prompt' | 'set_shot'
    frameCount: 'session-state' | 'cumulative' | 'per-chunk'
    image?: 'set_conditioning' | 'set_image'
    fps?: number
    resolution?: true
  }

type VideoTask = TaskOfPrimitive<'video'>
type Geometry = Pick<RenderModelFacts, 'aspectRatios' | 'resolutions' | 'frameSizes'>

interface References {
  images: number
  audio?: number
  video?: number
  imageRequired?: true
  keyframes?: true
  aggregateSeconds?: true
}

interface Profile {
  modelId: string
  name: string
  tasks: readonly VideoTask[]
  geometry: Geometry
  durations: readonly number[]
  workflow: Workflow
  references?: References
  seed?: false
  maxUploadMiB?: number
  labels?: 'plain' | 'frame-pictures'
}

const FROM_FRAMES = ['t2v', 'i2v', 'l2v', 'fl2v'] as const
const WITH_REFERENCES = ['t2v', 'ref2v'] as const
const H3_GEOMETRY: Geometry = {
  aspectRatios: ['16:9', '1:1', '9:16', '4:3'],
  resolutions: ['768p'],
  frameSizes: {
    '16:9': { '768p': [1344, 768] }, '1:1': { '768p': [768, 768] },
    '9:16': { '768p': [768, 1344] }, '4:3': { '768p': [1024, 768] },
  },
}
const h3References = { images: 9, audio: 3 }
const h3Frames = { first: 'first_frame_image', last: 'last_frame_image' }
const twoAspect720: Geometry = {
  aspectRatios: ['16:9', '9:16'], resolutions: ['720p'],
  frameSizes: { '16:9': { '720p': [1280, 720] }, '9:16': { '720p': [720, 1280] } },
}

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
}

function fixed(aspect: string, resolution: string, size: [number, number]): Geometry {
  return { aspectRatios: [aspect], resolutions: [resolution], frameSizes: { [aspect]: { [resolution]: size } } }
}

/** Profiles are reusable by hosted models with the same command and media schema. */
export const profiles = {
  'fast-h3-omni': {
    modelId: 'reactor/fast-h3-omni', name: 'FastH3-Omni', tasks: WITH_REFERENCES, geometry: H3_GEOMETRY,
    durations: [5.875, 8, 10.125, 12.25, 14.375], workflow: { kind: 'generation', ...h3Frames },
    references: { ...h3References, imageRequired: true, keyframes: true },
  },
  'fast-h3': {
    // The schema publishes live duration bounds. Reactor's FastH3 example uses 8s.
    modelId: 'reactor/fast-h3', name: 'FastH3', tasks: FROM_FRAMES,
    geometry: { aspectRatios: H3_GEOMETRY.aspectRatios, resolutions: H3_GEOMETRY.resolutions },
    durations: [8], workflow: { kind: 'generation', first: 'starting_frame', last: 'ending_frame' },
  },
  'h3-reference-to-video-turbo-realtime': {
    modelId: 'reactor/h3-reference-to-video-turbo-realtime', name: 'H3 Reference Turbo Realtime', tasks: WITH_REFERENCES,
    geometry: H3_GEOMETRY, durations: range(5, 15), workflow: { kind: 'generation' }, references: h3References, labels: 'plain',
  },
  'pika-h3-flex': {
    modelId: 'reactor/pika-h3-flex', name: 'Pika H3 Flex', tasks: [...FROM_FRAMES, 'ref2v'],
    geometry: {
      aspectRatios: ['16:9', '21:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '9:21'],
      resolutions: ['768p', '480p'],
    },
    durations: [5, 5.167, 5.875, 6, 6.583, 7, 7.292, 8, 8.708, 9, 9.417, 10, 10.125, 10.833, 11, 11.542, 12, 12.25,
      12.958, 13, 13.667, 14, 14.375, 15, 15.083],
    workflow: { kind: 'generation', ...h3Frames, resolution: true }, labels: 'frame-pictures',
    references: { ...h3References, video: 3, aggregateSeconds: true },
  },
  'pixverse-r2-director': {
    modelId: 'reactor/pixverse-r2-director', name: 'PixVerse R2 Director', tasks: WITH_REFERENCES,
    geometry: twoAspect720, durations: range(5, 10), workflow: { kind: 'queue' },
    references: { images: 6 }, seed: false, maxUploadMiB: 20,
  },
  ltx2: {
    modelId: 'reactor/ltx2', name: 'LTX', tasks: ['i2v'],
    geometry: fixed('20:11', '352p', [640, 352]), durations: range(4, 300), workflow: { kind: 'take' },
  },
  helios: {
    modelId: 'reactor/helios', name: 'Helios', tasks: ['t2v', 'i2v'],
    geometry: fixed('5:3', '768p', [1280, 768]), durations: range(1, 15),
    workflow: { kind: 'chunks', prompt: 'set_prompt', image: 'set_conditioning', frameCount: 'session-state', fps: 24 },
  },
  'longlive-v2': {
    modelId: 'reactor/longlive-v2', name: 'LongLive 2.0', tasks: ['t2v'],
    geometry: fixed('20:11', '704p', [1280, 704]), durations: range(1, 57),
    workflow: { kind: 'chunks', prompt: 'set_shot', frameCount: 'cumulative', fps: 24 },
  },
  'visko-orbis-stable': {
    modelId: 'reactor/visko-orbis-stable', name: 'Visko Orbis Stable', tasks: ['t2v', 'i2v'],
    geometry: { aspectRatios: ['16:9'], resolutions: ['1080p', '2k', '4k'] }, durations: range(1, 15),
    workflow: { kind: 'chunks', prompt: 'set_prompt', image: 'set_image', frameCount: 'per-chunk', resolution: true },
  },
  'visko-orbis-dynamic': {
    modelId: 'reactor/visko-orbis-dynamic', name: 'Visko Orbis Dynamic', tasks: ['t2v', 'i2v'],
    geometry: { aspectRatios: ['16:9'], resolutions: ['1080p', '2k', '4k'] }, durations: range(1, 15),
    workflow: { kind: 'chunks', prompt: 'set_prompt', image: 'set_image', frameCount: 'per-chunk', resolution: true },
  },
} satisfies Record<string, Profile>

/** The configuration accepts these schema profiles. */
export type ProfileName = keyof typeof profiles

/** Look up a supported Reactor schema.
 * @param name - the configured schema profile.
 * @returns its task, geometry and workflow settings.
 */
export function profileFor(name: ProfileName): Profile {
  return profiles[name]
}
