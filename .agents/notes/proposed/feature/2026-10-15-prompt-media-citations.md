# Agent Note: Prompt media citations

Status: proposed

English | [中文](2026-10-15-prompt-media-citations.zh.md)

## Problem

A render call takes a `prompt` and a separate `reference` list. The prompt names each reference with a MiniMax H3 token, such as `<Picture 1>`. This design has two problems:

1. The tokens work for one model only. Other video models use a different syntax.
2. A person who reads the prompt cannot see which media each token names.

## Proposal

A render call keeps two inputs: the reference list and the prompt. The prompt cites the items of the reference list in one harness syntax. Each model plugin changes the citations to the syntax of its model. Existing prompts and projects do not need migration.

### Terms

- **Reference list**: the `reference` inputs of a render call, in input order. The model plugin sends these media to the model.
- **Citation**: text in a prompt that names one project item, written as `@[<label>](dv:<kind>/<id>)`.
- **Input citation**: a citation of an input of the render call by its role, written as `dv:input/<role>`, for example `dv:input/first_frame`. It names the input whatever its value is, so it also names a value that a record has not produced yet.
- **Element**: a named group of reference media in a project, with versions. An element is a harness concept for people and the agent. A video model does not know elements.

### Ownership

| Step                                                                | Owner                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Define the citation syntax and parse citations                      | `@dv/project`                                              |
| Insert and show citations in the UI                                 | `@dv/ui-composer` and `@dv/ui-canvas`, after `@dv/project` |
| Check the citations against the reference list, and expand elements | `@dv/shot-render`                                          |
| Declare the reference limits and change the citation syntax         | Each model plugin, for example `@dv/fastvideo`             |

`@dv/project` owns the citation syntax because the project holds the records and the history that the citations name. `@dv/models` is only the catalog of the registered models.

### Rules

1. A render call takes a reference list and a prompt. The harness sends the prompt as written; it does not rewrite it.
2. The prompt cites items of the reference list by their assets, and other inputs of the call by their roles. If a citation names an asset that is not in the reference list, or an input that the call does not have, then the render call returns an error.
3. An item of the reference list that the prompt does not cite is sent to the model as usual.
4. The first frame is the `first_frame` input of the call. It comes from `continue_from`, or from a plan shot with `continue_previous`. The prompt cites it as `dv:input/first_frame`. A plan shot can cite it only when the shot continues the previous shot; otherwise `plan.create` and `plan.update` return an error.
5. An element version can be an item of the reference list. At render time, the harness expands the element into its media, and expands each citation of the element into citations of the media. The agent and the model plugins do not expand elements.
6. Each take keeps the source prompt and the expanded prompt. The `shot.render` result includes the expanded prompt.
7. Each model plugin declares its reference limits and changes each citation into the label that its model reads. For example, MiniMax H3 reads the k-th reference image as `<Picture k>`.
8. A model plugin can add the prompt rules of its model. MiniMax H3 has no first-frame slot, so its plugin returns an error for a call with a first frame that the prompt does not cite.

### First frame

The first frame breaks the assumption that a cited item already exists with an asset ID when the prompt is written. It is a separate input of the call. In a plan, it is the last still of the previous shot, which does not exist when the agent writes the plan. An input citation names the input by its role, so it does not need the value.

Most video models take the first frame in a separate slot, and the prompt does not name it. MiniMax H3 has one media list: an image is the first frame only because the prompt says so, for example `[keyframe completion] … <Picture 2> is the first frame of [Shot 1]` (its official guide, sections 2.2, 3 and 5.3). Workflow tools solve the same problem in the same way: a step names the output of an earlier step, and the value is filled in when the step runs.

| System         | How the first frame enters the request        | Does the prompt name it?              |
| -------------- | --------------------------------------------- | ------------------------------------- |
| MiniMax H3     | In the media list, after the reference images | Yes, and it must                      |
| Seedance 2.0   | Each image has a role, such as `first_frame`  | No; prompt text cannot set the role   |
| Google Veo 3.1 | A separate `image` field                      | No                                    |
| Kling          | A separate `image` field                      | No                                    |
| Luma           | `keyframes.frame0`                            | No                                    |
| Runway         | `promptImage` with `position: first`          | No                                    |
| GitHub Actions | Not applicable                                | A step names an earlier step's output |

The cases work as follows:

- **A direct render that continues a finished take.** The agent passes `continue_from` and writes `@[首帧](dv:input/first_frame) is the first frame of [Shot 1]`. The runner resolves the input to the take's last still. The MiniMax H3 plugin changes the citation into the `<Picture N>` after the reference images.
- **A plan shot that continues a shot that is not rendered.** The prompt contains the same citation. `plan.approve` adds the `first_frame` input; the runner resolves it after the previous shot renders. Nothing rewrites the prompt.
- **A model with a first-frame slot.** Its plugin puts the frame in the slot. Its skill tells the agent not to cite the frame; a citation of it becomes its label.
- **A last frame or a keyframe.** It is another input, cited as `dv:input/last_frame` or `dv:input/keyframe/2`.

### Deferred

A notice in the UI for a reference that the prompt does not cite waits for user feedback.

### Delivery

- Each pull request depends only on merged pull requests. Open the next pull request after its base merges.
- Each pull request changes at most about 300 lines outside tests.
- After each merge, `main` works.

The pull requests come in this order:

1. This Agent Note.
2. The citation parser in `@dv/project`, and the change to `<Picture N>` in `@dv/fastvideo`. A prompt without citations renders as before.
3. The check of the citations against the reference list in `shot.render`, with the tool descriptions and the skills.
4. The citation thumbnails in the take editor and the plan view.
5. The first-frame citation `dv:input/first_frame`, with the plan check and the MiniMax H3 prompt rule.
6. Element citations and their expansion.
7. Video citations.
8. Audio citations.

## Alternatives considered

**Read the reference list from the prompt only.** A user can type any text into a prompt, and a plain-text prompt cites nothing. A separate reference list keeps every reference that the user adds, and it matches the request of the video models: a list of media and a prompt that names them.

**Cite the first frame by its value.** The prompt would cite the last still as `dv:record/<record>#1`. A plan shot cannot cite a record that does not exist yet, so a plan would need its own syntax that `plan.approve` rewrites, and the same image would have two spellings.

**A placeholder only for the first frame (`dv:first-frame`).** It works, but each later input (last frame, keyframes) would need its own placeholder. An input citation by role covers all of them with one syntax.

**Model tokens in the prompt.** Each video model uses a different syntax. Positional tokens also change their numbers when the reference order changes.

**Cite only single media of an element.** The user must select each medium every time. Video products that group reference media insert one citation for the group.

**Expand elements in the agent.** The agent must find the media of each element, and the prompt loses the group.

**Expand elements in each model plugin.** Each plugin must know elements, and each plugin repeats the same code.

**Drop the media over the limit.** The harness removes media silently and decides for the agent or the user.

## Acceptance criteria

1. A render call whose prompt cites an asset outside the reference list returns an error and does not render.
2. For a prompt that cites one image of the reference list, `@dv/fastvideo` sends `<Picture 1>` and that image.
3. An element citation expands into the media of that element version, and the take keeps both prompts.

## Risks

1. The harness sets the text of an expanded element. A model can follow this text less well than text that its plugin writes.
2. An input citation has no thumbnail in the UI before the value of the input exists.
3. The agent follows the rule of each model on whether to cite the first frame. The MiniMax H3 check enforces the rule for MiniMax H3.
