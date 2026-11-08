---
name: voice-acting
description: "The procedure for a shot whose dialogue the user performs: the user's recording of the line, its conversion into an allowed voice with dv_voice_convert, the user's choice of take, and a shot that reuses the chosen take unchanged as its soundtrack. For requests such as 'use my recording as the character's voice', 'I'll voice this line myself' or 'make this line sound like <voice>'."
---

# Voice acting

The user performs a line; `dv_voice_convert` speaks the recording again in an allowed voice, keeping its words, timing and intonation; the shot reuses that clip unchanged as its soundtrack, so the character's lips follow the user's performance. The project block in your system prompt is the current state; read it before every call and pass `reason` wherever a tool requires it.

## When to use it

The user wants a character to say a line in a voice from the voice list, with the user's own delivery. Not for speech written from text alone (use `dv_audio_generate`), and not for music or sound effects.

## 1. The recording

- The line must exist as an audio asset of the project: the user records it in the Voice tab of the right Sidebar, or imports an audio file. If the project holds no such recording, ask the user to record one and wait; do not write speech yourself in its place.
- One recording per line and per character, at most 15 seconds, because one shot is 4 to 15 seconds. A longer line is split by the user into several recordings, one per shot, cut at pauses.
- A recording named `<script>-line-<NN>.wav` is line NN of a script the user recorded line by line in the Voice tab. A `dv_voice_convert` record that the user ran from the Voice tab carries the line's words in its `prompt`.
- Ask for the exact words of a recording whose words no record carries; you cannot hear it.

## 2. The voice

- `dv_models_list` with task `a2a` lists the voice models; `dv_models_get` lists each model's voices. Only those voices can be used.
- When the user asks for a voice that is not listed, say that it is not in the allowed list and offer the listed voices; do not imitate it with another tool or prompt.

## 3. The conversion

- Call `dv_voice_convert` with the model key, `voice`, `prompt` set to the exact words of the recording, and `inputs: {reference: <recording asset>}`.
- Make two or three takes (each call is a new take) and ask the user which one to keep; you cannot hear them. A kept take keeps its seed, so the same seed repeats it.
- The conversion runs in the background; a DreamVerse notice reports each take. A shot call may name a running take as `<record>#audio`; it then runs after the take.

## 4. The shot

- Render with a video model whose references take audio, such as `fasth3`. Load its prompt skill from `dv_models_list` before the first call, and follow it.
- Inputs: at least one image or video of the speaking character or the place (the model needs a picture), and the chosen take.
- `duration_sec`: the take's duration rounded up, at least 4.
- In the prompt, define the take as the complete dialogue track of the speaking character (`(S1)`), and mark it `fully_copy`:
  - `subject_definitions`: `<Audio n> is the complete spoken dialogue track of <character> (S1).`
  - `retention_analysis`: `<Audio n>: fully_copy - <Audio n> is reused 1:1 as the target video's complete final audio track, and the character's mouth movements follow its words and timing.`
  - `detailed_description`: the character speaks, lip-synced to `<Audio n>`, with `<d>[English] <the exact words></d>`.
  - `overall_soundscape`: `<Audio n> is directly reused as the complete audio track; no other sound is added.`
- Do not mark the take `reference` to change its sound: the model keeps the take's own performance anyway, and the marker only makes the result less predictable.
- A dialogue between two characters: one recording and one conversion per character, each `fully_copy` with its own speaker tag, at most three audio references per shot; or one shot per speaker.

## 5. Not available

- Changing the words, timing or emotion of a take: the user records the line again.
- Cutting or joining audio: the user records each shot's line as its own recording.
