/**
 * DreamVerse timeline fixture for the dv-timeline-sounds scenario: mounts the DSH Workspace registry, `@dv/project`,
 * `@dv/asset-pool`, and `@dv/timeline` from source beside the headless profile. Project record, Workspace, and Session
 * IDs, times, and measured durations come from per-process counters, and a stand-in `dvFfmpeg` reports one fixed audio
 * duration, so the tool results and the `.dreamverse/` files that the scenario compares repeat exactly in every run.
 */
import crypto from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import WorkspaceRegistry from '../../../packages/workspace/workspace/src/index.ts'
import DvAssetPool from '../../../packages/dv/asset-pool/src/index.ts'
import DvFfmpeg from '../../../packages/dv/ffmpeg/src/index.ts'
import DvProject from '../../../packages/dv/project/src/index.ts'
import DvTimeline from '../../../packages/dv/timeline/src/index.ts'

// The packages whose direct calls get fixture values: DreamVerse records, Workspace rows, and the headless Session ID
// that records name. Every other caller keeps the real generator and clock, so DSH message IDs never share these values.
const FIXTURE_CALLER = /[\\/]packages[\\/](?:dv|workspace|bundle[\\/]headless)[\\/]/

/** Whether the function that called the patched function lives in a fixture package. */
function fixtureCaller() {
  // Line 0 is the message, line 1 this function, line 2 the patched function, and line 3 its caller.
  return FIXTURE_CALLER.test(new Error().stack?.split('\n')[3] ?? '')
}

// A counter makes the UUID sequence of those callers the same in each run.
const realRandomUUID = crypto.randomUUID
let minted = 0
crypto.randomUUID = (...args) => fixtureCaller()
  ? `00000000-0000-4000-8000-${(++minted).toString(16).padStart(12, '0')}`
  : realRandomUUID.apply(crypto, args)
syncBuiltinESMExports()

// `new Date()` of those callers advances one second per call from a fixed start.
const RealDate = Date
const FIXTURE_EPOCH_MS = RealDate.UTC(2026, 0, 1)
let stamped = 0
globalThis.Date = class FixtureDate extends RealDate {
  constructor(...args) {
    if (args.length > 0) super(...args)
    else super(fixtureCaller() ? FIXTURE_EPOCH_MS + 1000 * ++stamped : RealDate.now())
  }
}

// `performance.now()` of those callers stays at 0, so a record's measured `cost.wall_seconds` is 0.
const realPerformanceNow = performance.now.bind(performance)
performance.now = () => fixtureCaller() ? 0 : realPerformanceNow()

/** The ffmpeg runner without binaries: every probe reports a one-second audio file, and no command runs. */
class FixtureFfmpeg extends DvFfmpeg {
  async probe() {
    return { durationSec: 1, videoDurationSec: null, width: null, height: null, hasAudio: true, codec: null }
  }

  async run() {
    throw new Error('dv-timeline-sounds fixture runs no ffmpeg command')
  }
}

/**
 * Mount the DreamVerse services that the sound tools need, and settle each one before the next, so the first model
 * request already lists the `dv_*` tools. New project folders go under the ignored `.dsh` entry.
 */
export async function apply(ctx) {
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(FixtureFfmpeg, { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' })
  await ctx.plugin(DvProject, { projectsFolder: join(process.cwd(), '.dsh', 'dreamverse') })
  await ctx.plugin(DvAssetPool, {})
  await ctx.plugin(DvTimeline, {})
}
