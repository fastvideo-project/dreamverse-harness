---
name: dreamverse-dgx-spark-setup
description: Set up DreamVerse (the video harness), FastVideo and a local LLM on one to four NVIDIA DGX Sparks, and choose the best model combination for the number of boxes. Use when a user asks their agent to install or configure DreamVerse on DGX Spark.
---

# Set up DreamVerse on DGX Spark

You are setting up DreamVerse on the user's NVIDIA DGX Sparks (GB10, 128 GB unified memory each). The user sits at the DGX Spark that will host DreamVerse; run every command on the boxes themselves. When you finish, the user opens DreamVerse in that box's browser and makes videos with FastH3 models served by FastVideo, planned by an LLM that runs locally or remotely.

The step-by-step commands and verify checks are in [Running DreamVerse on DGX Spark](https://github.com/fastvideo-project/dreamverse-harness/blob/main/scripts/video-harness/dgx-spark.md) (in a clone: `scripts/video-harness/dgx-spark.md`). This skill decides what to install where, carries the exact LLM setup, and keeps the setup safe.

## 1. Survey the boxes

Ask the user which DGX Sparks to use and which one hosts DreamVerse (DGX Spark 1 below). For each box, record free memory (`free -g`), free disk (`df -h ~`, at least 120 GB per box), the CUDA version (`nvcc --version`, 13.x), what already runs (`tmux ls`, `pgrep -af 'vllm serve|fastvideo'`), and its network addresses (`ip -br addr`); ping between boxes to learn which share a direct QSFP cable.

Ask before stopping or deleting anything you did not start. Never touch another user's processes or files.

## 2. Choose the combination

Pick by the number of DGX Sparks, then tell the user the plan before installing. Every box runs one FastVideo server; DGX Spark 1 also runs DreamVerse. One FastH3 NVFP4 model takes about 40 to 55 GB, so a box holds two of them, or one beside Qwen.

| DGX Sparks | LLM | DGX Spark 1 | DGX Spark 2 | DGX Spark 3 | DGX Spark 4 |
|---|---|---|---|---|---|
| 1 | Qwen on DGX Spark 1 | Qwen + FastH3 Trim | | | |
| 2 | Qwen on DGX Spark 1, or remote | FastH3 V1 + Trim (or Qwen + Trim) | FastH3 V2, Omni on demand | | |
| 3 | Qwen on DGX Spark 3, or remote | FastH3 V1 | FastH3 V2, Omni on demand | Qwen + FastH3 Trim | |
| 4 | Remote, or Qwen on one box | FastH3 V1 | FastH3 V2 | FastH3 Omni | FastH3 Trim |

For a 2K finish, two boxes joined by a direct cable load the Open-H3-Regenerate-2K upscaler together and split each clip (sequence parallel 2). Two or three DGX Sparks can be cabled directly; splitting one job across four needs a 200 GbE switch, so on a LAN say so instead of attempting it.

The models, all public on Hugging Face:

| Model | Repository | FastVideo serving |
|---|---|---|
| FastH3 Trim | `FastVideo/FastVideo-FastH3-Trim-8-Step-NVFP4` | `examples/serving/openai_fasth3_trim_spark.yaml` |
| FastH3 V2 | `FastVideo/FastVideo-FastH3-8-Step-V2-NVFP4-Consumer` | FastVideo's DGX Spark guide, `layer_profile: h3_dit_vsa` |
| FastH3 V1 | `FastVideo/FastVideo-FastH3-4-step-Preview-v1-VSA-DataFree` | `examples/serving/openai_fasth3_spark.yaml` |
| FastH3 Omni | `FastVideo/FastH3-Omni-NVFP4-QAD` | `examples/serving/openai_fasth3_omniref_spark.yaml` |
| 2K upscaler | `Efficient-Large-Model/Open-H3-Regenerate-2K` | `examples/serving/openai_open_h3_regenerate_2k.yaml` |
| Qwen 3.8 27B | `nvidia/Qwen3.8-27B-NVFP4` | vLLM, below |

## 3. The local LLM: Qwen 3.8 27B on vLLM

This is the setup DreamVerse was tested with on DGX Spark. Use vLLM's nightly wheels for CUDA 13; its kernel compiler needs `ninja` and the CUDA toolchain on `PATH`. Cap memory at 0.32 (about 39 GB) so a FastH3 model fits beside it, and enable tool calling and reasoning parsing, which the DreamVerse agent uses.

```bash
uv venv --python 3.12 ~/qwen-vllm
VIRTUAL_ENV=~/qwen-vllm uv pip install -U vllm ninja --pre \
  --extra-index-url https://wheels.vllm.ai/nightly/cu130 --index-strategy unsafe-best-match --torch-backend=cu130
hf download nvidia/Qwen3.8-27B-NVFP4 --local-dir ~/models/Qwen3.8-27B-NVFP4

export PATH=$HOME/qwen-vllm/bin:/usr/local/cuda/bin:$PATH CUDA_HOME=/usr/local/cuda
vllm serve ~/models/Qwen3.8-27B-NVFP4 --served-model-name qwen3.8-27b --host 127.0.0.1 --port 8000 \
  --kv-cache-dtype fp8_e4m3 --max-model-len 65536 \
  --reasoning-parser qwen3 --enable-auto-tool-choice --tool-call-parser qwen3_coder \
  --gpu-memory-utilization 0.32 --max-num-seqs 4 --max-num-batched-tokens 8192 --enable-chunked-prefill
```

Use `--host 127.0.0.1` when Qwen runs on DGX Spark 1, and the box's cable or LAN address when DreamVerse reaches it from another box. DreamVerse talks to it as the `deepseek-local` provider with model `qwen3.8-27b` (the guide's profile patch). For a remote LLM, point `DV_DEEPSEEK_BASE_URL` and `DV_AGENT_MODEL` at the user's OpenAI-compatible endpoint instead.

## 4. Install and verify

Follow the guide in order: prepare each box (memory watchdog), serve the LLM, serve FastVideo on every box, install DreamVerse on DGX Spark 1, write its profile with one server per model, and start it. Run each verify step before the next one. Rules from real failures on GB10:

- Start the memory watchdog first; an out-of-memory condition can freeze a DGX Spark.
- Start vLLM before FastVideo on the same box: its first start compiles kernels and briefly takes most of the memory.
- Bind servers to `127.0.0.1` on DGX Spark 1 and to the cable or LAN address on the others.
- Never run `pkill -f` with a pattern that also matches your own shell command; match the server instead (`'vllm serve'`, `'fastvideo.entrypoints.cli.main serve'`).
- Run servers in `tmux` sessions named for what they run.

## 5. Report

Tell the user the DreamVerse address on DGX Spark 1, and for each box: the models it serves, its address and port, the tmux session names, and the time and lowest free memory of its verify render. Give the restart order (vLLM, then FastVideo, then DreamVerse) and say which steps you skipped and why.
