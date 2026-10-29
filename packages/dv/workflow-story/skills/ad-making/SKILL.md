---
name: ad-making
description: "The procedure for a short product ad made from the user's product photo: the start questions and three storylines, a spec with numbers and a banned list, and ranked review notes, each in a text node; the user's agreement before rendering, one render per aspect ratio, and the export. For requests such as a product ad, an e-commerce ad or a launch video."
---

# Ad making

An ad has one cut, a 5 to 15 s film, per aspect ratio; the video model draws the copy and makes the sound. The project block in your system prompt is the current state; read it before every call, pass `reason` wherever a tool requires it, and pass `base_version` to every `dv_textnode_write` and `dv_textnode_edit`: `0` for a new path, else the newest `version` you saw. Make every picture and sound with this project's tools; for anything else (last section), say so once, offer the nearest thing, and add nothing unasked.

## When to use it

The user wants an ad or product film of a physical product from a product photo. Not for a talking-head ad, an edit of existing clips, or a screen demo.

## 1. Product and model

When the project block names no project, call `dv_proj_create` with `title`. A file the user attaches becomes a project asset. With no product photo, ask for one and stop.

If `dv_inspect_image` is in your tool list, call it with `inputs.image` = the photo's asset ID and `question` = "Product, body color, material, moving parts; is the photo sharp?"; otherwise read these facts from the photo.

Say the facts in one line. When the photo cannot show the product, say what to reshoot and stop.

Use a `ref2v` video model that renders sound, such as `fasth3` with its provider from the model catalog, and the photo as its reference.

If `dv_models_get` is in your tool list, call it with `modality: video`, `task: ref2v`, `provider` and `model`, and offer only the durations and aspect ratios it lists; otherwise offer 5, 10 or 15 s.

## 2. Brief and three storylines (one stop)

Write the text node `ad/storylines.md` with `dv_textnode_write`:

