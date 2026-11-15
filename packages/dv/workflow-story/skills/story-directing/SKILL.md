---
name: story-directing
description: "The order of calls from a story to rendered shots on a timeline: write the theme, the beats and the storyboard as text nodes, wait for the user to agree, render each shot with dv_shot_render, wait, and lay the takes on a timeline."
whenToUse: "The user wants a story or a multi-shot video made, or wants a story that is on a timeline extended, shortened or changed."
---

# Story directing

The order of calls from a story to rendered shots on a timeline: write the theme, the beats and the storyboard as text nodes, wait for the user to agree, render each shot, wait, and lay the takes on a timeline. The project block in your system prompt is the current state; read it before every call, and pass `reason` on every call.

## 1. Write the story as text nodes

Write each stage with `dv_textnode_write` (`path`, `title`, `body`, `base_version: 0`). Before you write a stage, call `dv_textnode_read` with the `path` of the stage before it and build from the text that it returns, since the user can have edited it. Pass that stage in `from`. Every `dv_textnode_edit` passes `base_version` = the newest `version` that you read or wrote.

1. `story/theme.md`: the premise, the characters, the location and the look, in a few lines.
2. `story/beats.md` with `from: [story/theme.md]`: the story as numbered beats, one line each.
3. `story/storyboard.md` with `from: [story/beats.md]`: a table of the shots (shot, model and task, duration, continuity: independent, intentional cut or continues previous, one line of action, camera), a compact cinematic profile for the whole story, and under it each shot's model key (`modality`, `task`, `provider`, `model`), its storyboard objective, planned prompt, references, `continue_from` intent and `duration_sec`.

If `dv_models_get` is in your tool list, call it for the model and task, and use only the durations and aspect ratios it lists. When the project already has a story, use another folder, such as `story-2/`.

## 2. Wait for the user to agree

Show the storyboard in a short summary and ask the user to read the text nodes on the canvas, change them there or tell you what to change. End the turn with one question in bold, such as **Render these 3 shots?** Generate nothing before the user agrees.

When the user asks for changes, change the text node with `dv_textnode_edit` and ask again. When the user agrees, call `dv_textnode_read` with `path: story/storyboard.md` and render from the text that it returns.

## 3. Create the references

When shots share a character, a location or a look, load the skill of that reference kind and create its versions first, so every shot cites the same version (`<id>@<version>`, such as `c1@1`) in `inputs.reference`.

## 4. Render each shot

Render in story order. Independent shots can use the agreed prompt directly. For a shot that continues the previous shot, do not treat the agreed prompt as final until the previous shot has finished and you have inspected its actual ending.

1. Call `dv_shot_render` for the next independent shot, or for the first shot of a continuity chain, with `modality`, `task`, `provider`, `model`, `prompt` and `duration_sec`; for task `ref2v` also `inputs.reference`, with each reference cited in the prompt. When a call is refused, fix the named value and call again.
2. Call `dv_proj_wait` for that render, then `dv_proj_state`. Read the finished render's video output and last frame.
3. When the next storyboard row is continuity-linked, inspect the finished render before calling `dv_shot_render` for the next shot.
4. If `dv_inspect_asset` is in your tool list, inspect the video output to get its duration.
5. If `dv_asset_grab_still` is in your tool list, grab three ordered stills from the ending window: about 1.0 s before the end, about 0.5 s before the end and `last`; for short clips, use `first`, the middle second and `last`.
6. If `dv_inspect_image` is in your tool list, inspect those stills in timestamp order for character motion, action phase, body orientation, movement direction and speed; camera motion and direction; scene, lighting, color palette, prop ownership and unfinished actions.
7. Write a compact continuity state with fields for characters, camera, scene, props, pending actions and frame references. Use `unknown` for uncertain facts.
8. Finalize the next shot's prompt from four inputs: the storyboard objective, the previous shot's continuity state, the intended narrative beat and the cinematic profile. Add a visible continuity passage inside the prompt that says how the shot begins from the actual ending, continues unfinished motion, preserves hard constraints and then transitions into the planned beat. Restate the relevant lighting, color, camera and style constraints. Do not carry motion constraints across rows marked intentional cut, new scene or time jump.
9. A shot that continues the previous shot passes `continue_from` = the record ID of the previous shot's render. Call it only after steps 2 to 8, so the project can use the previous take's last frame and the prompt can describe that actual state.
10. After a continuity-linked shot finishes, review the boundary from the previous shot into it before moving on.
11. If `dv_asset_grab_still` is in your tool list, grab the previous shot's late ending stills and the new shot's first or early stills.
12. If `dv_inspect_image` is in your tool list, compare the boundary stills for character identity, pose and action phase, movement direction, camera movement, spatial position, props, lighting and palette.
13. Write a boundary review with `status: pass | minor_issue | fail`, `severity`, `issue_types`, evidence and whether the issue was intentional. For `fail`, propose one repair such as a revised prompt, different reference frames, a retake of the new shot, a short bridge when supported or an intentional cut, then wait for the user before another render.
14. Repeat this loop until every shot is rendered. Report each finished shot with its link and, for continuity-linked shots, a one-line continuity state and boundary review summary.
15. If `dv_canvas_node_rename` is in your tool list, after rendering each new shot, find its canvas node ID in `dv_proj_state` and call `dv_canvas_node_rename` with `name: "<shot number> · <short shot description>"`, using the storyboard's shot number. Keep the short description to 4 words maximum. Use that name when discussing the shot. Preserve existing names on retakes and names chosen by the user.

## 5. Lay the takes on a timeline

Call `dv_timeline_create` with `inputs.clip` = output #0 of each shot's render, in story order (a render that is not done yet becomes a placeholder clip). Pass a new `timeline` ID and a `name` when the project already has a timeline.

## 6. Extend, shorten or change the story

One story is one timeline and one storyboard. The user asks for this about a timeline with words such as "make the story longer", "add a few more shots" or "change the story".

1. Change `story/storyboard.md` with `dv_textnode_edit`, show the new or changed shots, and wait for the user to agree as in step 2. A shot added after six shots is shot 7.
2. Render only the new or changed shots with `dv_shot_render`, in story order; a changed shot passes `based_on` = its earlier render. Each shot that continues a new render (the changed shot, or a shot this step renders again) renders again, with these calls:
   1. Before its render, call `dv_asset_grab_still` on the new previous render three times: at its duration minus 1.0 s, minus 0.5 s (4 and 4.5 for a 5 s shot) and `last`. Do this even when you already saw its last frame or other stills. Rewrite the shot's prompt from those stills (section 4 steps 7 and 8).
   2. Render it with `continue_from` = the new previous render.
   3. After its render, call `dv_asset_grab_still` on it at 0.5 s and 1.0 s, compare them with the previous ending stills, and write `Boundary <N-1>→<N>: pass | minor_issue | fail` and one reason in your reply.
3. Wait with `dv_proj_wait`, then call `dv_timeline_update` with `timeline` = the story's timeline and every clip in order, the unchanged clips as their earlier takes.
