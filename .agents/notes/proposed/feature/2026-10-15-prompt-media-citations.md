# Agent Note: Prompt media citations

Status: proposed

English | [中文](2026-10-15-prompt-media-citations.zh.md)

## Problem

A render call that takes a `prompt` and a separate `reference` list has three problems when the prompt refers to each reference with a MiniMax H3 token, such as `<Picture 1>` or `<Video 1>`:

1. The prompt and the `reference` list are two inputs. The agent can write two inputs that do not agree.
2. The tokens are specific to MiniMax H3. Other video models use different syntax. For example, Seedance uses `图片1`, and Kling uses `@<name>`.
3. A person who reads the prompt cannot see which image or video each token refers to.

## Proposal

Each prompt cites media directly. At render time, the harness and the model plugin change each citation to the syntax that the target model accepts. Existing prompts and projects do not need migration.

### Ownership

Each step has one owner. The harness parses, extracts, expands, and checks citations. Each model plugin changes the expanded citations to the syntax of its model. The agent writes only citations.

| Step                                                         | Owner                                                       |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| Define the citation syntax and parse citations on the server | `@dv/models`                                                |
| Insert citations from the `@` menu                           | `@dv/ui-composer` (chat), `@dv/ui-canvas` (take editor)     |
| Show citations as thumbnails in the client                   | `@dv/ui-kit`                                                |
| Extract the send list from the prompt                        | `@dv/shot-render` (`shot.render`)                           |
| Return the staged-item warning and the first-frame error     | `@dv/shot-render` (`shot.render`)                           |
| Expand character and location citations                      | `@dv/shot-render` (`shot.render`)                           |
| Check all shots of a plan before a render                    | `@dv/shot-plan` (`plan.approve`)                            |
| Declare the maximum number of references                     | Each model plugin, for example `@dv/fastvideo`              |
| Change citations to the syntax of the model                  | Each model plugin, for example `@dv/fastvideo`              |
| Find if a cited video has sound                              | The model plugin that needs it, for example `@dv/fastvideo` |

`@dv/models` owns the syntax because the syntax is part of the `RenderRequest` that the harness sends to each model plugin. In a `RenderRequest`, `prompt` holds the expanded citations, and `references` holds the cited assets in the order of their first citation.

### Citation syntax

A citation uses the chat syntax `@[<label>](dv:<target>)`. The target is one of these values:

| Target                                  | Cites                                  |
| --------------------------------------- | -------------------------------------- |
| `dv:asset/<asset-id>`                   | One image, video, or audio asset.      |
| `dv:first-frame`                        | The first frame of the take.           |
| `dv:character/<character-id>@<version>` | One version of a character.            |
| `dv:location/<location-id>@<version>`   | One version of a location.             |

### Send list

1. The harness extracts the send list from the citations in the prompt.
2. `shot.render` has no separate `reference` parameter. The agent writes only the prompt.
3. `shot.render` marks its `reference` input `fromParams`. For each caller, the runner of `@dv/project` reads the `reference` inputs from the prompt. The runner refuses a `reference` input from a caller.
4. A shot of a plan uses the same citations in its prompt. A plan has no separate reference list.
5. The UI shows a thumbnail and a list entry for each cited item.

### Reference area

The reference area of a take holds cited items and staged items. A staged item is an item in the reference area that the prompt does not cite.

1. The "Add asset" button adds an item to the reference area as a staged item.
2. The `@` menu shows the items of the reference area first.
3. If a user deletes an item that the prompt cites, then the UI refuses the deletion. The UI highlights each citation of that item in the prompt.
4. If a user deletes a citation from the prompt, then the item stays in the reference area as a staged item.

### Staged items at render time

The harness does not decide for the agent or the user. A person or the agent must make the decision.

1. If the reference area holds staged items, then `shot.render` does not render. `shot.render` returns a warning that lists the staged items.
2. The agent must call `shot.render` again with an explicit choice: send the staged items, or do not send them.
3. The UI shows a dialog with two buttons: "一起发送" (send the staged items) and "不发送" (do not send them).

### First frame

1. The take keeps the first frame in the `continue_from` field.
2. The prompt can cite the first frame with `@[首帧](dv:first-frame)`.
3. If the prompt cites `dv:first-frame` and `continue_from` is empty, then the harness returns an error before the render.
4. If `continue_from` has a value and the prompt does not cite the first frame, then the harness renders the take.
5. The MiniMax H3 plugin changes the first-frame citation to the next `<Picture N>` token. If a model has a first-frame input, then its plugin puts the frame in that input and changes the citation to plain text.

### Characters and locations

A character is a harness concept for people and the agent. A character is a named group of reference images. The group tells people and the agent that the images show the same person. A location is a named group of reference images for one place, and it follows the same rules as a character. The video model does not know characters or locations. The model receives only specific images and videos.

