---
name: documentary-making
description: "The procedure for a short narrated documentary, shots under one narrator: a script in sections, the narration as one clip cut at its pauses, a storyboard whose shot lengths follow the spoken lines, the user's agreement before each render, the narration on a sound track of the timeline, and the export."
whenToUse: "The user wants a documentary, an explainer or a narrated film about a real subject, such as a nature, science, history or how-it-works film."
---

# Documentary making

A documentary here is a row of shots with their own ambient sound and one narrator over them. The narration sets the length of every section, so write and render it before the shots. The project block in your system prompt is the current state; read it before every call, pass `reason` wherever a tool requires it, and pass `base_version` to every `dv_textnode_write` and `dv_textnode_edit`: `0` for a new path, else the newest `version` you saw.

## 1. Brief

When the project block names no project, call `dv_proj_create` with `title`. Take from the user's message the subject, the length, the language of the narration and the aspect ratio; use 3 minutes, the user's language and 16:9 for any the message leaves out, and say which you assumed. Ask nothing here.

## 2. Script (first stop)

Write `doc/script.md` with `dv_textnode_write`:

- One line: subject, length, language, aspect ratio, and the look in one sentence (light, lens, color, pace), which every shot prompt repeats word for word.
- A table with one row per section, 5 to 8 sections for 3 minutes: section number, the narration line, its word count, its seconds, and what the pictures show. Count 2.2 English words or 4 Chinese characters a second; a calm narrator reads slower than speech. A line is 1 to 3 sentences, ends with a full stop, and has no list and no bracket. The lines together take 60% to 75% of the film's length; the rest is picture and ambient sound.
- The first line makes the viewer want the answer; the last line closes the film. No line repeats what the picture already shows.
- Write only facts you are sure of: no invented number, name, date or quote. Under the table, list each claim the user should check.

Point the user to `doc/script.md` and end the turn with one question in bold, such as **Record this narration?** Generate nothing before the user agrees. On a change request, change the node with `dv_textnode_edit` and ask again.

## 3. Narration

Read `doc/script.md` with `dv_textnode_read` first; the user can edit it.

If `dv_audio_generate` is in your tool list, load the prompt skill of its speech model and render every line as one clip, each line its own paragraph, with `modality: audio`, `task: t2a`, `provider`, `model` and `prompt`; otherwise tell the user that this project has no speech model, ask for a recorded narration file, and stop.

The speech model picks the voice of each clip, so one clip keeps one narrator. When the lines are longer than one clip can hold (the prompt skill gives the limit), render two clips, break between two sections, and tell the user that the two halves may not share one voice.

If `dv_audioedit_split` is in your tool list, call it with `inputs.audio` = the narration clip and `pieces` = the number of lines in that clip; the result lists the pieces in time order, each with its duration. Without that tool, keep the clip whole and place it once in step 6.

Compare each piece's duration with its line's seconds in the script. When a piece is more than 40% off, the cut fell inside a line: say which pieces, and ask the user to listen before going on. You cannot hear the clip.

## 4. Storyboard (second stop)

If `dv_models_list` is in your tool list, call it with task `t2v`. When it lists no model, every shot is task `ref2v` and needs a reference picture: ask the user for one per section, or make them with this project's image model when it has one, before you write the storyboard.

If `dv_models_get` is in your tool list, call it for the chosen video model and task, and use only the durations and aspect ratios it lists; otherwise use 5 or 10 s.

Write `doc/storyboard.md` with `dv_textnode_write` and `from: [doc/script.md]`:

- Per section, shots whose lengths add up to at least the section's narration piece plus 2 s, and at most 6 s more than that. Prefer shots of 5 to 10 s.
- A table of the shots (shot, section, duration, scale, subject and action, camera), then each shot's model key (`modality`, `task`, `provider`, `model`), its prompt and its `duration_sec`.
- Neighboring shots differ in scale: wide, medium, close, macro. Each shot has one subject, one action that takes the whole shot, and one slow camera move or none.
- Every prompt ends with the look sentence and this line: natural ambient sound only, no music, no voice, no text on screen. Load the prompt skill of the video model and task, and follow it.
- No person on screen unless the user asked for one. A person or a place that returns in several shots needs a reference: load the skill of that reference kind, create it first, and render those shots with task `ref2v`.

Reply with the number of shots, the total length and the link of the narration clip, ask the user to listen to it, and end the turn with one question in bold, such as **Render these 18 shots?** Generate nothing before the user agrees.

## 5. Render the shots

Read `doc/storyboard.md` with `dv_textnode_read` and render from it. Call `dv_shot_render` once per shot in order, with `modality`, `task`, `provider`, `model`, `prompt`, `duration_sec` and `aspect_ratio`, and `inputs.reference` for task `ref2v`. Fix any value a refusal names and call again. Then call `dv_proj_wait` and `dv_proj_state`.

If `dv_asset_grab_still` is in your tool list, grab the middle frame of each shot (`inputs.video` = the shot's asset, `at` = half its length) and look at it: text, a logo, a person nobody asked for, or a subject that is not the one in the prompt makes the shot a retake. List the retakes with the reason, and render them with `based_on` = the first render after the user agrees.

## 6. Timeline and narration

1. `dv_timeline_create` with `inputs.clip` = output #0 of each shot's render, in storyboard order, and a `name`. Pass a new `timeline` ID when the project already has a timeline.
2. Call `dv_proj_state` and read each clip's `start_sec`. A section starts where its first shot starts.
3. If `dv_audioedit_speed` is in your tool list and a piece is longer than its section minus 1.5 s by at most 15% of the piece, call it with `inputs.audio` = the piece and `duration_sec` = that length, and use its output. Otherwise, for a long piece, place the next piece later and say so.
4. Per narration piece, `dv_timeline_sound_add` with `timeline`, `asset` = the piece, `start_sec` = its section's start plus 1, and `track: 0`. A clip kept whole goes once at 1 s.

When the user gave a music file, add it with `dv_timeline_sound_add` on `track: 1` at `start_sec: 0`, then `dv_timeline_volume` with `target: sound`, `track: 1`, `volume_db: -15`.

## 7. Deliver

`dv_timeline_export` with `timeline` = the film's timeline. Reply with the link, the length, the unchecked claims of `doc/script.md`, the shots you would retake, and that you saw stills and heard no sound.

## When a result is off

- A shot has text, a logo or a person nobody asked for: retake it with the unwanted thing named in the prompt's last line.
- A shot has music or a voice: retake it once; when the retake has it too, offer `dv_timeline_mute` with `target: video_track`, `track: 0`, which also removes the shots' ambient sound.
- A narration piece starts or ends inside a word: split the whole clip again with `at` = the times the user gives after listening.

## What this procedure cannot do

When the user asks for one of these, say so before writing the script:

- Titles, captions, subtitles or labels over the picture: the timeline has no text track.
- Music made for the film: no model here writes music; the user can give a file.
- Real footage, or a real person's face or voice: everything is generated; the user can import footage as clips.

## Sources

- MiniMax H3 skills (https://github.com/MiniMax-AI/MiniMax-H3), restated.
