/** Check that the host Python interpreter can import the Reactor SDK, without a key or a session. */
import { execFile } from 'node:child_process'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { AccountNeedsSetupError } from '@dv/models'

/** The pinned SDK install command that the setup message names. */
export const INSTALL_COMMAND = "python3 -m pip install 'reactor-sdk==1.15.0'"

const PROBE = 'import reactor_sdk'

/**
 * Run the configured interpreter with `-c "import reactor_sdk"`. The child gets the scrubbed parent environment and no
 * key.
 * @param pythonPath - the configured interpreter.
 * @param signal - aborts the probe and kills the child.
 * @param timeoutSeconds - the deadline for the probe.
 * @throws AccountNeedsSetupError naming the interpreter and {@link INSTALL_COMMAND} when the interpreter cannot start,
 * exits nonzero or times out.
 * @throws the signal's reason when `signal` aborts.
 */
export async function checkSdk(pythonPath: string, signal: AbortSignal, timeoutSeconds: number): Promise<void> {
  signal.throwIfAborted()
  const failure = await new Promise<Error | null>((resolve) => {
    execFile(pythonPath, ['-B', '-c', PROBE], {
      env: scrubbedParentEnv(), timeout: timeoutSeconds * 1000, killSignal: 'SIGKILL', maxBuffer: 4096, signal,
    }, (error) => { resolve(error) })
  })
  signal.throwIfAborted()
  if (failure !== null) {
    throw new AccountNeedsSetupError(`The Python interpreter ${pythonPath} cannot import reactor_sdk. Install it on the DreamVerse host with ${INSTALL_COMMAND}, or set pythonPath to an interpreter that has it.`)
  }
}