1. When a user selects a character in the `@` menu, the UI inserts one character citation. For example, the UI inserts `@[Jensen](dv:character/c1@1)`. The citation includes the character version.
2. A user can open the submenu of a character and cite one image of that character.
3. At render time, the harness expands each character citation into citations of its images. The harness keeps the image order of the character. For example, the harness replaces `@[Jensen](dv:character/c1@1)` with `Jensen (@[Jensen · front](dv:asset/a1) @[Jensen · side](dv:asset/a2))`.
4. The harness does the expansion. The agent and the model plugins do not expand characters.
5. Each take keeps two prompts: the source prompt with character citations, and the expanded prompt that the harness sends to the model plugin. Because each citation includes a version, a later change to the character does not change an earlier take.
6. The `shot.render` result includes the expanded prompt. The agent can see the images that the model receives.

### Model plugin translation

1. After the expansion, a prompt contains only asset citations and first-frame citations.
2. Each model plugin changes these citations to the syntax of its model. For example, `@dv/fastvideo` changes them to the MiniMax H3 tokens `<Picture N>`, `<Video N>`, and `<Audio N>`.
3. MiniMax H3 gives the sound of a video its own `<Audio N>` token. The `Asset` type does not record sound. Thus the MiniMax H3 plugin must examine each cited video on the server to find if the video has sound.

### Reference limits

1. Each model plugin declares the maximum number of reference images that its model accepts.
2. If the expanded prompt cites more images than this maximum, then `shot.render` does not render. `shot.render` returns a warning. The agent or the user decides how to change the prompt.

### Plan approval

`plan.approve` calls `shot.render` for each shot of an approved plan.

1. Before it renders a shot, `plan.approve` checks all of the shots in the plan.
2. If one or more shots have a warning or an error, then `plan.approve` renders no shot.
3. `plan.approve` returns the warnings and errors of all of the shots together.

### Delivery

Seven pull requests deliver the proposal. Each later pull request depends only on the first one.

1. Image citations through all layers: the syntax and the parser, the send list, the plan shots, the MiniMax H3 translation to `<Picture N>`, the tool descriptions and the skills, and the citation thumbnails in the take editor and the plan view.
2. The reference area: staged items, the refused deletion, and the staged-item warning.
3. The first frame: `dv:first-frame`.
4. Characters and locations: the expansion, the versions, and the expanded prompt of each take.
5. Video citations: `<Video N>`.
6. Audio: the sound check and `<Audio N>`.
7. The check of all shots of a plan before a render.

## Alternatives considered

**Separate reference list.** The agent writes the prompt and the `reference` list. The two inputs can disagree. The prompt is the only source of the send list, so the agent cannot make this error.

**Send staged items automatically.** Most video products send all items in the reference tray, cited or not. Cursor 2.0 had a defect: it sent an attachment that the user had removed. The harness does not make this decision for the agent or the user, so it returns a warning.

**Allow the deletion of a cited item with a warning.** IntelliJ Safe Delete warns and then deletes. The deletion leaves a citation that has no target. The UI refuses the deletion and shows each citation instead.

**Model tokens in the prompt.** `<Picture N>` is MiniMax H3 syntax. Seedance, Wan, and Kling use different syntax. Positional tokens also change number silently when the reference order changes.

**Only single-image citations for a character.** The user opens the character submenu and selects one image each time. No product that we examined does this. Kling, Vidu, Google Flow, Luma, and Krea insert one citation for the group. Krea also expands the group into its images at render time.

**Expansion by the agent.** The agent must find the images of each character. This adds a possible error. The prompt also loses the information that the images are one character.

**Expansion by each model plugin.** Each plugin must know characters, but characters are a harness concept. Each plugin also repeats the same code.

**Keep the first images when the count is more than the limit.** Krea keeps the first images in the image order. This removes images silently, so it decides for the agent or the user.

**Render the shots that have no warning.** The plan stays partly rendered. If a change to one shot causes changes to the plan, then the rendered shots are wasted.

## Acceptance criteria

1. `shot.render` has no `reference` parameter. The harness extracts the send list from the prompt.
2. For a prompt that cites one image, `@dv/fastvideo` sends `<Picture 1>` and that image.
3. A prompt with staged items in the reference area returns a warning and does not render.
4. A prompt that cites `dv:first-frame` with an empty `continue_from` field returns an error before the render.
5. A character citation expands into the images of that character version. The take keeps the source prompt and the expanded prompt.
6. An expanded prompt that cites more images than the model maximum returns a warning and does not render.
7. `plan.approve` renders no shot when one or more shots have a warning or an error.

## Risks

1. The removal of the `reference` parameter changes the tool contract of the agent. Prompts that use `<Picture N>` tokens do not work after this change.
2. The harness sets the text format of an expanded character. Some models can follow this format less well than a format that the model plugin writes.
3. The sound check adds one server-side examination for each cited video.
