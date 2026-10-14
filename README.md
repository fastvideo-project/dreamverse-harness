# DreamVerse Harness

English | [中文](README.zh.md)

<p align="center"><img src="packages/dreamverse-ui/kit/public/logo.svg" alt="DreamVerse logo" width="200"></p>

DreamVerse Harness is an agent harness for AI video production. You describe a video in a chat, and a video agent turns the request into characters, shot plans, rendered shots, and an edited timeline. Every change that you or the agent makes is a step in one project history, so you can review, undo, and redo the work of both.

The agent renders shots on a GPU video server that runs [FastVideo](https://github.com/hao-ai-lab/FastVideo) with FastH3 models. The harness runs the agent, stores each project, and serves the web interface where you chat, arrange assets on a canvas, and edit the timeline.

DreamVerse Harness is a research prototype. **Expect compatibility-breaking changes.** Review the [safety notice](SAFETY.md) before you run the project.

## Features

- **Video agent in a chat.** The agent follows the `video-directing` skill: it writes the story bible and a shot plan, asks you to confirm the plan, renders the approved shots, and assembles them into a timeline. Renders whose estimated GPU time exceeds a set limit wait for your request in the chat.
- **Two render modes.** `ref2va` renders a shot from a prompt, one or more reference images, and an optional first frame; a shot can continue from the last still of the previous shot. `t2va` renders a shot from a prompt only. Both modes return a video with audio and its last still.
- **Story bible.** Characters, locations, and styles are versioned entries that shot plans reference.
- **Shot plans.** A plan lists shots with their render mode, prompt, references, and duration. Approving a plan version renders only the new or changed shots and reuses the takes of unchanged shots.
- **Project canvas.** The canvas shows assets and story-bible entries as cards. From a card, you can render a new take of a shot or replace a reference image.
- **Timeline editor.** Insert, move, split, trim, and replace clips, and export a timeline to one video file with ffmpeg.
- **Asset pool.** Import images and videos, grab stills from videos, and mention any asset or project item in a chat message with `@`.
- **One history for you and the agent.** The History panel lists every step in time order. Undo (Ctrl+Z), redo (Shift+Ctrl+Z), and "go back to a step" work the same for your edits and the agent's edits.
- **Projects and chat sessions.** The navigator lists projects and the chat sessions of each project; the entry page shows recent projects and templates.
- **MCP tools.** With the MCP plugin on, the Explore section offers preset Blender and ComfyUI MCP servers that you can add in one step.

## Run

### Prerequisites

- Node.js `^22.19` or `>=24`, and `pnpm`.
- `ffmpeg` and `ffprobe`.
- A GPU video server: FastVideo with the `streaming_v2` API, serving `MiniMaxAI/MiniMax-H3` for `ref2va`. The configuration in [`scripts/dreamverse/h3-ref2va.serve.yaml`](scripts/dreamverse/h3-ref2va.serve.yaml) uses 4 GPUs. A second server with `FastVideo/FastVideo-FastH3-8-Step-V2` enables `t2va`.
- An OpenAI-compatible chat model endpoint for the agent, such as an SGLang server that serves DeepSeek V4.1, or a Groq API key.

### Start the video server

On the GPU machine, start FastVideo with the DreamVerse server configuration. The server listens on `127.0.0.1:8029`.

```sh
fastvideo serve --config scripts/dreamverse/h3-ref2va.serve.yaml
```

[`scripts/dreamverse/launch-generation.sh`](scripts/dreamverse/launch-generation.sh) runs the same command with the FastVideo checkout and ffmpeg paths of the development cluster.

<a id="run-from-source"></a>

### Start DreamVerse

The repository is private, so cloning it requires a GitHub account with access to `Davids048/dreamverse-harness`. Build the repository, point the harness at the video server and the agent model, and start the web interface:

```sh
git clone https://github.com/Davids048/dreamverse-harness.git
cd dreamverse-harness
pnpm install
pnpm run build

export DV_BACKEND_URL=http://127.0.0.1:8029
export DV_DEEPSEEK_BASE_URL=http://<sglang host>:30000/v1
export DV_FFMPEG="$(command -v ffmpeg)"

scripts/video-harness/launch.sh web
```

[`scripts/video-harness/launch.sh`](scripts/video-harness/launch.sh) creates the `video-harness` profile under `DSH_HOME` (default `~/.local/state/dsh-video-harness`) and starts the web interface on port `8092`. Open the URL that the command prints. To reach the page from another machine, add `--trusted-host <public host>`.

To run one task without the web interface and print the result, use the headless profile:

```sh
scripts/video-harness/launch.sh headless "Make a video of this person dancing" --session-id demo
```

### Configuration

The launch script and the [`@dv/bundle` configuration](packages/bundle/dv/cordis.patch.yml) read these environment variables:

| Variable                                                     | Purpose                                                                                                         | Default                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `DV_BACKEND_URL`                                             | FastVideo server for the `ref2va` render mode.                                                                  | `http://127.0.0.1:8029`                                     |
| `DV_T2VA_BACKEND_URL`                                        | FastVideo server for the `t2va` render mode. If you leave it unset, the agent has no `t2va` render tool.        | unset                                                       |
| `DV_PORT`                                                    | Port of the web interface.                                                                                      | `8092`                                                      |
| `DV_STATE_ROOT`                                              | Directory for assets, projects, chat session bindings, and view state.                                          | `~/.local/state/dv`                                         |
| `DV_FFMPEG`, `DV_FFPROBE`                                    | Paths of the media binaries.                                                                                    | a development-cluster ffmpeg path, `ffprobe`                |
| `DV_PUBLIC_URL`                                              | Public origin for asset links in chat cards.                                                                    | empty                                                       |
| `DV_AGENT_PROVIDER`, `DV_AGENT_MODEL`, `DV_AGENT_REASONING`  | Model route of the agent. Set `groq` and `qwen/qwen3.8-27b` to use Groq.                                        | `deepseek-local`, `deepseek-v4.1`, `low`                    |
| `DV_DEEPSEEK_BASE_URL`, `DV_DEEPSEEK_API_KEY`                | OpenAI-compatible endpoint and bearer token of the `deepseek-local` route.                                      | a development-cluster address, `none`                       |
| `DV_AGENT_VISION`                                            | Set `0` when the agent model cannot read images.                                                                | image input on                                              |
| `GROQ_API_KEY`                                               | Key of the Groq route. The launch script reads it from `DV_ENV_FILE`.                                           | unset                                                       |

The [`@dv/bundle` README](packages/bundle/dv/README.md) describes each variable in detail.

## Architecture

DreamVerse Harness is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), an agent harness in which every capability is a [Cordis](https://github.com/cordiverse/cordis) plugin. The DeepSeek Harness core supplies the agent loop, chat sessions, skills, tools, the model providers, and the web client. The DreamVerse packages under [`packages/dv/`](packages/dv) add video production as plugins, and the [`@dv/bundle`](packages/bundle/dv/README.md) profile layer composes them on top of the core.

```text
views          @dv/ui-shell  @dv/ui-canvas  @dv/ui-timeline  @dv/ui-asset-pool  @dv/ui-composer  @dv/ui-history
  │ HTTP: /api/dv/…, /dv/events
  ▼
API            @dv/api              routes that read project state and run operations as the user
  │
  ▼
registry       @dv/project          operation records, history, undo and redo, agent tools
  ▲
  │ registerOperation
components     @dv/asset-pool  @dv/story-bible  @dv/shot-plan  @dv/shot-render
               @dv/timeline  @dv/inspector  @dv/chat-references
  │ ctx.dvRef2va, ctx.dvT2va
  ▼
render modes   @dv/render-modes     one Service Definition per render mode
  ▲
  │ implements
providers      @dv/fasth3-ref2va  @dv/fasth3-t2va      HTTP clients of the FastVideo server
```

- **`@dv/project` owns every project change.** Each component registers its operations with `@dv/project`. Every operation is both an agent tool (`dv_<operation>`) and an action of the web interface, and every call becomes one record in the project's `records.jsonl` file. The project state, the History panel, and undo and redo all derive from these records.
- **Each render mode is a capability seam.** `@dv/render-modes` defines the renderer services, the FastH3 packages implement them against a FastVideo server, and `@dv/shot-render` registers a render tool only for the modes that the deployment serves. A different video model needs only a different provider package.
- **The views read and write through `@dv/api`.** The canvas, timeline, and History panel run operations through HTTP routes and refresh from the `/dv/events` stream, so the agent's edits appear in the views as the agent makes them.

A request flows through the system in these steps:

1. You send a chat message. `@dv/chat-references` resolves the assets and project items that the message mentions.
2. The agent writes story-bible entries and a shot plan with `dv_bible_*` and `dv_plan_create` tools, and asks you to confirm the plan.
3. After you confirm, `dv_plan_approve` schedules one render per new or changed shot and a timeline update.
4. Each render calls the FastVideo server and stores the take: the video and its last still.
5. `@dv/api` pushes the change on `/dv/events`, and the canvas, timeline, and History panel show the new state.

The [DreamVerse packages page](docs/subsystems/video-harness.md) defines the operation record, the history rules, confirmation, and the full glossary.

## Repository layout

| Path                                                 | Contents                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`packages/dv/`](packages/dv)                        | DreamVerse components, render modes, providers, API, and interface plugins.      |
| [`packages/bundle/dv/`](packages/bundle/dv)          | The `@dv/bundle` profile layer and the `video-directing` skill.                  |
| [`scripts/video-harness/`](scripts/video-harness)    | Profile setup and launch scripts.                                                |
| [`scripts/dreamverse/`](scripts/dreamverse)          | The FastVideo server configuration and launch script.                            |
| `packages/dreamverse/`, `packages/dreamverse-ui/`    | The earlier DreamVerse prototype with a fixed rendering workflow.                |
| Other `packages/` groups, `apps/`, `vendor/`         | The DeepSeek Harness core, applications, and vendored Cordis.                    |

## Development

The DeepSeek Harness [development guide](docs/development.md) and [architecture documentation](docs/architecture.md) apply to this repository. For agents, follow [AGENTS.md](AGENTS.md). See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules.

## License

[MIT](LICENSE). DreamVerse Harness is built on DeepSeek Harness, which is MIT-licensed by DeepSeek.

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
