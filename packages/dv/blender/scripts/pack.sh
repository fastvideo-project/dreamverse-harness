#!/usr/bin/env bash
# Pack @fastvideo/dreamverse-blender as one self-contained tarball: the three Blender plugins ride inside it as bundled
# dependencies, and so do the bridge's own dependencies (ws, fflate), so `dsh plugin add <absolute path or URL of the
# tarball>` installs everything without a registry.
#
# Usage, from the repository root after `pnpm run build`:
#   bash packages/dv/blender/scripts/pack.sh [destination directory]   # default: ./dist/packs (ignored by git)
set -euo pipefail

root=$(git rev-parse --show-toplevel)
dest=$(realpath -m "${1:-$root/dist/packs}")
plugins=(blender-bridge ui-blender workflow-blender)
# The bridge's runtime dependencies, which a bundled package must carry itself.
vendored=(ws fflate)

for plugin in "${plugins[@]}"; do
  [[ -f "$root/packages/dv/$plugin/lib/index.js" ]] || { echo "pack.sh: packages/dv/$plugin/lib is not built; run pnpm run build first" >&2; exit 1; }
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
filters=(--filter @fastvideo/dreamverse-blender)
for plugin in "${plugins[@]}"; do filters+=(--filter "@fastvideo/dreamverse-$plugin"); done
# pnpm pack applies publishConfig and turns each workspace:* range into the real version.
(cd "$root" && pnpm "${filters[@]}" pack --pack-destination "$work/tgz" >/dev/null)

stage="$work/stage"
mkdir -p "$stage"
tar -xzf "$work"/tgz/fastvideo-dreamverse-blender-0*.tgz -C "$stage"
for plugin in "${plugins[@]}"; do
  mkdir -p "$stage/package/node_modules/@fastvideo/dreamverse-$plugin"
  tar -xzf "$work"/tgz/fastvideo-dreamverse-"$plugin"-*.tgz -C "$stage/package/node_modules/@fastvideo/dreamverse-$plugin" --strip-components=1
done
bridge_modules="$stage/package/node_modules/@fastvideo/dreamverse-blender-bridge/node_modules"
mkdir -p "$bridge_modules"
for module in "${vendored[@]}"; do
  source_dir=$(cd "$root/packages/dv/blender-bridge" && node -p "require('node:path').dirname(require.resolve('$module/package.json'))")
  cp -RL "$source_dir" "$bridge_modules/$module"
done
node -e '
  const fs = require("node:fs")
  const file = process.argv[1]
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"))
  manifest.bundleDependencies = process.argv.slice(2).map(plugin => `@fastvideo/dreamverse-${plugin}`)
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n")
' "$stage/package/package.json" "${plugins[@]}"

mkdir -p "$dest"
(cd "$stage/package" && npm pack --silent --pack-destination "$dest")
echo "$dest/$(cd "$dest" && ls -t fastvideo-dreamverse-blender-0*.tgz | head -1)"