- One line of defaults: main variant and color; 10 s (or 5 or 15); 16:9 (each extra ratio renders again); the look (white studio, dark rim light, brand color field, lifestyle scene); no spoken line.
- Three storylines in words, three different films. Fit these spines to the product: launch (hero view, detail, the product's own action, closing), feature touch (still, trigger, action, detail, result), color family (main variant, the others enter, the set closes). Each gives its name, the first 2 seconds exactly, and its beats, look and sound in one line each. Put your recommendation first with its reason.
- Two or three copy lines: English, 3 to 5 words, at most 32 characters, no slogan. Translate a line the user gave in Chinese.

Point the user to `ad/storylines.md` and end the turn with one question in bold, such as **Which storyline and copy line, and do the defaults hold?** Build nothing before the user picks. On "you decide" or "no stops", take your recommendation, name the other two in one line each, and go on.

## 3. Spec with numbers

Read `ad/storylines.md` with `dv_textnode_read` first; the user can edit it. Write the spec to `ad/spec.md` with `dv_textnode_write` and `from: [ad/storylines.md]`, and repeat its numbers in every prompt:

- BEATS: 3 to 4 for 5 s, 5 to 7 for 10 s, 6 to 9 for 15 s, each a time range with one real action of this product (the lid opens 30 degrees). The last 2 s hold the product and the copy.
- LOOK: background hex, key light direction, the product at least 40% of the frame height in the hero beat, its body color and finish unchanged.
- COPY: at most twice in 10 s, one line at a time in the middle band, held at least 0.3 s a word plus 0.5 s; first half dark gray (white on a dark look), second half the product's color by name. Never write arrows, slashes or plus signs; the model draws them.
- SOUND: about 100 BPM, plucks, a soft kick, no vocals, a hard stop on the last beat; or the spoken line.
- 9:16: recompose, never squeeze; the product and the copy stay between 9% and 69% of the height from the top.
- BANNED: split screens, panels, grids; mirror floors; glow, particles, flares; invented interfaces, numbers or claims; a logo the user did not give; a recolored product. Add each default a review finds to `ad/spec.md` with `dv_textnode_edit`.

## 4. Spoken line (only when asked)

The spoken line sets the shortest shot length; a line too long for the model gets fewer words.

If `dv_audio_generate` is in your tool list, load the prompt skill of its speech model, call it with `modality: audio`, `task: t2a`, `provider`, `model` and `prompt` = the line in that skill's markup, and keep `duration_sec` at least the voice clip's `duration_sec` rounded up plus 1 s; otherwise write the line as dialogue in the prompt and count 0.4 s a word (4 Chinese characters a second) plus 1 s.

You cannot hear a voice clip; the user picks the take in step 5.

## 5. Prompts and ask (one stop)

Load the prompt skill of the video model and task, and follow it.

1. Per aspect ratio, one prompt carries every beat, cites the photo and the voice clip as `@[<label>](dv:asset/<AssetId>)`, spells out each copy line word for word with its time window and colors, and ends with the BANNED line. A prompt missing a copy line is not ready.
2. Add a beat table (time, picture, camera, copy, sound) and each prompt to `ad/spec.md` with `dv_textnode_edit`.
3. Reply with one line per aspect ratio (ratio, length) and the voice clip links, point the user to `ad/spec.md`, and end the turn with one question in bold, such as **Render both cuts now?** Generate nothing before the user agrees.

## 6. Render and lay out each cut

When the user agrees, read `ad/spec.md` with `dv_textnode_read` and render from it. Per aspect ratio, `dv_shot_render` with `modality`, `task`, `provider`, `model`, `duration_sec`, `aspect_ratio`, `prompt` and `inputs.reference` (the photo's asset ID, and any voice clip's). Fix any value a refusal names and call again. Then call `dv_proj_wait`. Per aspect ratio, `dv_timeline_create` with a new `timeline` ID, `name` (such as "Mug ad 9:16") and `inputs.clip` = output #0 of that ratio's render.

## 7. Ranked review

If `dv_asset_grab_still` is in your tool list, call it once per still with `inputs.video` = the cut's asset and `at` = the middle second of each copy beat, then `last`, and look at each still; otherwise ask the user to check the copy and the color.

Write the notes to `ad/review.md` with `dv_textnode_write` and `from: [ad/spec.md]`, one line per problem as `t=4.2s · where · problem → exact change · what stays`, ranked. P0 breaks the ad: misspelled or doubled copy, a wrong color, a banned item, a wrong ratio. P1 weakens it: over 3 s with nothing new, a soft ending. P2 is polish. Never score the cut.

To fix a cut, change its prompt in `ad/spec.md` with `dv_textnode_edit`, wait for the user to agree, then call `dv_shot_render` with `based_on` = the cut's render, wait with `dv_proj_wait`, and call `dv_timeline_update` with `timeline` = that ratio's timeline and `inputs.clip` = output #0 of the new render.

## 8. Deliver

`dv_timeline_export` with `timeline` = each ratio's timeline. Reply with each link, ratio and length, the copy, the storylines not built, the open notes of `ad/review.md`, and what nobody checked (you saw stills and heard no sound). Offer one next step once, such as another ratio.

## What this procedure cannot do

When the user asks for one of these, say so before writing the spec:

- Voice-over or music laid over the cut: no audio lane; the sound comes from the shot.
- Titles, captions, a logo or an end card over the picture: no text lane; the model draws the copy.
- A product picture made from the photo: the image model takes text only.

## Sources

- MiniMax H3 skill `minimalist-product-ad-generator` v0.5.6 (https://github.com/MiniMax-AI/MiniMax-H3): start questions, spines, copy and beats, restated.
- HyperFrames skills (https://github.com/heygen-com/hyperframes, Apache-2.0): storylines, spec, banned list, holds, 9:16 band, ranked notes, host tools first.
