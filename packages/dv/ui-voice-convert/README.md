---
description: "Browser half of DreamVerse voice conversion: the Voice right-Sidebar tab, which records a spoken line with the browser microphone into the asset pool and converts a recording into an allowed voice with voice.convert, and the voice.convert records as voice takes on the canvas, declared with defineGenerationUi."
kind: "package-reference"
---

# @fastvideo/dreamverse-ui-voice-convert

English | [中文](README.zh.md)

## Summary

Use this package to let the user perform a character's lines in the web application. The 配音 / Voice tab of the right Sidebar shows a loaded script one line at a time, large, records each line with the browser microphone, keeps it as an audio asset of the open project, and converts a recording into a voice of an `a2a` model with one `voice.convert` run of [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.md). The converted takes are voice nodes on the canvas, with a take editor whose voice chip lists the model's voices.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin with `@fastvideo/dreamverse-voice-convert` and a provider of task `a2a`; the DreamVerse bundle does not mount it.

```yaml
- id: dv-ui-voice-convert
  name: '@fastvideo/dreamverse-ui-voice-convert'
```

| Gesture | Request or event |
| --- | --- |
| 载入剧本 / Load script, then a `.txt` or `.md` file | `POST /api/dv/assets/import` of the file as `text/plain` (a browser gives Markdown no media type), and the script becomes the chosen one; the 剧本 / Script menu lists the project's `text/plain` and `text/markdown` assets |
| The teleprompter | The chosen script's text (`GET /dv/assets/<AssetId>`) parsed by `parseScript`: `NAME: words` lines, screenplay blocks (a speaker in capitals, the words below it up to a blank line or the next speaker), and other lines without a speaker; parenthesized or bracketed lines, scene headings (`INT.`, `EXT.`), and inside a block the lines with a word in capitals among lowercase words (action such as `Fletcher SLAPS him.`) are skipped, and in a script that names any speaker, lines without one are action too. The current line shows large with its speaker, its position (`Line 3 / 12`) and ✓ when it has a take, above the list of all lines |
| 录制这一句 / Record line, 停止 / Stop, 重录 / Retake, 保存这条 / Keep take; Space, Enter, ← and → while the teleprompter has focus | Keep imports the take as `<script stem>-line-<NN>.wav` with `surface=asset_pool`, reads the state again, chooses the take and its words in the convert form, and moves to the next line |
| 开始录音 / Record, then 停止 / Stop | The browser asks for the microphone; the recording is decoded and kept in the tab as mono 16-bit WAV, named `line-<YYYYMMDD-HHMMSS>.wav`, with a player |
| 保存录音 / Keep recording | `POST /api/dv/assets/import` with `surface=asset_pool` and the tab's chat session; the new asset becomes the chosen recording |
| 丢弃 / Discard | The recording is dropped; nothing is written |
| 转换 / Convert | `POST /api/dv/operation` with `voice.convert`, `surface: 'asset_pool'`, the chosen recording as input `reference`, the chosen voice's model key and `voice`, and the trimmed words of the line as `prompt` |

Choosing a line's take in the recording menu fills its words. The recording menu lists the project's audio assets, newest first; the voice menu lists the voices of every `a2a` model of `GET /api/dv/models`. Without such a model the tab says that no voice model is available, and without a recording it asks for one before it converts. A refused or failed request shows its message as an alert. The browser offers the microphone only to a secure origin, such as `http://127.0.0.1` through an SSH tunnel.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The client plugin registers the `dv-voice` tab type with the right-Sidebar tab registry and its body in the slot `sidebar.right.pane.tab` under the key `@fastvideo/dreamverse-ui-voice-convert`; the body draws `VoicePanel` for the project that `useCurrentProject` names. One `defineGenerationUi` declaration claims `voice.convert` records as the node type `voice` (palette slot `var(--dv-node-6)`, body height 72) and registers its card, take editor, retry action, chat card, History row and parameter bar. The bar's chip menu lists the voices of the selected model's `schema()`, and its `@` filter offers one audio recording. `browserRecorder` records with `MediaRecorder`, decodes with an `AudioContext`, mixes the channels to one and encodes 16-bit PCM WAV with `encodeWav`, so the asset pool reads the recording's duration.

| File | Content |
| --- | --- |
| [`src/client/index.ts`](src/client/index.ts) | The tab type, its body and the voice takes |
| [`src/client/VoicePanel.tsx`](src/client/VoicePanel.tsx) | The Voice panel and the browser microphone |
| [`src/client/voice-bar.ts`](src/client/voice-bar.ts) | The parameter bar of `voice.convert` |
| [`src/client/wav.ts`](src/client/wav.ts) | Mono mixing and WAV encoding |
| [`src/client/ScriptPanel.tsx`](src/client/ScriptPanel.tsx) | The script teleprompter |
| [`src/client/script.ts`](src/client/script.ts) | Script parsing and the file names of line takes |
| [`src/client/useTake.ts`](src/client/useTake.ts) | One microphone take at a time, shared by the teleprompter and the single-line recorder |
| [`tests/script.client.spec.tsx`](tests/script.client.spec.tsx) | Script parsing, take names, and the teleprompter's gestures and keys |
| [`tests/voice.client.spec.tsx`](tests/voice.client.spec.tsx) | WAV encoding, the bar, and the panel's gestures against a scripted API and a fake microphone |
| [`tests/plugin.client.spec.tsx`](tests/plugin.client.spec.tsx) | The registrations under the slot runtime and their removal, and the browser microphone with stubbed browser APIs |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@fastvideo/dreamverse-voice-convert`](../voice-convert/README.md): the operation that the tab runs.
- [`@dv/ui-generation`](../ui-generation/README.md): the generation kit that draws the voice takes.
- [`@dv/ui-asset-pool`](../ui-asset-pool/README.md): the asset pool panel, which lists the recordings and takes under 音频 / Audio.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `@dv/project`; the `asset.import` and `voice.convert` records that the Voice tab and the voice takes write reach the model only through the project state and update messages and the `dv_proj_*` and operation tools of [`@dv/project`](../project/README.md).

#### KV Cache effect

None; the package sends nothing to a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No trimming**: the tab keeps the whole recording; a line is recorded again rather than cut.
- **The agent cannot read a script**: no tool reads a text asset's content, so the agent learns a line's words from the `voice.convert` records the tab writes, or from the user.
