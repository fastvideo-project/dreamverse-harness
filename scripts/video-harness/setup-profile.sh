#!/usr/bin/env bash
# Create the three video-harness dsh profiles in $DSH_HOME/profiles: `video-harness` stacks the bundle on dsh-base and
# dsh-web-app (the chat page), `video-harness-creator` adds @dv/bundle-creator to that stack, and
# `video-harness-headless` stacks the bundle on dsh-base and dsh-headless (one task per process). Each gets a manifest
# and a profile patch (each kept when it already exists, so bundles switched on in the Plugins page survive a
# restart), and node_modules links to the bundles of this checkout's packages/bundle. The headless patch mounts the DSH
# Workspace registry, which @dv/project needs and dsh-web-app mounts for the chat page; the web patches start empty.
set -euo pipefail

: "${DSH_HOME:?DSH_HOME must name the harness home directory}"
fork_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

make_profile() {
  local name="$1" surface="$2" patch="$3" creator="${4:-}"
  local profile_dir="$DSH_HOME/profiles/$name"
  mkdir -p "$profile_dir/node_modules/@dv"
  [[ -e "$profile_dir/package.json" ]] || echo "{\"name\":\"dsh-profile-$name\",\"private\":true,\"dsh\":{\"profile\":{\"bundles\":[\"@deepseek-ai/dsh-base\",\"$surface\",\"@dv/bundle\"${creator:+,\"@dv/bundle-creator\"}]}}}" \
    > "$profile_dir/package.json"
  [[ -e "$profile_dir/cordis.patch.yml" ]] || printf '%s\n' "$patch" > "$profile_dir/cordis.patch.yml"
  ln -sfn "$fork_root/packages/bundle/dv" "$profile_dir/node_modules/@dv/bundle"
  [[ -z "$creator" ]] || ln -sfn "$fork_root/packages/bundle/dv-creator" "$profile_dir/node_modules/@dv/bundle-creator"
}

make_profile video-harness '@deepseek-ai/dsh-web-app' '[]'
make_profile video-harness-creator '@deepseek-ai/dsh-web-app' '[]' creator
make_profile video-harness-headless '@deepseek-ai/dsh-headless' "- insert:
    - id: workspace
      name: '@deepseek-ai/dsh-workspace'"
