---
name: video-directing
description: "The planning procedure for making or changing a video with the dv_* tools: project setup, the story and its shots, a model, a task and inputs for each shot, prompts written with the prompt skill of that model and task, retakes and stale shots."
whenToUse: "The user wants a video made or extended from a description and references, or wants shots of an existing project planned, retaken or restyled."
---

# Video directing

Every `dv_*` call becomes a record the user sees as a chat card, a canvas node, and a timeline clip. The project block in your system prompt is the current state; read it before every call. Follow this procedure in order unless the user asks for something narrower.

For a single text-only shot, describe characters, places and style in the prompt. Use references when the user supplies or requests them, or when visual continuity requires them.

## 1. Project setup

1. When the project block names a project, work in it; never create or switch projects. Only a conversation with no project starts one with `dv_proj_create`.
2. `dv_asset_import` every reference the user gave (`path`, `mime`). Look at each image with `dv_inspect_image` and say in one line what it shows.
3. Before any render, create a reference for everything that must look the same across shots, with the imported asset IDs as its reference images. Any reference kind that the DreamVerse project rules in your system prompt list can be a shot reference (`<id>@<version>`). Before you create or change a reference of a kind, load that kind's skill from your skill list when the kind ships one; it gives the tool and its arguments.

## 2. Organize the story and its shots

1. Split the story into shots, one clear action each. Divide the requested duration by the shot length. Default to the duration the selected model lists that is closest to 5 s, and use only listed durations. "15 seconds" at 5 s is three shots; "30 seconds" is six.
2. Write one line per shot: what happens, the camera, and which references appear. Mark whether the shot is independent, an intentional discontinuity, or continuity-linked to the previous shot.
3. Write a compact cinematic profile for the whole story: style, palette, lighting, camera language, depth of field, motion blur, grain, aspect ratio and sound style. Note intentional per-shot changes.
4. Keep the storyboard objective stable after the user agrees. For a continuity-linked shot, finalize its prompt only after the previous shot finishes and you have inspected the previous shot's actual ending.

## 3. Choose each shot's model, task and inputs

Choose each shot's model with the `video-model-selection` skill: `dv_models_list` lists the models with their tasks and descriptions, and `dv_models_get` gives one model's durations, input limits and `extra` parameters. Each shot names the `modality`, `task`, `provider` and `model` of one listed model.

- Task `ref2v` takes the prompt and reference images (`references`: `c1@1` or asset IDs), and `continue_previous` where the model takes a first frame. The model's schema gives the reference count; `fasth3` needs at least one. Task `t2v` takes the prompt alone.
- A shot with a reference that must look like its reference images uses task `ref2v`. A shot that needs no reference image (a landscape, an establishing shot, an object the user only described) can use task `t2v` with a model that serves it.
- When a shot needs task `ref2v` and the user gave no reference image, ask for one (the user can attach it in the chat) before planning.
- `continue_previous: true` makes a shot start from the last frame of the previous shot. It is a choice per shot: use it when the shot continues the previous action in the same place; leave it out for an intentional cut, a new scene, a time jump, or an unrelated shot. Shot 1 never continues.
- A continuing shot renders with the last frame of the previous shot as its `first_frame` input, so its prompt follows the first-frame rule of its prompt skill (section 5).
- Plan-level `references` apply to every task `ref2v` shot that names no `references` of its own.
- Use provider-specific latent, motion or alignment controls only when `dv_models_get` lists them in `extra`. Do not invent parameters such as previous-clip latent reuse or RoPE alignment; otherwise express continuity through `continue_previous`, reference frames and prompt constraints.
- Do not change a shot's model, task, references or `continue_previous` on your own after the user agreed to the plan; propose the change and stop.

## 4. Inspect completed shots for continuity

For each continuity-linked pair, inspect the actual completed previous shot before you write or revise the next shot's final prompt.

1. Wait for the previous render to finish and read the current project state.
2. Inspect the final 0.5 to 1.0 seconds with ordered stills when available; use the last frame alone only when no other frame can be inspected.
3. Produce a compact continuity state with only facts relevant to the next shot, and write `unknown` instead of guessing. Include `shot_id`, character action phase and motion, camera motion, scene lighting/palette, props, pending actions, `references.last_frame` and ordered `references.motion_frames`.

## 5. Check shot boundaries

After a continuity-linked shot finishes, review the boundary from the previous shot into it before moving on.

1. Compare the previous ending window with the new starting window when still-grab and image-inspection tools are available.
2. Produce a compact review with `status: pass | minor_issue | fail`, severity, issue types, evidence and whether the boundary was intentional.
3. Check visual, motion and narrative continuity separately. A large frame difference is fine for an intentional cut, not for an unplanned character reset, missing unfinished action, prop change, direction reversal or camera stop.
4. For `minor_issue`, continue and name the limitation. For `fail`, propose one repair such as prompt revision, different reference frames, a retake, a supported bridge or an intentional cut; wait for the user before another render.

## 6. Write each prompt with the prompt skill of its model and task

Before writing the prompts, load the prompt skill of every model and task the plan uses from your skill list. Write each independent shot's `prompt` with the rules of its skill. A task `ref2v` prompt cites its reference images as `@[<label>](dv:asset/<AssetId>)`; a task `t2v` prompt describes everything in words.

For a continuity-linked shot, combine the storyboard objective with the previous shot's continuity state. Add an explicit continuity passage inside the model's prompt format:

- Begin from the previous ending pose, action phase, motion direction, spatial relationship, lighting, palette and camera motion where observed.
- Continue unfinished actions before starting the new beat. Do not assume an action finished just because the previous prompt planned it.
- Keep hard constraints: character identity, required story state, prop ownership and the first-frame citation when `continue_previous` is used.
- Treat approximate speed, framing, lighting and camera motion as soft constraints unless the user or storyboard makes them mandatory.
- Drop continuity constraints across intentional cuts, new scenes and time jumps, but keep stable references such as character or prop identity when they remain in story.
- State uncertainty explicitly, for example "the hand position is not clear in the inspected frames", and avoid inventing a precise pose.
- Reuse the cinematic profile unless the storyboard intentionally changes it. Restate concise color, lighting, camera and style constraints in every prompt.

## 7. Retakes the user asks for

The `timeline-editing` skill maps each editing request to its tool calls. The rules behind it:

- **A retake keeps the model, the task and the inputs.** A retake of clip N calls `dv_shot_render` with the `modality`, `task`, `provider`, `model`, `inputs.reference` and `continue_from` of the record that produced clip N, `based_on` = that record, `supersedes: [that record]`, and a prompt that changes only what the user named.
- **A render you propose on your own waits for the user.** Describe it, then stop and ask in bold.

## 8. When a reference changes

An update of a reference writes its next version and makes every record that used the old version stale, and a retake that `supersedes` a record makes the records that used its outputs stale. Nothing is redone by itself.

1. Read the "stale" records in the project block.
2. List the affected shots by clip position.
3. Ask in bold which to redo. Never render a stale shot again without that answer.
4. Redo the agreed ones as retakes (section 7) with the new reference version in `inputs.reference`.

## 9. Words to the user

- "This person", "she" or "he" is the reference of a person; with one such reference it is that one. When the user's words fit two references, clips or shots and the message has no `dv:` mention that names one, ask; do not guess.

## 10. Do not

- Do not render before the user agreed to the plan, and do not render stale shots again before the user chose.
- Do not invent appearance details.
- Do not create a second plan to extend or change a story; update its plan.
