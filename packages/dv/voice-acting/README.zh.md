---
description: "可安装的 DreamVerse 配音套件：把它装进 DreamVerse profile，部署它附带的 Seed-VC 服务器和可用来构建音色的 VoxCeleb1 说话人列表，再开启允许的音色。"
kind: "package-bundle"
---

# @fastvideo/dreamverse-voice-acting

[English](README.md) | 中文

## 概要

使用本套件为 DreamVerse 加入配音：你在「配音」标签页里录下自己的台词，用 [Seed-VC](https://github.com/Plachtaa/seed-vc) 把每条录音转换成允许的音色，再渲染与转换后录音口型同步的镜头。把它装进 DreamVerse profile 会插入四个插件：[`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.zh.md)（`voice.convert` 操作及其工具）、[`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.zh.md)（模型，配置之前保持关闭）、[`@fastvideo/dreamverse-ui-voice-convert`](../ui-voice-convert/README.zh.md)（配音标签页和剧本提词器）和 [`@fastvideo/dreamverse-workflow-voice`](../workflow-voice/README.zh.md)（`voice-acting` 技能）。本包还在 `server/` 中附带 Seed-VC 服务器，它运行在带 NVIDIA GPU 的机器上。

## 目录

- [使用本包](#use-this-package)
  - [1. 安装套件](#1-install-the-bundle)
  - [2. 部署 Seed-VC 服务器](#2-set-up-the-seed-vc-server)
  - [3. 下载 VoxCeleb1 说话人列表](#3-download-the-voxceleb1-speaker-list)
  - [4. 启动服务器](#4-start-the-server)
  - [5. 开启允许的音色](#5-switch-on-the-allowed-voices)
  - [6. 发布这些包](#6-publish-the-packages)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

你需要一个叠加了 [`@dv/bundle`](../../bundle/dv/README.zh.md) 的 DreamVerse profile，以及一台带 NVIDIA GPU、约 3 GB 空闲显存和 Python 3.10 或更高版本的机器来运行 Seed-VC 服务器。harness 必须能通过 HTTP 访问这台机器。

<a id="1-install-the-bundle"></a>
### 1. 安装套件

从发布它的 registry，或从[第 6 步](#6-publish-the-packages)打包的自包含 tarball（用绝对路径或 URL）把套件装进 DreamVerse profile：

```sh
dsh plugin --profile video-harness add @fastvideo/dreamverse-voice-acting
dsh plugin --profile video-harness add /shared/packs/fastvideo-dreamverse-voice-acting-0.1.0.tgz
```

在源码检出中，用 `node --import tsx/esm apps/cli/src/bin.ts` 代替 `dsh`。Web 侧边栏的 **插件** 页面也能安装同样的 spec。安装会把套件加入 profile 的套件列表，四个插件在下次启动时加载。`dsh plugin --profile video-harness remove @fastvideo/dreamverse-voice-acting` 会再次移除它们。

这些插件从正在运行的 harness 取用共享的 DreamVerse 和 harness 包，例如 `@dv/generation` 和 `@dv/models`，所以 profile 必须叠加 `@dv/bundle`。安装时 pnpm 会对这些 peer 依赖给出警告；这些警告是预期的。

<a id="2-set-up-the-seed-vc-server"></a>
### 2. 部署 Seed-VC 服务器

在 GPU 机器上做一次即可。服务器运行 Seed-VC 自己的推理代码，因此需要一份 Seed-VC 检出及其 Python 环境。本套件用 Seed-VC 提交 `51383ef`、Python 3.11、PyTorch 2.11 和 CUDA 12.8 测试过。

```sh
git clone https://github.com/Plachtaa/seed-vc.git
cd seed-vc && git checkout 51383ef
python3 -m venv .venv
.venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install -r <bundle>/server/requirements.txt
```

`<bundle>` 是已安装的包目录 `<profile>/node_modules/@fastvideo/dreamverse-voice-acting`，在源码检出中是 `packages/dv/voice-acting`。请安装与你的 CUDA 版本对应的 PyTorch；Seed-VC 的 `requirements.txt` 固定了较旧的 PyTorch，如有冲突可以把它从文件中删掉。

首次启动会从 Hugging Face 下载模型权重：`Plachta/Seed-VC`（v1 检查点 `DiT_seed_v2_uvit_whisper_small_wavenet_bigvgan_pruned.pth`）、`openai/whisper-small`、`nvidia/bigvgan_v2_22khz_80band_256x` 和 `funasr/campplus`，约 1.5 GB。Seed-VC 把自己的检查点放在 `seed-vc/checkpoints`，其余放在 Hugging Face 缓存（`HF_HOME`）中。如果 GPU 机器无法访问互联网，先在能联网的地方用同一个 `HF_HOME` 启动一次服务器，之后设置 `HF_HUB_OFFLINE=1`。

<a id="3-download-the-voxceleb1-speaker-list"></a>
### 3. 下载 VoxCeleb1 说话人列表

如果每个允许的音色都有自己的目标音频，可以跳过这一步。有了它，音色可以只用名字配置，服务器用 [VoxCeleb1](https://www.robots.ox.ac.uk/~vgg/data/voxceleb/vox1.html)（来自 YouTube 访谈的 1,251 位说话人）中该说话人的访谈音频构建目标音频。服务器从 Hugging Face 上的副本 [`ProgramComputer/voxceleb`](https://huggingface.co/datasets/ProgramComputer/voxceleb) 读取数据集，该数据集需要申请访问：

1. 登录 Hugging Face 后打开数据集页面并接受其条款。
2. 在 GPU 机器上用能读取该数据集的 token 登录：`.venv/bin/hf auth login`（token 保存在 `HF_HOME` 中，或设置 `HF_TOKEN`）。
3. 下载说话人列表，40 KB：

   ```sh
   .venv/bin/hf download ProgramComputer/voxceleb vox1/vox1_meta.csv --repo-type dataset --local-dir /data/voxceleb
   ```

这样就够了：构建音色时，服务器用 HTTP 范围请求只从数据集压缩包中读取该说话人的音频，约 100 MB，构建约需两分钟。对于无法联网的机器，再下载两个音频压缩包，共 34 GB，并把它们所在的目录设为 `VOXCELEB_DIR`：

```sh
.venv/bin/hf download ProgramComputer/voxceleb vox1/vox1_dev_wav.zip vox1/vox1_test_wav.zip \
    --repo-type dataset --local-dir /data/voxceleb
```

说话人列表把每位说话人写作 `First_Last`，例如 `Miles_Teller`；音色的 `speaker`（或 `label`）与它匹配时不区分大小写、空格和下划线。VoxCeleb1 用于研究。只有在说话人允许你使用其声音时才配置该音色。

<a id="4-start-the-server"></a>
### 4. 启动服务器

```sh
SEED_VC_DIR=/path/to/seed-vc \
VOXCELEB_META=/data/voxceleb/vox1/vox1_meta.csv \
bash <bundle>/server/start-seed-vc.sh
```

| 变量 | 含义 |
| --- | --- |
| `SEED_VC_DIR` | Seed-VC 检出目录；必填 |
| `SEED_VC_PYTHON` | 它的 Python；默认 `$SEED_VC_DIR/.venv/bin/python` |
| `SEED_VC_PORT` | 端口；默认 `8010` |
| `SEED_VC_GPU` | 使用的 GPU，作为 `CUDA_VISIBLE_DEVICES`；默认不改动 |
| `VOXCELEB_META` | `vox1_meta.csv`；没有它就不能按名字构建音色 |
| `VOXCELEB_DIR` | 存放 `vox1_dev_wav.zip` 和 `vox1_test_wav.zip` 的目录；没有它就从 Hugging Face 读取音频 |
| `VOICE_CACHE` | 已构建音色的存放位置；默认 `~/.cache/dv-seed-vc/voices` |
| `HF_HOME`、`HF_HUB_OFFLINE` | 权重和 token 所在的 Hugging Face 缓存，以及离线模式 |

模型约一分钟加载完毕。之后 `curl http://<gpu host>:8010/health` 返回 `{"model": "seed-vc-v1-whisper-small-wavenet", "sample_rate": 22050}`。50 步转换一句短台词约需 4 秒。在 Slurm 集群上，请在 GPU 作业内启动，例如 `srun --jobid=<job> --overlap -N1 -n1 env SEED_VC_DIR=... bash <bundle>/server/start-seed-vc.sh`。

服务器有三个路由，由 `@fastvideo/dreamverse-seed-vc` 调用：

| 路由 | 作用 |
| --- | --- |
| `GET /health` | 报告模型和采样率 |
| `POST /v1/convert` | 用 `diffusion_steps` 和 `seed` 把 `source` 转换成 `target` 的音色（二者都是 base64 data URI），返回 WAV |
| `POST /v1/voices/build` | 构建 VoxCeleb1 说话人 `name` 的目标音频，长 `seconds` 秒，返回 WAV；名字未知时返回 404 |

`server/build-voice-target.py` 则用你自己录制的某位说话人的音频构建目标音频：它把最干净的片段拼接到 `--seconds` 秒，例如 `python build-voice-target.py --out narrator.wav --seconds 16 take1.wav take2.wav`。

<a id="5-switch-on-the-allowed-voices"></a>
### 5. 开启允许的音色

把下面这一行加到 profile 自己的 `cordis.patch.yml`（`$DSH_HOME/profiles/video-harness/cordis.patch.yml`），然后重启 harness：

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

`voices` 是白名单：配音标签页和智能体只能转换为这些音色。带 `target` 的音色使用该音频，harness 必须能读取它；没有 `target` 的音色在首次转换时由服务器按 `speaker`（否则按 `label`）从 VoxCeleb1 构建。[`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.zh.md#use-this-package) 列出全部配置字段。然后打开一个项目：开始页会列出 **配音** 标签页，[`voice-acting` 技能](../workflow-voice/skills/voice-acting/SKILL.md) 告诉智能体如何用转换后的录音渲染镜头。

<a id="6-publish-the-packages"></a>
### 6. 发布这些包

套件和它的四个插件在构建之后从源码检出一起以 `@fastvideo` scope 发布到 npm。在检出中它们从 `src/` 运行；发布的包运行构建出的 `lib/`，由 `publishConfig` 选择。先做一次：在 npmjs.com 上创建组织 `fastvideo`，并以其成员身份用 `npm login` 登录；然后：

```sh
pnpm run build
pnpm --filter "@fastvideo/dreamverse-*" publish --access public
```

pnpm 会把 `workspace:` 版本替换为发布的版本；加上 `--registry <registry URL>` 可以发布到其他 registry，要从那里安装，请在 profile 的 `.npmrc` 或插件管理器的 `registry` 中设置同一个 registry。发布之后，`dsh plugin --profile video-harness add @fastvideo/dreamverse-voice-acting` 可以安装它，首页 探索 区 插件 标签里的 安装 也可以；该标签列出 DreamVerse 插件目录 `@dv/plugin-catalog` 中的包。

没有 registry 时，打包一个把四个插件作为 bundled dependencies 装在里面的 tarball，再共享这个文件或它的 URL，例如 GitHub release 的附件。脚本会打印 tarball 的路径；默认目标是检出中的 `dist/packs/`：

```sh
pnpm run build
bash packages/dv/voice-acting/scripts/pack.sh /shared/packs
```

<a id="understand-the-implementation"></a>
## 理解实现

套件本身没有代码：`cordis.patch.yml` 插入四个插件，其中 `dv-seed-vc` 是关闭的，因为它需要只有部署方才知道的服务器 URL 和白名单；profile 补丁作为最后一层把它开启。每个插件把与宿主共享的 DreamVerse 和 harness 包声明为 `peerDependencies`；profile 不安装 peer，harness 把它们解析到 `@dv/bundle` 带来的副本。`@fastvideo/dreamverse-ui-voice-convert` 的浏览器部分是一个预构建的包 `lib/client.js`，由 harness 提供给 Web 客户端。

服务器 `server/seed-vc-server.py` 只加载一次 Seed-VC v1 模型，并对每个请求依次运行 Seed-VC 的 `inference.main`，使用请求中的种子，因此相同的种子、录音和音色会得到相同的结果。`server/voice_target.py` 按语音电平与底噪之差给音频打分，保留最干净片段所在的那场访谈，按质量从高到低拼接到所需长度，并把结果缓存为 `voxceleb1-<id>-<seconds>s.wav`。

<a id="further-exploration"></a>
## 延伸阅读

- [`@fastvideo/dreamverse-seed-vc`](../seed-vc/README.zh.md)：配置字段、音色构建和拒绝情形。
- [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.zh.md)：`voice.convert` 操作和 `dv_voice_convert`。
- [`@fastvideo/dreamverse-ui-voice-convert`](../ui-voice-convert/README.zh.md)：配音标签页、剧本格式和提词器按键。
- [打包并安装插件](../../../docs/user/develop/basic/publish.zh.md)：套件、profile 和 `dsh plugin`。

<a id="model-experience"></a>
## 模型体验

间接地，通过 `@fastvideo/dreamverse-voice-convert` 的 `dv_voice_convert`、`dv_models_get` 显示的 `@fastvideo/dreamverse-seed-vc` 音色条目，以及 `@fastvideo/dreamverse-workflow-voice` 的 `voice-acting` 技能；套件本身不添加模型可见的文本。

#### KV Cache 影响

自身没有；插入的插件各自说明。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 套件需要这样的 DreamVerse 版本：资源池能读取音频时长、列出音频文件，开始页列出插件标签页；在更旧的版本中，配音标签页只能从右侧边栏打开，音频资源没有时长。
- 这些插件只能在叠加了 `@dv/bundle` 的 profile 中运行，它提供插件的 peer 包；在其他 harness profile 中无法使用。
- 服务器一次转换一段录音；第二个请求会等待第一个完成。
- 按名字构建的音色只来自 VoxCeleb1。不在其中的说话人需要目标音频。
