# Running DreamVerse on DGX Spark

This page sets up the DreamVerse video harness on NVIDIA DGX Spark (GB10, 128 GB unified memory), first fully local on one DGX Spark, then across two to four. You sit at a DGX Spark with its own display; nothing runs on a laptop and no SSH tunnel is needed. FastVideo serves the video models; vLLM serves a local LLM when the agent should not use a remote one.

Each recipe ends with a verify step. Run them in order: a later step assumes the earlier one is green.

## Pick a recipe

| DGX Sparks | Recipe | The agent | What runs where |
|---|---|---|---|
| 1 | [Fully local](#1-fully-local-on-one-dgx-spark) | Qwen 3.8 27B on the box | Qwen 3.8 27B (vLLM) and FastH3 Trim share one DGX Spark |
| 2 or 3 | [Several DGX Sparks](#2-several-dgx-sparks) | Local or remote | One FastVideo server per DGX Spark; the harness loads, unloads and routes per box |
| 2 or 3, cabled | [A 2K upscale split across a pair](#3-a-2k-upscale-split-across-two-dgx-sparks) | Local or remote | Two DGX Sparks run one FastVideo server with sequence parallel |
| 4 | [Several DGX Sparks](#2-several-dgx-sparks) | Local or remote | Splitting one job across all four needs a 200 GbE switch |

Two or three DGX Sparks can be cabled directly through their two QSFP ports; four need a 200 GbE switch (or a manually configured four-cable ring), per NVIDIA's multi-DGX-Spark playbook.

## 0. Prepare each DGX Spark

1. Use DGX OS with CUDA 13 (`nvcc --version` reports 13.0) and at least 120 GB of free disk.
2. Log in to Hugging Face once (`hf auth login`) so the downloads below can run unattended.
3. Run a memory watchdog. On GB10 an out-of-memory condition can freeze the box, so kill the model servers before free memory runs out. A minimal one, started detached so it survives a closed terminal:

   ```bash
   cat > ~/memguard.sh <<'EOF'
   #!/bin/bash
   # Kill this user's model servers when MemAvailable stays below 4 GiB.
   low=0
   while true; do
     avail=$(awk '/MemAvailable/{print $2}' /proc/meminfo)
     if [ "$avail" -lt $((4 * 1024 * 1024)) ]; then low=$((low + 1)); else low=0; fi
     if [ "$low" -ge 2 ]; then
       echo "$(date +%T) MemAvailable=$((avail / 1024)) MiB: stopping model servers" >> ~/memguard.log
       pkill -9 -u "$USER" -f 'vllm serve'; pkill -9 -u "$USER" -f 'fastvideo.entrypoints.cli.main serve'
       low=0; sleep 5
     fi
     sleep 0.5
   done
   EOF
   setsid nohup bash ~/memguard.sh >/dev/null 2>&1 </dev/null &
   ```

**Verify:** `pgrep -af memguard.sh` prints one process.

## 1. Fully local on one DGX Spark

The agent and the video model share the box: Qwen 3.8 27B NVFP4 takes about 39 GB under vLLM, FastH3 Trim NVFP4 about 45 GB while rendering, and the rest is headroom.

### 1.1 Download the weights

```bash
hf download nvidia/Qwen3.8-27B-NVFP4 --local-dir ~/models/Qwen3.8-27B-NVFP4
hf download FastVideo/FastVideo-FastH3-Trim-8-Step-NVFP4 --local-dir ~/models/FastH3-Trim-8-Step-NVFP4
```

### 1.2 Serve the LLM with vLLM

vLLM's nightly wheels support GB10 (sm_121) on CUDA 13. Its kernel compiler needs `ninja` and the CUDA toolchain on `PATH`.

```bash
uv venv --python 3.12 ~/qwen-vllm
VIRTUAL_ENV=~/qwen-vllm uv pip install -U vllm ninja --pre \
  --extra-index-url https://wheels.vllm.ai/nightly/cu130 --index-strategy unsafe-best-match --torch-backend=cu130

export PATH=$HOME/qwen-vllm/bin:/usr/local/cuda/bin:$PATH CUDA_HOME=/usr/local/cuda
vllm serve ~/models/Qwen3.8-27B-NVFP4 --served-model-name qwen3.8-27b --host 127.0.0.1 --port 8000 \
  --kv-cache-dtype fp8_e4m3 --max-model-len 65536 \
  --reasoning-parser qwen3 --enable-auto-tool-choice --tool-call-parser qwen3_coder \
  --gpu-memory-utilization 0.32 --max-num-seqs 4 --max-num-batched-tokens 8192 --enable-chunked-prefill
```

`--gpu-memory-utilization 0.32` caps vLLM near 39 GB so FastH3 fits beside it. The first start compiles kernels for several minutes and briefly uses most of the memory, so start vLLM before the video server.

**Verify:** a tool call comes back as a structured `tool_calls` entry.

```bash
curl -s http://127.0.0.1:8000/v1/chat/completions -H 'content-type: application/json' -d '{
  "model": "qwen3.8-27b", "max_tokens": 256,
  "messages": [{"role": "user", "content": "Call the weather tool for Paris."}],
  "tools": [{"type": "function", "function": {"name": "get_weather",
    "parameters": {"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]}}}]
}' | grep -o '"tool_calls":\[[^]]*\]'
```

### 1.3 Serve FastH3 with FastVideo

Install FastVideo by its [DGX Spark guide](https://github.com/hao-ai-lab/FastVideo/blob/main/docs/getting_started/installation/spark_performance.md), then serve the released Trim recipe from FastVideo's `examples/serving/openai_fasth3_trim_spark.yaml` with the local weights and port 18000:

```bash
cd FastVideo
sed -e "s|model_path: FastVideo/FastVideo-FastH3-Trim-8-Step-NVFP4|model_path: $HOME/models/FastH3-Trim-8-Step-NVFP4|" \
    -e 's|  port: 8000|  port: 18000|' examples/serving/openai_fasth3_trim_spark.yaml > ~/trim-serve.yaml
FASTVIDEO_MINIMAX_H3_FUSIONS=all FASTVIDEO_NVFP4_MM_BACKEND=cudnn \
FASTVIDEO_H3_VAE_TILE_BATCH=12 FASTVIDEO_H3_VAE_INT8_OVERLAY=0 \
FASTVIDEO_VSA_TRITON=1 FASTVIDEO_VSA_PTX_BLACKWELL=0 FASTVIDEO_FA4=0 \
FASTVIDEO_ATTENTION_BACKEND=VIDEO_SPARSE_ATTN_H3 HF_HUB_OFFLINE=1 \
python -m fastvideo.entrypoints.cli.main serve --config ~/trim-serve.yaml
```

**Verify:** the server reports its model and renders a clip. With Qwen resident, a 5 s 480p clip took 75 s on a DGX Spark and memory stayed above 18 GB free.

```bash
curl -s http://127.0.0.1:18000/v1/model_info | grep -o '"served_model_name": "[^"]*"'
curl -s -o ~/trim-test.mp4 -w '%{http_code}\n' http://127.0.0.1:18000/v1/videos/sync -H 'content-type: application/json' \
  -d '{"model": "fasth3-trim", "prompt": "A golden retriever runs along a beach at sunset", "size": "832x480", "seconds": "5"}'
```

### 1.4 Install the harness

The harness needs Node 22.19+ or 24 and pnpm 11.

```bash
curl -sSLO https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-arm64.tar.xz && tar xf node-v24.22.2-linux-arm64.tar.xz
export PATH=$PWD/node-v24.22.2-linux-arm64/bin:$PATH
corepack enable pnpm
git clone <this repository> dreamverse-harness && cd dreamverse-harness
pnpm install && pnpm run build
```

### 1.5 Point the harness at the local LLM and FastH3

Create the profile, then write its patch. The patch replaces the bundle's agent route and FastVideo servers, and turns off the rows that point at cluster servers.

```bash
export DSH_HOME=$HOME/.local/state/dsh-video-harness
scripts/video-harness/setup-profile.sh
cat > "$DSH_HOME/profiles/video-harness/cordis.patch.yml" <<'EOF'
- id: llm-pi-ai
  config:
    providers:
      deepseek-local:
        apiKeyEnv: DV_DEEPSEEK_API_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:8000/v1
        compat:
          supportsDeveloperRole: false
        models:
          - id: qwen3.8-27b
            name: Qwen 3.8 27B (local)
            input: [text]
            reasoningEfforts: { 'off': none, low: low, medium: medium, high: high }
- id: dv-fastvideo
  disabled: false
  config:
    models:
      fasth3:
        t2v:
          baseUrl: http://127.0.0.1:18000
          task: t2va
          displayName: FastH3 Trim
          modelFacts:
            modelId: fasth3-trim
            frameSizes:
              '16:9': { 480p: [832, 480], 768p: [1344, 768] }
              '9:16': { 480p: [480, 832], 768p: [768, 1344] }
              '1:1': { 480p: [480, 480], 768p: [768, 768] }
            numFramesByDurationSec: { 5: 124, 6: 158, 7: 175, 8: 192, 9: 226, 10: 243, 11: 277, 12: 294, 13: 328, 14: 345, 15: 362 }
            maxReferences: 0
            referenceMediaTypes: {}
- id: dv-uniserve
  disabled: true
- id: dv-sglang-omni
  disabled: true
- id: dv-sglang-diffusion
  disabled: true
EOF
```

`frameSizes` and `numFramesByDurationSec` must match what the FastVideo server publishes in `/v1/model_info` (`video_output_capabilities`).

**Verify:** `node --import tsx/esm apps/cli/src/bin.ts --profile video-harness --dump-config` shows `qwen3.8-27b` under `deepseek-local` and `http://127.0.0.1:18000` under `dv-fastvideo`.

### 1.6 Start the harness

```bash
export DV_PROJECTS_FOLDER=$HOME/dreamverse-projects DV_FFMPEG=$(command -v ffmpeg) DV_FFPROBE=$(command -v ffprobe)
export DV_DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1 DV_DEEPSEEK_API_KEY=none
export DV_AGENT_PROVIDER=deepseek-local DV_AGENT_MODEL=qwen3.8-27b DV_AGENT_VISION=0 DV_ENV_FILE=/dev/null
scripts/video-harness/launch.sh web
```

**Verify:** the first line prints `dsh web: http://127.0.0.1:8092/?token=...`. Open it in the DGX Spark's browser, ask for a short scene, and a FastH3 Trim clip renders.

## 2. Several DGX Sparks

Every DGX Spark runs its own FastVideo server, and the harness on DGX Spark 1 routes each model and task to the server that holds it. A remote LLM, or Qwen on any one box from [step 1.2](#12-serve-the-llm-with-vllm), plans the shots.

1. On each additional DGX Spark, repeat [step 0](#0-prepare-each-dgx-spark), download the models it will hold, and serve them with FastVideo bound to the box's address on the direct cable or LAN (`server.host`), not `127.0.0.1`. For load and unload under the harness's control, serve a model catalog (`server.model_catalog`), which adds `GET /v1/model_state` and `POST /v1/models/load` and `/v1/models/unload` (FastVideo's [server contract](https://github.com/hao-ai-lab/FastVideo/blob/main/docs/design/server_contracts/openai.md)).
2. In the profile patch, give each model and task its server's `baseUrl` (for example FastH3 V2 on DGX Spark 2 at `http://192.168.23.2:18000`), and set `managed: true` on a catalog server so the agent's `dv_models_load`, `dv_models_unload` and `dv_models_status` tools reach it.
3. Keep every box's memory in budget: one FastH3 NVFP4 model is 40 to 55 GB resident, so two fit in a DGX Spark, or one beside Qwen.

**Verify:** in the harness, ask the agent for `dv_models_status`; every server answers with its loaded model. Then request two shots that use models on different DGX Sparks and confirm both render at the same time.

## 3. A 2K upscale split across two DGX Sparks

Two cabled DGX Sparks run one Open-H3-Regenerate-2K server with sequence parallel over Ray, so each box refines half of the clip. FastVideo's [Open-H3-Regenerate-2K guide](https://github.com/hao-ai-lab/FastVideo/blob/main/docs/inference/open_h3_regenerate_2k.md) has the two-DGX-Spark settings (`sp_size: 2`, `examples/inference/optimizations/spark_pair_env.sh` for the cable's RoCE interface, and the opt-ins measured at 158 s per 2560x1440 clip against 510 s on one box). Start the Ray head on one box and join the other over the direct cable, then serve with `num_gpus: 2`.

**Verify:** the guide's two-DGX-Spark example returns a 2560x1440 clip, and `nvidia-smi` shows GPU load on both boxes during the refine.
