#!/usr/bin/env bash
# Start the Seed-VC server for @fastvideo/dreamverse-seed-vc on a machine with an NVIDIA GPU (about 3 GB of GPU memory). See the
# @fastvideo/dreamverse-voice-acting README for the one-time setup.
#
#   SEED_VC_DIR=/path/to/seed-vc ./start-seed-vc.sh [server options]
#
# Environment:
#   SEED_VC_DIR     the Seed-VC checkout; required
#   SEED_VC_PYTHON  its Python (default $SEED_VC_DIR/.venv/bin/python)
#   SEED_VC_PORT    the port (default 8010)
#   SEED_VC_GPU     the GPU to use, as CUDA_VISIBLE_DEVICES (default: leave CUDA_VISIBLE_DEVICES as it is)
#   VOXCELEB_META   vox1_meta.csv, so voices can be built from a name (default: no voices by name)
#   VOXCELEB_DIR    a folder holding vox1_dev_wav.zip and vox1_test_wav.zip (default: read clips from Hugging Face)
#   VOICE_CACHE     where built voices are kept (default ~/.cache/dv-seed-vc/voices)
#   HF_HOME         the Hugging Face cache for the model weights; set HF_HUB_OFFLINE=1 once they are downloaded
set -euo pipefail

: "${SEED_VC_DIR:?SEED_VC_DIR must name the Seed-VC checkout}"
python="${SEED_VC_PYTHON:-$SEED_VC_DIR/.venv/bin/python}"
if [[ -n "${SEED_VC_GPU:-}" ]]; then
  export CUDA_VISIBLE_DEVICES="$SEED_VC_GPU"
fi
# Matplotlib, which Seed-VC imports, needs a writable config folder.
export MPLCONFIGDIR="${MPLCONFIGDIR:-${XDG_CACHE_HOME:-$HOME/.cache}/matplotlib}"
exec "$python" "$(dirname "${BASH_SOURCE[0]}")/seed-vc-server.py" "$@"
