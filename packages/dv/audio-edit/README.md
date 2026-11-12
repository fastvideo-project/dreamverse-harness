---
description: "Audio edit component of DreamVerse: the dvAudioEdit service and its two operations, audioedit.split (cut an audio asset into pieces at given times or at its longest pauses) and audioedit.speed (play it faster or slower without changing its pitch), with their agent tools."
kind: "package-reference"
---

# @dv/audio-edit

English | [中文](README.zh.md)

## Summary

Use this package to let the agent fit audio, such as generated narration, to the clips of a timeline. Its two operations, which `dvProject` turns into the agent tools `dv_audioedit_split` and `dv_audioedit_speed`, run ffmpeg through `dvFfmpeg`: `audioedit.split` cuts one audio asset into pieces at given times or at its longest pauses, and `audioedit.speed` plays it faster or slower without changing its pitch. Both write new WAV assets and leave the input unchanged. The component has no reducer. The interface shows the operations as 切分音频 / Split audio and 调整语速 / Change speed.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin after `@dv/project`, `@dv/ffmpeg`, and `@dv/asset-pool`.

```yaml
- id: dv-audio-edit
  name: '@dv/audio-edit'
  config:
    pauseDb: -35
    minPauseSec: 0.3
```

| Field | Default | Meaning |
| --- | --- | --- |
| `pauseDb` | `-35` | The level in dB below which `audioedit.split` hears a pause |
| `minPauseSec` | `0.3` | The shortest pause, in seconds, that `audioedit.split` can cut at |

| Operation | Tool | Inputs and params | Report |
| --- | --- | --- | --- |
| `audioedit.split` | `dv_audioedit_split` | input `audio`; either `pieces` (2 or more, cut at the longest pauses) or `at` (cut times in seconds after 0, increasing, at least 1 ms apart) | `{pieces: [{start_sec, end_sec, duration_sec}]}` |
| `audioedit.speed` | `dv_audioedit_speed` | input `audio`; either `speed` (0.5 to 100) or `duration_sec` (more than 0; the fitted factor must fall in the same range) | `{speed, duration_sec}` |

A call with neither or both of the two params, or with a value outside its range, is refused with `invalid_params` before any record is written. A call that the audio cannot satisfy fails its record with `operation_failed`: too few pauses for `pieces`, a cut at or after the end, an input that is not audio, an audio whose duration ffprobe cannot read, or an ffmpeg error. The first piece output has the role `piece`; the later pieces have the roles `output_1`, `output_2`, and so on. `audioedit.speed` is deterministic, so a repeated call with the same input and params reuses the earlier output; `audioedit.split` is not, because its cuts at pauses also depend on `pauseDb` and `minPauseSec`. The service methods `split(audio, cut, dir)` and `speed(audio, change, dir)` apply the same checks for other callers.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`split` reads the duration with ffprobe. With `pieces`, it runs ffmpeg's `silencedetect` filter on the first audio stream, keeps the pauses that start after 0 and end before the end, takes the longest `pieces − 1` of them, and cuts at their midpoints. All times are rounded to milliseconds. One ffmpeg command then writes every piece from the first audio stream as 16-bit PCM WAV. `speed` computes the factor from the input's duration when it is given `duration_sec`, applies ffmpeg's `atempo` filter, which keeps the pitch, and reads the result's duration with ffprobe for the report.

| File | Content |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `dvAudioEdit`: both operations and their service methods |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`@dv/project`](../project/README.md): operations, deterministic reuse, and agent tools.
- [`@dv/ffmpeg`](../ffmpeg/README.md): `run` and `probe`.
- [`@dv/asset-pool`](../asset-pool/README.md): the asset files this component reads and writes.
- [`@dv/timeline`](../timeline/README.md): `dv_timeline_sound_add` puts the pieces on a sound track.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

Two tools, `dv_audioedit_split` and `dv_audioedit_speed`, in the format `@dv/project` gives every operation tool. `dv_audioedit_split` says it cuts an audio asset into pieces that together cover it, such as one narration into one line per clip, and takes `pieces` or `at`. `dv_audioedit_speed` says it plays an audio asset faster or slower without changing its pitch, such as a narration line that runs longer than its clip, and takes `speed` or `duration_sec`. Both take the input `audio` and say that each result is a new WAV asset and "Runs on the CPU."; the description of `dv_audioedit_speed` ends with "Repeating a call with the same inputs and params reuses the earlier result."

#### Token effect

About 650 tokens for the two definitions with the shared arguments of `@dv/project`, fixed while the plugin is mounted. The figure is estimated from their size, about 1,250 characters each, not measured with a tokenizer.

#### KV Cache effect

The definitions sit in the stable tool section of every agent request; mounting or removing the plugin changes the tool list and invalidates the cached prefix from the tool section on.

### Tool results

#### What the model sees

A call returns one text block: `done <record>: ` with the summary (`split into 3 pieces`, `speed ×1.25`, or `fitted to 5 s`), one line per output with its role, asset ID, MIME type, and URL, the params, and the report: each piece's `start_sec`, `end_sec`, and `duration_sec` in the input, or the factor used and the result's `duration_sec`.

#### Token effect

About 120 tokens for a speed result, and about 100 tokens plus about 60 per piece for a split result, estimated from their size.

#### KV Cache effect

The result is appended to the conversation after the call; the cached prefix stays intact.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **New files only**: each call writes new WAV assets; neither operation trims or retimes a sound already on a timeline.
- **Pauses are found by level**: `audioedit.split` with `pieces` treats every stretch quieter than `pauseDb` for `minPauseSec` as a pause, so music or a noisy background under the voice can hide pauses; the agent then passes `at`.
- **First audio stream only**: a file with several audio streams is read and cut from its first one.
- **No skill uses the tools yet**: no workflow skill tells the agent when to split or retime narration.
- **No recorded session**: no e2e story or recorded-session snapshot drives `dv_audioedit_split` or `dv_audioedit_speed`, so their model-visible text is pinned only by the package's tests.
