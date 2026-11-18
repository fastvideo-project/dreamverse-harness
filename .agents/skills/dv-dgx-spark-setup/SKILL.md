---
name: dv-dgx-spark-setup
description: Use to set up the DreamVerse video harness on one to four NVIDIA DGX Sparks, fully local or across boxes, by following and verifying the DGX Spark guide. For agents operating the machines.
---

# Set up DreamVerse on DGX Spark

This skill is for an agent that sets up DreamVerse on DGX Sparks for a user. The procedure, commands and verify steps live in [Running DreamVerse on DGX Spark](../../../scripts/video-harness/dgx-spark.md); this skill decides which recipe applies, runs it safely, and reports what works.

## 1. Survey before changing anything

For every DGX Spark the user names, record:

- free memory (`free -g`), free disk (`df -h ~`) and CUDA version (`nvcc --version`);
- what already runs: `tmux ls`, model servers (`pgrep -af 'vllm serve|fastvideo.entrypoints'`), and other users' processes (`ps -eo user,cmd --sort=-rss | head`);
- network: `ip -br addr` and which addresses answer a ping, to learn which boxes share a direct QSFP cable.

Ask before stopping or deleting anything you did not start. Never touch another user's processes or files. Do not put work on a box the user reserves for CI.

## 2. Pick the recipe

- One DGX Spark, or the user wants no cloud: recipe 1 (fully local, Qwen 3.8 27B and FastH3 Trim in one box).
- Two to four DGX Sparks: recipe 2 (a FastVideo server per box, routed by the harness), with a local or remote LLM as the user prefers.
- A 2K upscale across two boxes: recipe 3, only for boxes joined by a direct cable. Splitting one job across four DGX Sparks needs a 200 GbE switch; say so instead of attempting it on a LAN.

State the recipe and each box's role to the user before installing.

## 3. Run it

Follow the guide's steps in order and run each verify step before the next one. Rules that come from real failures on GB10:

- Start the memory watchdog first and confirm it is running; an out-of-memory condition can freeze a DGX Spark.
- Start vLLM before any FastVideo server: its first start compiles kernels and briefly takes most of the memory.
- Keep two FastH3 NVFP4 models per box at most, or one beside Qwen 3.8 27B.
- Bind servers to `127.0.0.1` on the box that hosts the harness, and to the cable or LAN address on the others.
- Never run `pkill -f` with a pattern that also matches your own shell command line; match the server's command instead (`'vllm serve'`, `'fastvideo.entrypoints.cli.main serve'`).
- Run long installs and servers in `tmux` sessions named for what they run, so the user can find them.
- Downloads go to `~/models`; check free disk first.

## 4. Report

Tell the user, for each DGX Spark: which models it serves, on which address and port, the tmux session names, the measured time and lowest free memory of the verify render, and how to restart everything in the right order (vLLM, then FastVideo, then the harness). Say which steps you skipped and why.
