#!/usr/bin/env bash
# Run DeepSeek Harness from source with a video-harness profile.
#
#   scripts/video-harness/launch.sh web [dsh web args]          the chat page (default --port 8092 --no-open)
#   scripts/video-harness/launch.sh creator [dsh web args]      the chat page with the DreamVerse Creator preset and
#                                                               live reload of packages/dv, beside the browser bundle
#                                                               watcher; needs one earlier `pnpm run build`
#   scripts/video-harness/launch.sh headless "<task>" [args]    one task, printed result, exit; add --session-id <id>
#                                                               to continue an earlier headless session
#
# Provider keys are sourced from DV_ENV_FILE (default /mnt/lustre/vlm-d1su/codes/fv-hub/.env) and never printed. The
# bundle patch (packages/bundle/dv/cordis.patch.yml) reads DV_PROJECTS_FOLDER, DV_PUBLIC_URL,
# DV_AGENT_PROVIDER, DV_AGENT_MODEL, DV_AGENT_REASONING, DV_AGENT_VISION, DV_DEEPSEEK_BASE_URL, and DV_DEEPSEEK_API_KEY
# from this environment. The agent model defaults to DeepSeek V4.1 on the cluster's SGLang server
# (http://10.244.6.153:30000/v1, no key); DV_AGENT_PROVIDER=groq DV_AGENT_MODEL=qwen/qwen3.8-27b is the fallback.
# DSH_HOME defaults to $HOME/.local/state/dsh-video-harness. Extra arguments are forwarded to dsh, for example
# --trusted-host <host>.
set -euo pipefail

fork_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
surface="${1:-web}"
shift || true

env_file="${DV_ENV_FILE:-/mnt/lustre/vlm-d1su/codes/fv-hub/.env}"
if [[ -r "$env_file" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
fi

export DSH_HOME="${DSH_HOME:-$HOME/.local/state/dsh-video-harness}"
export DV_DEEPSEEK_BASE_URL="${DV_DEEPSEEK_BASE_URL:-http://10.244.6.153:30000/v1}"
# pi-ai's OpenAI-compatible route requires a bearer token even for a keyless server.
export DV_DEEPSEEK_API_KEY="${DV_DEEPSEEK_API_KEY:-none}"
"$fork_root/scripts/video-harness/setup-profile.sh"

cd "$fork_root"
case "$surface" in
  web)
    exec node --import tsx/esm apps/cli/src/bin.ts --profile video-harness --port "${DV_PORT:-8092}" --no-open "$@"
    ;;
  creator)
    # set -m makes each background job a process-group leader, so stop_creator can signal each job's whole tree.
    set -m
    watcher='' server=''
    watch_log="$(mktemp)"
    # Stop both jobs: SIGINT to the watcher, SIGTERM to the server, and SIGKILL to what is left after 30 s.
    stop_creator() {
      trap '' INT TERM
      local groups=() group deadline
      # dev-web stops its stages on a process-group SIGINT, the signal that Ctrl+C sends in a terminal.
      [[ -z "$watcher" ]] || { groups+=("$watcher"); kill -INT -- "-$watcher" 2>/dev/null || true; }
      [[ -z "$server" ]] || { groups+=("$server"); kill -TERM -- "-$server" 2>/dev/null || true; }
      if [[ ${#groups[@]} -gt 0 ]]; then
        # After 30 s, SIGKILL ends what is left. `wait` reaps the two jobs, and the loop waits for the rest of each group.
        (sleep 30; for group in "${groups[@]}"; do kill -KILL -- "-$group" 2>/dev/null || true; done) &
        deadline=$!
        disown "$deadline"
        wait "${groups[@]}" 2>/dev/null || true
        for group in "${groups[@]}"; do
          # Zombies do not count: a container's PID 1 can leave reparented children unreaped.
          while kill -0 "$deadline" 2>/dev/null \
            && ps -eo pgid=,stat= | awk -v group="$group" '$1 == group && $2 !~ /^Z/ { found = 1 } END { exit !found }'; do
            sleep 0.5
          done
        done
        kill -KILL -- "-$deadline" 2>/dev/null || true
      fi
      rm -f "$watch_log"
    }
    trap 'exit 130' INT
    trap 'exit 143' TERM
    trap stop_creator EXIT
    pnpm run dev:web --skip-build --no-serve > >(tee "$watch_log") 2>&1 &
    watcher=$!
    # The server starts after the watcher's first builds, the point where `pnpm run dev:web` starts its own server.
    until grep -q '^dev-web: watching' "$watch_log"; do
      kill -0 "$watcher" 2>/dev/null || exit 1
      sleep 1
    done
    node --import tsx/esm apps/cli/src/bin.ts --profile video-harness-creator --port "${DV_PORT:-8092}" --no-open "$@" &
    server=$!
    wait -n "$watcher" "$server"
    ;;
  headless)
    exec node --import tsx/esm apps/cli/src/bin.ts --profile video-harness-headless "$@"
    ;;
  *)
    echo "usage: $0 web|creator|headless [args]" >&2
    exit 2
    ;;
esac
