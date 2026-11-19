# DreamVerse Harness

English | [中文](README.zh.md)

<p align="center"><img src="docs/user/guide/dreamverse-logo.svg" alt="DreamVerse" width="520"></p>

<p align="center"><strong>Open-source AI filmmaking on your own GPUs.</strong></p>

<p align="center"><a href="#features">Features</a> · <a href="#get-started">Get started</a> · <a href="#how-it-works">How it works</a> · <a href="#community">Community</a></p>

DreamVerse Harness takes local video generation from single clips to complete films. You describe a film in a chat, and an agent works with you to write it, design its characters and places, render every shot, and cut the takes together on a timeline. It runs on your own GPUs through [FastVideo](https://github.com/hao-ai-lab/FastVideo), it works with any model you connect, and every part of it is a plugin you can change.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/user/guide/dreamverse-workspace-dark.png">
  <img src="docs/user/guide/dreamverse-workspace.png" alt="A DreamVerse project: the canvas shows a character, a location, a generated still and a rendered shot; the chat shows the agent's report on the take">
</picture>

## Features

- **Runs on your hardware.** DreamVerse Harness renders through a FastVideo server running FastH3. Put that server on a GPU cluster, or run it locally on an RTX GPU, a DGX Spark, or Apple Silicon. You pay for electricity, not for credits.
- **Bring any model.** Each video, image, or audio model is one provider plugin in the model catalog. To add your own model or API, write a provider plugin, or ask a coding agent to write it with the built-in [`dv-add-model-provider`](.agents/skills/dv-add-model-provider/SKILL.md) skill.
- **An agent that knows how to direct.** The agent follows directing skills and model-specific prompting skills, and it acts through a dedicated toolset: it breaks down the story, locks character and location references, renders shots, and lays out the timeline.
- **Direct it interactively.** FastH3 renders a take in seconds, so you can watch a shot and steer the next one right away. The agent asks before it spends GPU time, and you can re-roll one shot, swap a reference, or recut the sequence without starting over.
- **Bring your own skills.** Skills are Markdown files that teach the agent how to work. Edit the shipped ones or drop your own into [`packages/bundle/dv/skills/`](packages/bundle/dv/skills), then start any of them from the Skills page. Turn whole features on and off on the Plugins page.
- **One history for you and the agent.** Every change, from the chat or from the canvas, is a step in the project history. Undo and redo work the same for both, and an undone take stays available for comparison.

<table>
  <tr>
    <td width="50%"><img src="docs/user/guide/dreamverse-home.png" alt="The Home page with the prompt box, templates, and the Explore section"><br><sub>Start from one sentence on the Home page.</sub></td>
    <td width="50%"><img src="docs/user/guide/dreamverse-approve.png" alt="The agent asks whether to render the shot, with the generated still on the canvas"><br><sub>The agent asks before it renders.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/user/guide/dreamverse-history.png" alt="The History panel lists each step of the agent with its time and reason"><br><sub>Every step is in the History panel.</sub></td>
    <td width="50%"><img src="docs/user/guide/dreamverse-timeline.png" alt="The timeline editor with the rendered shot on the video track"><br><sub>Edit and export on the timeline.</sub></td>
  </tr>
</table>

DreamVerse Harness is a research preview. Expect breaking changes, and read the [safety notice](SAFETY.md) before you run it.

<a id="run"></a>

## Get started

DreamVerse Harness needs two servers: a FastVideo server that renders the video, and an OpenAI-compatible chat endpoint that runs the agent.

### What you need

- Node.js `^22.19.0` or `>=24.0.0`, and pnpm `11.7.0`.
- `ffmpeg` and `ffprobe`.
- GPUs for the FastVideo server. The FastH3 8-Step configuration below uses 4 NVIDIA GPUs, and it also runs on 2 GPUs with more than 80 GB of memory each, such as NVIDIA GB200 (see step 1).
- An OpenAI-compatible chat endpoint for the agent, such as an SGLang server with DeepSeek V4.1, and its API key if it needs one.

### 1. Start a video server

On the GPU machine, install FastVideo and serve FastH3 8-Step V2 (text to video with audio) on port 8000:

```sh
uv venv --python 3.12 --seed && source .venv/bin/activate
git clone https://github.com/hao-ai-lab/FastVideo.git && cd FastVideo
UV_TORCH_BACKEND=cu130 uv pip install -e ".[fasth3]"
fastvideo serve --config examples/serving/openai_fasth3_8step.yaml --server.host 127.0.0.1
```

The install takes about 10 minutes, and the first start also downloads the model weights. The server keeps running in this terminal, so use a second terminal for the next steps. The server is ready when it prints `Uvicorn running on http://127.0.0.1:8000`; then `curl http://127.0.0.1:8000/v1/models` lists `fasth3`.

With fewer than 4 GPUs, set the GPU count and the sequence-parallel size to the same number. That number must divide the 56 attention heads of the model, so 3 GPUs fail at startup. On 2 GPUs, each GPU needs more than 80 GB of memory. For example:

```sh
CUDA_VISIBLE_DEVICES=0,1 fastvideo serve --config examples/serving/openai_fasth3_8step.yaml --server.host 127.0.0.1 \
  --generator.engine.num_gpus 2 --generator.engine.parallelism.sp_size 2
```

If the server prints `Application startup failed. Exiting.`, the `fastvideo serve` process can keep running. Stop that process before you start the server again.

To run the server on one local machine, use the matching configuration in [FastVideo's serving examples](https://github.com/hao-ai-lab/FastVideo/tree/main/examples/serving): `openai_fasth3_omniref_rtx5090.yaml`, `openai_fasth3_omniref_rtx_pro6000.yaml`, or `openai_fasth3_omniref_spark.yaml` for FastH3 OmniRef on one GPU, or `mlx_fasth3_8step.yaml` on Apple Silicon.

<a id="run-from-source"></a>

### 2. Install DreamVerse Harness

The repository is private for now; cloning it needs a GitHub account with access to `fastvideo-project/dreamverse-harness`.

```sh
git clone https://github.com/fastvideo-project/dreamverse-harness
cd dreamverse-harness
pnpm install
pnpm run build
```

`pnpm install` and `pnpm run build` take about 10 minutes together. During `pnpm install`, the `Failed to create bin` warnings for `dsh` are expected before the first build.

### 3. Connect the video server

Create the `video-harness` profile:

```sh
export DSH_HOME="$HOME/.local/state/dsh-video-harness"
scripts/video-harness/setup-profile.sh
```

The script prints nothing when it succeeds.

Then point the profile at your FastVideo server. This patch turns on the `fastvideo` provider with your server for task `t2v`, and turns off the providers that point at the development cluster:

```sh
cat > "$DSH_HOME/profiles/video-harness/cordis.patch.yml" <<'EOF'
- id: dv-fastvideo
  disabled: false
  config:
    models:
      fasth3:
        t2v:
          baseUrl: http://127.0.0.1:8000
          modelFacts:
            modelId: fasth3
            frameSizes: { '16:9': { 768p: [1344, 768] }, '9:16': { 768p: [768, 1344] }, '1:1': { 768p: [768, 768] } }
            numFramesByDurationSec: { 5: 124, 6: 158, 7: 175, 8: 192, 9: 226, 10: 243, 11: 277, 12: 294, 13: 328, 14: 345, 15: 362 }
            maxReferences: 0
            referenceMediaTypes: {}
- id: dv-uniserve
  disabled: true
- id: dv-sglang-diffusion
  disabled: true
- id: dv-sglang-omni
  disabled: true
EOF
```

For a FastH3 OmniRef server, put it under `ref2v` with the `ref2v` model facts of the `dv-fastvideo` row in [`packages/bundle/dv/cordis.patch.yml`](packages/bundle/dv/cordis.patch.yml). A `ref2v` model needs at least one reference image for each shot; attach a photo in the chat, or keep an image model on so that the agent can make one. The [`@dv/fastvideo` README](packages/dv/fastvideo/README.md) describes every field.

### 4. Connect the agent model

Set the agent's endpoint and key, the environment file of the launch script, the media tools, and the folder for your projects:

```sh
export DV_DEEPSEEK_BASE_URL=http://<your endpoint>/v1
export DV_DEEPSEEK_API_KEY=<your key>   # omit this line for a server without a key
export DV_ENV_FILE=/dev/null
export DV_FFMPEG="$(command -v ffmpeg)"
export DV_PROJECTS_FOLDER="$HOME/DreamVerse"
mkdir -p "$DV_PROJECTS_FOLDER"
```

The agent uses the model `deepseek-v4.1`. If `$DV_DEEPSEEK_BASE_URL/models` lists another name, set `DV_AGENT_MODEL` to that name. Set `DV_AGENT_VISION=0` if the model cannot read images. The [`@dv/bundle` README](packages/bundle/dv/README.md) lists the other variables, such as `DV_PORT`.

### 5. Launch

```sh
scripts/video-harness/launch.sh web
```

Run this command in the same shell as step 4, because `launch.sh` reads the variables of step 4. Without `DV_DEEPSEEK_BASE_URL`, `launch.sh` uses a server of the development cluster. `launch.sh` also loads the file that `DV_ENV_FILE` names, and the default is a file on the development machine; step 4 sets `DV_ENV_FILE` to `/dev/null`. To load provider keys, such as `GROQ_API_KEY`, from a file, set `DV_ENV_FILE` to that file.

The web interface listens on port `8092`. Open the URL that the command prints, such as `http://127.0.0.1:8092/?token=…`; the token logs you in. To open the page from another machine, add `--trusted-host <host name>` to the command.

### 6. Make your first video

1. On the Home page, type what you want in the prompt box, for example `Make a 5-second video of a corgi chef flipping pancakes in a sunny kitchen.`, and press Enter. DreamVerse creates a project and opens it.
2. When the agent asks a question, choose an answer and click **Submit**.
3. Before it renders, the agent asks you to confirm the shot, for example **Shall I render this one 5-second shot, and in which framing?**. The question and the answers change from chat to chat. Choose a **Yes** answer, such as **Yes — 16:9 widescreen**, and click **Submit**. On 2 NVIDIA GB200 GPUs, a 5-second shot takes about 3 minutes.
4. The take appears on the **Canvas**. The **History** panel lists every step, and you can undo any of them.
5. Open the **Timeline** tab. If it says **The project has no timelines yet**, the agent did not place the take on a timeline. Ask the agent in the chat: `Put the shot on the timeline.`
6. Click **Export**. When the export finishes, click **Open the exported video**. The video opens in a new browser tab. Save it with a `.mp4` file name, because the link has no file extension.

### Set up on DGX Spark

To set up DreamVerse Harness, FastVideo and a local LLM on one to four NVIDIA DGX Sparks, let a coding agent do it. Install the [`dreamverse-dgx-spark-setup`](.agents/skills/dreamverse-dgx-spark-setup/SKILL.md) skill in Codex or Claude Code, and ask the agent to set up DreamVerse on your DGX Sparks:

```sh
npx skills add fastvideo-project/dreamverse-harness --skill dreamverse-dgx-spark-setup
```

The agent inspects each DGX Spark, chooses a model layout for the hardware you have, installs FastVideo, the LLM and DreamVerse Harness, and checks every box with a test render. To do it yourself, follow the [DGX Spark guide](scripts/video-harness/dgx-spark.md), which has the full commands and a check after each step. The guide has these recipes:

**[One DGX Spark, fully local](scripts/video-harness/dgx-spark.md#1-fully-local-on-one-dgx-spark).** Qwen 3.8 27B (about 39 GB under vLLM) and FastH3 Trim (about 45 GB while rendering) share one box:

1. Prepare the box: DGX OS with CUDA 13, at least 120 GB of free disk, a Hugging Face login (`hf auth login`), and a memory watchdog, because an out-of-memory condition can freeze a GB10.
2. Download the weights:

   ```sh
   hf download nvidia/Qwen3.8-27B-NVFP4 --local-dir ~/models/Qwen3.8-27B-NVFP4
   hf download FastVideo/FastVideo-FastH3-Trim-8-Step-NVFP4 --local-dir ~/models/FastH3-Trim-8-Step-NVFP4
   ```

3. Serve Qwen with the nightly CUDA 13 wheels of vLLM on port 8000, with `--gpu-memory-utilization 0.32` so that FastH3 fits beside it. Start it first, because its first start compiles kernels.
4. Install FastVideo by its [DGX Spark guide](https://github.com/hao-ai-lab/FastVideo/blob/main/docs/getting_started/installation/spark_performance.md), and serve FastH3 Trim from `examples/serving/openai_fasth3_trim_spark.yaml` with the local weights on port 18000.
5. Build DreamVerse Harness, create its profile, and write a profile patch that points the agent at Qwen and `dv-fastvideo` at FastH3 Trim. Then launch the web interface with `scripts/video-harness/launch.sh web`, and open the printed URL in the browser of the DGX Spark.

**[Several DGX Sparks](scripts/video-harness/dgx-spark.md#2-several-dgx-sparks).** Every DGX Spark runs its own FastVideo server, bound to its address on the direct cable or the LAN, with a model catalog (`server.model_catalog`) so that the agent can load and unload models on it. In the profile patch, give each model its server's `baseUrl`, and set `managed: true` on each catalog server. One FastH3 NVFP4 model takes 40 to 55 GB, so two fit in a DGX Spark, or one beside Qwen.

**[2K across two DGX Sparks](scripts/video-harness/dgx-spark.md#3-a-2k-upscale-split-across-two-dgx-sparks).** Two cabled DGX Sparks run one Open-H3-Regenerate-2K server with sequence parallel over Ray (`sp_size: 2`), so each box refines half of each clip.

## How it works

DreamVerse Harness is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), an agent harness in which every capability is a [Cordis](https://github.com/cordiverse/cordis) plugin. DreamVerse adds video production as plugins in layers: a project layer that records every change in an append-only history, a model catalog with one provider plugin per model, features such as characters, locations, shot renders and the timeline, and workflows such as the story workflow that combine them. Each plugin ships the skills that tell the agent how to use it.

The [DreamVerse packages page](docs/subsystems/video-harness.md) describes the layers, the operation record, and the history rules.

## Community

- Join the [FastVideo Slack](https://join.slack.com/t/fastvideo/shared_invite/zt-4heayzk81-lOkgpvJRoceuZjNP7pXxJA) to ask questions and share what you make.
- Join the [Discord server](https://discord.gg/dqc2J2yNQ) to chat with other users.
- Report bugs and request features in [GitHub Issues](https://github.com/fastvideo-project/dreamverse-harness/issues).
- Share your provider plugins and skills: open a pull request, or post them in Slack or Discord.

## Development

Start with the [development guide](docs/development.md) and the [architecture documentation](docs/architecture.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules. For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE). DreamVerse Harness is built on DeepSeek Harness, which DeepSeek publishes under the MIT license.

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
