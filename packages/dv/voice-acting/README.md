---
description: "Installable DreamVerse voice acting bundle: install it into a DreamVerse profile, set up the Seed-VC server it ships and the VoxCeleb1 speaker list it can build voices from, and switch on the allowed voices."
kind: "package-bundle"
---

# @fastvideo/dreamverse-voice-acting

English | [中文](README.zh.md)

## Summary

Use this bundle to add voice acting to DreamVerse: you record your own lines in a Voice tab, convert each take into an allowed voice with [Seed-VC](https://github.com/Plachtaa/seed-vc), and render shots that are lip-synced to the converted take. Installing it into a DreamVerse profile inserts four plugins: [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.md) (the `voice.convert` operation and its tool), [`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.md) (the model, switched off until you configure it), [`@fastvideo/dreamverse-ui-voice-convert`](../ui-voice-convert/README.md) (the Voice tab and the script teleprompter), and [`@fastvideo/dreamverse-workflow-voice`](../workflow-voice/README.md) (the `voice-acting` skill). The package also ships the Seed-VC server in `server/`, which runs on a machine with an NVIDIA GPU.

## Table of Contents

- [Use this package](#use-this-package)
  - [1. Install the bundle](#1-install-the-bundle)
  - [2. Set up the Seed-VC server](#2-set-up-the-seed-vc-server)
  - [3. Download the VoxCeleb1 speaker list](#3-download-the-voxceleb1-speaker-list)
  - [4. Start the server](#4-start-the-server)
  - [5. Switch on the allowed voices](#5-switch-on-the-allowed-voices)
  - [6. Publish the packages](#6-publish-the-packages)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

You need a DreamVerse profile, which stacks [`@dv/bundle`](../../bundle/dv/README.md), and a machine with an NVIDIA GPU, about 3 GB of free GPU memory and Python 3.10 or later for the Seed-VC server. The harness has to reach that machine over HTTP.

<a id="1-install-the-bundle"></a>
### 1. Install the bundle

Install the bundle into the DreamVerse profile, from the registry it is published to, or from the self-contained tarball that [step 6](#6-publish-the-packages) packs, by its absolute path or its URL:

```sh
dsh plugin --profile video-harness add @fastvideo/dreamverse-voice-acting
dsh plugin --profile video-harness add /shared/packs/fastvideo-dreamverse-voice-acting-0.1.0.tgz
```

From a source checkout, run `node --import tsx/esm apps/cli/src/bin.ts` in place of `dsh`. The **Plugins** page of the web sidebar installs the same specs. The install adds the bundle to the profile's bundle list, and its four plugins load at the next start. `dsh plugin --profile video-harness remove @fastvideo/dreamverse-voice-acting` removes them again.

The plugins take their shared DreamVerse and harness packages, such as `@dv/generation` and `@dv/models`, from the running harness, so the profile has to stack `@dv/bundle`. pnpm warns about these peer dependencies during the install; the warnings are expected.

<a id="2-set-up-the-seed-vc-server"></a>
### 2. Set up the Seed-VC server

Do this once on the GPU machine. The server runs Seed-VC's own inference code, so it needs a Seed-VC checkout with its Python environment. The bundle was tested with commit `51383ef` of Seed-VC, Python 3.11, PyTorch 2.11 and CUDA 12.8.

```sh
git clone https://github.com/Plachtaa/seed-vc.git
cd seed-vc && git checkout 51383ef
python3 -m venv .venv
.venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install -r <bundle>/server/requirements.txt
```

`<bundle>` is the installed package folder, `<profile>/node_modules/@fastvideo/dreamverse-voice-acting`, or `packages/dv/voice-acting` in a checkout. Install the PyTorch build for your CUDA version; Seed-VC's `requirements.txt` pins an older PyTorch, which you can drop from it if it conflicts.

The first start downloads the model weights from Hugging Face: `Plachta/Seed-VC` (the v1 checkpoint `DiT_seed_v2_uvit_whisper_small_wavenet_bigvgan_pruned.pth`), `openai/whisper-small`, `nvidia/bigvgan_v2_22khz_80band_256x` and `funasr/campplus`, about 1.5 GB. Seed-VC keeps its own checkpoint in `seed-vc/checkpoints` and the others in the Hugging Face cache (`HF_HOME`). If the GPU machine has no internet access, start the server once where it has, with the same `HF_HOME`, and set `HF_HUB_OFFLINE=1` afterwards.

<a id="3-download-the-voxceleb1-speaker-list"></a>
### 3. Download the VoxCeleb1 speaker list

Skip this step if every allowed voice has its own target clip. With it, a voice can be configured by name only, and the server builds its target clip from that speaker's interview clips in [VoxCeleb1](https://www.robots.ox.ac.uk/~vgg/data/voxceleb/vox1.html), 1,251 speakers from YouTube interviews. The server reads the dataset from the Hugging Face copy [`ProgramComputer/voxceleb`](https://huggingface.co/datasets/ProgramComputer/voxceleb), which is gated:

1. Open the dataset page while signed in to Hugging Face and accept its terms.
2. Sign in on the GPU machine, with a token that can read the dataset: `.venv/bin/hf auth login` (it stores the token in `HF_HOME`, or set `HF_TOKEN`).
3. Download the speaker list, 40 KB:

   ```sh
   .venv/bin/hf download ProgramComputer/voxceleb vox1/vox1_meta.csv --repo-type dataset --local-dir /data/voxceleb
   ```

That is enough: when a voice is built, the server reads only that speaker's clips from the dataset's archives with HTTP range requests, about 100 MB, and the build takes about two minutes. For a machine without internet access, download the two audio archives as well, 34 GB in all, and pass their folder as `VOXCELEB_DIR`:

```sh
.venv/bin/hf download ProgramComputer/voxceleb vox1/vox1_dev_wav.zip vox1/vox1_test_wav.zip \
    --repo-type dataset --local-dir /data/voxceleb
```

The speaker list names each speaker as `First_Last`, such as `Miles_Teller`; a voice's `speaker` (or `label`) matches it without regard to case, spaces or underscores. VoxCeleb1 is meant for research. Configure a voice only when its speaker allowed you to use their voice.

<a id="4-start-the-server"></a>
### 4. Start the server

```sh
SEED_VC_DIR=/path/to/seed-vc \
VOXCELEB_META=/data/voxceleb/vox1/vox1_meta.csv \
bash <bundle>/server/start-seed-vc.sh
```

| Variable | Meaning |
| --- | --- |
| `SEED_VC_DIR` | The Seed-VC checkout; required |
| `SEED_VC_PYTHON` | Its Python; default `$SEED_VC_DIR/.venv/bin/python` |
| `SEED_VC_PORT` | The port; default `8010` |
| `SEED_VC_GPU` | The GPU to use, as `CUDA_VISIBLE_DEVICES`; default unchanged |
| `VOXCELEB_META` | `vox1_meta.csv`; without it, voices cannot be built by name |
| `VOXCELEB_DIR` | The folder that holds `vox1_dev_wav.zip` and `vox1_test_wav.zip`; without it, the clips are read from Hugging Face |
| `VOICE_CACHE` | Where built voices are kept; default `~/.cache/dv-seed-vc/voices` |
| `HF_HOME`, `HF_HUB_OFFLINE` | The Hugging Face cache of the weights and the token, and offline mode |

The models load in about a minute. Then `curl http://<gpu host>:8010/health` answers `{"model": "seed-vc-v1-whisper-small-wavenet", "sample_rate": 22050}`. A conversion of a short line takes about 4 seconds at 50 steps. On a Slurm cluster, start it inside the GPU job, for example `srun --jobid=<job> --overlap -N1 -n1 env SEED_VC_DIR=... bash <bundle>/server/start-seed-vc.sh`.

The server has three routes, which `@fastvideo/dreamverse-seed-vc` calls:

| Route | Does |
| --- | --- |
| `GET /health` | Reports the model and the sample rate |
| `POST /v1/convert` | Converts `source` into the voice of `target` (both base64 data URIs) with `diffusion_steps` and `seed`, and answers a WAV |
| `POST /v1/voices/build` | Builds the target clip of the VoxCeleb1 speaker `name`, `seconds` long, and answers a WAV; 404 for an unknown name |

`server/build-voice-target.py` builds a target clip from your own recordings of a speaker instead: it joins the cleanest clips up to `--seconds`, for example `python build-voice-target.py --out narrator.wav --seconds 16 take1.wav take2.wav`.

<a id="5-switch-on-the-allowed-voices"></a>
### 5. Switch on the allowed voices

Add this row to the profile's own `cordis.patch.yml`, `$DSH_HOME/profiles/video-harness/cordis.patch.yml`, and restart the harness:

```yaml
- id: dv-seed-vc
  disabled: false
  config:
    baseUrl: http://gpu-host:8010
    diffusionSteps: 100
    voices:
      narrator:
        label: The Narrator
        target: /data/voices/narrator.wav
        note: Recorded by the narrator, who allowed its use for this project.
      sam-reed:
        label: Sam Reed
        note: Sam Reed allowed the use of their voice for this project.
```

`voices` is the whitelist: the Voice tab and the agent can convert only to these voices. A voice with `target` uses that clip, which must be readable by the harness; a voice without it is built by the server from VoxCeleb1, by `speaker` or else `label`, on its first conversion. [`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.md#use-this-package) lists every config field. Then open a project: the **Voice** tab is listed on the Start page, and the [`voice-acting` skill](../workflow-voice/skills/voice-acting/SKILL.md) tells the agent how to render a shot with a converted take.

<a id="6-publish-the-packages"></a>
### 6. Publish the packages

The bundle and its four plugins are published together to npm under the `@fastvideo` scope, from a checkout, after a build. In the checkout they run from `src/`; the published packages run the built `lib/`, which `publishConfig` selects. Once, create the organization `fastvideo` on npmjs.com and sign in with `npm login` as one of its members; then:

```sh
pnpm run build
pnpm --filter "@fastvideo/dreamverse-*" publish --access public
```

pnpm replaces the `workspace:` versions with the published ones; add `--registry <registry URL>` to publish to another registry, and set the same registry in the profile's `.npmrc` or in the `registry` of the plugin manager to install from it. Once published, `dsh plugin --profile video-harness add @fastvideo/dreamverse-voice-acting` installs it, and so does 安装 / Install in the Plugins tab of the entry page's 探索 / Explore section, which lists the packages of the DreamVerse plugin catalog `@dv/plugin-catalog`.

Without a registry, pack one tarball that carries the four plugins inside it as bundled dependencies, and share its file or a URL to it, such as a GitHub release asset. The script prints the tarball's path; the default destination is `dist/packs/` of the checkout:

```sh
pnpm run build
bash packages/dv/voice-acting/scripts/pack.sh /shared/packs
```

<a id="understand-the-implementation"></a>
## Understand the implementation

The bundle owns no code: `cordis.patch.yml` inserts the four plugins, with `dv-seed-vc` disabled because it needs a server URL and a whitelist that only the deployment knows; the profile patch, the last layer, switches it on. Each plugin declares the DreamVerse and harness packages it shares with the host as `peerDependencies`; the profile does not install peers, and the harness resolves them to the copies that `@dv/bundle` brings. The browser half of `@fastvideo/dreamverse-ui-voice-convert` is one prebuilt bundle, `lib/client.js`, that the harness serves to the web client.

The server, `server/seed-vc-server.py`, loads the Seed-VC v1 models once and runs Seed-VC's `inference.main` for each request, one at a time, with the request's seed, so the same seed, recording and voice give the same take. `server/voice_target.py` scores clips by the gap between their speech level and noise floor, keeps the interview that holds the cleanest clip, joins clips best first up to the requested length, and caches the result as `voxceleb1-<id>-<seconds>s.wav`.

<a id="further-exploration"></a>
## Further Exploration

- [`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.md): the config fields, the voice builds and the refusals.
- [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.md): the `voice.convert` operation and `dv_voice_convert`.
- [`@fastvideo/dreamverse-ui-voice-convert`](../ui-voice-convert/README.md): the Voice tab, the script format and the teleprompter keys.
- [Package and install a plugin](../../../docs/user/develop/basic/publish.md): bundles, profiles and `dsh plugin`.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dv_voice_convert` of `@fastvideo/dreamverse-voice-convert`, the voice entry of `@fastvideo/dreamverse-seed-vc` that `dv_models_get` shows, and the `voice-acting` skill of `@fastvideo/dreamverse-workflow-voice`; the bundle itself adds no model-visible text.

#### KV Cache effect

None of its own; the inserted plugins describe theirs.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The bundle needs a DreamVerse version whose asset pool reads audio durations, lists audio files, and whose Start page lists plugin tabs; with an older one, the Voice tab is reachable only from the right sidebar and audio assets have no duration.
- The plugins run only in a profile that stacks `@dv/bundle`, which provides their peer packages; they are not usable in another harness profile.
- The server converts one recording at a time; a second request waits for the first.
- Voices built by name come only from VoxCeleb1. A speaker who is not in it needs a target clip.
