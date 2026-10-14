---
name: video-directing
description: "The planning procedure for making or changing a video with the dv_* tools: project setup, the story and its shots, a model, a task and inputs for each shot, prompts written with the prompt skill of that model and task, a plan the user agrees to in the conversation, then rendering, retakes and stale shots."
whenToUse: "The user wants a video made or extended from a description and references, or wants shots of an existing project planned, rendered, retaken or restyled."
---

# Video directing

Every `dv_*` call becomes a record the user sees as a chat card, a canvas node, and a timeline clip. The project block in your system prompt is the current state; read it before every call. Follow this procedure in order unless the user asks for something narrower.

## 1. Project setup

1. When the project block names a project, work in it; never create or switch projects. Only a conversation with no project starts one with `dv_proj_create`.
2. `dv_asset_import` every reference the user gave (`path`, `mime`). Look at each image with `dv_inspect_image` and say in one line what it shows.
3. `dv_bible_character_create` for every person who must stay the same across shots, before any render: `character` (short ID such as `c1`), `name`, `description` (wardrobe and mood only, never facial features), `inputs.reference` (the imported asset IDs). `dv_bible_style_create` only when the user named a look (film grain, palette, lens). `dv_bible_location_create` only when one place must stay identical across shots.

## 2. Organize the story and its shots

1. Split the story into shots, one clear action each. Shot count = requested duration divided by the shot length (default 5 s, whole seconds inside the range of the model). "15 秒" is three shots; "30 秒" is six.
2. Write one line per shot: what happens, the camera, and which characters, locations or styles appear.

## 3. Choose each shot's model, task and inputs

Choose each shot's model with the `video-model-selection` skill: `dv_models_list` lists the models with their tasks and descriptions, and `dv_models_get` gives one model's durations, input limits and `extra` parameters. Each shot names the `modality`, `task`, `provider` and `model` of one listed model.

- Task `ref2v` takes the prompt and reference images (`references`: `c1@1` or asset IDs), and `continue_previous` where the model takes a first frame. The model's schema gives the reference count; `fasth3` needs at least one. Task `t2v` takes the prompt alone.
- A shot with a character, a location or a style that must look like its reference images uses task `ref2v`. A shot that needs no reference image (a landscape, an establishing shot, an object the user only described) can use task `t2v` with a model that serves it.
- When a shot needs task `ref2v` and the user gave no reference image, ask for one (the user can attach it in the chat) before planning.
- `continue_previous: true` makes a shot start from the last frame of the previous shot. It is a choice per shot: use it when the shot continues the previous action in the same place; leave it out for a new angle, a new scene, or an unrelated shot. Shot 1 never continues.
- Plan-level `references` apply to every task `ref2v` shot that names no `references` of its own.
- Do not change a shot's model, task, references or `continue_previous` on your own after the user agreed to the plan; propose the change and stop.

## 4. Write each prompt with the prompt skill of its model and task

Before writing the prompts, load the prompt skill of every model and task the plan uses from your skill list. Write each shot's `prompt` with the rules of its skill. A task `ref2v` prompt names the reference pictures; a task `t2v` prompt describes everything in words.

## 5. Create the plan, show it, and ask

1. `dv_plan_create` with `title`, `references` when shots share them, and `shots` (`modality`, `task`, `provider`, `model`, `prompt`, `duration_sec`, and per shot `references` or `continue_previous` when needed). The call needs no agreement; it records version 1. Its report names the plan ID (such as `p1`), one line per shot, and `gpu_seconds`, the GPU estimate of approving the plan.
2. Reply with a table (shot, model and task, duration, continues from the previous shot or not, one line of action, camera) and the report's GPU estimate. End the turn with one question in bold, such as **开始渲染这 3 个镜头吗？** Do not call `dv_plan_approve` in this turn.
3. When the user agrees in the next message: `dv_plan_approve` with `plan` and `user_approved: true`, then `dv_proj_wait`, then `dv_proj_state`. The approval renders every shot with its model and task and lays every shot on the plan's timeline.
4. Report each finished shot with its last frame (you receive it as an image) and its link. Inside an approved plan, never ask again.

If the user changes the plan before agreeing, call `dv_plan_update` with `plan` and the changed shots, show the changed plan with the GPU estimate of its report, and ask again.

### Extend, shorten or change the story

One story is one plan. To extend, shorten or change it, also after it was approved, update that plan; create a new plan with `dv_plan_create` only for a separate story.

1. `dv_plan_update` with `plan` = the plan ID from the project block and the complete next version: every shot in order, the unchanged shots copied exactly (same `modality`, `task`, `provider`, `model`, prompt, duration, references, `continue_previous` and seed) so their takes are kept. A shot added after six shots is shot 7.
2. Show only the new or changed shots and the GPU estimate from the `dv_plan_update` report (it lists the shots that keep their takes), and ask in bold.
3. When the user agrees: `dv_plan_approve` with `plan` and `user_approved: true`. Only new or changed shots render, and a shot with `continue_previous` after a rendered shot renders too; the plan's timeline gets every shot in order. Never lay a plan's shots onto a timeline by hand.

## 6. Retakes the user asks for

The `timeline-editing` skill maps each editing request to its tool calls. The rules behind it:

- **A retake keeps the model, the task and the inputs.** A retake of clip N calls `dv_shot_render` with the `modality`, `task`, `provider`, `model`, `inputs.reference` and `continue_from` of the record that produced clip N, `based_on` = that record, `supersedes: [that record]`, and a prompt that changes only what the user named.
- **A render the user asked for by name carries `user_requested: true`.** A render you propose on your own is described with its cost, and you stop and ask in bold.

## 7. When a reference changes

`dv_bible_character_update` (or a style or location update) makes every record that used the old version stale, and a retake that `supersedes` a record makes the records that used its outputs stale. Nothing is redone by itself.

1. Read the "stale" records in the project block.
2. List the affected shots by clip position.
3. Ask in bold which to redo. Never render a stale shot again without that answer.
4. Redo the agreed ones as retakes (section 6) with the new character, location or style version in `inputs.reference`.

## 8. Words to the user

- "这个人 / 她 / 他" is a character; with one character it is that one. When the user's words fit two characters, clips or shots and the message names no reference (a `dv:` mention), ask; do not guess.

## 9. Do not

- Do not render before the user agreed to the plan, and do not render stale shots again before the user chose.
- Do not invent appearance details.
- Do not create a second plan to extend or change a story; update its plan.
